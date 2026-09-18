import { NextRequest } from 'next/server'
import { getStorageAdapter } from '@/lib/storage-adapter'
import { state, subscribeToPasteEvents, type TacoCommentEvent } from '@/lib/server-state'

export const dynamic = 'force-dynamic'

/**
 * EventStream / SSE Realtime Subscription for a Taco Paste:
 * - Emits initial ready frame
 * - Emits backfill history if ?after=seq
 * - Emits live comment events in real time
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: tacoId } = await context.params

  // 1. Check in memory first
  let paste = state.pastes.get(tacoId)

  // 2. If not in memory (e.g. cold start / new serverless instance), check Vercel Blob storage!
  if (!paste) {
    const storage = getStorageAdapter()
    const storagePath = `pastes/${tacoId}.json`
    const rawBytes = await storage.getObject(storagePath)

    if (!rawBytes) {
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Taco Paste not found in storage' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Revive paste into memory state
    paste = {
      id: tacoId,
      title: 'Taco Paste',
      storageKey: storagePath,
      contentHash: '',
      createdAt: new Date().toISOString(),
      lastSequence: 1,
    }
    state.pastes.set(tacoId, paste)
  }

  const afterParam = req.nextUrl.searchParams.get('after')
  const afterSeq = afterParam ? Number.parseInt(afterParam, 10) : paste.lastSequence

  let unsubscribe: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      // 1. Ready frame
      const readyFrame = {
        kind: 'ready',
        protocol: 'taco-host/1',
        tacoId,
        cursor: String(afterSeq),
        mode: afterParam ? 'replay' : 'live',
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(readyFrame)}\n\n`))

      // 2. Replay backfill if after specified
      if (afterParam) {
        const events = state.events.get(tacoId) || []
        const backfill = events.filter((e) => e.sequence > afterSeq)
        for (const ev of backfill) {
          const evFrame = {
            kind: 'event',
            id: ev.id,
            sequence: String(ev.sequence),
            tacoId: ev.tacoId,
            type: 'comment.created',
            occurredAt: ev.occurredAt,
            data: { body: ev.body },
            actor: { displayName: ev.author },
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evFrame)}\n\n`))
        }
      }

      // 3. Realtime listener
      unsubscribe = subscribeToPasteEvents(tacoId, (ev: TacoCommentEvent) => {
        const evFrame = {
          kind: 'event',
          id: ev.id,
          sequence: String(ev.sequence),
          tacoId: ev.tacoId,
          type: 'comment.created',
          occurredAt: ev.occurredAt,
          data: { body: ev.body },
          actor: { displayName: ev.author },
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(evFrame)}\n\n`))
      })
    },
    cancel() {
      unsubscribe?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
