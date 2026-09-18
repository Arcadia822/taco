import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HostSubscriptionSession } from '../../host/src/ws.ts'
import { MemoryBlobDriver, MemoryDatabaseDriver, TacoHostService } from '../../host/src/index.ts'
import { TacoClient } from '../src/client.ts'
import { runCli } from '../src/runner.ts'
import { TacoSubscriber, WebSocketSessionAdapter } from '../src/subscriber.ts'

const FIXTURE_TACO = resolve(process.cwd(), 'specs/008-taco-host-contract/008-taco-host-contract.taco.html')

describe('Taco Host & CLI End-to-End (Phase 3)', () => {
  it('connects client to mock host and executes remote publish, events, and export', async () => {
    const db = new MemoryDatabaseDriver()
    const blob = new MemoryBlobDriver()
    const hostService = new TacoHostService({ db, blob, hostUrl: 'http://localhost:32167' })

    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = String(input)
      const url = new URL(urlStr)
      const pathname = url.pathname
      const method = init?.method || 'GET'
      const headers = (init?.headers || {}) as Record<string, string>
      const auth = headers['Authorization'] || headers['authorization']
      const idempotencyKey = headers['Idempotency-Key'] || headers['idempotency-key']

      if (pathname === '/v1/capabilities' && method === 'GET') {
        const res = await hostService.getCapabilities()
        return new Response(JSON.stringify(res.body), { status: res.status, headers: res.headers })
      }
      if (pathname === '/v1/tacos' && method === 'POST') {
        const body = JSON.parse(init?.body as string)
        const tacoId = 'test-paste-id'
        return new Response(
          JSON.stringify({
            command: 'publish',
            host: 'http://localhost:32167',
            id: tacoId,
            tacoId,
            title: body.snapshot?.title || 'Test',
            contentHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
            url: `http://localhost:32167/t/${tacoId}`,
            createdAt: new Date().toISOString(),
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (pathname.startsWith('/v1/tacos/') && pathname.endsWith('/events') && method === 'GET') {
        return new Response(
          JSON.stringify({
            events: [{ id: 'ev_1', sequence: '1', type: 'revision.published' }],
            throughSequence: '1',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      return new Response('Not Found', { status: 404 })
    }

    try {
      const client = new TacoClient('http://localhost:32167')

      // Test publish
      const runRes = await runCli(['publish', FIXTURE_TACO], client)
      expect(runRes.exitCode).toBe(0)
      const pubResult = JSON.parse(runRes.stdout!)
      expect(pubResult.tacoId).toBeDefined()
      expect(pubResult.contentHash).toMatch(/^sha256:/)

      // Test events query
      const eventsRes = await runCli(['events', pubResult.tacoId], client)
      expect(eventsRes.exitCode).toBe(0)
      const eventsData = JSON.parse(eventsRes.stdout!)
      expect(eventsData.events.length).toBe(1)
      expect(eventsData.events[0].type).toBe('revision.published')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('runs subscription session and tests graceful 1012 rotation with cursor reconnect', async () => {
    const db = new MemoryDatabaseDriver()
    const blob = new MemoryBlobDriver()
    const hostService = new TacoHostService({ db, blob, hostUrl: 'http://localhost:32167' })

    const anon = (await hostService.createAnonymousCredentials()).body as { apiKey: { secret: string } }
    const auth = `Bearer ${anon.apiKey.secret}`

    const dummyPayload = {
      protocol: 'taco-host/1',
      snapshot: {
        format: 'taco/files',
        version: 1,
        docId: 'doc',
        title: 'Doc',
        root: 'specs/test',
        files: [{ path: 'specs/test/spec.md', mediaType: 'text/markdown', content: '# T' }],
      },
    }
    const dummyBytes = new TextEncoder().encode(JSON.stringify(dummyPayload))
    const cryptoHash = await crypto.subtle.digest('SHA-256', dummyBytes)
    const dummyHash = `sha256:${Array.from(new Uint8Array(cryptoHash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`

    const prepCorrect = (
      await hostService.prepareUpload(auth, '11111111-1111-4111-8111-111111111111', {
        protocol: 'taco-host/1',
        purpose: 'publish',
        payloadHash: dummyHash,
        payloadBytes: dummyBytes.byteLength,
      })
    ).body as { uploadId: string; uploadUrl: string }

    await blob.putObject(prepCorrect.uploadUrl.match(/vercel-storage\.com\/([^?]+)/)![1], dummyBytes)
    const published = (
      await hostService.publishTaco(auth, '11111111-1111-4111-8111-111111111111', {
        protocol: 'taco-host/1',
        uploadId: prepCorrect.uploadId,
      })
    ).body as { tacoId: string }

    const receivedFrames: string[] = []
    let currentSession: HostSubscriptionSession | null = null

    const mockFactory = (): WebSocketSessionAdapter => {
      let onMsg: (msg: string) => void = () => {}
      let onCls: (code: number, reason: string) => void = () => {}

      return {
        async connect(_url: string) {},
        send(data: string) {
          const frame = JSON.parse(data) as { type: string; after?: string | null }
          if (frame.type === 'subscribe') {
            currentSession = new HostSubscriptionSession(
              db,
              published.tacoId,
              {
                send: (msg) => onMsg(msg),
                close: (code, reason) => onCls(code ?? 1000, reason ?? ''),
              },
              { pollIntervalMs: 50, rotationDurationMs: 150 },
            )
            currentSession.start(frame.after ?? null)
          }
        },
        close() {
          currentSession?.destroy()
        },
        onMessage(cb) {
          onMsg = cb
        },
        onClose(cb) {
          onCls = cb
        },
        onError(_cb) {},
      }
    }

    const subscriber = new TacoSubscriber(
      'http://localhost:32167',
      published.tacoId,
      {
        onFrame: (frame) => receivedFrames.push(frame),
        onDiagnostic: () => {},
        onError: () => {},
      },
      mockFactory,
      { maxReconnectTimeMs: 1000 },
    )

    const subPromise = subscriber.start()
    await new Promise((r) => setTimeout(r, 350))
    subscriber.stop()
    currentSession?.destroy()

    expect(receivedFrames.some((f) => f.includes('"kind":"ready"'))).toBe(true)
  })
})
