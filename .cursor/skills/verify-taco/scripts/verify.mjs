#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const args = process.argv.slice(2)
const allowed = new Set(['--artifact', '--scenario', '--out'])
const options = {}
for (let i = 0; i < args.length; i += 2) {
  assert(allowed.has(args[i]) && args[i + 1] && !args[i + 1].startsWith('--'),
    'Usage: verify.mjs [--artifact path.taco.html] [--scenario path.mjs] [--out new-directory]')
  options[args[i]] = args[i + 1]
}
const artifact = resolve(repo, options['--artifact'] ?? 'dist-single/Taco_Spec.taco.html')
const scenario = resolve(repo, options['--scenario'] ?? '.cursor/skills/verify-taco/scripts/browse.mjs')
const outDir = resolve(repo, options['--out'] ?? `artifacts/verify-taco/${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`)
await mkdir(outDir, { recursive: true })
// Refuse reusing an evidence directory, including one left by a failed run.
await writeFile(resolve(outDir, 'run.json'), JSON.stringify({ artifact, scenario, started: new Date().toISOString() }, null, 2), { flag: 'wx' })
const events = []
const errors = []
const network = []
const saved = new Map()
let server, browser, context, page, url, failure
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const parseBundle = (html) => {
  const match = html.match(/<script\b[^>]*\bid=["']taco-document["'][^>]*>([\s\S]*?)<\/script>/i)
  assert(match, 'Missing #taco-document data block')
  const bundle = JSON.parse(match[1])
  assert.equal(bundle.format, 'taco/files')
  assert.equal(bundle.version, 1)
  assert(bundle.files?.length, 'Empty bundle')
  return bundle
}
const capture = async (name, target = page) => {
  assert(/^[a-z0-9-]+$/.test(name), 'Capture names must use lowercase letters, digits and hyphens')
  await target.screenshot({ path: resolve(outDir, `${name}.png`), fullPage: true })
  await writeFile(resolve(outDir, `${name}.aria.txt`), await target.locator('body').ariaSnapshot())
}
const step = async (action, fn) => {
  const event = { action, started: new Date().toISOString() }
  events.push(event)
  try { const value = await fn(); event.ok = true; return value }
  catch (error) { event.ok = false; event.error = error.message; throw error }
}
try {
  const bytes = await readFile(artifact)
  const bundle = parseBundle(bytes.toString('utf8'))
  const digest = hash(bytes)
  // Serve only this immutable product snapshot and downloads explicitly registered below.
  server = createServer((req, res) => {
    const target = new URL(req.url, 'http://127.0.0.1').pathname
    if (req.method !== 'GET') { res.writeHead(405).end(); return }
    if (target === '/doctor') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ artifact, sha256: digest, docId: bundle.docId, pid: process.pid }))
    } else if (target === '/app.taco.html' || saved.has(target)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(target === '/app.taco.html' ? bytes : saved.get(target))
    } else { res.writeHead(404).end() }
  })
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok) })
  url = `http://127.0.0.1:${server.address().port}/app.taco.html`
  console.log(JSON.stringify({ phase: 'ready', url, outDir, sha256: digest }))
  browser = await chromium.launch({ headless: true })
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', acceptDownloads: true, serviceWorkers: 'block' })
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
  await context.route('**/*', async (route) => {
    const request = route.request()
    const target = new URL(request.url())
    const permitted = target.origin === new URL(url).origin || ['data:', 'blob:'].includes(target.protocol)
    network.push({ url: request.url(), method: request.method(), permitted })
    if (permitted) await route.continue(); else await route.abort()
  })
  context.on('page', (target) => {
    target.on('pageerror', (error) => errors.push(error.message))
    target.on('console', (message) => { if (message.type() === 'error') events.push({ consoleError: message.text() }) })
  })
  page = await context.newPage()
  const ready = async (target) => {
    await target.waitForFunction(() => !!window.taco, undefined, { timeout: 15000 })
    await target.locator('#taco-splash').waitFor({ state: 'detached', timeout: 15000 })
    await target.locator('nav.file-sidebar button.file-row.is-selected[data-path]').waitFor({ state: 'visible' })
  }
  await page.goto(url, { waitUntil: 'load' })
  await ready(page)
  const doctor = async () => {
    const response = await fetch(new URL('/doctor', url))
    assert(response.ok, 'Owned server is not responding')
    const identity = await response.json()
    assert.equal(identity.sha256, digest)
    assert.equal(identity.pid, process.pid)
    assert.equal(hash(await readFile(artifact)), digest, 'Build changed during run; rebuild and start a new run')
    const state = await page.evaluate(() => ({ docId: JSON.parse(document.getElementById('taco-document').textContent).docId, format: window.taco.format, validation: window.taco.validate() }))
    assert.equal(state.docId, bundle.docId)
    assert.equal(state.format, 'taco/files')
    assert.equal(state.validation.ok, true)
    assert.equal(state.validation.counts.error, 0)
    assert.deepEqual(errors, [])
    await writeFile(resolve(outDir, 'doctor.json'), JSON.stringify({ ...identity, ...state, url }, null, 2))
    return state
  }
  await step('Doctor: owned port, immutable build, mounted app and valid bundle', doctor)
  const reopen = async (path) => {
    const data = await readFile(path)
    const doc = parseBundle(data.toString('utf8'))
    saved.set('/saved.taco.html', data)
    const target = await context.newPage()
    await target.goto(new URL('/saved.taco.html', url).href, { waitUntil: 'load' })
    await ready(target)
    return { page: target, bundle: doc }
  }
  const drive = await import(pathToFileURL(scenario).href)
  assert.equal(typeof drive.default, 'function', 'Scenario must export default async function(harness)')
  await drive.default({ page, context, url, outDir, bundle, capture, step, doctor, reopen, assert })
  assert.deepEqual(errors, [], 'Uncaught browser errors')
  assert.equal(hash(await readFile(artifact)), digest, 'Verification must not overwrite the built artifact')
} catch (error) {
  failure = error
  if (page && !page.isClosed()) { try { await capture('failure') } catch (captureError) { events.push({ captureError: captureError.message }) } }
} finally {
  // Keep every artifact; release only owned resources. Attempt each cleanup even if another fails.
  const cleanup = {}
  for (const [name, release] of [
    ['trace', async () => { if (context) await context.tracing.stop({ path: resolve(outDir, 'trace.zip') }) }],
    ['context', async () => { if (context) await context.close() }],
    ['browser', async () => { if (browser) await browser.close() }],
    ['server', async () => { if (server?.listening) await new Promise((ok, fail) => server.close((error) => error ? fail(error) : ok())) }],
  ]) {
    try { await release(); cleanup[name] = 'closed' } catch (error) { cleanup[name] = error.message; failure ??= error }
  }
  if (url) {
    try { await fetch(new URL('/doctor', url), { signal: AbortSignal.timeout(1000) }); failure ??= new Error('Owned port still responds after cleanup'); cleanup.port = 'still responding' }
    catch (error) {
      cleanup.port = error.name === 'TimeoutError' ? 'timeout' : 'closed'
      if (error.name === 'TimeoutError') failure ??= new Error('Could not confirm owned port closed')
    }
  }
  await writeFile(resolve(outDir, 'actions.json'), JSON.stringify(events, null, 2))
  await writeFile(resolve(outDir, 'network.json'), JSON.stringify(network, null, 2))
  await writeFile(resolve(outDir, 'result.json'), JSON.stringify({ ok: !failure, error: failure?.message, pageErrors: errors, cleanup, artifact: relative(repo, artifact), scenario: relative(repo, scenario), url }, null, 2))
  // Check retained evidence after resources have been released.
  await readFile(resolve(outDir, 'actions.json'))
  await readFile(resolve(outDir, 'doctor.json')).catch(() => { if (!failure) throw new Error('Doctor evidence missing') })
  console.log(JSON.stringify({ phase: 'complete', ok: !failure, outDir, cleanup, error: failure?.message }))
}
if (failure) process.exitCode = 1
