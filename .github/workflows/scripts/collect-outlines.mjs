#!/usr/bin/env node
/**
 * collect-outlines.mjs
 *
 * Runs inside the network-disabled capture container alongside the app server.
 * Extracts DOM Outlines for both 'taco' and 'host' views and outputs a compact
 * JSON artifact. NO API keys, NO external networks, NO secrets.
 */

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { extractDomOutline } from './dom-outline.mjs'

const require = createRequire(import.meta.url)
const DEFAULT_TIMEOUT_MS = 45000
const DESKTOP_VIEWPORT = { width: 1280, height: 800 }

async function waitForServer(url, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // Keep waiting
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`Server at ${url} failed to respond within ${timeoutMs}ms`)
}

export async function collectOutlines(options = {}) {
  const { tacoFile, hostUrl, outPath, playwrightModule, timeout = DEFAULT_TIMEOUT_MS } = options

  if (!tacoFile || !existsSync(tacoFile)) {
    throw new Error(`Complete Taco bundle not found at ${tacoFile}`)
  }
  if (!hostUrl) {
    throw new Error('Host URL is required')
  }
  if (!outPath) {
    throw new Error('Output path is required')
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

  const outlines = []

  try {
    // 1. Taco file view
    const pageTaco = await context.newPage()
    const tacoUrl = pathToFileURL(resolve(tacoFile)).href
    await pageTaco.goto(tacoUrl, { waitUntil: 'load', timeout })
    await pageTaco.waitForSelector('#app', { timeout })
    // Wait for splash to disappear
    await pageTaco.waitForFunction(() => !document.getElementById('taco-splash'), { timeout })
    await pageTaco.waitForTimeout(1000)

    const tacoInitial = await pageTaco.evaluate(extractDomOutline)
    outlines.push({
      view: 'taco',
      title: 'Complete Taco Desktop (Initial)',
      url: tacoUrl,
      outline: tacoInitial.outline,
      interactiveElements: tacoInitial.interactiveElements,
    })

    // Walk through files in sidebar (e.g. spec.md or others) to extract deeper outlines
    const fileButtons = await pageTaco
      .locator('button.sidebar-row.file-row:not(.is-selected)')
      .all()
    for (let fIdx = 0; fIdx < Math.min(fileButtons.length, 3); fIdx += 1) {
      const btn = fileButtons[fIdx]
      const filePath = await btn.getAttribute('data-path')
      await btn.click()
      await pageTaco.waitForTimeout(600)
      const fileOutline = await pageTaco.evaluate(extractDomOutline)
      outlines.push({
        view: 'taco',
        title: `Complete Taco - ${filePath}`,
        url: tacoUrl,
        filePath,
        outline: fileOutline.outline,
        interactiveElements: fileOutline.interactiveElements,
      })
    }
    await pageTaco.close()

    // 2. Host view
    const pageHost = await context.newPage()
    await pageHost.goto(hostUrl, { waitUntil: 'load', timeout })
    await pageHost.waitForSelector('header, .home-root, body', { timeout })
    await pageHost.waitForTimeout(1000)

    const hostResult = await pageHost.evaluate(extractDomOutline)
    outlines.push({
      view: 'host',
      title: 'Host Demo Desktop',
      url: hostUrl,
      outline: hostResult.outline,
      interactiveElements: hostResult.interactiveElements,
    })
    await pageHost.close()
  } finally {
    await browser.close()
  }

  writeFileSync(outPath, JSON.stringify({ outlines }, null, 2), 'utf-8')
  console.log(`[collect-outlines] Successfully wrote ${outlines.length} outlines to ${outPath}`)
  return outlines
}

function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--taco-file' && argv[i + 1]) options.tacoFile = argv[++i]
    else if (argv[i] === '--host-url' && argv[i + 1]) options.hostUrl = argv[++i]
    else if (argv[i] === '--out-path' && argv[i + 1]) options.outPath = argv[++i]
    else if (argv[i] === '--playwright-module' && argv[i + 1]) options.playwrightModule = argv[++i]
    else if (argv[i] === '--timeout' && argv[i + 1]) options.timeout = Number(argv[++i])
  }
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2))
  collectOutlines(args).catch((err) => {
    console.error('[collect-outlines] Fatal error:', err)
    process.exit(1)
  })
}
