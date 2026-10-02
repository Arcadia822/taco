import { randomUUID } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { DatabaseNotConfiguredError, getDatabase, GoneError } from '../../../../../lib/db.ts'
import { subscribeToTacoEvents } from '../../../../../lib/server-state.ts'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SEQUENCE_PATTERN = /^(0|[1-9][0-9]*)$/
const HARNESS_NAMES = new Set([
  'codex',
  'claude-code',
  'github-copilot',
  'cursor',
  'agy',
  'pi',
  'omp',
  'openclaw',
  'hermes',
  'opencode',
  'gemini-cli',
  'other',
])
const MODEL_NAMES = new Set(['gpt', 'claude', 'gemini', 'other'])

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: tacoId } = await context.params

  // Validate headers
  const listenerIdHeader = req.headers.get('x-listener-id')?.trim()
  if (listenerIdHeader && !UUID_PATTERN.test(listenerIdHeader)) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Invalid X-Listener-Id UUID' } }, { status: 400 })
  }

  const harness = req.headers.get('x-taco-harness')?.trim()
  if (harness && !HARNESS_NAMES.has(harness)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: `Invalid X-Taco-Harness: ${harness}` } },
      { status: 400 },
    )
  }

  const model = req.headers.get('x-taco-model')?.trim()
  if (model && !MODEL_NAMES.has(model)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: `Invalid X-Taco-Model: ${model}` } },
      { status: 400 },
    )
  }

  const rawModelId = req.headers.get('x-taco-model-id')?.trim()
  let modelId: string | undefined = undefined
  if (rawModelId !== undefined && rawModelId !== null && rawModelId !== '') {
    try {
      modelId = decodeURIComponent(rawModelId).trim()
    } catch {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Invalid X-Taco-Model-Id: malformed percent-encoding' } },
        { status: 400 },
      )
    }
    if (modelId.length < 1 || modelId.length > 128) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'X-Taco-Model-Id must be between 1 and 128 characters' } },
        { status: 400 },
      )
    }
  }

  const rawListenerName = req.headers.get('x-taco-listener-name')?.trim()
  let listenerName: string | undefined = undefined
  if (rawListenerName !== undefined && rawListenerName !== null && rawListenerName !== '') {
    try {
      listenerName = decodeURIComponent(rawListenerName).trim()
    } catch {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Invalid X-Taco-Listener-Name: malformed percent-encoding' } },
        { status: 400 },
      )
    }
    if (listenerName.length < 1 || listenerName.length > 64) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'X-Taco-Listener-Name must be between 1 and 64 characters' } },
        { status: 400 },
      )
    }
  }
  const rawSession = req.headers.get('x-taco-session')?.trim()
  let sessionTitle: string | undefined = undefined
  if (rawSession !== undefined && rawSession !== null && rawSession !== '') {
    try {
      sessionTitle = decodeURIComponent(rawSession).trim()
    } catch {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Invalid X-Taco-Session: malformed percent-encoding' } },
        { status: 400 },
      )
    }
    if (sessionTitle.length < 1 || sessionTitle.length > 256) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'X-Taco-Session must be between 1 and 256 characters' } },
        { status: 400 },
      )
    }
  }
  const afterParam = req.nextUrl.searchParams.get('after')?.trim()
  if (afterParam !== undefined && afterParam !== null && afterParam !== '') {
    if (!SEQUENCE_PATTERN.test(afterParam)) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Invalid after sequence parameter' } },
        { status: 400 },
      )
    }
  }

  try {
    const db = getDatabase()
    const taco = await db.getTaco(tacoId)
    if (!taco) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Taco not found' } }, { status: 404 })
    }
    if (taco.status === 'deleted' || taco.status === 'expired') {
      return NextResponse.json({ error: { code: 'GONE', message: 'Taco is closed, expired, or deleted' } }, { status: 410 })
    }

    const lastSeq = BigInt(taco.lastSequence)
    const isReplay = afterParam !== undefined && afterParam !== null && afterParam !== ''
    let afterSeq = 0n

    if (isReplay) {
      afterSeq = BigInt(afterParam)
      if (afterSeq > lastSeq) {
        return NextResponse.json(
          {
            error: {
              code: 'CURSOR_EXPIRED',
              message: `Requested cursor sequence ${afterParam} is beyond the latest event sequence ${taco.lastSequence} (historical gap)`,
            },
          },
          { status: 410 },
        )
      }
    }

    // Register / touch listener lease
    const listenerId = listenerIdHeader || randomUUID()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 90 * 1000).toISOString()
    await db.upsertListenerLease(tacoId, {
      listenerId,
      name: listenerName || undefined,
      sessionTitle: sessionTitle || undefined,
      harness: harness || undefined,
      model: model || undefined,
      modelId: modelId || undefined,
      connectedAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt,
    })

    let unsubscribe: (() => void) | null = null
    let pollTimer: NodeJS.Timeout | null = null
    let heartbeatTimer: NodeJS.Timeout | null = null
    let leaseTimer: NodeJS.Timeout | null = null
    let streamClosed = false

    const cleanup = () => {
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
      }
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
      if (leaseTimer) {
        clearInterval(leaseTimer)
        leaseTimer = null
      }
    }
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        let currentSentSequence = isReplay ? afterSeq : lastSeq

        // 1. Emit ready frame per protocol spec:
        // Live mode: { kind: 'ready', protocol: 'taco-host/1', tacoId, cursor: lastSequence, mode: 'live' }
        // Replay mode: { kind: 'ready', protocol: 'taco-host/1', tacoId, cursor: afterParam, mode: 'replay', replayThrough: lastSequence }
        const readyData = isReplay
          ? {
              kind: 'ready',
              protocol: 'taco-host/1',
              tacoId,
              cursor: afterParam,
              mode: 'replay',
              replayThrough: taco.lastSequence,
            }
          : {
              kind: 'ready',
              protocol: 'taco-host/1',
              tacoId,
              cursor: taco.lastSequence,
              mode: 'live',
            }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(readyData)}\n\n`))


        // Sequential polling queue to prevent concurrent overlapping polls
        let isPolling = false
        const pollForNewEvents = async () => {
          if (streamClosed || isPolling) return
          isPolling = true
          try {
            const events = await db.getEventsAfter(tacoId, currentSentSequence)
            for (const ev of events) {
              if (streamClosed) break
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`))
              currentSentSequence = BigInt(ev.sequence)
            }
          } catch (err) {
            if (!streamClosed) {
              streamClosed = true
              cleanup()
              try {
                controller.error(err)
              } catch {}
            }
          } finally {
            isPolling = false
          }
        }

        // 2. If in replay mode, catch up to current watermark first and emit checkpoint frame
        if (isReplay) {
          try {
            const replayEvents = await db.getEventsAfter(tacoId, afterSeq)
            if (streamClosed) {
              cleanup()
              return
            }
            for (const ev of replayEvents) {
              if (streamClosed) break
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`))
              currentSentSequence = BigInt(ev.sequence)
            }
            if (streamClosed) {
              cleanup()
              return
            }
            const checkpointFrame = {
              kind: 'checkpoint',
              tacoId,
              cursor: String(currentSentSequence),
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(checkpointFrame)}\n\n`))
          } catch (err) {
            streamClosed = true
            cleanup()
            try {
              controller.error(err)
            } catch {}
            return
          }
        }
        if (streamClosed) {
          cleanup()
          return
        }
        // 3. Live tail polling:
        // Poll every 1s for cross-instance Vercel commits
        pollTimer = setInterval(pollForNewEvents, 1000)

        // Subscribe to in-process event broadcast for zero-latency local dispatch
        unsubscribe = subscribeToTacoEvents(tacoId, () => {
          pollForNewEvents()
        })

        // 4. Heartbeat keepalive every 15s
        heartbeatTimer = setInterval(() => {
          if (streamClosed) return
          try {
            controller.enqueue(encoder.encode(': keepalive\n\n'))
          } catch {
            // Stream closed
          }
        }, 15000)

        // 5. Periodic lease renewal every 30s while connection active
        leaseTimer = setInterval(async () => {
          if (streamClosed) return
          try {
            const touchNow = new Date()
            const touchExpires = new Date(touchNow.getTime() + 90 * 1000).toISOString()
            await db.upsertListenerLease(tacoId, {
              listenerId,
              name: listenerName || undefined,
              sessionTitle: sessionTitle || undefined,
              harness: harness || undefined,
              model: model || undefined,
              modelId: modelId || undefined,
              lastSeenAt: touchNow.toISOString(),
              expiresAt: touchExpires,
            })
          } catch {
            // Lease refresh failure
          }
        }, 30000)
      },
      cancel() {
        streamClosed = true
        cleanup()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    if (err instanceof GoneError) {
      return NextResponse.json({ error: { code: 'GONE', message: err.message } }, { status: 410 })
    }
    if (err instanceof DatabaseNotConfiguredError) {
      return NextResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: err.message } }, { status: 503 })
    }
    const message = err instanceof Error ? err.message : 'Internal Server Error'
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message } }, { status: 500 })
  }
}
