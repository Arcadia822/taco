#!/usr/bin/env node
/**
 * execute-preview.mjs
 *
 * Runs in the UNTRUSTED, NETWORK-DISABLED capture container.
 * NO API keys, NO external network access.
 *
 * It reads the validated `preview-plan.json`, boots Chromium at 1280x800 desktop viewport,
 * drives the steps for each scene, captures screenshots on "shot" actions, and writes
 * out PNG files plus a `manifest.json`.
 *
 * CRITICAL RULE:
 * If a target element is missing or an interaction fails, it reports the failure explicitly!
 * It NEVER replaces a failed target with a fake success homepage snapshot.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validatePreviewPlan, DESKTOP_VIEWPORT } from './plan-schema.mjs'

const DEFAULT_TIMEOUT_MS = 30000

async function waitForServer(url, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // Waiting
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`Server at ${url} failed to respond within ${timeoutMs}ms`)
}

async function locateElement(page, step) {
  if (!step.target) throw new Error(`Step ${step.do} is missing a target selector`)
  let loc = page.locator(step.target)
  if (step.text) loc = loc.filter({ hasText: step.text })
  const count = await loc.count()
  for (let i = 0; i < count; i += 1) {
    const el = loc.nth(i)
    if (await el.isVisible()) return el
  }
  throw new Error(
    `Element not found or not visible: ${step.target}${step.text ? ` with text "${step.text}"` : ''}`,
  )
}

export async function executePlan(options = {}) {
  const {
    planFile,
    tacoFile,
    hostUrl,
    outDir,
    playwrightModule,
    timeout = DEFAULT_TIMEOUT_MS,
  } = options

  if (!planFile || !existsSync(planFile)) {
    throw new Error(`Plan file not found: ${planFile}`)
  }
  if (!tacoFile || !existsSync(tacoFile)) {
    throw new Error(`Taco bundle not found: ${tacoFile}`)
  }
  if (!hostUrl) throw new Error('Host URL is required')
  if (!outDir) throw new Error('Output directory is required')

  mkdirSync(outDir, { recursive: true })

  const rawPlan = JSON.parse(readFileSync(planFile, 'utf-8'))
  const plan = validatePreviewPlan(rawPlan)

  const manifest = {
    version: 1,
    planSource: plan.source,
    plannerModel: plan.model,
    status: 'passed',
    summary: plan.summary,
    mismatch: plan.mismatch,
    unseen: plan.unseen,
    scenes: [],
    errors: [],
    executedAt: new Date().toISOString(),
  }

  if (!plan.ui_change || plan.scenes.length === 0) {
    console.log('[execute-preview] Plan specifies no UI change. Writing manifest.')
    manifest.status = 'unavailable'
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
    return manifest
  }

  // Load Playwright
  let playwright
  if (playwrightModule) {
    playwright = await import(pathToFileURL(playwrightModule).href)
  } else {
    playwright = await import('playwright')
  }
  const { chromium } = playwright.default || playwright

  await waitForServer(hostUrl, timeout)

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  })

  const context = await browser.newContext({
    viewport: DESKTOP_VIEWPORT,
    deviceScaleFactor: 1,
  })

  const tacoUrl = pathToFileURL(resolve(tacoFile)).href

  try {
    for (const scene of plan.scenes) {
      console.log(`[execute-preview] Executing Scene: ${scene.id} ("${scene.title}")`)
      const sceneResult = {
        id: scene.id,
        title: scene.title,
        status: 'passed',
        steps: [],
        screenshots: [],
      }

      const page = await context.newPage()
      try {
        const targetUrl = scene.target === 'taco' ? tacoUrl : hostUrl
        await page.goto(targetUrl, { waitUntil: 'load', timeout })
        if (scene.target === 'taco') {
          await page.waitForSelector('#app', { timeout })
          await page.waitForFunction(() => !document.getElementById('taco-splash'), { timeout })
        } else {
          await page.waitForSelector('#app, main', { timeout })
        }
        await page.waitForTimeout(500)

        // Execute steps
        for (let i = 0; i < scene.steps.length; i += 1) {
          const step = scene.steps[i]
          const startMs = Date.now()
          const stepRecord = {
            stepIndex: i,
            action: step.do,
            status: 'passed',
            target: step.target,
            durationMs: 0,
          }

          try {
            switch (step.do) {
              case 'click': {
                const el = await locateElement(page, step)
                await el.click({ timeout: 5000 })
                await page.waitForTimeout(400)
                break
              }
              case 'hover': {
                const el = await locateElement(page, step)
                await el.hover({ timeout: 5000 })
                await page.waitForTimeout(300)
                break
              }
              case 'wait': {
                await page.waitForTimeout(step.ms || 500)
                break
              }
              case 'scroll': {
                if (step.to) {
                  const el = await locateElement(page, { target: step.to })
                  await el.scrollIntoViewIfNeeded()
                }
                break
              }
              case 'open-file': {
                if (step.path) {
                  // Click file item in Taco file browser sidebar
                  const fileSelector = `[data-path="${step.path}"], .file-tree-item`
                  const item = page.locator(fileSelector).filter({ hasText: step.path }).first()
                  await item.click({ timeout: 5000 })
                  await page.waitForTimeout(500)
                }
                break
              }
              case 'shot': {
                const filename = `${scene.id}-${step.name}.png`
                const shotPath = join(outDir, filename)
                await page.screenshot({ path: shotPath })
                sceneResult.screenshots.push({
                  filename,
                  name: step.name || '',
                  caption: step.caption || '',
                  status: 'passed',
                })
                break
              }
            }
          } catch (stepErr) {
            console.error(
              `[execute-preview] Step ${i} (${step.do}) failed in Scene ${scene.id}:`,
              stepErr.message,
            )
            stepRecord.status = 'failed'
            stepRecord.error = stepErr.message
            sceneResult.status = 'failed'
            sceneResult.error = `Step ${i} (${step.do}) failed: ${stepErr.message}`

            // If a shot step failed or failure occurred before shot, capture failure state
            const errFilename = `${scene.id}-failure.png`
            await page.screenshot({ path: join(outDir, errFilename) }).catch(() => {})
            sceneResult.screenshots.push({
              filename: errFilename,
              name: 'failure-state',
              caption: `[EXECUTION FAILED] ${stepErr.message}`,
              status: 'failed',
            })
            sceneResult.steps.push(stepRecord)
            break
          }

          stepRecord.durationMs = Date.now() - startMs
          sceneResult.steps.push(stepRecord)
        }
      } catch (sceneErr) {
        sceneResult.status = 'failed'
        sceneResult.error = sceneErr.message
      } finally {
        await page.close()
      }

      manifest.scenes.push(sceneResult)
      if (sceneResult.status === 'failed') {
        manifest.status = 'failed'
        manifest.errors.push(`Scene ${scene.id} failed: ${sceneResult.error}`)
      }
    }
  } finally {
    await browser.close()
  }

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  console.log(`[execute-preview] Execution complete. Overall status: ${manifest.status}`)
  return manifest
}

function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--plan-file' && argv[i + 1]) options.planFile = argv[++i]
    else if (argv[i] === '--taco-file' && argv[i + 1]) options.tacoFile = argv[++i]
    else if (argv[i] === '--host-url' && argv[i + 1]) options.hostUrl = argv[++i]
    else if (argv[i] === '--out-dir' && argv[i + 1]) options.outDir = argv[++i]
    else if (argv[i] === '--playwright-module' && argv[i + 1]) options.playwrightModule = argv[++i]
    else if (argv[i] === '--timeout' && argv[i + 1]) options.timeout = Number(argv[++i])
  }
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2))
  executePlan(args).catch((err) => {
    console.error('[execute-preview] Fatal error:', err)
    process.exit(1)
  })
}
