// @vitest-environment node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/runner.ts'
import { executeListen } from '../src/listen.ts'
import { EXIT_CODES } from '../src/errors.ts'
import { readBundleFromHtml, type TacoBundle } from '../../../skills/taco/scripts/pack.mjs'

const FIXTURE_TACO = resolve(
  import.meta.dirname,
  '../../../specs/008-taco-host-contract/008-taco-host-contract.taco.html',
)

interface ReadyEventPayload {
  type: 'ready'
  port: number
  docId: string
  sessionId: string
  url: string
}

interface CliErrorJson {
  error: {
    code: string
    message: string
  }
}

interface JsonHandoffResponse {
  ok: boolean
  error?: string
  handoffId?: string
}

interface LockFilePayload {
  pid: number
  port: number
}

interface TestListener {
  port: number
  token: string
  sessionId: string
  docId: string
  readyUrl: string
  originalBundle: TacoBundle
  resultPromise: Promise<{ exitCode: number; stdout?: string; stderr?: string }>
  abort: () => void
}

async function spawnTestListener(artifactPath: string, timeout = 30): Promise<TestListener> {
  const abortController = new AbortController()
  const { promise: readyPromise, resolve: resolveReady } =
    Promise.withResolvers<ReadyEventPayload>()

  const originalWrite = process.stdout.write
  process.stdout.write = function (
    chunk: string | Uint8Array,
    encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ): boolean {
    try {
      const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      for (const line of str.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('{"type":"ready"')) {
          const parsed = JSON.parse(trimmed) as ReadyEventPayload
          resolveReady(parsed)
        }
      }
    } catch {}

    if (typeof encodingOrCb === 'function') {
      return originalWrite.call(process.stdout, chunk, undefined, encodingOrCb)
    }
    if (typeof encodingOrCb === 'string') {
      return originalWrite.call(process.stdout, chunk, encodingOrCb, cb)
    }
    return originalWrite.call(process.stdout, chunk, undefined, cb)
  }

  const resultPromise = executeListen({
    filePath: artifactPath,
    port: 0,
    timeout,
    noOpen: true,
    signal: abortController.signal,
  })

  let readyEvent: ReadyEventPayload
  try {
    readyEvent = await readyPromise
  } finally {
    process.stdout.write = originalWrite
  }

  const hash = readyEvent.url.slice(
    readyEvent.url.indexOf('#taco-listen=') + '#taco-listen='.length,
  )
  const decoded = decodeURIComponent(hash)
  const params = new URLSearchParams(decoded)
  const token = params.get('token') || ''

  const bundleRes = await readBundleFromHtml(artifactPath)
  const originalBundle = bundleRes.bundle

  return {
    port: readyEvent.port,
    token,
    sessionId: readyEvent.sessionId,
    docId: readyEvent.docId,
    readyUrl: readyEvent.url,
    originalBundle,
    resultPromise,
    abort: () => abortController.abort(),
  }
}

describe('listener hardening (Finding 1-4)', () => {
  const tempDirs: string[] = []

  const createTempArtifact = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'taco-listen-hardening-'))
    tempDirs.push(dir)
    const dest = join(dir, 'test-artifact.taco.html')
    copyFileSync(FIXTURE_TACO, dest)
    return dest
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {}
    }
    tempDirs.length = 0
  })

  it('rejects deeply nested payloads with 400 without crashing, and accepts subsequent valid handoff', async () => {
    const artifactPath = createTempArtifact()
    const listener = await spawnTestListener(artifactPath, 30)

    try {
      // 1. Send deeply nested payload exceeding depth limit (MAX_TRAVERSAL_DEPTH = 64)
      let nested: unknown = { leaf: true }
      for (let i = 0; i < 80; i++) {
        nested = [nested]
      }
      const deepPayload = {
        schema: 'taco-local-handoff/1',
        createdAt: new Date().toISOString(),
        docId: listener.docId,
        sessionId: listener.sessionId,
        handoffId: 'deep_test_1',
        baseline: listener.originalBundle,
        snapshot: listener.originalBundle,
        deepData: nested,
      }

      const resDeep = await fetch(`http://127.0.0.1:${listener.port}/handoff`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${listener.token}`,
          'X-Taco-Doc-Id': listener.docId,
          'X-Taco-Session-Id': listener.sessionId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(deepPayload),
      })

      expect(resDeep.status).toBe(400)
      const deepJson = (await resDeep.json()) as JsonHandoffResponse
      expect(deepJson.ok).toBe(false)
      expect(deepJson.error).toContain('payload too deeply nested')

      // 2. Verify listener is still alive and accepts subsequent valid handoff
      const validPayload = {
        schema: 'taco-local-handoff/1',
        createdAt: new Date().toISOString(),
        docId: listener.docId,
        sessionId: listener.sessionId,
        handoffId: 'valid_handoff_1',
        baseline: listener.originalBundle,
        snapshot: listener.originalBundle,
      }

      const resValid = await fetch(`http://127.0.0.1:${listener.port}/handoff`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${listener.token}`,
          'X-Taco-Doc-Id': listener.docId,
          'X-Taco-Session-Id': listener.sessionId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validPayload),
      })

      expect(resValid.status).toBe(200)
      const validJson = (await resValid.json()) as JsonHandoffResponse
      expect(validJson.ok).toBe(true)
      expect(validJson.handoffId).toBe('valid_handoff_1')

      const cliResult = await listener.resultPromise
      expect(cliResult.exitCode).toBe(EXIT_CODES.OK)

      // Verify lockfile was removed after clean exit
      const lockPath = join(dirname(artifactPath), `.${basename(artifactPath)}.listen.lock`)
      expect(existsSync(lockPath)).toBe(false)
    } finally {
      listener.abort()
    }
  })

  it('enforces admission control: rejects concurrent in-flight bodies exceeding limit', async () => {
    const artifactPath = createTempArtifact()
    const listener = await spawnTestListener(artifactPath, 30)

    const holdRequests: http.ClientRequest[] = []
    try {
      // Satiate 4 concurrent in-flight requests (MAX_CONCURRENT_REQUESTS = 4)
      const connectPromises: Promise<void>[] = []
      for (let i = 0; i < 4; i++) {
        const { promise: connected, resolve: resolveConnected } = Promise.withResolvers<void>()
        connectPromises.push(connected)

        const req = http.request({
          hostname: '127.0.0.1',
          port: listener.port,
          path: '/handoff',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${listener.token}`,
            'X-Taco-Doc-Id': listener.docId,
            'X-Taco-Session-Id': listener.sessionId,
            'Content-Type': 'application/json',
            'Transfer-Encoding': 'chunked',
          },
        })

        req.on('socket', (socket) => {
          if (socket.connecting) {
            socket.once('connect', () => {
              req.write('{"chunk":1')
              resolveConnected()
            })
          } else {
            req.write('{"chunk":1')
            resolveConnected()
          }
        })

        // Teardown destroys these held requests; the resulting socket reset is expected.
        req.on('error', () => {})
        holdRequests.push(req)
      }

      await Promise.all(connectPromises)

      // 5th request must be rejected immediately by admission control
      const resOverLimit = await fetch(`http://127.0.0.1:${listener.port}/handoff`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${listener.token}`,
          'X-Taco-Doc-Id': listener.docId,
          'X-Taco-Session-Id': listener.sessionId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ping: true }),
      })

      expect([429, 503]).toContain(resOverLimit.status)
      const jsonOverLimit = (await resOverLimit.json()) as JsonHandoffResponse
      expect(jsonOverLimit.ok).toBe(false)
      expect(jsonOverLimit.error).toContain('Too many concurrent requests')
    } finally {
      for (const req of holdRequests) {
        req.destroy()
      }
      listener.abort()
    }
  })

  it('safely handles lock files: preserves young incomplete lock, replaces stale old lock', async () => {
    const artifactPath = createTempArtifact()
    const lockPath = join(dirname(artifactPath), `.${basename(artifactPath)}.listen.lock`)

    // 1. Simulate pre-existing incomplete/young lock (mtime fresh, corrupted/empty content)
    writeFileSync(lockPath, '{"pid":', 'utf8')

    const resYoung = await runCli([
      'listen',
      artifactPath,
      '--no-open',
      '--port',
      '0',
      '--timeout',
      '1',
    ])
    expect(resYoung.exitCode).toBe(EXIT_CODES.CONFLICT_ERROR)
    const youngPayload = JSON.parse(resYoung.stderr!) as CliErrorJson
    const errYoung = youngPayload.error
    expect(errYoung.code).toBe('CONFLICT_ERROR')

    // Verify young incomplete lock was NOT stolen or unlinked
    expect(existsSync(lockPath)).toBe(true)
    expect(readFileSync(lockPath, 'utf8')).toBe('{"pid":')

    // 2. Simulate stale old lock: set mtime to 10 seconds ago
    const past = new Date(Date.now() - 10_000)
    utimesSync(lockPath, past, past)

    // Now spawn listener: it should detect stale lock, replace it atomically, and acquire lock
    const listener = await spawnTestListener(artifactPath, 5)
    try {
      expect(existsSync(lockPath)).toBe(true)
      const lockData = JSON.parse(readFileSync(lockPath, 'utf8')) as LockFilePayload
      expect(lockData.pid).toBe(process.pid)
      expect(lockData.port).toBe(listener.port)
    } finally {
      listener.abort()
    }
  })

  it('refuses to start when receipt directory has insecure permissions (mode 0777)', async () => {
    const artifactPath = createTempArtifact()
    const userSuffix =
      typeof process.getuid === 'function' ? String(process.getuid()) : process.env.USER || 'user'
    const receiptsDir = join(tmpdir(), `taco-receipts-${userSuffix}`)

    mkdirSync(receiptsDir, { recursive: true, mode: 0o700 })
    chmodSync(receiptsDir, 0o777)

    try {
      const res = await runCli(['listen', artifactPath, '--no-open', '--port', '0'])
      expect(res.exitCode).toBe(EXIT_CODES.LOCAL_IO_ERROR)
      const errPayload = JSON.parse(res.stderr!) as CliErrorJson
      const err = errPayload.error
      expect(err.code).toBe('LOCAL_IO_ERROR')
      expect(err.message).toContain('insecure permissions')
    } finally {
      // Restore secure mode
      chmodSync(receiptsDir, 0o700)
    }
  })
})
