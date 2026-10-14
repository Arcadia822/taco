#!/usr/bin/env node
/**
 * Real Tacobin Host smoke: real Next.js routes, real SQLite, real CLI, real browser.
 * No mocks, no agent, no model, no production credential.
 *
 * Setup: copies `packages/host` into an isolated workspace under the repo `tmp/`, builds and starts
 * the real Next.js production server with a temporary `TACO_DB_PATH` SQLite database and a fresh
 * random `TACO_CSRF_SECRET`, writes the shared verify fixture into the committed Host shell and
 * publishes it with the real CLI (`packages/cli/dist/main.js publish <fixture> --host <origin>`).
 *
 * Cases:
 *   host/open                 served page boots, inert host capability block, readonly state route
 *   host/autosave             real editor input autosaves and the independent state route agrees
 *   host/reopen               a second, independent context sees the saved marker
 *   host/comment              selection comment through the UI, persisted for a third context
 *   host/handoff:no-listener  Handoff is gated by the no-listeners dialog, no handoff is sent
 *   host/handoff:listener     the real CLI subscriber receives the handoff event and the CLI reads
 *                             back the same receipt the API serves
 *   host/conflict             stale state version rejects the save, then Load latest recovers
 *   host/csrf                 missing token and hostile origin are both rejected with 403
 *   host/cli:unknown-taco     subscribing to an unknown Taco exits 2 instead of hanging
 *
 * Usage:
 *   node scripts/smoke-host.mjs [--out <fresh-dir>] [--keep-workspace]
 *
 * Evidence lands in `<out>` (default `artifacts/smoke-host/<timestamp>-<id>`): `server.log`,
 * `host.sqlite`, `cli.json`, `fixture.taco.html`, `summary.json` and one directory per case with
 * screenshots, ARIA snapshots, network log, state snapshot, actions log and browser trace.
 * Every owned resource is released and every cleanup step is attempted, even after a failure.
 * Exit code 1 on failure, or 130/143 on process interruption.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import {
  FIXTURE,
  fixtureBundle,
  writeFixture,
} from '../.agents/skills/verify-taco/scripts/fixture.mjs'
import {
  openPanelTab,
  selectFile,
  submitComment,
  typeAtEnd,
} from '../.agents/skills/verify-taco/scripts/ui.mjs'

const EXPECTED_CASE_IDS = [
  'host/open',
  'host/autosave',
  'host/reopen',
  'host/comment',
  'host/handoff:no-listener',
  'host/handoff:listener',
  'host/conflict',
  'host/csrf',
  'host/cli:unknown-taco',
]

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hostPackage = join(repoRoot, 'packages', 'host')
const nextBin = join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
const cliBin = join(repoRoot, 'packages', 'cli', 'dist', 'main.js')
const hostShellAsset = join(hostPackage, 'assets', 'taco-shell.html')

/** Paths the isolated copy must never contain: env secrets, the developer's build, dependencies. */
const EXCLUDED_PATH = /(^|\/)(\.env[^/]*|\.next|node_modules)(\/|$)/
const COPY_ENTRIES = [
  'src',
  'assets',
  'public',
  'package.json',
  'next.config.ts',
  'tsconfig.json',
  'next-env.d.ts',
]
const BUILD_TIMEOUT_MS = 300_000
const READY_TIMEOUT_MS = 180_000
const CASE_TIMEOUT_MS = 180_000
const CLI_DEFAULT_TIMEOUT_MS = 60_000
const VIEWPORT = { width: 1440, height: 1000 }

const usage = `Usage: node scripts/smoke-host.mjs [--out <fresh-dir>] [--keep-workspace]

  --out <dir>      evidence directory; must not exist yet
                   (default: artifacts/smoke-host/<timestamp>-<id>)
  --keep-workspace keep tmp/smoke-host-<id>/ instead of deleting it`

const sleep = (ms, signal) =>
  new Promise((done, reject) => {
    if (signal?.aborted) return reject(new Error('sleep aborted'))
    const timer = setTimeout(done, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('sleep aborted'))
      },
      { once: true },
    )
  })

const nowIso = () => new Date().toISOString()
const messageOf = (error) => (error instanceof Error ? error.message : String(error))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const posixPath = (value) => value.split('\\').join('/')
const slugOf = (id) => id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
const relativeToRepo = (value) => posixPath(relative(repoRoot, value))
const tail = (value, length = 4000) => (value.length > length ? value.slice(-length) : value)

function parseArgs(argv) {
  const options = { out: null, keepWorkspace: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error('--out needs a directory')
      options.out = value
      index += 1
    } else if (arg === '--keep-workspace') {
      options.keepWorkspace = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage)
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage}`)
    }
  }
  return options
}

/** `node:sqlite` is what the SQLite adapter loads; fail before building if this Node cannot import it. */
async function assertNodeSqlite() {
  try {
    const { DatabaseSync } = await import('node:sqlite')
    assert.equal(typeof DatabaseSync, 'function', 'node:sqlite must expose DatabaseSync')
  } catch (error) {
    throw new Error(
      `Node ${process.version} cannot import node:sqlite, which the Host SQLite adapter requires: ${messageOf(error)}`,
    )
  }
}

async function findFreePort() {
  const probe = createServer()
  await new Promise((done, failed) => {
    probe.once('error', failed)
    probe.listen(0, '127.0.0.1', done)
  })
  const { port } = probe.address()
  await new Promise((done) => probe.close(done))
  return port
}

async function portIsClosed(port) {
  const probe = createServer()
  try {
    await new Promise((done, failed) => {
      probe.once('error', failed)
      probe.listen(port, '127.0.0.1', done)
    })
    return true
  } catch {
    return false
  } finally {
    await new Promise((done) => probe.close(() => done()))
  }
}

/** Serialized log appender; a write failure is reported, never swallowed. */
function makeLogWriter(file, redact, onError) {
  let queue = Promise.resolve()
  const write = (chunk) => {
    const text = redact(chunk.toString('utf8'))
    if (!text) return
    queue = queue.then(() => appendFile(file, text)).catch(onError)
  }
  return { write, flush: () => queue }
}

/** Copy only what the Host build needs, never a developer's env, build output or modules. */
async function prepareWorkspace(workspaceRoot) {
  const hostDir = join(workspaceRoot, 'host')
  await mkdir(hostDir, { recursive: true })
  for (const entry of COPY_ENTRIES) {
    const source = join(hostPackage, entry)
    if (!existsSync(source)) continue
    await cp(source, join(hostDir, entry), {
      recursive: true,
      filter: (candidate) => {
        const rel = relative(hostPackage, candidate)
        if (!rel) return true
        return !EXCLUDED_PATH.test(posixPath(rel))
      },
    })
  }
  return hostDir
}

/** The copy is the isolation guarantee, so prove it: no secrets, no `.next`, no `node_modules`. */
async function assertCleanCopy(hostDir) {
  const entries = await readdir(hostDir, { recursive: true })
  const offenders = entries.map(posixPath).filter((entry) => EXCLUDED_PATH.test(entry))
  assert.deepEqual(
    offenders,
    [],
    `isolated Host copy must exclude env files, .next and node_modules: ${offenders.join(', ')}`,
  )
  for (const required of [
    'package.json',
    'next.config.ts',
    'tsconfig.json',
    'src/app/layout.tsx',
  ]) {
    assert(existsSync(join(hostDir, required)), `isolated Host copy is missing ${required}`)
  }
}

function spawnNext(args, { cwd, env, onOutput }) {
  const child = spawn(process.execPath, [nextBin, ...args], {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.once('error', (error) => {
    child.spawnError = error
  })
  child.stdout.on('data', onOutput)
  child.stderr.on('data', onOutput)
  return child
}

function waitForExit(child, timeoutMs, abortSignal) {
  if (child.spawnError || child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(true)
  return new Promise((done) => {
    const timer = setTimeout(() => done(false), timeoutMs)
    const onAbort = () => {
      clearTimeout(timer)
      done(false)
    }
    if (abortSignal?.aborted) return onAbort()
    abortSignal?.addEventListener('abort', onAbort, { once: true })
    child.once('close', () => {
      clearTimeout(timer)
      abortSignal?.removeEventListener('abort', onAbort)
      done(true)
    })
  })
}

/** Signal a detached process group so no helper process survives the run. */
async function signalTree(child, signal) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // Already gone.
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const startedAt = nowIso()
  const startedMs = Date.now()
  const runId = randomUUID().slice(0, 8)
  const stamp = startedAt.replace(/[:.]/g, '-')
  const outDir = resolve(
    repoRoot,
    options.out ?? join('artifacts', 'smoke-host', `${stamp}-${runId}`),
  )
  await mkdir(dirname(outDir), { recursive: true })
  try {
    await mkdir(outDir)
  } catch (error) {
    throw new Error(
      `evidence directory must be fresh (${relativeToRepo(outDir)}): ${messageOf(error)}`,
    )
  }

  const globalAbort = new AbortController()
  let interruptedSignal = null

  const onInterrupt = (sig) => {
    if (interruptedSignal) return
    interruptedSignal = sig
    failures.push(`process interrupted by ${sig}`)
    globalAbort.abort(new Error(`process interrupted by ${sig}`))
  }
  const handleSigInt = () => onInterrupt('SIGINT')
  const handleSigTerm = () => onInterrupt('SIGTERM')

  process.on('SIGINT', handleSigInt)
  process.on('SIGTERM', handleSigTerm)

  const summary = {
    ok: false,
    interrupted: null,
    startedAt,
    node: process.version,
    evidence: relativeToRepo(outDir),
    workspaceKept: options.keepWorkspace,
    expectedCases: EXPECTED_CASE_IDS,
    childEnvKeys: [],
    cliEnvKeys: [],
    publish: null,
    cases: [],
    counts: { cases: 0, passed: 0, failed: 0 },
    network: { allowed: 0, blocked: 0, offOrigin: [] },
    cleanup: {},
  }
  const cliRuns = []
  const shared = {}
  const failures = []
  const cliChildren = new Set()
  const serverLog = join(outDir, 'server.log')

  let port = null
  let origin = ''
  let databasePath = null
  let workspaceRoot = null
  let csrfSecret = null
  let logFailure = null
  let browser = null
  let buildChild = null
  let serverChild = null
  let log = null

  const cliEnv = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
  }
  summary.cliEnvKeys = Object.keys(cliEnv).sort()

  const api = async (pathname, init = {}) => {
    const signal = init.signal
      ? AbortSignal.any([globalAbort.signal, init.signal])
      : globalAbort.signal
    const response = await fetch(`${origin}${pathname}`, { ...init, signal })
    const text = await response.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { response, status: response.status, text, json }
  }

  const serverLogTail = async () => {
    if (!log) return ''
    await log.flush()
    try {
      return tail(await readFile(serverLog, 'utf8'))
    } catch (error) {
      return `(server.log unreadable: ${messageOf(error)})`
    }
  }

  /** One cleanup step; a failure is recorded in the summary and fails the run. */
  const cleanup = async (label, run) => {
    try {
      summary.cleanup[label] = await run()
    } catch (error) {
      summary.cleanup[label] = `failed: ${messageOf(error)}`
      failures.push(`cleanup (${label}): ${messageOf(error)}`)
    }
  }

  /** Run one real CLI invocation with an outer deadline; only this child is signalled. */
  const runCli = async (
    args,
    { timeoutMs = CLI_DEFAULT_TIMEOUT_MS, caseId = 'setup', signal } = {},
  ) => {
    const combinedSignal = signal
      ? AbortSignal.any([globalAbort.signal, signal])
      : globalAbort.signal
    if (combinedSignal.aborted) {
      throw new Error(`CLI execution aborted before spawn (${args.join(' ')})`)
    }
    const child = spawn(process.execPath, [cliBin, ...args], {
      cwd: workspaceRoot,
      env: cliEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    cliChildren.add(child)
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    const exit = await new Promise((done) => {
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 2000).unref()
      }, timeoutMs)
      const onAbort = () => {
        clearTimeout(timer)
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 2000).unref()
        done({ code: null, signal: 'SIGTERM', error: 'aborted' })
      }
      if (combinedSignal.aborted) return onAbort()
      combinedSignal.addEventListener('abort', onAbort, { once: true })
      child.once('error', (error) => {
        clearTimeout(timer)
        combinedSignal.removeEventListener('abort', onAbort)
        done({ code: null, signal: null, error: error.message })
      })
      child.once('close', (code, signalCode) => {
        clearTimeout(timer)
        combinedSignal.removeEventListener('abort', onAbort)
        done({ code, signal: signalCode, error: null })
      })
    })
    cliChildren.delete(child)
    const record = { caseId, argv: args, ...exit, timedOut, stdout, stderr }
    cliRuns.push(record)
    return record
  }

  /** Start the real `subscribe` command and keep reading its NDJSON frames until it settles. */
  const startCliSubscription = async ({
    caseId,
    tacoId,
    timeoutMs = CASE_TIMEOUT_MS,
    signal,
  } = {}) => {
    const combinedSignal = signal
      ? AbortSignal.any([globalAbort.signal, signal])
      : globalAbort.signal
    if (combinedSignal.aborted) {
      throw new Error('CLI subscription aborted before spawn')
    }
    const args = ['subscribe', tacoId, '--host', origin]
    const child = spawn(process.execPath, [cliBin, ...args], {
      cwd: workspaceRoot,
      env: cliEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    cliChildren.add(child)
    const frames = []
    const waiters = new Set()
    let stdout = ''
    let stderr = ''
    let readyFrame = null
    let exitResult = null
    let resolveReady
    let rejectReady
    const ready = new Promise((resolvePromise, rejectPromise) => {
      resolveReady = resolvePromise
      rejectReady = rejectPromise
    })
    // This helper owns the promise it creates; the awaiting caller still sees the rejection.
    ready.catch(() => undefined)
    const settleReady = (settle, value) => {
      if (readyFrame) return
      readyFrame = value
      settle(value)
    }
    const deliver = (frame) => {
      frames.push(frame)
      for (const waiter of [...waiters]) {
        if (!waiter.match(frame)) continue
        waiters.delete(waiter)
        clearTimeout(waiter.timer)
        waiter.resolve(frame)
      }
    }
    let buffered = ''
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      stdout += text
      buffered += text
      let newline = buffered.indexOf('\n')
      while (newline !== -1) {
        const line = buffered.slice(0, newline).trim()
        buffered = buffered.slice(newline + 1)
        if (line) {
          try {
            const frame = JSON.parse(line)
            if (frame.kind === 'ready') settleReady(resolveReady, frame)
            deliver(frame)
          } catch {
            settleReady(
              rejectReady,
              new Error(`CLI subscribe printed a non-JSON line: ${line.slice(0, 200)}`),
            )
          }
        }
        newline = buffered.indexOf('\n')
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    const kill = () => {
      try {
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 2000).unref()
      } catch {
        // Already gone.
      }
    }
    const onAbort = () => {
      kill()
    }
    if (combinedSignal.aborted) onAbort()
    else combinedSignal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => {
      settleReady(
        rejectReady,
        new Error(`CLI subscribe produced no ready frame within ${timeoutMs}ms`),
      )
      kill()
    }, timeoutMs)
    const exited = new Promise((done) => {
      child.once('error', (error) => {
        clearTimeout(timer)
        combinedSignal.removeEventListener('abort', onAbort)
        done({ code: null, signal: null, error: error.message })
      })
      child.once('close', (code, signalCode) => {
        clearTimeout(timer)
        combinedSignal.removeEventListener('abort', onAbort)
        settleReady(
          rejectReady,
          new Error(`CLI subscribe exited (${code ?? signalCode}) before the ready frame`),
        )
        for (const waiter of [...waiters]) {
          waiters.delete(waiter)
          clearTimeout(waiter.timer)
          waiter.reject(
            new Error(`CLI subscribe exited (${code ?? signalCode}) before the expected event`),
          )
        }
        done({ code, signal: signalCode, error: null })
      })
    })
    return {
      ready,
      frames,
      argv: args,
      waitForExit: async (waitMs) => {
        const settled = await Promise.race([exited, sleep(waitMs).then(() => 'timeout')])
        if (settled === 'timeout') return null
        exitResult = settled
        return settled
      },
      waitForFrame(match, waitMs) {
        const seen = frames.find(match)
        if (seen) return Promise.resolve(seen)
        return new Promise((resolvePromise, rejectPromise) => {
          const waiter = {
            match,
            resolve: resolvePromise,
            reject: rejectPromise,
            timer: setTimeout(() => {
              waiters.delete(waiter)
              rejectPromise(new Error('timed out waiting for a CLI subscribe frame'))
            }, waitMs),
          }
          waiters.add(waiter)
        })
      },
      kill,
      async record() {
        await waitForExit(child, 3000)
        cliChildren.delete(child)
        const record = {
          caseId,
          argv: args,
          code: exitResult?.code ?? child.exitCode,
          signal: exitResult?.signal ?? child.signalCode,
          frames: frames.map((frame) => ({
            kind: frame.kind,
            type: frame.type ?? null,
            handoffId: frame.data?.handoffId ?? null,
          })),
          stdout: tail(stdout, 4000),
          stderr: tail(stderr, 4000),
        }
        cliRuns.push(record)
        return record
      },
    }
  }

  try {
    // 1. Preconditions and the isolated Host workspace.
    await assertNodeSqlite()
    assert(
      existsSync(nextBin),
      `Next CLI not found at ${relativeToRepo(nextBin)}; run npm ci first`,
    )
    assert(
      existsSync(hostShellAsset),
      `committed Host shell asset is missing: ${relativeToRepo(hostShellAsset)}`,
    )
    assert(
      existsSync(cliBin),
      `CLI bundle missing at ${relativeToRepo(cliBin)}; build it first (npm run build --workspace @tacobin/cli)`,
    )

    assert.equal(typeof fixtureBundle, 'function', 'fixture.mjs must export fixtureBundle()')
    assert.equal(typeof writeFixture, 'function', 'fixture.mjs must export writeFixture()')
    assert(FIXTURE && typeof FIXTURE === 'object', 'fixture.mjs must export FIXTURE')
    assert(
      typeof FIXTURE.paths?.intro === 'string' && FIXTURE.paths.intro,
      'FIXTURE.paths.intro is required (TACO-81 contract)',
    )
    assert(
      typeof FIXTURE.markers?.intro === 'string' && FIXTURE.markers.intro,
      'FIXTURE.markers.intro is required (TACO-81 contract)',
    )

    const fixtureDoc = fixtureBundle()
    assert.equal(fixtureDoc.format, 'taco/files', 'fixture bundle must use the taco/files format')
    assert(
      Array.isArray(fixtureDoc.files) && fixtureDoc.files.length > 0,
      'fixture bundle must have files',
    )
    if (typeof FIXTURE.dataPaths?.intro === 'string') {
      assert(FIXTURE.dataPaths.intro, 'FIXTURE.dataPaths.intro is required (TACO-81 contract)')
    }
    const introPath =
      (typeof FIXTURE.dataPaths?.intro === 'string' && FIXTURE.dataPaths.intro) ||
      fixtureDoc.files
        .map((file) => file.path)
        .find(
          (path) =>
            path === FIXTURE.paths.intro || path === `${fixtureDoc.root}/${FIXTURE.paths.intro}`,
        )
    assert(
      typeof introPath === 'string' && fixtureDoc.files.some((file) => file.path === introPath),
      `the fixture bundle must contain the entry file ${FIXTURE.paths.intro}`,
    )
    assert.equal(
      introPath,
      `${fixtureDoc.root}/${FIXTURE.paths.intro}`,
      'the entry data-path must be the root-prefixed fixture path',
    )

    workspaceRoot = resolve(repoRoot, 'tmp', `smoke-host-${runId}`)
    summary.workspace = relativeToRepo(workspaceRoot)
    summary.fixture = {
      docId: fixtureDoc.docId,
      root: fixtureDoc.root,
      files: fixtureDoc.files.length,
      title: fixtureDoc.title,
    }
    const hostDir = await prepareWorkspace(workspaceRoot)
    await assertCleanCopy(hostDir)

    // 2. Environment allowlists: a random CSRF secret, a temporary SQLite path, no production env.
    csrfSecret = randomBytes(32).toString('hex')
    const redact = (text) =>
      csrfSecret && text.includes(csrfSecret) ? text.split(csrfSecret).join('[redacted]') : text
    await writeFile(serverLog, '')
    log = makeLogWriter(serverLog, redact, (error) => {
      if (logFailure) return
      logFailure = messageOf(error)
      failures.push(`server.log write failed: ${logFailure}`)
    })
    log.write(
      `# host smoke ${stamp}-${runId} node=${process.version} cwd=${relativeToRepo(hostDir)}\n`,
    )

    port = await findFreePort()
    origin = `http://127.0.0.1:${port}`
    databasePath = join(workspaceRoot, 'host.sqlite')
    const childEnv = {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      PORT: String(port),
      TACO_DB_PATH: databasePath,
      TACO_CSRF_SECRET: csrfSecret,
    }
    for (const forbidden of [
      'DATABASE_URL',
      'VERCEL',
      'POSTGRES_URL',
      'BLOB_READ_WRITE_TOKEN',
      'BLOB_STORE_ID',
    ]) {
      assert(!(forbidden in childEnv), `${forbidden} must stay out of the Host child environment`)
    }
    summary.origin = origin
    summary.hostShellSha256 = sha256(await readFile(hostShellAsset))
    summary.childEnvKeys = Object.keys(childEnv).sort()

    // 3. Build and start the real Next.js production server inside the isolated copy.
    buildChild = spawnNext(['build'], { cwd: hostDir, env: childEnv, onOutput: log.write })
    assert(
      await waitForExit(buildChild, BUILD_TIMEOUT_MS, globalAbort.signal),
      `next build did not finish within ${BUILD_TIMEOUT_MS}ms`,
    )
    if (globalAbort.signal.aborted)
      throw new Error(`next build interrupted by ${interruptedSignal}`)
    if (buildChild.spawnError)
      throw new Error(`next build could not start: ${messageOf(buildChild.spawnError)}`)
    assert.equal(
      buildChild.exitCode,
      0,
      `next build failed (exit ${buildChild.exitCode})\n${await serverLogTail()}`,
    )
    buildChild = null

    let startOutput = ''
    let ownedServerReady = false
    serverChild = spawnNext(['start', '--hostname', '127.0.0.1', '-p', String(port)], {
      cwd: hostDir,
      env: childEnv,
      onOutput(chunk) {
        log.write(chunk)
        startOutput = tail(startOutput + chunk.toString('utf8'))
        ownedServerReady ||= /\bReady in\b/.test(startOutput)
      },
    })
    let serverExit = null
    serverChild.once('exit', (code, signal) => {
      serverExit = { code, signal }
    })
    const deadline = Date.now() + READY_TIMEOUT_MS
    let capabilities = null
    while (Date.now() < deadline) {
      if (globalAbort.signal.aborted)
        throw new Error(`Host server startup interrupted by ${interruptedSignal}`)
      if (serverExit)
        throw new Error(
          `Host server exited early (${JSON.stringify(serverExit)})\n${await serverLogTail()}`,
        )
      if (serverChild.spawnError)
        throw new Error(`Host server could not start: ${messageOf(serverChild.spawnError)}`)
      // The port probe was released before the build. Only our child's listening signal
      // authorizes requests; a different Host on that port must never receive a publish.
      if (!ownedServerReady) {
        await sleep(100, globalAbort.signal).catch(() => undefined)
        continue
      }
      try {
        const probe = await api('/v1/capabilities', { signal: globalAbort.signal })
        if (probe.status === 200) {
          capabilities = probe.json
          break
        }
      } catch {
        // Not listening yet.
      }
      await sleep(500, globalAbort.signal).catch(() => undefined)
    }
    assert(
      capabilities,
      `Host server was not ready within ${READY_TIMEOUT_MS}ms\n${await serverLogTail()}`,
    )
    assert.equal(
      capabilities.protocol,
      'taco-host/1',
      'capabilities must describe the taco-host/1 protocol',
    )

    // 4. Write the shared fixture into the committed Host shell and publish it with the real CLI.
    const fixtureArtifact = join(outDir, 'fixture.taco.html')
    const written = await writeFixture({ shell: hostShellAsset, out: fixtureArtifact })
    assert.equal(
      resolve(repoRoot, written.artifact),
      fixtureArtifact,
      'writeFixture must write the requested artifact',
    )
    summary.fixture.artifact = relativeToRepo(fixtureArtifact)
    summary.fixture.sha256 = sha256(await readFile(fixtureArtifact))

    const publishRun = await runCli(['publish', fixtureArtifact, '--host', origin], {
      caseId: 'setup',
      signal: globalAbort.signal,
    })
    assert.equal(
      publishRun.code,
      0,
      `CLI publish must succeed (exit ${publishRun.code}, timedOut=${publishRun.timedOut}): ${publishRun.stderr}`,
    )
    const published = JSON.parse(publishRun.stdout)
    assert.equal(published.command, 'publish', 'CLI publish must report the publish command')
    assert(published.tacoId, 'CLI publish must return a tacoId')
    const publishedHost = new URL(published.host)
    const publishedPage = new URL(published.url)
    assert.equal(
      publishedPage.origin,
      publishedHost.origin,
      'the published page must belong to the returned Host',
    )
    assert.equal(publishedHost.protocol, 'http:', 'the smoke must stay on its local HTTP server')
    assert(
      ['localhost', '127.0.0.1', '[::1]'].includes(publishedHost.hostname),
      'the returned Host must stay on loopback',
    )
    assert.equal(
      publishedHost.port,
      String(port),
      'the returned Host must use the owned server port',
    )
    assert.equal(
      publishedPage.pathname,
      `/t/${published.tacoId}`,
      'the published URL must open this Taco',
    )
    const publishedResponse = await fetch(publishedPage, {
      signal: AbortSignal.any([globalAbort.signal, AbortSignal.timeout(10_000)]),
      redirect: 'error',
    })
    assert.equal(publishedResponse.status, 200, 'the actual CLI publish URL must be accessible')
    assert(
      (await publishedResponse.text()).includes(fixtureDoc.docId),
      'the published page must contain this fixture identity',
    )
    // Follow the URL the CLI actually delivered: NextURL canonicalizes loopback names,
    // and browser Origin headers must agree with that published origin for CSRF checks.
    origin = publishedHost.origin
    summary.origin = origin
    summary.publish = {
      argv: publishRun.argv,
      exitCode: publishRun.code,
      tacoId: published.tacoId,
      revisionId: published.revisionId,
      contentHash: published.contentHash,
      url: published.url,
      expiresAt: published.expiresAt ?? null,
    }
    shared.tacoId = published.tacoId

    // 5. The published snapshot must be exactly the shared fixture, read back through the real route.
    const setupState = await api(`/v1/tacos/${shared.tacoId}/state`, {
      headers: { Accept: 'application/json' },
    })
    assert.equal(
      setupState.status,
      200,
      `GET state must succeed: ${setupState.status} ${setupState.text.slice(0, 500)}`,
    )
    assert.equal(
      setupState.json.snapshot.docId,
      fixtureDoc.docId,
      'the state route must serve the fixture docId',
    )
    assert.equal(
      setupState.json.snapshot.title,
      fixtureDoc.title,
      'the state route must serve the fixture title',
    )
    assert.equal(
      setupState.json.snapshot.root,
      fixtureDoc.root,
      'the state route must serve the fixture root',
    )
    assert.deepEqual(
      setupState.json.snapshot.files.map((file) => file.path).sort(),
      fixtureDoc.files.map((file) => file.path).sort(),
      'the published snapshot must contain every fixture file',
    )
    assert.deepEqual(
      setupState.json.snapshot.navigation ?? null,
      fixtureDoc.navigation ?? null,
      'the published snapshot must keep the fixture navigation',
    )
    shared.publishStateVersion = setupState.json.stateVersion
    summary.publish.stateVersion = shared.publishStateVersion

    // 6. Real browser against the real routes.
    browser = await chromium.launch({ headless: true })

    const createContext = async (caseSlug, label) => {
      const context = await browser.newContext({
        viewport: VIEWPORT,
        locale: 'en-US',
        timezoneId: 'UTC',
        colorScheme: 'light',
        reducedMotion: 'reduce',
        acceptDownloads: true,
        serviceWorkers: 'block',
      })
      await context.route('**/*', async (route) => {
        const url = route.request().url()
        const protocol = `${url.slice(0, url.indexOf(':') + 1)}`
        if (url.startsWith(origin) || protocol === 'data:' || protocol === 'blob:') {
          summary.network.allowed += 1
          return route.continue()
        }
        summary.network.blocked += 1
        if (summary.network.offOrigin.length < 50)
          summary.network.offOrigin.push({ case: caseSlug, url })
        return route.abort('blockedbyclient')
      })
      await context.tracing.start({ screenshots: true, snapshots: true })
      return { caseSlug, label, context, network: [], pageErrors: [] }
    }

    const attachPage = async (owned) => {
      const page = await owned.context.newPage()
      page.on('pageerror', (error) => owned.pageErrors.push(error.message))
      page.on('requestfailed', (request) => {
        owned.network.push({
          method: request.method(),
          url: request.url(),
          failed: request.failure()?.errorText ?? 'failed',
          blockedByPolicy: !request.url().startsWith(origin),
        })
      })
      page.on('response', (response) => {
        owned.network.push({
          method: response.request().method(),
          url: response.url(),
          status: response.status(),
        })
      })
      return page
    }

    const openTaco = async (page, signal) => {
      if (signal?.aborted) throw new Error('openTaco aborted before navigation')
      // Arm response listeners before triggering navigation so all initial background
      // requests of HostedSession.load() are guaranteed captured.
      const statePromise = page.waitForResponse(
        (res) =>
          res.request().method() === 'GET' &&
          new URL(res.url()).pathname === `/v1/tacos/${shared.tacoId}/state` &&
          res.status() === 200,
        { timeout: 45_000 },
      )
      const reviewsPromise = page.waitForResponse(
        (res) =>
          res.request().method() === 'GET' &&
          new URL(res.url()).pathname === `/v1/tacos/${shared.tacoId}/reviews` &&
          res.status() === 200,
        { timeout: 45_000 },
      )
      const listenersPromise = page.waitForResponse(
        (res) =>
          res.request().method() === 'GET' &&
          new URL(res.url()).pathname === `/v1/tacos/${shared.tacoId}/listeners` &&
          res.status() === 200,
        { timeout: 45_000 },
      )
      await page.goto(`${origin}/t/${shared.tacoId}`, { waitUntil: 'load' })
      if (signal?.aborted) throw new Error('openTaco aborted after load')
      await Promise.all([statePromise, reviewsPromise, listenersPromise])
      if (signal?.aborted) throw new Error('openTaco aborted after responses')
      // Wait for the observable finalized mounted state: initial state and reviews have been
      // adopted, .ProseMirror is ready, .host-presence-button is mounted, .host-recovery-control
      // is hidden (clean ready state, no premature conflict), and .save-button is not dirty.
      await page.waitForFunction(
        () => {
          if (!window.taco) return false
          const prose = document.querySelector('.ProseMirror')
          if (!prose) return false
          const presence = document.querySelector('.host-presence-button')
          if (!presence) return false
          const recovery = document.querySelector('.host-recovery-control')
          if (!recovery || !recovery.hidden) return false
          const saveBtn = document.querySelector('.save-button')
          if (!saveBtn || saveBtn.classList.contains('is-dirty')) return false
          return true
        },
        null,
        { timeout: 45_000 },
      )
      if (signal?.aborted) throw new Error('openTaco aborted after finalized state')
    }

    const capture = async (owned, page, name) => {
      const base = `${owned.caseSlug}-${owned.label}-${name}`
      const dir = join(outDir, owned.caseSlug)
      await page.screenshot({ path: join(dir, `${base}.png`) })
      await writeFile(
        join(dir, `${base}.aria.txt`),
        `${await page.locator('body').ariaSnapshot()}\n`,
      )
      return base
    }

    const runCase = async (id, body) => {
      const caseSlug = slugOf(id)
      const caseDir = join(outDir, caseSlug)
      await mkdir(caseDir, { recursive: true })
      const caseStart = Date.now()
      const actions = []
      const owned = []
      const caseSubscriptions = []
      const extras = new Map()
      const caseAbort = new AbortController()

      if (globalAbort.signal.aborted) {
        throw new Error(`Execution interrupted before case ${id}: ${interruptedSignal}`)
      }
      const onGlobalAbort = () => caseAbort.abort(globalAbort.signal.reason)
      globalAbort.signal.addEventListener('abort', onGlobalAbort, { once: true })

      const checkAborted = () => {
        if (caseAbort.signal.aborted) {
          throw new Error(`[${id}] case aborted: cannot acquire new resources or perform requests`)
        }
      }

      const caseApi = async (pathname, init = {}) => {
        checkAborted()
        const signal = init.signal
          ? AbortSignal.any([caseAbort.signal, init.signal])
          : caseAbort.signal
        const response = await fetch(`${origin}${pathname}`, { ...init, signal })
        const text = await response.text()
        let json = null
        try {
          json = text ? JSON.parse(text) : null
        } catch {
          json = null
        }
        return { response, status: response.status, text, json }
      }

      const caseReadState = async () => {
        const result = await caseApi(`/v1/tacos/${shared.tacoId}/state`, {
          headers: { Accept: 'application/json' },
        })
        assert.equal(
          result.status,
          200,
          `GET state must succeed: ${result.status} ${result.text.slice(0, 500)}`,
        )
        return result
      }
      const caseReadThreads = async () => {
        const result = await caseApi(`/v1/tacos/${shared.tacoId}/reviews`, {
          headers: { Accept: 'application/json' },
        })
        assert.equal(
          result.status,
          200,
          `GET reviews must succeed: ${result.status} ${result.text.slice(0, 500)}`,
        )
        return result.json ?? []
      }
      const caseReadListeners = async () => {
        const result = await caseApi(`/v1/tacos/${shared.tacoId}/listeners`, {
          headers: { Accept: 'application/json' },
        })
        assert.equal(
          result.status,
          200,
          `GET listeners must succeed: ${result.status} ${result.text.slice(0, 500)}`,
        )
        return result.json?.listeners ?? []
      }

      const caseCreateContext = async (slug, label) => {
        checkAborted()
        const item = await createContext(slug, label)
        if (caseAbort.signal.aborted) {
          await item.context.close()
          checkAborted()
        }
        owned.push(item)
        return item
      }

      const caseAttachPage = async (ownedItem) => {
        checkAborted()
        return attachPage(ownedItem)
      }

      const caseOpenTaco = async (page) => {
        checkAborted()
        return openTaco(page, caseAbort.signal)
      }

      const caseRunCli = async (args, cliOpts = {}) => {
        checkAborted()
        return runCli(args, { ...cliOpts, caseId: id, signal: caseAbort.signal })
      }

      const caseStartCliSubscription = async (subOpts = {}) => {
        checkAborted()
        const sub = await startCliSubscription({
          ...subOpts,
          caseId: id,
          tacoId: shared.tacoId,
          signal: caseAbort.signal,
        })
        caseSubscriptions.push(sub)
        return sub
      }

      const step = async (label, run) => {
        checkAborted()
        actions.push({ at: nowIso(), label })
        try {
          return await run()
        } catch (caught) {
          const failure = caught instanceof Error ? caught : new Error(String(caught))
          failure.step = label
          throw failure
        }
      }

      const caseWithTimeout = (promise, timeoutMs, label) =>
        new Promise((done, failed) => {
          const timer = setTimeout(() => {
            caseAbort.abort(new Error(`${label} timed out after ${timeoutMs}ms`))
            failed(new Error(`${label} timed out after ${timeoutMs}ms`))
          }, timeoutMs)
          promise.then(
            (value) => {
              clearTimeout(timer)
              done(value)
            },
            (error) => {
              clearTimeout(timer)
              failed(error)
            },
          )
        })

      let error = null
      try {
        await caseWithTimeout(
          body({
            id,
            caseSlug,
            caseDir,
            actions,
            owned,
            step,
            extra: (name, value) => extras.set(name, value),
            createContext: caseCreateContext,
            attachPage: caseAttachPage,
            openTaco: caseOpenTaco,
            capture,
            runCli: caseRunCli,
            startCliSubscription: caseStartCliSubscription,
            api: caseApi,
            readState: caseReadState,
            readThreads: caseReadThreads,
            readListeners: caseReadListeners,
            signal: caseAbort.signal,
          }),
          CASE_TIMEOUT_MS,
          id,
        )
      } catch (caught) {
        error = caught instanceof Error ? caught : new Error(String(caught))
        error.message = `${error.step ? `[${error.step}] ` : ''}${error.message}`
      } finally {
        caseAbort.abort()
        globalAbort.signal.removeEventListener('abort', onGlobalAbort)
        for (const sub of caseSubscriptions) {
          try {
            sub.kill()
          } catch {}
          try {
            await sub.record()
          } catch {}
        }
        for (const item of owned) {
          try {
            await item.context.tracing.stop({
              path: join(caseDir, `${caseSlug}-${item.label}.trace.zip`),
            })
          } catch (caught) {
            error ??= new Error(`trace retention failed: ${messageOf(caught)}`)
          }
          if (error) {
            for (const page of item.context.pages()) {
              try {
                await writeFile(
                  join(caseDir, `${caseSlug}-${item.label}-failure.aria.txt`),
                  `${await page.locator('body').ariaSnapshot()}\n`,
                )
                await page.screenshot({
                  path: join(caseDir, `${caseSlug}-${item.label}-failure.png`),
                })
              } catch {
                // The page may already be gone.
              }
            }
          }
          try {
            await item.context.close()
          } catch (caught) {
            error ??= new Error(`context cleanup failed: ${messageOf(caught)}`)
          }
        }
        const pageErrors = owned.flatMap((item) => item.pageErrors)
        if (!error && pageErrors.length > 0)
          error = new Error(`page errors: ${pageErrors.join(' | ')}`)
      }
      await writeFile(
        join(caseDir, 'network.json'),
        `${JSON.stringify(
          owned.flatMap((item) => item.network),
          null,
          2,
        )}\n`,
      )
      await writeFile(join(caseDir, 'actions.json'), `${JSON.stringify(actions, null, 2)}\n`)
      for (const [name, value] of extras) {
        await writeFile(
          join(caseDir, name),
          typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`,
        )
      }
      const record = {
        id,
        ok: !error,
        durationMs: Date.now() - caseStart,
        dir: relativeToRepo(caseDir),
        error: error ? error.message : null,
      }
      await writeFile(join(caseDir, 'result.json'), `${JSON.stringify(record, null, 2)}\n`)
      summary.cases.push(record)
      if (error) failures.push(`${id}: ${error.message}`)
      console.log(`${error ? 'FAIL' : 'ok  '} ${id} (${record.durationMs}ms)`)
      return record
    }

    // host/open — the served page boots with the inert capability block and the readonly route agrees.
    await runCase(
      'host/open',
      async ({
        caseSlug,
        owned,
        step,
        createContext,
        attachPage,
        openTaco,
        capture,
        extra,
        readState,
      }) => {
        const item = await createContext(caseSlug, 'a')
        const page = await attachPage(item)
        await step('open the served Taco', () => openTaco(page))
        await step('the host capability block is inert and same-origin', async () => {
          const capability = await page.evaluate(() => {
            const element = document.getElementById('taco-host-capability')
            return element
              ? {
                  inHead: element.parentElement === document.head,
                  type: element.getAttribute('type'),
                  payload: element.textContent,
                }
              : null
          })
          assert(capability, 'the served page must declare a host capability block')
          assert.equal(capability.inHead, true, 'the capability block must live in <head>')
          assert.equal(
            capability.type,
            'application/taco+host',
            'the capability block must use the frozen media type',
          )
          assert.deepEqual(JSON.parse(capability.payload), { version: 1, tacoId: shared.tacoId })
          const hosted = await page.evaluate(() => window.taco.hosted())
          assert.equal(hosted?.tacoId, shared.tacoId, 'window.taco.hosted() must report this Taco')
          assert.equal(
            hosted?.apiBase,
            `/v1/tacos/${shared.tacoId}`,
            'the API base must stay same-origin',
          )
        })
        await step('window.taco.validate() reports no error on the served fixture', async () => {
          const validation = await page.evaluate(() => window.taco.validate())
          assert.equal(
            validation.ok,
            true,
            `served fixture must validate: ${JSON.stringify(validation)}`,
          )
          assert.equal(
            validation.counts.error,
            0,
            `the served fixture must have no error finding: ${JSON.stringify(validation.findings)}`,
          )
          assert.deepEqual(validation.issues, [], 'the served fixture must raise no security issue')
          extra('validate.json', {
            counts: validation.counts,
            findings: validation.findings,
            issues: validation.issues,
          })
        })
        await step('the fixture navigation entry is selected', async () => {
          const selected = await page
            .locator('nav.file-sidebar button.file-row.is-selected')
            .getAttribute('data-path')
          assert.equal(selected, introPath, 'the fixture navigation entry must be selected on boot')
        })
        await step('the independent state route serves the published snapshot', async () => {
          const state = await readState()
          assert.equal(
            state.json.snapshot.docId,
            fixtureDoc.docId,
            'the state route must serve the published docId',
          )
          assert.equal(
            state.json.snapshot.files.length,
            fixtureDoc.files.length,
            'the state route must serve every published file',
          )
          assert.equal(
            state.json.stateVersion,
            shared.publishStateVersion,
            'no write may precede the first case',
          )
          const servedIntro = state.json.snapshot.files.find((file) => file.path === introPath)
          assert(servedIntro, `the served snapshot must contain ${introPath}`)
          assert(
            servedIntro.content.includes(FIXTURE.markers.intro),
            'the served snapshot must carry the fixture prose marker',
          )
          const booted = await page.evaluate(
            (path) => window.taco.readFile(path).content,
            introPath,
          )
          assert(
            booted.includes(FIXTURE.markers.intro),
            'the booted page must render the fixture prose marker',
          )
          extra('state.json', {
            stateVersion: state.json.stateVersion,
            revisionId: state.json.revisionId,
            contentHash: summary.publish.contentHash,
          })
        })
        await step('capture the booted page', () => capture(item, page, 'booted'))
      },
    )

    // host/autosave — real editor input reaches the Host and its own state read agrees.
    await runCase(
      'host/autosave',
      async ({
        caseSlug,
        owned,
        step,
        createContext,
        attachPage,
        openTaco,
        capture,
        extra,
        readState,
      }) => {
        const item = await createContext(caseSlug, 'a')
        const page = await attachPage(item)
        await step('open the served Taco', () => openTaco(page))
        const before = await readState()
        await step('select the entry file', async () => {
          await selectFile(page, introPath)
          assert.equal(
            await page
              .locator('nav.file-sidebar button.file-row.is-selected')
              .getAttribute('data-path'),
            introPath,
          )
        })
        const marker = `host-autosave-${runId}`
        const patch = page.waitForResponse(
          (response) =>
            response.request().method() === 'PATCH' &&
            new URL(response.url()).pathname === `/v1/tacos/${shared.tacoId}/state`,
          { timeout: 30_000 },
        )
        await step('type into the editor and wait for the accepted autosave', async () => {
          const [, response] = await Promise.all([typeAtEnd(page, marker), patch])
          const body = await response.json()
          assert.equal(
            response.status(),
            200,
            `autosave must be accepted: ${response.status()} ${JSON.stringify(body)}`,
          )
          assert(
            BigInt(body.stateVersion) > BigInt(before.json.stateVersion),
            'an accepted autosave must advance the state version',
          )
        })
        await step('the independent state read shows the marker', async () => {
          const after = await readState()
          assert(
            BigInt(after.json.stateVersion) > BigInt(before.json.stateVersion),
            'the state version must advance',
          )
          const file = after.json.snapshot.files.find((candidate) => candidate.path === introPath)
          assert(file, `the served snapshot must still contain ${introPath}`)
          assert(file.content.includes(marker), 'the saved state must contain the typed marker')
          const live = await page.evaluate((path) => window.taco.readFile(path).content, introPath)
          assert(live.includes(marker), 'the live editor must hold the marker too')
          shared.autosaveMarker = marker
          shared.autosaveVersion = after.json.stateVersion
          extra('state.json', {
            before: before.json.stateVersion,
            after: after.json.stateVersion,
            marker,
          })
        })
        await step('capture the saved page', () => capture(item, page, 'saved'))
      },
    )

    // host/reopen — a fresh context is served the persisted marker out of SQLite.
    await runCase(
      'host/reopen',
      async ({ caseSlug, owned, step, createContext, attachPage, openTaco, capture, extra }) => {
        assert(shared.autosaveMarker, 'host/autosave must run before host/reopen')
        const item = await createContext(caseSlug, 'a')
        const page = await attachPage(item)
        await step('open the served Taco in a fresh context', () => openTaco(page))
        await step('the markdown surface shows the autosaved marker', async () => {
          await page.waitForFunction(
            (needle) => document.querySelector('.ProseMirror')?.innerText.includes(needle) === true,
            shared.autosaveMarker,
            { timeout: 15_000 },
          )
          const content = await page.evaluate(
            (path) => window.taco.readFile(path).content,
            introPath,
          )
          assert(
            content.includes(shared.autosaveMarker),
            'a second context must be served the saved marker',
          )
          extra('state.json', {
            marker: shared.autosaveMarker,
            stateVersion: shared.autosaveVersion,
          })
        })
        await step('capture the reopened page', () => capture(item, page, 'reopened'))
      },
    )

    // host/comment — a selection comment through the UI, persisted for an independent context.
    await runCase(
      'host/comment',
      async ({
        caseSlug,
        owned,
        step,
        createContext,
        attachPage,
        openTaco,
        capture,
        extra,
        readThreads,
      }) => {
        const commentBody = `Host smoke comment ${runId}`
        const commentMarker = `host-comment-${runId}`
        const authorOwned = await createContext(caseSlug, 'author')
        const authorPage = await attachPage(authorOwned)
        await step('open the served Taco and select the entry file', async () => {
          await openTaco(authorPage)
          await selectFile(authorPage, introPath)
        })
        await step('anchor a comment on text typed in the editor', async () => {
          await typeAtEnd(authorPage, commentMarker)
          await authorPage.keyboard.press('ControlOrMeta+Shift+ArrowLeft')
          const selectionButton = authorPage.locator('.selection-comment-button')
          await selectionButton.waitFor({ state: 'visible', timeout: 10_000 })
          await selectionButton.click()
        })
        const reviewMutation = authorPage.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === `/v1/tacos/${shared.tacoId}/reviews`,
          { timeout: 30_000 },
        )
        let threadId = null
        await step('submit the comment through the composer and author dialog', async () => {
          const [created, response] = await Promise.all([
            submitComment(authorPage, commentBody),
            reviewMutation,
          ])
          threadId = created
          assert(threadId, 'submitComment must return the created thread id')
          assert(
            response.ok(),
            `the comment mutation must succeed: ${response.status()} ${await response.text()}`,
          )
          assert((await readThreads()).length >= 1, 'the Host must hold the new thread')
        })
        await step('capture the authoring page', () =>
          capture(authorOwned, authorPage, 'authoring'),
        )
        const readerOwned = await createContext(caseSlug, 'reader')
        const readerPage = await attachPage(readerOwned)
        await step('a third context sees the same thread', async () => {
          await openTaco(readerPage)
          await openPanelTab(readerPage, 'comments')
          const thread = readerPage.locator(`article.comment-thread[data-thread-id="${threadId}"]`)
          await thread.waitFor({ state: 'visible', timeout: 15_000 })
          assert(
            (await thread.innerText()).includes(commentBody),
            'the thread must show the submitted body',
          )
          const threads = await readThreads()
          const stored = threads.find((candidate) => candidate.id === threadId)
          assert(stored, 'the independent reviews route must serve the thread')
          assert(
            stored.messages.some((message) => message.body === commentBody),
            'the stored thread must hold the body',
          )
          shared.commentThreadId = threadId
          shared.commentBody = commentBody
          shared.commentMarker = commentMarker
          extra('state.json', { threadId, commentBody, threads: threads.length })
        })
        await step('capture the reader page', () => capture(readerOwned, readerPage, 'reader'))
      },
    )

    // host/handoff:no-listener — Handoff is gated by the dialog and posts nothing.
    await runCase(
      'host/handoff:no-listener',
      async ({
        caseSlug,
        owned,
        step,
        createContext,
        attachPage,
        openTaco,
        capture,
        extra,
        readListeners,
      }) => {
        assert(shared.autosaveMarker, 'host/autosave must run before handoff')
        const item = await createContext(caseSlug, 'a')
        const page = await attachPage(item)
        const handoffs = []
        page.on('request', (request) => {
          if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/handoffs'))
            handoffs.push(request.url())
        })
        await step('no listener is connected', async () => {
          assert.deepEqual(
            await readListeners(),
            [],
            'the gating case must start with no listener lease',
          )
        })
        await step('open the served Taco', () => openTaco(page))
        await step('Handoff opens the no-listeners dialog and sends nothing', async () => {
          await page.locator('button.copy-review-main').click()
          const dialog = page.locator('dialog.host-no-listeners-dialog')
          await dialog.waitFor({ state: 'visible', timeout: 20_000 })
          const text = await dialog.innerText()
          assert(
            text.includes(`taco-cli subscribe ${shared.tacoId} --host ${origin}`),
            'the dialog must name the real subscribe command for this Taco',
          )
          await capture(item, page, 'gated')
          await sleep(1500)
          assert.deepEqual(handoffs, [], 'a gated Handoff must not post to /handoffs')
          extra('state.json', { listeners: 0, handoffs: handoffs.length })
        })
      },
    )

    // host/handoff:listener — the real CLI subscriber must receive the handoff, and read it back.
    await runCase(
      'host/handoff:listener',
      async ({
        id,
        caseSlug,
        owned,
        step,
        createContext,
        attachPage,
        openTaco,
        capture,
        extra,
        runCli,
        startCliSubscription,
        readListeners,
        api,
      }) => {
        assert(
          shared.autosaveMarker && shared.commentThreadId,
          'earlier cases must persist content and a comment first',
        )
        const item = await createContext(caseSlug, 'a')
        const page = await attachPage(item)
        await step('open the served Taco', () => openTaco(page))
        let subscription = null
        try {
          await step('the real CLI subscribes over SSE and reports its listener', async () => {
            subscription = await startCliSubscription({ caseId: id, tacoId: shared.tacoId })
            const ready = await subscription.ready
            assert.equal(ready.protocol, 'taco-host/1', 'the ready frame must name the protocol')
            assert.equal(ready.tacoId, shared.tacoId, 'the ready frame must name this Taco')
            assert.equal(ready.mode, 'live', 'a first subscribe is a live stream')
            assert.match(
              String(ready.cursor),
              /^(0|[1-9][0-9]*)$/,
              'the ready frame must carry a decimal cursor',
            )
            const listenersDeadline = Date.now() + 15_000
            let seen = []
            while (Date.now() < listenersDeadline) {
              seen = await readListeners()
              if (seen.length >= 1) break
              await sleep(250)
            }
            assert.equal(
              seen.length,
              1,
              `the Host must report exactly the CLI listener: ${JSON.stringify(seen)}`,
            )
            assert(!seen[0].name, 'the CLI listener self-reports no display name')
            extra('state.json', { listeners: seen })
          })
          const handoffResponse = page.waitForResponse(
            (response) =>
              response.request().method() === 'POST' &&
              new URL(response.url()).pathname === `/v1/tacos/${shared.tacoId}/handoffs`,
            { timeout: 60_000 },
          )
          let handoffId = null
          await step('Handoff commits against the real Host', async () => {
            const [, response] = await Promise.all([
              page.locator('button.copy-review-main').click(),
              handoffResponse,
            ])
            const body = await response.json()
            assert.equal(
              response.status(),
              201,
              `handoff must be created: ${response.status()} ${JSON.stringify(body)}`,
            )
            assert.equal(body.changed, true, 'a first handoff must report changed content')
            handoffId = body.handoffId
            assert(handoffId, 'the handoff response must carry the handoff id')
            await page.waitForFunction(
              () =>
                document.querySelector('.taco-toast')?.textContent?.includes('Handed off to') ===
                true,
              null,
              { timeout: 15_000 },
            )
            await capture(item, page, 'handed-off')
          })
          await step('the CLI subscriber receives the handoff event and exits 0', async () => {
            const event = await subscription.waitForFrame(
              (frame) => frame.type === 'review.handed_off',
              20_000,
            )
            assert.equal(event.tacoId, shared.tacoId, 'the event must name this Taco')
            assert.equal(
              event.data?.handoffId,
              handoffId,
              'the event must name the committed handoff',
            )
            const exit = await subscription.waitForExit(20_000)
            assert(exit, 'the CLI subscriber must exit after the handoff event')
            assert.equal(
              exit.code,
              0,
              `the CLI subscriber must exit 0 (got ${JSON.stringify(exit)})`,
            )
          })
          await step('the CLI reads back the same receipt the API serves', async () => {
            const receipt = await api(`/v1/tacos/${shared.tacoId}/handoffs/${handoffId}`, {
              headers: { Accept: 'application/json' },
            })
            assert.equal(
              receipt.status,
              200,
              `the handoff must be readable: ${receipt.status} ${receipt.text.slice(0, 500)}`,
            )
            const handoffRun = await runCli(
              ['handoff', shared.tacoId, handoffId, '--host', origin],
              { caseId: id },
            )
            assert.equal(
              handoffRun.code,
              0,
              `CLI handoff must succeed (exit ${handoffRun.code}): ${handoffRun.stderr}`,
            )
            const viaCli = JSON.parse(handoffRun.stdout)
            assert.deepEqual(
              viaCli,
              receipt.json,
              'the CLI handoff read must equal the API receipt',
            )
            const changed = viaCli.payload.changedFiles.find(
              (file) => file.path === FIXTURE.paths.intro,
            )
            assert(changed, `the receipt must list ${FIXTURE.paths.intro}`)
            assert(
              changed.content.includes(shared.autosaveMarker),
              'the receipt must carry the autosaved content',
            )
            const thread = viaCli.payload.comments.find(
              (candidate) => candidate.id === shared.commentThreadId,
            )
            assert(thread, 'the receipt must carry the comment thread')
            assert(
              thread.messages.some((message) => message.body === shared.commentBody),
              'the receipt must carry the comment body',
            )
            extra('receipt.json', {
              handoffId,
              author: viaCli.author,
              changedFiles: viaCli.payload.changedFiles.map((file) => file.path),
              commentThread: thread.id,
              cliExitCode: handoffRun.code,
            })
            shared.handoffId = handoffId
          })
        } finally {
          subscription?.kill()
          const record = await subscription?.record()
          if (record) summary.cliSubscription = record
        }
      },
    )

    // host/conflict — a stale state version is rejected, then Load latest recovers the saved content.
    await runCase(
      'host/conflict',
      async ({
        id,
        caseSlug,
        owned,
        step,
        createContext,
        attachPage,
        openTaco,
        capture,
        extra,
        startCliSubscription,
        readState,
        readListeners,
      }) => {
        assert(
          shared.autosaveMarker && shared.commentThreadId,
          'earlier cases must persist content first',
        )
        const base = (await readState()).json.stateVersion
        const first = await createContext(caseSlug, 'first')
        const second = await createContext(caseSlug, 'second')
        const firstPage = await attachPage(first)
        const secondPage = await attachPage(second)
        let subscription = null
        try {
          await step('a real CLI listener is connected, so Handoff is not gated', async () => {
            subscription = await startCliSubscription({ caseId: id, tacoId: shared.tacoId })
            const ready = await subscription.ready
            assert.equal(ready.tacoId, shared.tacoId, 'the ready frame must name this Taco')
            const listenersDeadline = Date.now() + 15_000
            let seen = []
            while (Date.now() < listenersDeadline) {
              seen = await readListeners()
              if (seen.length >= 1) break
              await sleep(250)
            }
            assert(seen.length >= 1, `the listener gate must be satisfied: ${JSON.stringify(seen)}`)
          })
          await step('two contexts open at the same state version', async () => {
            await openTaco(firstPage)
            await openTaco(secondPage)
            await selectFile(firstPage, introPath)
            await selectFile(secondPage, introPath)
            assert.equal(
              (await readState()).json.stateVersion,
              base,
              'opening two contexts must not change the state version',
            )
          })
          const firstMarker = `host-conflict-first-${runId}`
          const secondMarker = `host-conflict-second-${runId}`
          await step('the first context saves', async () => {
            const patch = firstPage.waitForResponse(
              (response) =>
                response.request().method() === 'PATCH' &&
                new URL(response.url()).pathname === `/v1/tacos/${shared.tacoId}/state`,
              { timeout: 30_000 },
            )
            const [, response] = await Promise.all([typeAtEnd(firstPage, firstMarker), patch])
            assert.equal(
              response.status(),
              200,
              `the first save must succeed: ${response.status()} ${await response.text()}`,
            )
            const body = await response.json()
            assert.equal(
              body.stateVersion,
              String(BigInt(base) + 1n),
              'the first save must advance exactly one version',
            )
          })
          await step('the stale context is rejected with 409', async () => {
            const patch = secondPage.waitForResponse(
              (response) =>
                response.request().method() === 'PATCH' &&
                new URL(response.url()).pathname === `/v1/tacos/${shared.tacoId}/state`,
              { timeout: 30_000 },
            )
            const [, response] = await Promise.all([typeAtEnd(secondPage, secondMarker), patch])
            const body = await response.json()
            assert.equal(
              response.status(),
              409,
              `a stale save must be rejected: ${response.status()} ${JSON.stringify(body)}`,
            )
            assert.equal(
              body.error?.code,
              'CONFLICT',
              'the rejection must report the conflict code',
            )
          })
          await step('the conflict control is visible with the conflict label', async () => {
            await secondPage
              .locator('.host-recovery-control')
              .waitFor({ state: 'visible', timeout: 15_000 })
            const label = await secondPage.locator('.host-recovery-status').innerText()
            assert(label.includes('Conflict'), `the status must name the conflict: ${label}`)
            const buttonLabel = await secondPage
              .locator('.host-recovery-button .button-label')
              .innerText()
            assert(
              buttonLabel.includes('load the latest'),
              `the recovery button must offer Load latest: ${buttonLabel}`,
            )
            const content = await secondPage.evaluate(
              (path) => window.taco.readFile(path).content,
              introPath,
            )
            assert(content.includes(secondMarker), 'the stale draft must stay in the editor')
            await capture(second, secondPage, 'conflict')
          })
          const handoffs = []
          secondPage.on('request', (request) => {
            if (
              request.method() === 'POST' &&
              new URL(request.url()).pathname.endsWith('/handoffs')
            )
              handoffs.push(request.url())
          })
          await step('Handoff is blocked by the conflict and posts nothing', async () => {
            await secondPage.locator('button.copy-review-main').click()
            await secondPage.waitForFunction(
              () =>
                document
                  .querySelector('.taco-toast')
                  ?.textContent?.includes('nothing was handed off') === true,
              null,
              { timeout: 20_000 },
            )
            await sleep(1000)
            assert.deepEqual(handoffs, [], 'a conflicted Handoff must not post to /handoffs')
            assert(
              subscription.frames.every((frame) => frame.type !== 'review.handed_off'),
              'a blocked Handoff must not reach the listener',
            )
          })
          await step('Load latest restores the saved content', async () => {
            await secondPage.locator('.host-recovery-button').click()
            const dialog = secondPage.locator('dialog.confirmation-dialog[open]')
            await dialog.waitFor({ state: 'visible', timeout: 15_000 })
            const confirmLabel = await dialog
              .locator('.control-button-primary .button-label')
              .innerText()
            assert(
              confirmLabel.includes('load the latest'),
              `the confirmation must be explicit: ${confirmLabel}`,
            )
            await dialog.locator('.control-button-primary').click()
            await secondPage.waitForFunction(
              (needle) =>
                document.querySelector('.ProseMirror')?.innerText.includes(needle) === true,
              firstMarker,
              { timeout: 20_000 },
            )
            const content = await secondPage.evaluate(
              (path) => window.taco.readFile(path).content,
              introPath,
            )
            assert(
              !content.includes(secondMarker),
              'the discarded draft must be gone from the editor',
            )
            const state = await readState()
            const saved = state.json.snapshot.files.find((file) => file.path === introPath)
            assert.equal(
              content,
              saved.content,
              'the recovered editor content must equal the saved Host state',
            )
            await secondPage
              .locator('.host-recovery-control')
              .waitFor({ state: 'hidden', timeout: 15_000 })
            extra('state.json', {
              base,
              firstMarker,
              secondMarker,
              stateVersion: state.json.stateVersion,
              handoffs: handoffs.length,
            })
          })
          await step('capture the recovered page', () => capture(second, secondPage, 'recovered'))
        } finally {
          subscription?.kill()
          await subscription?.record()
        }
      },
    )

    // host/csrf — the real routes reject a missing token and a hostile origin.
    await runCase('host/csrf', async ({ step, extra, api, readState }) => {
      const before = await readState()
      const version = before.json.stateVersion
      const stateRes = await api(`/v1/tacos/${shared.tacoId}/state`, {
        headers: { Accept: 'application/json' },
      })
      const token = stateRes.response.headers.get('x-taco-csrf')
      assert(token, 'GET state must issue a CSRF token')
      const cookieHeader = stateRes.response.headers.get('set-cookie')
      const nonceMatch = cookieHeader?.match(/taco_csrf=([^;]+)/)
      const cookieNonce = nonceMatch ? nonceMatch[1] : null
      assert(cookieNonce, 'GET state must set a taco_csrf cookie')

      const patchBody = JSON.stringify({
        protocol: 'taco-state/1',
        expectedStateVersion: version,
        author: 'Verification Reviewer',
        fileChanges: [],
        title: `${fixtureDoc.title} (csrf probe)`,
      })
      const probes = []
      await step('a patch without X-Taco-CSRF is rejected', async () => {
        const result = await api(`/v1/tacos/${shared.tacoId}/state`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
          body: patchBody,
        })
        probes.push({
          header: null,
          origin: null,
          cookie: null,
          status: result.status,
          code: result.json?.error?.code ?? null,
          message: result.json?.error?.message ?? null,
        })
        assert.equal(
          result.status,
          403,
          `a patch without the token must be rejected: ${result.status} ${result.text.slice(0, 300)}`,
        )
        assert.equal(result.json?.error?.code, 'FORBIDDEN', 'the rejection must report FORBIDDEN')
      })
      await step(
        'a patch from a hostile origin with matching CSRF cookie and token is rejected solely for cross-origin',
        async () => {
          const result = await api(`/v1/tacos/${shared.tacoId}/state`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': randomUUID(),
              'X-Taco-CSRF': token,
              Origin: 'http://evil.invalid',
              Cookie: `taco_csrf=${cookieNonce}`,
            },
            body: patchBody,
          })
          probes.push({
            header: 'X-Taco-CSRF',
            origin: 'http://evil.invalid',
            cookie: 'taco_csrf',
            status: result.status,
            code: result.json?.error?.code ?? null,
            message: result.json?.error?.message ?? null,
          })
          assert.equal(
            result.status,
            403,
            `a cross-origin patch must be rejected: ${result.status} ${result.text.slice(0, 300)}`,
          )
          assert.equal(result.json?.error?.code, 'FORBIDDEN', 'the rejection must report FORBIDDEN')
        },
      )
      await step(
        'a positive control request with matching same-origin, token, and cookie passes CSRF verification',
        async () => {
          // Positive control: same-origin, valid token, matching cookie.
          // It passes validateCsrfAndOrigin (step 1), idempotency (step 2), and reaches the DB where expectedStateVersion mismatch returns 409 CONFLICT,
          // proving CSRF verification succeeded (not 403) while maintaining server state unmodified.
          const positiveBody = JSON.stringify({
            protocol: 'taco-state/1',
            expectedStateVersion: '999999',
            author: 'Verification Reviewer',
            fileChanges: [],
            title: fixtureDoc.title,
          })
          const result = await api(`/v1/tacos/${shared.tacoId}/state`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': randomUUID(),
              'X-Taco-CSRF': token,
              Origin: origin,
              Cookie: `taco_csrf=${cookieNonce}`,
            },
            body: positiveBody,
          })
          probes.push({
            header: 'X-Taco-CSRF',
            origin,
            cookie: 'taco_csrf',
            status: result.status,
            code: result.json?.error?.code ?? null,
            message: result.json?.error?.message ?? null,
          })
          assert.equal(
            result.status,
            409,
            `positive control must pass CSRF check and reach version check: ${result.status} ${result.text.slice(0, 300)}`,
          )
          assert.equal(
            result.json?.error?.code,
            'CONFLICT',
            'positive control must report CONFLICT (not 403 FORBIDDEN)',
          )
        },
      )
      await step('no probe changed the stored state', async () => {
        const after = await readState()
        assert.equal(after.json.stateVersion, version, 'probes must not advance the state version')
        assert.equal(
          after.json.snapshot.title,
          fixtureDoc.title,
          'probes must not change the title',
        )
        extra('csrf.json', { version, probes })
      })
    })

    // host/cli:unknown-taco — an unknown Taco fails fast instead of hanging on the stream.
    await runCase('host/cli:unknown-taco', async ({ id, step, runCli, extra }) => {
      const unknown = randomUUID()
      await step('subscribing to an unknown Taco exits 2', async () => {
        const run = await runCli(['subscribe', unknown, '--host', origin], {
          caseId: id,
          timeoutMs: 30_000,
        })
        assert.equal(
          run.timedOut,
          false,
          'an unknown Taco must fail fast, not hang until the deadline',
        )
        assert.equal(
          run.code,
          2,
          `an unknown Taco must exit 2 (got ${run.code}): ${run.stderr || run.stdout}`,
        )
        assert(run.stderr.includes('NOT_FOUND'), `the failure must report NOT_FOUND: ${run.stderr}`)
        assert.equal(run.stdout.trim(), '', 'a rejected subscribe must not print a ready frame')
        extra('state.json', { unknownTacoId: unknown, exitCode: run.code, stderr: run.stderr })
      })
    })
  } catch (error) {
    failures.push(`setup: ${messageOf(error)}`)
    console.error(`setup failed: ${messageOf(error)}`)
  } finally {
    // Every owned resource is released and every cleanup step is attempted, even after a failure.

    await cleanup('cliChildren', async () => {
      if (cliChildren.size === 0) return 'none live'
      const count = cliChildren.size
      for (const child of cliChildren) {
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 2000).unref()
      }
      return `stopped ${count}`
    })
    await cleanup('browser', async () => {
      if (!browser) return 'not started'
      await browser.close()
      return 'closed'
    })
    await cleanup('build', async () => {
      if (!buildChild) return 'finished'
      await signalTree(buildChild, 'SIGTERM')
      if (!(await waitForExit(buildChild, 5000))) await signalTree(buildChild, 'SIGKILL')
      return 'stopped'
    })
    await cleanup('server', async () => {
      if (!serverChild) return 'not started'
      await signalTree(serverChild, 'SIGTERM')
      if (!(await waitForExit(serverChild, 5000))) await signalTree(serverChild, 'SIGKILL')
      await waitForExit(serverChild, 5000)
      return `stopped (exit ${serverChild.exitCode ?? 'signal'})`
    })
    await cleanup('port', async () => {
      if (!port || !serverChild) return 'not started'
      let closed = false
      for (let attempt = 0; attempt < 20 && !closed; attempt += 1) {
        closed = await portIsClosed(port)
        if (!closed) await sleep(250)
      }
      assert(closed, `port ${port} is still accepting connections`)
      return 'closed'
    })
    await cleanup('sqlite', async () => {
      if (!databasePath) return 'not created'
      let copied = 0
      for (const suffix of ['', '-wal', '-shm']) {
        const source = `${databasePath}${suffix}`
        if (!existsSync(source)) continue
        await cp(source, join(outDir, `host.sqlite${suffix}`))
        copied += 1
      }
      return `copied ${copied} file(s)`
    })
    await cleanup('log', async () => {
      if (!log) return 'not started'
      await log.flush()
      return logFailure ? `failed: ${logFailure}` : 'written'
    })
    await cleanup('cliEvidence', async () => {
      await writeFile(join(outDir, 'cli.json'), `${JSON.stringify(cliRuns, null, 2)}\n`)
      return `${cliRuns.length} invocation(s)`
    })
    await cleanup('secret', async () => {
      if (!csrfSecret) return 'not generated'
      const entries = await readdir(outDir, { recursive: true, withFileTypes: true })
      const files = [
        serverLog,
        ...entries
          .filter((entry) => entry.isFile() && /\.(json|txt|log)$/.test(entry.name))
          .map((entry) => join(entry.parentPath ?? outDir, entry.name)),
      ]
      for (const file of [...new Set(files)]) {
        if (!existsSync(file)) continue
        const text = await readFile(file, 'utf8')
        assert(
          !text.includes(csrfSecret),
          `the CSRF secret must never reach ${relativeToRepo(file)}`,
        )
      }
      return 'absent from evidence'
    })
    await cleanup('workspace', async () => {
      if (!workspaceRoot) return 'not created'
      if (options.keepWorkspace) return `kept at ${relativeToRepo(workspaceRoot)}`
      await rm(workspaceRoot, { recursive: true, force: true })
      return 'removed'
    })
    summary.counts.cases = summary.cases.length
    summary.counts.passed = summary.cases.filter((entry) => entry.ok).length
    summary.counts.failed = summary.cases.filter((entry) => !entry.ok).length
    const ids = summary.cases.map((entry) => entry.id)
    if (JSON.stringify(ids) !== JSON.stringify(EXPECTED_CASE_IDS)) {
      failures.push(
        `executed cases ${JSON.stringify(ids)} do not match the declared order ${JSON.stringify(EXPECTED_CASE_IDS)}`,
      )
    }
    summary.ok = failures.length === 0
    summary.interrupted = interruptedSignal
    summary.failures = failures
    summary.finishedAt = nowIso()
    summary.durationMs = Date.now() - startedMs
    const signalBeforeWrite = interruptedSignal
    await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
    if (signalBeforeWrite !== interruptedSignal) {
      summary.ok = false
      summary.interrupted = interruptedSignal
      await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
    }
    console.log(
      JSON.stringify({
        smoke: 'host',
        ok: summary.ok,
        cases: summary.counts.cases,
        failed: summary.counts.failed,
        evidence: relativeToRepo(outDir),
        cleanup: summary.cleanup,
        failures,
      }),
    )
    if (interruptedSignal) {
      process.exitCode = interruptedSignal === 'SIGINT' ? 130 : 143
    } else if (!summary.ok) {
      process.exitCode = 1
    }
    process.removeListener('SIGINT', handleSigInt)
    process.removeListener('SIGTERM', handleSigTerm)
  }
}

await main().catch((error) => {
  console.error(`host smoke crashed: ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
})
