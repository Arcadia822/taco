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

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validatePreviewPlan, DESKTOP_VIEWPORT } from './plan-schema.mjs'

const require = createRequire(import.meta.url)

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

  // Load Playwright via entry resolution to prevent ERR_UNSUPPORTED_DIR_IMPORT
  let playwright
  const requested = playwrightModule || process.env.PLAYWRIGHT_MODULE_PATH || null
  if (requested) {
    const asPath = requested.startsWith('file://') ? fileURLToPath(requested) : requested
    let entry
    try {
      entry = require.resolve(resolve(asPath))
    } catch (err) {
      throw new Error(`Could not resolve the Playwright module at ${requested}: ${err.message}`)
    }
    playwright = await import(pathToFileURL(entry).href)
  } else {
    try {
      playwright = await import(pathToFileURL(require.resolve('playwright')).href)
    } catch (err) {
      playwright = await import('playwright')
    }
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
          await page.waitForSelector('header, .home-root, body', { timeout })
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
                if (!step.path) {
                  throw new Error('open-file step requires a path')
                }
                // Expand any closed stage/folder details elements in sidebar first
                await page.evaluate(() => {
                  document.querySelectorAll('details.stage-group:not([open])').forEach((d) => {
                    d.setAttribute('open', '')
                  })
                })
                // Locate precise button.sidebar-row.file-row with exact data-path
                const fileButton = page
                  .locator(`button.sidebar-row.file-row[data-path="${step.path}"]`)
                  .first()
                await fileButton.waitFor({ state: 'visible', timeout: 5000 })
                await fileButton.click({ timeout: 5000 })
                // Confirm selection
                await page.waitForFunction(
                  (p) => {
                    const el = document.querySelector(
                      `button.sidebar-row.file-row[data-path="${p}"]`,
                    )
                    return el && el.classList.contains('is-selected')
                  },
                  step.path,
                  { timeout: 5000 },
                )
                await page.waitForTimeout(600)
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
