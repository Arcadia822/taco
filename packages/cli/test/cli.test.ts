import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/runner.ts'

const FIXTURE_TACO = resolve(import.meta.dirname, '../../../specs/008-taco-host-contract/008-taco-host-contract.taco.html')

describe('taco-cli (Phase 1)', () => {
  it('outputs root help JSON on no arguments, help, or --help', async () => {
    const res1 = await runCli([])
    expect(res1.exitCode).toBe(0)
    const json1 = JSON.parse(res1.stdout!)
    expect(json1.schema).toBe('taco-cli-help/1')
    expect(json1.summary).toContain('Taco CLI')
    expect(
      json1.commands.some(
        (command: { name: string; summary: string }) =>
          command.name === 'skills read' && command.summary.includes('installation'),
      ),
    ).toBe(true)
    expect(
      json1.examples.some(
        (example: { invocation: string }) => example.invocation === 'taco-cli skills read taco',
      ),
    ).toBe(true)

    const res2 = await runCli(['help'])
    expect(res2.exitCode).toBe(0)
    expect(JSON.parse(res2.stdout!)).toEqual(json1)

    const res3 = await runCli(['--help'])
    expect(res3.exitCode).toBe(0)
    expect(JSON.parse(res3.stdout!)).toEqual(json1)
  })

  it('outputs subcommand help for publish, update, and subscribe', async () => {
    const res = await runCli(['help', 'publish'])
    expect(res.exitCode).toBe(0)
    const json = JSON.parse(res.stdout!)
    expect(json.command).toEqual(['publish'])
    expect(json.options.some((o: { name: string }) => o.name === '--dry-run')).toBe(true)

    const resUpdate = await runCli(['update', '--help'])
    expect(resUpdate.exitCode).toBe(0)
    const jsonUpdate = JSON.parse(resUpdate.stdout!)
    expect(jsonUpdate.command).toEqual(['update'])
    expect(jsonUpdate.options.some((o: { name: string }) => o.name === '--base')).toBe(true)
  })

  it('rejects forbidden legacy flags (--json, --ndjson, --public) with exit code 2', async () => {
    const res = await runCli(['publish', '--json'])
    expect(res.exitCode).toBe(2)
    const err = JSON.parse(res.stderr!)
    expect(err.error.code).toBe('VALIDATION_ERROR')
    expect(err.error.message).toContain('--json')
  })

  it('lists embedded skills and reads embedded guide markdown', async () => {
    const listRes = await runCli(['skills', 'list'])
    expect(listRes.exitCode).toBe(0)
    const listJson = JSON.parse(listRes.stdout!)
    expect(listJson.schema).toBe('taco-cli-skills/1')
    expect(listJson.skills.some((s: { id: string }) => s.id === 'taco')).toBe(true)

    const readRes = await runCli(['skills', 'read', 'taco'])
    expect(readRes.exitCode).toBe(0)
    const readJson = JSON.parse(readRes.stdout!)
    expect(readJson.id).toBe('taco')
    expect(readJson.path).toBe('SKILL.md')
    expect(readJson.content).toContain('# Taco Agent Guide')
    expect(readJson.version).toBe('1.2.0')
    expect(readJson.content).toContain('## Start Here')
    expect(readJson.content).toContain('references/publishing.md')

    const readRefRes = await runCli(['skills', 'read', 'taco', 'references/publishing.md'])
    expect(readRefRes.exitCode).toBe(0)
    const readRefJson = JSON.parse(readRefRes.stdout!)
    expect(readRefJson.content).toContain('# Publishing Guide')

    // Refuses directory traversal
    const badRead = await runCli(['skills', 'read', 'taco', '../../secret.txt'])
    expect(badRead.exitCode).toBe(2)
  })

  it('executes publish --dry-run projecting actual standalone Taco file', async () => {
    const res = await runCli(['publish', FIXTURE_TACO, '--dry-run'])
    expect(res.exitCode).toBe(0)
    const json = JSON.parse(res.stdout!)
    expect(json.command).toBe('publish')
    expect(json.dryRun).toBe(true)
    expect(json.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(json.files.length).toBeGreaterThan(0)
    expect(json.payloadBytes).toBeGreaterThan(0)
  })

  it('executes update --dry-run validating base revision parameter', async () => {
    // Missing base
    const noBase = await runCli([
      'update',
      '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
      FIXTURE_TACO,
      '--dry-run',
    ])
    expect(noBase.exitCode).toBe(2)

    // With base
    const res = await runCli([
      'update',
      '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
      FIXTURE_TACO,
      '--base',
      '993b05fd-2f80-48cc-aafd-1d7564781001',
      '--dry-run',
    ])
    expect(res.exitCode).toBe(0)
    const json = JSON.parse(res.stdout!)
    expect(json.command).toBe('update')
    expect(json.baseRevisionId).toBe('993b05fd-2f80-48cc-aafd-1d7564781001')
    expect(json.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('carries the requested resume cursor to the Host stream URL', async () => {
    const originalFetch = globalThis.fetch
    let requestedUrl = ''
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      requestedUrl = String(input)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(
            encoder.encode('data: {"kind":"ready","cursor":"7","mode":"replay"}\n\n'),
          )
          controller.enqueue(
            encoder.encode('data: {"kind":"error","error":{"code":"TACO_CLOSED"}}\n\n'),
          )
          controller.close()
        },
      })
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }

    try {
      const res = await runCli([
        'subscribe',
        '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
        '--after',
        '7',
        '--host',
        'https://host.example',
      ])
      expect(res.exitCode).toBe(4)
      expect(requestedUrl).toBe(
        'https://host.example/v1/tacos/8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001/subscribe?after=7',
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('validates subscribe metadata flags strictly according to OpenAPI contract', async () => {
    // Missing tacoId
    const resNoId = await runCli(['subscribe'])
    expect(resNoId.exitCode).toBe(2)
    expect(JSON.parse(resNoId.stderr!).error.message).toContain('Missing tacoId')

    // Invalid --harness
    const resBadHarness = await runCli([
      'subscribe',
      '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
      '--harness',
      'invalid-agent',
    ])
    expect(resBadHarness.exitCode).toBe(2)
    expect(JSON.parse(resBadHarness.stderr!).error.message).toContain('Invalid --harness')

    // Invalid --model
    const resBadModel = await runCli([
      'subscribe',
      '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
      '--model',
      'llama',
    ])
    expect(resBadModel.exitCode).toBe(2)
    expect(JSON.parse(resBadModel.stderr!).error.message).toContain('Invalid --model')

    // Invalid --model-id (> 128 chars)
    const longModelId = 'a'.repeat(129)
    const resLongModelId = await runCli([
      'subscribe',
      '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
      '--model-id',
      longModelId,
    ])
    expect(resLongModelId.exitCode).toBe(2)
    expect(JSON.parse(resLongModelId.stderr!).error.message).toContain('Invalid --model-id')

    // Invalid --name (> 64 chars)
    const longName = 'n'.repeat(65)
    const resLongName = await runCli([
      'subscribe',
      '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
      '--name',
      longName,
    ])
    expect(resLongName.exitCode).toBe(2)
    expect(JSON.parse(resLongName.stderr!).error.message).toContain('Invalid --name')
    // Invalid --session (> 256 chars)
    const longSession = 's'.repeat(257)
    const resLongSession = await runCli([
      'subscribe',
      '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
      '--session',
      longSession,
    ])
    expect(resLongSession.exitCode).toBe(2)
    expect(JSON.parse(resLongSession.stderr!).error.message).toContain('Invalid --session')
    // Invalid --after (non-numeric)
    const resBadAfter = await runCli([
      'subscribe',
      '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
      '--after',
      'bad_cursor',
    ])
    expect(resBadAfter.exitCode).toBe(2)
    expect(JSON.parse(resBadAfter.stderr!).error.message).toContain('Invalid --after')

    // Invalid --listener-id (not UUID)
    const resBadListenerId = await runCli([
      'subscribe',
      '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
      '--listener-id',
      'not-a-uuid',
    ])
    expect(resBadListenerId.exitCode).toBe(2)
    expect(JSON.parse(resBadListenerId.stderr!).error.message).toContain('Invalid --listener-id')
  })

  it('passes SSE metadata headers and preserves stable X-Listener-Id across reconnects', async () => {
    const originalFetch = globalThis.fetch
    const recordedHeaders: Headers[] = []
    let callCount = 0

    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      callCount += 1
      const headers = new Headers(init?.headers)
      recordedHeaders.push(headers)

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder()
          if (callCount === 1) {
            // First connection sends ready then closes gracefully with 1012 (rotation)
            controller.enqueue(
              encoder.encode('data: {"kind":"ready","cursor":"3","mode":"live"}\n\n'),
            )
            controller.close()
          } else {
            // Reconnect connection sends closed error
            controller.enqueue(
              encoder.encode('data: {"kind":"ready","cursor":"3","mode":"replay"}\n\n'),
            )
            controller.enqueue(
              encoder.encode('data: {"kind":"error","error":{"code":"TACO_CLOSED"}}\n\n'),
            )
            controller.close()
          }
        },
      })
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }

    try {
      const res = await runCli([
        'subscribe',
        '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
        '--harness',
        'claude-code',
        '--model',
        'claude',
        '--model-id',
        'claude-3-7-sonnet',
        '--name',
        'ReviewerAgent',
        '--session',
        '中文会话测试',
        '--host',
        'https://host.example',
      ])
      expect(res.exitCode).toBe(4)
      expect(callCount).toBeGreaterThanOrEqual(2)

      const firstListenerId = recordedHeaders[0].get('X-Listener-Id')
      expect(firstListenerId).toBeTruthy()
      expect(firstListenerId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )
      expect(recordedHeaders[0].get('X-Taco-Harness')).toBe('claude-code')
      expect(recordedHeaders[0].get('X-Taco-Model')).toBe('claude')
      expect(recordedHeaders[0].get('X-Taco-Model-Id')).toBe(encodeURIComponent('claude-3-7-sonnet'))
      expect(recordedHeaders[0].get('X-Taco-Listener-Name')).toBe(encodeURIComponent('ReviewerAgent'))
      expect(recordedHeaders[0].get('X-Taco-Session')).toBe(encodeURIComponent('中文会话测试'))
      // Stable listener ID across reconnect!
      const secondListenerId = recordedHeaders[1].get('X-Listener-Id')
      expect(secondListenerId).toBe(firstListenerId)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('correctly parses stream chunks across boundaries without losing partial data', async () => {
    const originalFetch = globalThis.fetch
    const stdoutChunks: string[] = []
    const originalWrite = process.stdout.write
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write

    globalThis.fetch = async (): Promise<Response> => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder()
          // Split chunk mid-JSON
          controller.enqueue(encoder.encode('data: {"kind":"ready","cur'))
          controller.enqueue(encoder.encode('sor":"10","mode":"live"}\n\n'))
          // Event split across data and newline
          controller.enqueue(
            encoder.encode(
              'data: {"kind":"event","id":"e1","sequence":"11","tacoId":"8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001","type":"comment.created","occurredAt":"2026-09-29T00:00:00Z","actor":{"displayName":"Tester"},"data":{"body":"hello"}}\r\n',
            ),
          )
          controller.enqueue(encoder.encode('\r\n'))
          // TACO_CLOSED error to exit
          controller.enqueue(
            encoder.encode('data: {"kind":"error","error":{"code":"TACO_CLOSED"}}\n\n'),
          )
          controller.close()
        },
      })
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }

    try {
      const res = await runCli([
        'subscribe',
        '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
        '--stream',
        '--host',
        'https://host.example',
      ])
      expect(res.exitCode).toBe(4)
      const outputLines = stdoutChunks.join('').split('\n').filter(Boolean)
      expect(outputLines.length).toBe(2)
      const readyObj = JSON.parse(outputLines[0])
      expect(readyObj.kind).toBe('ready')
      expect(readyObj.cursor).toBe('10')

      const eventObj = JSON.parse(outputLines[1])
      expect(eventObj.kind).toBe('event')
      expect(eventObj.sequence).toBe('11')
    } finally {
      process.stdout.write = originalWrite
      globalThis.fetch = originalFetch
    }
  })

  it('does not advance cursor on ready frame in replay mode, avoiding skipping replay on reconnect', async () => {
    const originalFetch = globalThis.fetch
    const requestedUrls: string[] = []
    let connectionAttempt = 0

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      requestedUrls.push(String(input))
      connectionAttempt += 1

      if (connectionAttempt === 1) {
        // First connection: server sends ready with high cursor 10 in replay mode, then drops
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder()
            controller.enqueue(
              encoder.encode(
                'data: {"kind":"ready","cursor":"10","mode":"replay","replayThrough":"10"}\n\n',
              ),
            )
            // Abrupt disconnect before any events are received
            controller.error(new Error('Network dropped'))
          },
        })
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      } else {
        // Second connection: must resume from 5 (not 10!), receives events, then TACO_CLOSED
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder()
            controller.enqueue(
              encoder.encode(
                'data: {"kind":"ready","cursor":"10","mode":"replay","replayThrough":"10"}\n\n',
              ),
            )
            controller.enqueue(
              encoder.encode(
                'data: {"kind":"event","id":"e6","sequence":"6","tacoId":"8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001","type":"comment.created","occurredAt":"2026-09-29T00:00:00Z","actor":{"displayName":"Tester"},"data":{"body":"msg"}}\n\n',
              ),
            )
            controller.enqueue(
              encoder.encode('data: {"kind":"error","error":{"code":"TACO_CLOSED"}}\n\n'),
            )
            controller.close()
          },
        })
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }
    }

    try {
      const res = await runCli([
        'subscribe',
        '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
        '--after',
        '5',
        '--host',
        'https://host.example',
      ])
      expect(res.exitCode).toBe(4)
      expect(requestedUrls[0]).toContain('after=5')
      // Reconnect MUST have after=5 because ready in replay mode did NOT overwrite it with 10!
      expect(requestedUrls[1]).toContain('after=5')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('reports gap with exit code 6 when subscribe receives HTTP 410 Gone without retrying', async () => {
    const originalFetch = globalThis.fetch
    const stderrChunks: string[] = []
    const originalStderrWrite = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk))
      return true
    }) as typeof process.stderr.write

    let fetchCount = 0

    globalThis.fetch = async (): Promise<Response> => {
      fetchCount += 1
      return new Response(
        JSON.stringify({
          error: {
            code: 'CURSOR_EXPIRED',
            message: 'Requested cursor sequence is too old',
          },
        }),
        { status: 410, headers: { 'Content-Type': 'application/json' } },
      )
    }

    try {
      const res = await runCli([
        'subscribe',
        '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
        '--after',
        '1',
        '--host',
        'https://host.example',
      ])
      // Must immediately exit with code 6 without retrying!
      expect(res.exitCode).toBe(6)
      expect(fetchCount).toBe(1)

      const outputLines = stderrChunks.join('').split('\n').filter(Boolean)
      expect(outputLines.length).toBe(1)
      const record = JSON.parse(outputLines[0])
      expect(record).toEqual({
        kind: 'error',
        error: {
          code: 'CURSOR_EXPIRED',
          message: 'Requested cursor sequence is too old',
        },
      })
    } finally {
      process.stderr.write = originalStderrWrite
      globalThis.fetch = originalFetch
    }
  })

  it('emits exactly one terminal error and no duplicate diagnostics when subscribe receives HTTP 410 on reconnect', async () => {
    const originalFetch = globalThis.fetch
    const stderrChunks: string[] = []
    const originalStderrWrite = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk))
      return true
    }) as typeof process.stderr.write

    let callCount = 0

    globalThis.fetch = async (): Promise<Response> => {
      callCount += 1
      if (callCount === 1) {
        // First connection closes gracefully with 1012 (rotation) to trigger immediate reconnect
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder()
            controller.enqueue(
              encoder.encode('data: {"kind":"ready","cursor":"3","mode":"live"}\n\n'),
            )
            controller.close()
          },
        })
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }
      // Reconnect receives 410 (cursor expired while instance was restarting)
      return new Response(
        JSON.stringify({
          error: {
            code: 'CURSOR_EXPIRED',
            message: 'Cursor 3 has expired during service rotation',
          },
        }),
        { status: 410, headers: { 'Content-Type': 'application/json' } },
      )
    }

    try {
      const res = await runCli([
        'subscribe',
        '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
        '--after',
        '3',
        '--host',
        'https://host.example',
      ])

      expect(res.exitCode).toBe(6)
      expect(callCount).toBe(2)

      const outputLines = stderrChunks.join('').split('\n').filter(Boolean)
      const records = outputLines.map((l) => JSON.parse(l))

      // Legitimate reconnect diagnostic from initial stream drop/rotation, exactly one terminal error record, and no duplicate 410 diagnostics
      const diagnostics = records.filter((r) => r.kind === 'diagnostic')
      const errors = records.filter((r) => r.kind === 'error')

      expect(diagnostics.length).toBe(1)
      expect(diagnostics[0].code).toBe('DISCONNECTED')
      expect(diagnostics[0].attempt).toBe(1)
      expect(errors.length).toBe(1)
      expect(errors[0]).toEqual({
        kind: 'error',
        error: {
          code: 'CURSOR_EXPIRED',
          message: 'Cursor 3 has expired during service rotation',
        },
      })
    } finally {
      process.stderr.write = originalStderrWrite
      globalThis.fetch = originalFetch
    }
  })

  it('emits exactly one terminal error and no diagnostics on HTTP 404 or HTTP 400 subscribe connect error', async () => {
    const originalFetch = globalThis.fetch
    const stderrChunks: string[] = []
    const originalStderrWrite = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk))
      return true
    }) as typeof process.stderr.write

    globalThis.fetch = async (): Promise<Response> => {
      return new Response('Taco not found', { status: 404 })
    }

    try {
      const res = await runCli([
        'subscribe',
        '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
        '--host',
        'https://host.example',
      ])
      expect(res.exitCode).toBe(2)

      const outputLines = stderrChunks.join('').split('\n').filter(Boolean)
      expect(outputLines.length).toBe(1)
      const record = JSON.parse(outputLines[0])
      expect(record).toEqual({
        kind: 'error',
        error: {
          code: 'NOT_FOUND',
          message: 'Taco not found (HTTP 404)',
        },
      })
    } finally {
      process.stderr.write = originalStderrWrite
      globalThis.fetch = originalFetch
    }
  })

  it('validates events --after and reports gap with exit code 6 on HTTP 410', async () => {
    // Invalid --after
    const resBadAfter = await runCli([
      'events',
      '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
      '--after',
      'foo',
    ])
    expect(resBadAfter.exitCode).toBe(2)
    expect(JSON.parse(resBadAfter.stderr!).error.code).toBe('VALIDATION_ERROR')

    // 410 response reports gap
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'CURSOR_EXPIRED',
            message: 'Sequence 10 is too old; earliest available sequence is 50',
            details: { requestedAfter: '10', earliestRetainedSequence: '50' },
          },
        }),
        { status: 410, headers: { 'Content-Type': 'application/json' } },
      )
    }

    try {
      const res = await runCli([
        'events',
        '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
        '--after',
        '10',
        '--host',
        'https://host.example',
      ])
      expect(res.exitCode).toBe(6)
      const err = JSON.parse(res.stderr!)
      expect(err.error.code).toBe('CURSOR_EXPIRED')
      expect(err.error.message).toContain('earliest available sequence is 50')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('passes review.handed_off reference event to stdout without mistaking comment as handoff', async () => {
    const originalFetch = globalThis.fetch
    const stdoutChunks: string[] = []
    const originalWrite = process.stdout.write
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write

    globalThis.fetch = async (): Promise<Response> => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode('data: {"kind":"ready","cursor":"1","mode":"live"}\n\n'))
          // Comment event
          controller.enqueue(
            encoder.encode(
              'data: {"kind":"event","id":"c1","sequence":"2","tacoId":"8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001","type":"comment.created","occurredAt":"2026-09-29T00:00:00Z","actor":"Alice","data":{"body":"Please review"}}\n\n',
            ),
          )
          // Handoff reference event
          controller.enqueue(
            encoder.encode(
              'data: {"kind":"event","id":"h1","sequence":"3","tacoId":"8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001","type":"review.handed_off","occurredAt":"2026-09-29T00:01:00Z","actor":"Alice","data":{"handoffId":"99999999-4cad-43d2-a5f6-4f56bcb0a001"}}\n\n',
            ),
          )
          controller.enqueue(
            encoder.encode('data: {"kind":"error","error":{"code":"TACO_CLOSED"}}\n\n'),
          )
          controller.close()
        },
      })
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }

    try {
      // Default mode: exits 0 immediately upon receiving review.handed_off and filters out comment.created
      const resDefault = await runCli([
        'subscribe',
        '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
        '--host',
        'https://host.example',
      ])
      expect(resDefault.exitCode).toBe(0)

      const defaultLines = stdoutChunks.join('').split('\n').filter(Boolean)
      const defaultFrames = defaultLines.map((l) => JSON.parse(l))
      expect(defaultFrames.length).toBe(2)
      expect(defaultFrames[0].kind).toBe('ready')
      expect(defaultFrames[1].kind).toBe('event')
      expect(defaultFrames[1].type).toBe('review.handed_off')
      expect(defaultFrames[1].data.handoffId).toBe('99999999-4cad-43d2-a5f6-4f56bcb0a001')

      // Stream mode (--stream): outputs every frame and keeps streaming until closed
      stdoutChunks.length = 0
      const resStream = await runCli([
        'subscribe',
        '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
        '--stream',
        '--host',
        'https://host.example',
      ])
      expect(resStream.exitCode).toBe(4)

      const streamLines = stdoutChunks.join('').split('\n').filter(Boolean)
      const streamFrames = streamLines.map((l) => JSON.parse(l))
      expect(streamFrames[0].kind).toBe('ready')
      expect(streamFrames[1].kind).toBe('event')
      expect(streamFrames[1].type).toBe('comment.created')
      expect(streamFrames[2].kind).toBe('event')
      expect(streamFrames[2].type).toBe('review.handed_off')
      expect(streamFrames[2].data.handoffId).toBe('99999999-4cad-43d2-a5f6-4f56bcb0a001')
    } finally {
      process.stdout.write = originalWrite
      globalThis.fetch = originalFetch
    }
  })

  it('retrieves full immutable handoff content via taco-cli handoff command', async () => {
    const originalFetch = globalThis.fetch
    const handoffRecord = {
      id: '99999999-4cad-43d2-a5f6-4f56bcb0a001',
      tacoId: '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
      author: 'Alice',
      createdAt: '2026-09-29T00:01:00Z',
      payload: {
        root: 'specs/015-hosted-review-handoff',
        changedFiles: [],
        incrementalFiles: [],
        checkpointChanges: [],
        incrementalCheckpointChanges: [],
        checkpoints: null,
        checkpointDefinitionDelta: { from: null, to: null },
        incrementalCheckpointDefinitionDelta: { from: null, to: null },
        comments: [],
        commentsThroughSequence: '2',
      },
    }

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      if (url.includes('/handoffs/99999999-4cad-43d2-a5f6-4f56bcb0a001')) {
        return new Response(JSON.stringify(handoffRecord), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('Not found', { status: 404 })
    }

    try {
      const res = await runCli([
        'handoff',
        '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
        '99999999-4cad-43d2-a5f6-4f56bcb0a001',
        '--host',
        'https://host.example',
      ])
      expect(res.exitCode).toBe(0)
      const data = JSON.parse(res.stdout!)
      expect(data.id).toBe('99999999-4cad-43d2-a5f6-4f56bcb0a001')
      expect(data.author).toBe('Alice')
      expect(data.payload.root).toBe('specs/015-hosted-review-handoff')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('settles handoff on first review.handed_off frame and ignores subsequent frames in same chunk', async () => {
    const originalFetch = globalThis.fetch
    const stdoutChunks: string[] = []
    const originalWrite = process.stdout.write
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write

    globalThis.fetch = async (): Promise<Response> => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder()
          // Send ready, first handoff, and second handoff in the SAME stream chunk
          controller.enqueue(
            encoder.encode(
              'data: {"kind":"ready","cursor":"1","mode":"live"}\n\n' +
                'data: {"kind":"event","id":"h1","sequence":"2","tacoId":"8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001","type":"review.handed_off","occurredAt":"2026-09-29T00:01:00Z","actor":"Alice","data":{"handoffId":"11111111-4cad-43d2-a5f6-4f56bcb0a001"}}\n\n' +
                'data: {"kind":"event","id":"h2","sequence":"3","tacoId":"8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001","type":"review.handed_off","occurredAt":"2026-09-29T00:02:00Z","actor":"Bob","data":{"handoffId":"22222222-4cad-43d2-a5f6-4f56bcb0a001"}}\n\n' +
                'data: {"kind":"error","error":{"code":"TACO_CLOSED"}}\n\n',
            ),
          )
          controller.close()
        },
      })
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }

    try {
      const res = await runCli([
        'subscribe',
        '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
        '--host',
        'https://host.example',
      ])
      expect(res.exitCode).toBe(0)

      const lines = stdoutChunks.join('').split('\n').filter(Boolean)
      const frames = lines.map((l) => JSON.parse(l))
      // Must emit ready + EXACTLY ONE handoff frame, ignoring subsequent handoff / TACO_CLOSED in same chunk
      expect(frames.length).toBe(2)
      expect(frames[0].kind).toBe('ready')
      expect(frames[1].type).toBe('review.handed_off')
      expect(frames[1].data.handoffId).toBe('11111111-4cad-43d2-a5f6-4f56bcb0a001')
    } finally {
      process.stdout.write = originalWrite
      globalThis.fetch = originalFetch
    }
  })

  it('encodes unicode --name and --model-id via encodeURIComponent', async () => {
    const originalFetch = globalThis.fetch
    const recordedHeaders: Headers[] = []

    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers)
      recordedHeaders.push(headers)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(
            encoder.encode('data: {"kind":"error","error":{"code":"TACO_CLOSED"}}\n\n'),
          )
          controller.close()
        },
      })
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }

    try {
      const res = await runCli([
        'subscribe',
        '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
        '--name',
        '中文审查员',
        '--model-id',
        '通义千问-2.5',
        '--host',
        'https://host.example',
      ])
      expect(res.exitCode).toBe(4)
      expect(recordedHeaders[0].get('X-Taco-Listener-Name')).toBe(encodeURIComponent('中文审查员'))
      expect(recordedHeaders[0].get('X-Taco-Model-Id')).toBe(encodeURIComponent('通义千问-2.5'))
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
