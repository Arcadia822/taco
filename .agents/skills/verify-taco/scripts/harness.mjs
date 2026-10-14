// SPDX-License-Identifier: MIT
// Extracted Taco verification runner: one owned server, browser and context per
// call, immutable artifact, retained evidence and cleanup proof on failure.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
export const DEFAULT_TIMEOUT_MS = 180000
const MAX_NETWORK_ENTRIES = 4000
const CAPTURE_TIMEOUT_MS = 15000

const DATA_BLOCK = /<script\b[^>]*\bid=["']taco-document["'][^>]*>([\s\S]*?)<\/script>/i
const CONTENT_TYPES = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
}

/** Read the bundle out of a generated shell's data block. */
export const parseBundle = (html) => {
  assert(typeof html === 'string', 'parseBundle requires the shell HTML')
  const match = html.match(DATA_BLOCK)
  assert(match, 'Missing #taco-document data block')
  const bundle = JSON.parse(match[1])
  assert.equal(bundle.format, 'taco/files')
  assert.equal(bundle.version, 1)
  assert(bundle.files?.length, 'Empty bundle')
  return bundle
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const exists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** The installed Mermaid dist is the only external code the runner may serve. */
const loadMermaidMirror = async () => {
  try {
    const manifest = JSON.parse(
      await readFile(resolve(REPO_ROOT, 'node_modules/mermaid/package.json'), 'utf8'),
    )
    const dist = resolve(REPO_ROOT, 'node_modules/mermaid/dist')
    if (typeof manifest.version !== 'string' || !(await exists(dist))) return null
    return { version: manifest.version, dist }
  } catch {
    return null
  }
}

/**
 * Map a CDN request to a file in the pinned local dist. A version that does not
 * match the installed package is never mirrored: the request stays refused.
 */
const mirrorPath = (mirror, url) => {
  if (!mirror) return null
  const prefix =
    url.hostname === 'cdn.jsdelivr.net'
      ? `/npm/mermaid@${mirror.version}/dist/`
      : url.hostname === 'esm.sh'
        ? `/mermaid@${mirror.version}/`
        : null
  if (!prefix || !url.pathname.startsWith(prefix)) return null
  const rest = url.pathname.slice(prefix.length)
  return rest && !rest.includes('..') ? rest : null
}

const contentTypeFor = (path) =>
  CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'

/**
 * Run one verification case with its own server, browser and context.
 * `run(h)` drives the UI; the runner keeps every piece of evidence and releases
 * only its own resources, even when the case fails or hangs.
 */
export async function runVerification({
  artifact,
  outDir,
  run,
  fixture = null,
  label = 'verification',
  timeout = DEFAULT_TIMEOUT_MS,
} = {}) {
  assert(typeof artifact === 'string' && artifact, 'runVerification requires artifact')
  assert(typeof outDir === 'string' && outDir, 'runVerification requires outDir')
  assert(typeof run === 'function', 'runVerification requires run(h)')

  const artifactPath = resolve(REPO_ROOT, artifact)
  const evidenceDir = resolve(REPO_ROOT, outDir)
  const startedAt = new Date()
  const events = []
  const errors = []
  const network = []
  const saved = new Map()
  const boundaries = []
  const seenBoundaries = new Set()
  let networkDropped = 0
  let server
  let browser
  let context
  let page
  let url
  let digest
  let bundle
  let doctorState = null
  let doctorRan = false
  let failure = null
  let timedOut = false
  let reopened = 0
  let serverStarted = false
  let browserLaunched = false
  let contextCreated = false
  let traceStarted = false
  let traceStopped = false
  let tracingStartPromise = null
  let setupDone = false
  let stopped = false
  let cancelSetup
  const setupCancelled = new Promise((_, reject) => {
    cancelSetup = reject
  })
  setupCancelled.catch(() => {})
  const setupOperation = (pending) => Promise.race([pending, setupCancelled])
  await mkdir(evidenceDir, { recursive: true })
  try {
    await writeFile(
      resolve(evidenceDir, 'run.json'),
      JSON.stringify(
        {
          label,
          artifact: relative(REPO_ROOT, artifactPath),
          outDir: relative(REPO_ROOT, evidenceDir),
          timeoutMs: timeout,
          started: startedAt.toISOString(),
        },
        null,
        2,
      ),
      { flag: 'wx' },
    )
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(
        `Evidence directory already holds a run: ${relative(REPO_ROOT, evidenceDir)}; pass a fresh --out directory`,
      )
    }
    throw error
  }

  const record = (entry) => {
    if (network.length >= MAX_NETWORK_ENTRIES) {
      networkDropped += 1
      return
    }
    network.push(entry)
  }

  const boundary = (description) => {
    assert(typeof description === 'string' && description.trim(), 'boundary requires a description')
    if (seenBoundaries.has(description)) return
    seenBoundaries.add(description)
    boundaries.push({ description, at: new Date().toISOString() })
  }

  const capture = async (name, target = page) => {
    assert(
      /^[a-z0-9-]+$/.test(name),
      'Capture names must use lowercase letters, digits and hyphens',
    )
    assert(target, `No page to capture ${name}`)
    await target.screenshot({
      path: resolve(evidenceDir, `${name}.png`),
      fullPage: true,
      timeout: CAPTURE_TIMEOUT_MS,
    })
    await writeFile(
      resolve(evidenceDir, `${name}.aria.txt`),
      await target.locator('body').ariaSnapshot({ timeout: CAPTURE_TIMEOUT_MS }),
    )
  }

  const step = async (action, fn) => {
    const event = { action, started: new Date().toISOString() }
    events.push(event)
    try {
      const value = await fn()
      event.ok = true
      event.finished = new Date().toISOString()
      return value
    } catch (error) {
      event.ok = false
      event.error = error.message
      event.finished = new Date().toISOString()
      throw error
    }
  }

  const ready = async (target) => {
    await target.waitForFunction(() => !!window.taco, undefined, { timeout: 20000 })
    await target.locator('#taco-splash').waitFor({ state: 'detached', timeout: 20000 })
    await target
      .locator('nav.file-sidebar button.file-row.is-selected[data-path]')
      .waitFor({ state: 'visible', timeout: 20000 })
  }

  const doctor = async () => {
    doctorRan = true
    const evidence = { started: new Date().toISOString(), ok: false }
    try {
      const response = await fetch(new URL('/doctor', url), { signal: AbortSignal.timeout(5000) })
      evidence.server = { ok: response.ok, status: response.status }
      assert(response.ok, 'Owned server is not responding')
      const identity = await response.json()
      evidence.identity = identity
      assert.equal(identity.sha256, digest)
      assert.equal(identity.pid, process.pid)
      assert.equal(
        sha256(await readFile(artifactPath)),
        digest,
        'Build changed during run; rebuild and start a new run',
      )
      const state = await page.evaluate(() => ({
        docId: JSON.parse(document.getElementById('taco-document').textContent).docId,
        format: window.taco.format,
        validation: window.taco.validate(),
      }))
      evidence.state = state
      assert.equal(state.docId, bundle.docId)
      assert.equal(state.format, 'taco/files')
      assert.equal(
        state.validation.ok,
        true,
        `Document validation failed: ${JSON.stringify(state.validation.findings)}`,
      )
      assert.equal(state.validation.counts.error, 0)
      assert.deepEqual(errors, [])
      evidence.ok = true
      doctorState = state
      return state
    } catch (error) {
      evidence.error = error.message
      throw error
    } finally {
      await writeFile(resolve(evidenceDir, 'doctor.json'), JSON.stringify(evidence, null, 2))
    }
  }

  const reopen = async (path) => {
    const data = await readFile(path)
    const doc = parseBundle(data.toString('utf8'))
    const route = `/reopened-${++reopened}.taco.html`
    saved.set(route, data)
    const target = await context.newPage()
    await target.goto(new URL(route, url).href, { waitUntil: 'load' })
    await ready(target)
    return { page: target, bundle: doc }
  }

  const main = async () => {
    const gate = () => {
      if (stopped) throw new Error(`${label} stopped before completing setup`)
    }

    gate()
    const bytes = await readFile(artifactPath)
    gate()
    bundle = parseBundle(bytes.toString('utf8'))
    digest = sha256(bytes)
    const mirror = await loadMermaidMirror()
    if (!mirror) boundary('Mermaid dist mirror unavailable; CDN requests stay refused')

    gate()
    server = createServer((req, res) => {
      void (async () => {
        const target = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405).end()
          return
        }
        if (target.pathname === '/doctor') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              artifact: artifactPath,
              sha256: digest,
              docId: bundle.docId,
              pid: process.pid,
            }),
          )
          return
        }
        if (target.pathname === '/app.taco.html' || saved.has(target.pathname)) {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          })
          res.end(target.pathname === '/app.taco.html' ? bytes : saved.get(target.pathname))
          return
        }
        res.writeHead(404).end()
      })()
    })
    await new Promise((ok, fail) => {
      server.once('error', fail)
      server.listen(0, '127.0.0.1', ok)
    })
    serverStarted = true
    if (stopped) {
      if (server.listening) await new Promise((ok) => server.close(ok))
      throw new Error(`${label} stopped after server start`)
    }
    url = `http://127.0.0.1:${server.address().port}/app.taco.html`
    const origin = new URL(url).origin
    console.log(
      JSON.stringify({
        phase: 'ready',
        label,
        url,
        outDir: relative(REPO_ROOT, evidenceDir),
        sha256: digest,
      }),
    )

    gate()
    const remainingLaunchMs = Math.min(
      30000,
      Math.max(1, timeout - (Date.now() - startedAt.getTime())),
    )
    const launchedBrowser = await chromium.launch({ headless: true, timeout: remainingLaunchMs })
    browser = launchedBrowser
    browserLaunched = true
    if (stopped) {
      await launchedBrowser.close().catch(() => {})
      throw new Error(`${label} stopped after browser launch`)
    }

    gate()
    const createdContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: 'en-US',
      acceptDownloads: true,
      serviceWorkers: 'block',
    })
    context = createdContext
    contextCreated = true
    if (stopped) {
      await createdContext.close().catch(() => {})
      throw new Error(`${label} stopped after context creation`)
    }

    tracingStartPromise = context.tracing
      .start({ screenshots: true, snapshots: true, sources: true })
      .then(() => {
        traceStarted = true
      })
    await setupOperation(tracingStartPromise)
    gate()
    await setupOperation(
      context.route('**/*', async (route) => {
        try {
          const request = route.request()
          let target
          try {
            target = new URL(request.url())
          } catch {
            record({
              url: request.url(),
              method: request.method(),
              permitted: false,
              reason: 'unparsable-url',
            })
            await route.abort()
            return
          }
          const local =
            target.origin === origin || target.protocol === 'data:' || target.protocol === 'blob:'
          if (local) {
            record({ url: request.url(), method: request.method(), permitted: true })
            await route.continue()
            return
          }
          const mirrored = mirrorPath(mirror, target)
          if (mirrored) {
            const file = resolve(mirror.dist, mirrored)
            if (file.startsWith(`${mirror.dist}${sep}`) && (await exists(file))) {
              record({
                url: request.url(),
                method: request.method(),
                permitted: true,
                mirror: 'local-pinned-dist',
              })
              boundary('Mermaid ESM served from the pinned local dist instead of the live CDN')
              await route.fulfill({ path: file, contentType: contentTypeFor(file) })
              return
            }
          }
          record({
            url: request.url(),
            method: request.method(),
            permitted: false,
            ...(mirrored ? { mirror: 'missing-in-dist' } : {}),
          })
          await route.abort()
        } catch (error) {
          // A request already gone (or a closed page) must not become an unhandled rejection.
          events.push({ routeError: error.message })
          try {
            await route.abort()
          } catch {}
        }
      }),
    )
    context.on('page', (target) => {
      target.on('pageerror', (error) => errors.push(error.message))
      target.on('console', (message) => {
        if (message.type() === 'error') events.push({ consoleError: message.text() })
      })
    })
    gate()
    page = await setupOperation(context.newPage())
    gate()
    await setupOperation(page.goto(url, { waitUntil: 'load' }))
    gate()
    await setupOperation(ready(page))
    gate()
    await setupOperation(
      step('Doctor: owned port, immutable build, mounted app and valid bundle', doctor),
    )
    gate()
    setupDone = true
    const harness = {
      page,
      context,
      url,
      outDir: evidenceDir,
      bundle,
      fixture,
      capture,
      step,
      doctor,
      reopen,
      assert,
      boundary,
      artifact: artifactPath,
      sha256: digest,
      label,
      boundaries,
    }
    await run(harness)
    assert.deepEqual(errors, [], 'Uncaught browser errors')
    assert.equal(
      sha256(await readFile(artifactPath)),
      digest,
      'Verification must not overwrite the built artifact',
    )
  }

  const execution = main()
  // The race below owns the rejection; this keeps a late hang from surfacing as
  // an unhandled rejection once cleanup has already closed the resources.
  execution.catch(() => {})
  const cleanup = {}
  let timer
  try {
    await Promise.race([
      execution,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          stopped = true
          const error = new Error(
            `${label} timed out after ${timeout}ms; owned resources were stopped`,
          )
          cancelSetup(error)
          reject(error)
        }, timeout)
      }),
    ])
  } catch (error) {
    failure = error
    if (timedOut)
      boundary('Case execution time limit reached; owned browser and server were stopped')
    if (page && !page.isClosed()) {
      try {
        await capture('failure')
      } catch (captureError) {
        events.push({ captureError: captureError.message })
      }
    }
  } finally {
    clearTimeout(timer)
    stopped = true
    cancelSetup(new Error(`${label} stopped before completing setup`))
    const boundedCleanup = async (pending, timeoutMs, name) => {
      let deadline
      try {
        await Promise.race([
          pending,
          new Promise((_, reject) => {
            deadline = setTimeout(
              () => reject(new Error(`${name} timed out after ${timeoutMs}ms`)),
              timeoutMs,
            )
          }),
        ])
      } finally {
        clearTimeout(deadline)
      }
    }
    if (tracingStartPromise) {
      await boundedCleanup(tracingStartPromise, 2000, 'Trace startup').catch((error) => {
        cleanup.trace = error.message
        failure ??= error
      })
    }

    const stopTrace = async () => {
      if (!traceStarted || traceStopped || !context) return
      traceStopped = true
      await boundedCleanup(
        context.tracing.stop({ path: resolve(evidenceDir, 'trace.zip') }),
        3000,
        'Trace retention',
      )
    }
    const closeServer = async () => {
      if (!server?.listening) return
      await boundedCleanup(
        new Promise((done, reject) => {
          server.close((error) => (error ? reject(error) : done()))
          server.closeAllConnections()
        }),
        2000,
        'Server close',
      )
    }

    // Retain tracing before closing the context, and attempt every owned release.
    for (const [name, wasStarted, release] of [
      ['trace', traceStarted, stopTrace],
      ['context', contextCreated, () => boundedCleanup(context.close(), 2000, 'Context close')],
      ['browser', browserLaunched, () => boundedCleanup(browser.close(), 2000, 'Browser close')],
      ['server', serverStarted, closeServer],
    ]) {
      if (!wasStarted) {
        cleanup[name] ??= 'not started'
        continue
      }
      try {
        await release()
        cleanup[name] ??= 'closed'
      } catch (error) {
        cleanup[name] = error.message
        failure ??= error
      }
    }
    // Closing acquired resources interrupts setup. A hung case body is never awaited.
    if (!setupDone) {
      await boundedCleanup(
        execution.catch(() => {}),
        3000,
        'Setup settling',
      ).catch((error) => {
        cleanup.setup = error.message
        failure ??= error
      })
    }

    if (serverStarted && url) {
      try {
        await fetch(new URL('/doctor', url), { signal: AbortSignal.timeout(1000) })
        failure ??= new Error('Owned port still responds after cleanup')
        cleanup.port = 'still responding'
      } catch (error) {
        cleanup.port = error.name === 'TimeoutError' ? 'timeout' : 'closed'
        if (error.name === 'TimeoutError')
          failure ??= new Error('Could not confirm owned port closed')
      }
    } else if (serverStarted) {
      cleanup.port = 'closed'
    } else {
      cleanup.port = 'not started'
    }
  }

  const finishedAt = new Date()
  events.push({ phase: 'complete', finished: finishedAt.toISOString() })
  const result = {
    ok: !failure,
    error: failure?.message ?? null,
    label,
    artifact: relative(REPO_ROOT, artifactPath),
    sha256: digest ?? null,
    docId: bundle?.docId ?? null,
    fixture: fixture ? { docId: fixture.docId ?? null, root: fixture.root ?? null } : null,
    url: url ?? null,
    outDir: relative(REPO_ROOT, evidenceDir),
    doctor: doctorRan ? 'doctor.json' : null,
    doctorOk: Boolean(doctorState),
    boundaries,
    pageErrors: errors,
    steps: events.length,
    network: {
      records: network.length,
      dropped: networkDropped,
      refused: network.filter((entry) => !entry.permitted).length,
      mirrored: network.filter((entry) => entry.mirror === 'local-pinned-dist').length,
    },
    cleanup,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    timeoutMs: timeout,
    started: startedAt.toISOString(),
    finished: finishedAt.toISOString(),
  }
  await writeFile(resolve(evidenceDir, 'actions.json'), JSON.stringify(events, null, 2))
  await writeFile(resolve(evidenceDir, 'network.json'), JSON.stringify(network, null, 2))
  await writeFile(resolve(evidenceDir, 'result.json'), JSON.stringify(result, null, 2))
  // Check retained evidence after resources have been released.
  await readFile(resolve(evidenceDir, 'actions.json'))
  await readFile(resolve(evidenceDir, 'result.json'))
  await readFile(resolve(evidenceDir, 'doctor.json')).catch(() => {
    if (!failure && doctorRan) failure = new Error('Doctor evidence missing')
  })
  const outcome = failure ? { ...result, ok: false, error: failure.message } : result
  console.log(
    JSON.stringify({
      phase: 'complete',
      label,
      ok: outcome.ok,
      outDir: result.outDir,
      cleanup,
      error: outcome.error,
    }),
  )
  return outcome
}
