#!/usr/bin/env node
/**
 * capture-preview.mjs
 *
 * Trusted capture driver. It runs inside the network-disabled capture container
 * next to the untrusted application server and drives Chromium over container
 * loopback against the fixed view registry: no pull-request input can add a
 * URL, selector, viewport, or output filename.
 *
 * The Playwright package is installed by the workflow into a trusted directory
 * and passed in with an explicit absolute path; the browser binaries come from
 * the pinned `mcr.microsoft.com/playwright` image.
 *
 * The output directory receives exactly the registered PNG filenames and
 * nothing else. There is deliberately no manifest: the sanitizer container, not
 * this process, decides what the published set is.
 *
 * Options:
 *   --taco-file <path>           Complete .taco.html bundle to snapshot
 *   --host-url <url>             Loopback URL of the running Host server
 *   --out-dir <path>             Directory that receives the fixed PNG set
 *   --playwright-module <path>   Trusted Playwright package directory or entry
 *   --timeout <ms>               Per-view ready timeout (default 30000)
 *
 * A local run may omit --playwright-module when `playwright` resolves from the
 * working tree; set PLAYWRIGHT_MODULE_PATH instead of passing the flag if you
 * prefer an environment override.
 */

import { createRequire } from 'node:module'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { FIXED_VIEWS } from './view-registry.mjs'

const require = createRequire(import.meta.url)
const DEFAULT_TIMEOUT_MS = 30000

/**
 * Loads Playwright from an explicit directory, an explicit entry file, or the
 * ambient module graph. The ESM loader rejects directory `file:` URLs, so an
 * explicit path is resolved through CommonJS resolution first (which honours
 * `package.json#main` and `exports`).
 */
async function resolvePlaywright(explicitPath) {
  const requested = explicitPath || process.env.PLAYWRIGHT_MODULE_PATH || null
  if (requested) {
    const asPath = requested.startsWith('file://') ? fileURLToPath(requested) : requested
    let entry
    try {
      entry = require.resolve(resolve(asPath))
    } catch (err) {
      throw new Error(`Could not resolve the Playwright module at ${requested}: ${err.message}`)
    }
    return await import(pathToFileURL(entry).href)
  }

  try {
    return await import(pathToFileURL(require.resolve('playwright')).href)
  } catch (err) {
    throw new Error(
      `Could not load playwright. Pass --playwright-module <path> or set PLAYWRIGHT_MODULE_PATH.\nError: ${err.message}`,
    )
  }
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'manual' })
      if (response.status > 0 && response.status < 500) return true
    } catch {
      // The server has not bound its socket yet.
    }
    await new Promise((wake) => setTimeout(wake, 250))
  }
  throw new Error(`Host server at ${url} did not answer within ${timeoutMs}ms`)
}

/**
 * Serialized into the page, so it must stay self-contained. It asserts the real
 * runtime state of the standalone bundle: the Taco API is present, the document
 * validates, the primary surface has been laid out, and the splash is gone.
 * The capture context uses `reducedMotion: 'reduce'`, so the splash is removed
 * synchronously rather than waiting on a transition.
 */
function tacoViewReady() {
  const api = window.taco
  if (!api || api.format !== 'taco/files' || typeof api.validate !== 'function') return false
  let validation
  try {
    validation = api.validate()
  } catch {
    return false
  }
  if (!validation || validation.ok !== true) return false
  const main = document.getElementById('taco-main')
  if (!main) return false
  const rect = main.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  return !document.getElementById('taco-splash')
}

/** Serialized into the page; asserts the Host landing page finished painting. */
function hostViewReady() {
  const heading = document.querySelector('h1')
  if (!heading) return false
  const rect = heading.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  if (!document.fonts || document.fonts.status !== 'loaded') return false
  return true
}

async function waitForRenderedView(page, view, timeout) {
  if (view.target === 'taco') {
    await page.waitForFunction(tacoViewReady, undefined, { timeout, polling: 500 })
    return
  }
  await page.waitForSelector('h1', { state: 'visible', timeout })
  await page.evaluate(() => document.fonts.ready.then(() => true))
  await page.waitForFunction(hostViewReady, undefined, { timeout, polling: 500 })
}

export async function captureViews(options = {}) {
  const outDir = resolve(options.outDir ?? './artifacts/previews')
  const tacoFile = options.tacoFile ? resolve(options.tacoFile) : null
  const hostUrl = options.hostUrl ?? null
  const timeout = Number(options.timeout ?? DEFAULT_TIMEOUT_MS)

  const targets = new Set(FIXED_VIEWS.map((view) => view.target))
  if (targets.has('taco')) {
    if (!tacoFile) throw new Error('--taco-file is required to capture the taco views.')
    if (!existsSync(tacoFile)) throw new Error(`Taco bundle not found: ${tacoFile}`)
  }
  if (targets.has('host') && !hostUrl) {
    throw new Error('--host-url is required to capture the host views.')
  }

  mkdirSync(outDir, { recursive: true })

  const playwright = await resolvePlaywright(options.playwrightModule)
  const chromium = playwright.chromium ?? playwright.default?.chromium
  if (!chromium) throw new Error('Chromium launcher not found on the imported Playwright module.')

  if (hostUrl) await waitForServer(hostUrl, timeout)

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  })

  const captured = []
  try {
    for (const view of FIXED_VIEWS) {
      const context = await browser.newContext({
        viewport: { width: view.viewport.width, height: view.viewport.height },
        isMobile: Boolean(view.viewport.isMobile),
        hasTouch: Boolean(view.viewport.hasTouch),
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      })

      try {
        const page = await context.newPage()
        page.setDefaultTimeout(timeout)

        const targetUrl = view.target === 'taco' ? pathToFileURL(tacoFile).href : hostUrl
        // Navigation readiness only; `waitForRenderedView` asserts the real
        // rendering state, so a long-lived socket cannot stall the capture.
        await page.goto(targetUrl, { waitUntil: 'load' })
        await waitForRenderedView(page, view, timeout)

        const destPath = join(outDir, view.filename)
        await page.screenshot({ path: destPath, animations: 'disabled' })

        console.log(
          `Captured ${view.id} -> ${view.filename} (${view.viewport.width}x${view.viewport.height})`,
        )
        captured.push({
          id: view.id,
          filename: view.filename,
          viewport: {
            width: view.viewport.width,
            height: view.viewport.height,
            isMobile: Boolean(view.viewport.isMobile),
            hasTouch: Boolean(view.viewport.hasTouch),
          },
        })
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }

  return captured
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--out-dir' && value) {
      options.outDir = value
      index += 1
    } else if (flag === '--taco-file' && value) {
      options.tacoFile = value
      index += 1
    } else if (flag === '--host-url' && value) {
      options.hostUrl = value
      index += 1
    } else if (flag === '--playwright-module' && value) {
      options.playwrightModule = value
      index += 1
    } else if (flag === '--timeout' && value) {
      options.timeout = Number.parseInt(value, 10)
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${flag}`)
    }
  }
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const captured = await captureViews(parseArgs(process.argv.slice(2)))
    console.log(`Capture complete: ${captured.length} views recorded.`)
  } catch (err) {
    console.error(`Capture failed: ${err.message}`)
    process.exit(1)
  }
}
