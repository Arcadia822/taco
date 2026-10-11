import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { readBundleFromHtml, validateBundle, type TacoBundle } from '../../../skills/taco/scripts/pack.mjs'
import { EXIT_CODES, makeCliError, type CliErrorPayload } from './errors.ts'
import type { LocalHandoff, LocalReceipt, TacoDocument } from '@taco/protocol'

export interface ListenOptions {
  filePath: string
  port?: number
  timeout?: number
  noOpen?: boolean
  openBrowser?: boolean
}

export interface CliExecutionResult {
  exitCode: number
  stdout?: string
  stderr?: string
}

const MAX_BODY_BYTES = 64 * 1024 * 1024 // 64 MiB limit

const isLoopbackHost = (hostHeader: string | undefined): boolean => {
  if (!hostHeader) return false
  try {
    const url = new URL(`http://${hostHeader}`)
    const h = url.hostname.toLowerCase()
    return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]'
  } catch {
    return false
  }
}

const isLoopbackOrigin = (originHeader: string | undefined): boolean => {
  if (!originHeader || originHeader === 'null') return true
  try {
    const url = new URL(originHeader)
    const h = url.hostname.toLowerCase()
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]')
    )
  } catch {
    return false
  }
}

const CREDENTIAL_KEY_PATTERN =
  /^(collab|access|credentials|relay|relayConfig|relay_config|token|secret|apiKey|api_key|password|authToken|auth_token|accessToken|access_token|privateKey|ownerPriv|priv|key|authorization)$/i

const hasCredentials = (obj: unknown): boolean => {
  if (!obj || typeof obj !== 'object') return false
  if (Array.isArray(obj)) return obj.some(hasCredentials)
  const record = obj as Record<string, unknown>
  for (const [k, v] of Object.entries(record)) {
    if (CREDENTIAL_KEY_PATTERN.test(k)) return true
    if (v && typeof v === 'object' && hasCredentials(v)) return true
  }
  return false
}

const credentialFreeDocument = (doc: Record<string, unknown>): TacoDocument => {
  const clone = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>
  for (const k of Object.keys(clone)) {
    if (CREDENTIAL_KEY_PATTERN.test(k)) {
      delete clone[k]
    }
  }

  if (Array.isArray(clone.files)) {
    clone.files = clone.files.map((file) => {
      if (!file || typeof file !== 'object') return file
      const f = { ...file } as Record<string, unknown>
      for (const k of Object.keys(f)) {
        if (CREDENTIAL_KEY_PATTERN.test(k)) {
          delete f[k]
        }
      }
      if (Array.isArray(f.blocks)) {
        f.blocks = f.blocks.map((block) => {
          if (!block || typeof block !== 'object') return block
          const b = { ...block } as Record<string, unknown>
          for (const k of Object.keys(b)) {
            if (CREDENTIAL_KEY_PATTERN.test(k)) {
              delete b[k]
            }
          }
          return b
        })
      }
      return f
    })
  }
  return clone as unknown as TacoDocument
}

export const executeListen = (options: ListenOptions): Promise<CliExecutionResult> => {
  const { promise, resolve: resolvePromise } = Promise.withResolvers<CliExecutionResult>()

  const artifactPath = resolve(options.filePath)
  if (!existsSync(artifactPath)) {
    const error = makeCliError('LOCAL_IO_ERROR', `File not found: ${artifactPath}`)
    resolvePromise({ exitCode: EXIT_CODES.LOCAL_IO_ERROR, stderr: JSON.stringify(error) })
    return promise
  }

  void (async () => {
    let originalBundle: TacoBundle
    let docId: string
    try {
      const res = await readBundleFromHtml(artifactPath)
      originalBundle = res.bundle
      docId = originalBundle.docId
    } catch (err) {
      const error = makeCliError(
        'VALIDATION_ERROR',
        `Failed to parse taco bundle: ${(err as Error).message}`,
      )
      resolvePromise({ exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) })
      return
    }

    const sessionId = `sess_${randomBytes(8).toString('hex')}`
    const sessionToken = randomBytes(16).toString('hex')
    const requestedPort = options.port ? Number(options.port) : 0
    const timeoutSec = options.timeout ? Number(options.timeout) : 300

    const lockFilePath = join(dirname(artifactPath), `.${basename(artifactPath)}.listen.lock`)
    const lockInstanceId = randomBytes(16).toString('hex')
    let lockAcquired = false

    const acquireLock = async (
      port: number,
    ): Promise<{ ok: true } | { ok: false; error: CliErrorPayload }> => {
      const lockPayload = JSON.stringify({
        pid: process.pid,
        port,
        docId,
        startTime: Date.now(),
        lockInstanceId,
      })

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await writeFile(lockFilePath, lockPayload, { flag: 'wx', encoding: 'utf8' })
          lockAcquired = true
          return { ok: true }
        } catch (err: unknown) {
          const nodeErr = err as NodeJS.ErrnoException
          if (nodeErr?.code === 'EEXIST') {
            let lockData: { pid?: number; lockInstanceId?: string } | null = null
            try {
              const content = await readFile(lockFilePath, 'utf8')
              lockData = JSON.parse(content) as { pid?: number; lockInstanceId?: string }
            } catch {
              // Unreadable / corrupted lockfile treated as stale
            }

            if (lockData && typeof lockData.pid === 'number') {
              let isAlive = false
              try {
                process.kill(lockData.pid, 0)
                isAlive = true
              } catch (killErr: unknown) {
                const killErrNode = killErr as NodeJS.ErrnoException
                if (killErrNode?.code !== 'ESRCH') {
                  isAlive = true
                }
              }

              if (isAlive) {
                return {
                  ok: false,
                  error: makeCliError(
                    'CONFLICT_ERROR',
                    `Another listener is already running for ${basename(artifactPath)} (pid ${lockData.pid})`,
                  ),
                }
              }
            }

            // Stale lock: await its removal before retry
            try {
              await unlink(lockFilePath)
            } catch (unlinkErr: unknown) {
              const unlinkErrNode = unlinkErr as NodeJS.ErrnoException
              if (unlinkErrNode?.code !== 'ENOENT') {
                return {
                  ok: false,
                  error: makeCliError(
                    'CONFLICT_ERROR',
                    `Failed to remove stale lockfile: ${unlinkErrNode?.message || String(unlinkErr)}`,
                  ),
                }
              }
            }
            continue
          }

          const errMsg = err instanceof Error ? err.message : String(err)
          return {
            ok: false,
            error: makeCliError('CONFLICT_ERROR', `Failed to acquire listener lock: ${errMsg}`),
          }
        }
      }

      return {
        ok: false,
        error: makeCliError(
          'CONFLICT_ERROR',
          `Failed to acquire listener lock for ${basename(artifactPath)} after retries`,
        ),
      }
    }

    const removeLock = async () => {
      if (!lockAcquired) return
      lockAcquired = false
      try {
        if (existsSync(lockFilePath)) {
          try {
            const content = await readFile(lockFilePath, 'utf8')
            const current = JSON.parse(content) as { lockInstanceId?: string; pid?: number }
            if (current?.lockInstanceId === lockInstanceId || current?.pid === process.pid) {
              await unlink(lockFilePath).catch(() => {})
            }
          } catch {
            await unlink(lockFilePath).catch(() => {})
          }
        }
      } catch {}
    }

    let timeoutTimer: NodeJS.Timeout | undefined
    let graceTimer: NodeJS.Timeout | undefined
    let isClosing = false
    let cleanedUp = false

    let inFlightHandoffId: string | null = null
    let inFlightPayloadHash: string | null = null
    let inFlightPromise: Promise<LocalReceipt> | null = null

    let completedHandoffId: string | null = null
    let completedPayloadHash: string | null = null
    let completedReceipt: LocalReceipt | null = null

    const cleanupAndClose = async (
      exitCode: number,
      errorPayload?: CliErrorPayload,
    ) => {
      if (cleanedUp) return
      cleanedUp = true
      isClosing = true

      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
        timeoutTimer = undefined
      }
      if (graceTimer) {
        clearTimeout(graceTimer)
        graceTimer = undefined
      }

      process.removeListener('SIGINT', onSigInt)
      process.removeListener('SIGTERM', onSigTerm)

      await removeLock()

      try {
        server.closeAllConnections?.()
      } catch {}

      server.close(() => {
        if (errorPayload) {
          resolvePromise({ exitCode, stderr: JSON.stringify(errorPayload) })
        } else {
          resolvePromise({ exitCode })
        }
      })
    }

    const persistReceipt = async (
      cleanPayload: LocalHandoff,
      handoffId: string,
    ): Promise<LocalReceipt> => {
      const receiptsDir = join(tmpdir(), 'taco-receipts')
      await mkdir(receiptsDir, { recursive: true, mode: 0o700 })

      const dirStat = await lstat(receiptsDir)
      if (dirStat.isSymbolicLink()) {
        throw new Error('Receipt directory cannot be a symbolic link')
      }

      const safeDoc = docId.replace(/[^a-zA-Z0-9_-]/g, '_')
      const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
      const receiptFileName = `taco-receipt-${safeDoc}-${safeSession}-${handoffId}.json`
      const receiptPath = join(receiptsDir, receiptFileName)

      try {
        const existingStat = await lstat(receiptPath)
        if (existingStat.isSymbolicLink()) {
          throw new Error('Receipt target cannot be a symbolic link')
        }
      } catch (err: unknown) {
        const statErr = err as NodeJS.ErrnoException
        if (statErr?.code !== 'ENOENT') throw err
      }
      const receipt: LocalReceipt = {
        schema: 'taco-local-receipt/1',
        docId,
        sessionId,
        handoffId,
        receivedAt: new Date().toISOString(),
        path: receiptPath,
        payload: cleanPayload,
      }

      const tempReceiptPath = join(
        receiptsDir,
        `.tmp-${safeDoc}-${safeSession}-${handoffId}-${randomBytes(8).toString('hex')}`,
      )

      try {
        await writeFile(tempReceiptPath, JSON.stringify(receipt, null, 2), {
          encoding: 'utf8',
          mode: 0o600,
        })
        await rename(tempReceiptPath, receiptPath)
        return receipt
      } catch (err) {
        await unlink(tempReceiptPath).catch(() => {})
        throw err
      }
    }

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Loopback host check
      if (!isLoopbackHost(req.headers.host)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Forbidden: host not permitted' }))
        return
      }

      // Loopback origin check
      const origin = req.headers.origin
      if (origin && !isLoopbackOrigin(origin)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Forbidden: origin not permitted' }))
        return
      }

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', origin || '*')
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, X-Taco-Doc-Id, X-Taco-Session-Id',
      )

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      const pathname = req.url ? req.url.split('?')[0] : ''
      if (req.method === 'POST' && (pathname === '/handoff' || pathname === '/')) {
        const authHeader = req.headers['authorization'] || ''
        const bearer = authHeader.replace(/^Bearer\s+/i, '').trim()
        const headerDocId = req.headers['x-taco-doc-id']
        const headerSessionId = req.headers['x-taco-session-id']

        if (!bearer || bearer !== sessionToken) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Unauthorized: invalid session token' }))
          return
        }

        if (headerDocId && headerDocId !== docId) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Mismatched docId in header' }))
          return
        }

        if (headerSessionId && headerSessionId !== sessionId) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Mismatched sessionId in header' }))
          return
        }

        const chunks: Buffer[] = []
        let bodyBytes = 0
        let aborted = false

        req.on('data', (chunk: Buffer) => {
          bodyBytes += chunk.length
          if (bodyBytes > MAX_BODY_BYTES) {
            aborted = true
            req.destroy()
            res.writeHead(413, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Payload Too Large' }))
            return
          }
          chunks.push(chunk)
        })

        req.on('end', async () => {
          if (aborted) return

          let body: string
          try {
            body = Buffer.concat(chunks).toString('utf8')
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Invalid UTF-8 payload' }))
            return
          }

          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(body) as Record<string, unknown>
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Invalid JSON payload' }))
            return
          }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Invalid payload: must be an object' }))
            return
          }

          const payload = (parsed.payload ?? parsed) as Record<string, unknown>
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Invalid payload: must be an object' }))
            return
          }

          if (payload.schema !== 'taco-local-handoff/1') {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Invalid schema: expected taco-local-handoff/1' }))
            return
          }

          if (typeof payload.createdAt !== 'string' || !payload.createdAt || isNaN(Date.parse(payload.createdAt))) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Invalid or missing createdAt timestamp' }))
            return
          }

          if (payload.docId !== docId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Mismatched docId in payload' }))
            return
          }

          if (payload.sessionId !== sessionId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Mismatched sessionId in payload' }))
            return
          }

          const rawHandoffId = typeof payload.handoffId === 'string' ? payload.handoffId : ''
          if (!rawHandoffId || !/^[a-zA-Z0-9_-]+$/.test(rawHandoffId)) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Invalid handoffId: must be alphanumeric/dash/underscore' }))
            return
          }
          const handoffId = rawHandoffId

          // Reject credentials/token in incoming payload
          if ('token' in payload || hasCredentials(payload)) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Credentials not permitted in handoff payload' }))
            return
          }

          const baselineBundle = payload.baseline as Record<string, unknown>
          const snapshotBundle = payload.snapshot as Record<string, unknown>
          if (!baselineBundle || !snapshotBundle || typeof baselineBundle !== 'object' || typeof snapshotBundle !== 'object') {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Missing baseline or snapshot in payload' }))
            return
          }

          // Bind baseline AND snapshot docId/root to original artifact
          if (baselineBundle.docId !== originalBundle.docId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Baseline docId does not match artifact docId' }))
            return
          }
          if (snapshotBundle.docId !== originalBundle.docId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Snapshot docId does not match artifact docId' }))
            return
          }
          if (baselineBundle.root !== originalBundle.root) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Baseline root does not match artifact root' }))
            return
          }
          if (snapshotBundle.root !== originalBundle.root) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Snapshot root does not match artifact root' }))
            return
          }

          // Validate bundle structures and paths
          try {
            validateBundle(baselineBundle)
            validateBundle(snapshotBundle)
          } catch (valErr) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: `Invalid bundle in handoff: ${(valErr as Error).message}` }))
            return
          }

          // Project credential-free versions
          const cleanBaseline = credentialFreeDocument(baselineBundle)
          const cleanSnapshot = credentialFreeDocument(snapshotBundle)
          const cleanPayload: LocalHandoff = {
            schema: 'taco-local-handoff/1',
            handoffId,
            sessionId,
            docId,
            createdAt: payload.createdAt as string,
            baseline: cleanBaseline,
            snapshot: cleanSnapshot,
          }

          const payloadHash = createHash('sha256')
            .update(JSON.stringify(cleanPayload))
            .digest('hex')

          // State checking for closing, completed, and in-flight
          if (isClosing) {
            if (completedHandoffId === handoffId && completedPayloadHash === payloadHash) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true, handoffId, receiptId: handoffId }))
              return
            }
            if (completedHandoffId === handoffId) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Changed content for same handoffId rejected' }))
              return
            }
            res.writeHead(409, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Listener is closing, distinct handoff rejected' }))
            return
          }

          if (completedHandoffId !== null) {
            if (completedHandoffId === handoffId) {
              if (completedPayloadHash === payloadHash) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, handoffId, receiptId: handoffId }))
                return
              }
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Changed content for same handoffId rejected' }))
              return
            }
            res.writeHead(409, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Listener already completed a handoff' }))
            return
          }

          if (inFlightHandoffId !== null) {
            if (inFlightHandoffId === handoffId) {
              if (inFlightPayloadHash !== payloadHash) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: 'Changed content for same handoffId rejected' }))
                return
              }
              // Share same in-flight persistence
              try {
                await inFlightPromise
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, handoffId, receiptId: handoffId }))
              } catch {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: 'Failed to persist handoff receipt' }))
              }
              return
            }
            res.writeHead(409, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Another handoff is currently in flight' }))
            return
          }

          // First persistence attempt
          inFlightHandoffId = handoffId
          inFlightPayloadHash = payloadHash
          inFlightPromise = persistReceipt(cleanPayload, handoffId)

          let receipt: LocalReceipt
          try {
            receipt = await inFlightPromise
          } catch {
            inFlightHandoffId = null
            inFlightPayloadHash = null
            inFlightPromise = null
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Failed to persist handoff receipt' }))
            return
          }

          completedHandoffId = handoffId
          completedPayloadHash = payloadHash
          completedReceipt = receipt
          inFlightHandoffId = null
          inFlightPromise = null

          // ACK response to browser
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, handoffId, receiptId: handoffId }))

          // Emit delivery event line on stdout
          const deliveryEvent = {
            type: 'handoff',
            receipt: {
              schema: receipt.schema,
              docId,
              sessionId,
              handoffId,
              path: receipt.path,
            },
            path: receipt.path,
            payload: cleanPayload,
          }
          process.stdout.write(`${JSON.stringify(deliveryEvent)}\n`)

          // Mark closing and begin bounded grace period for concurrent / immediate retry
          if (timeoutTimer) {
            clearTimeout(timeoutTimer)
            timeoutTimer = undefined
          }
          isClosing = true
          graceTimer = setTimeout(async () => {
            await cleanupAndClose(EXIT_CODES.OK)
          }, 150)
        })
        return
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Not found' }))
    })

    server.on('error', async (err) => {
      const error = makeCliError('LOCAL_IO_ERROR', `Listener server error: ${err.message}`)
      await cleanupAndClose(EXIT_CODES.LOCAL_IO_ERROR, error)
    })

    const onSigInt = async () => {
      await cleanupAndClose(EXIT_CODES.SIGINT)
    }

    const onSigTerm = async () => {
      await cleanupAndClose(EXIT_CODES.SIGTERM)
    }

    process.once('SIGINT', onSigInt)
    process.once('SIGTERM', onSigTerm)

    server.listen(requestedPort, '127.0.0.1', async () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : requestedPort

      // Acquire lock exclusively before emitting ready
      const lockRes = await acquireLock(port)
      if (!lockRes.ok) {
        await cleanupAndClose(EXIT_CODES.CONFLICT_ERROR, lockRes.error)
        return
      }

      const queryParams = new URLSearchParams({
        port: String(port),
        token: sessionToken,
        sessionId,
        docId,
      }).toString()

      const readyUrl = `${pathToFileURL(artifactPath).href}#taco-listen=${encodeURIComponent(queryParams)}`

      const readyEvent = {
        type: 'ready',
        port,
        docId,
        sessionId,
        url: readyUrl,
      }
      process.stdout.write(`${JSON.stringify(readyEvent)}\n`)

      if (options.openBrowser && !options.noOpen) {
        try {
          const platform = process.platform
          const child =
            platform === 'darwin'
              ? spawn('open', [readyUrl], { detached: true, stdio: 'ignore' })
              : platform === 'win32'
              ? spawn('cmd', ['/c', 'start', '""', readyUrl], { detached: true, stdio: 'ignore' })
              : spawn('xdg-open', [readyUrl], { detached: true, stdio: 'ignore' })
          child.on('error', () => {
            // Handled: avoid unhandled error event
          })
          child.unref()
        } catch {
          // Handled: sync spawn failure
        }
      }

      if (timeoutSec > 0) {
        timeoutTimer = setTimeout(async () => {
          const error = makeCliError('NETWORK_TIMEOUT', 'Listener timed out waiting for handoff')
          await cleanupAndClose(EXIT_CODES.NETWORK_TIMEOUT, error)
        }, timeoutSec * 1000)
      }
    })
  })()

  return promise
}
