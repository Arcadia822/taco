import { NextRequest, NextResponse } from 'next/server'
import { broadcastPasteEvent, state } from '@/lib/server-state'
import { getStorageAdapter } from '@/lib/storage-adapter'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: tacoId } = await context.params
  let paste = state.pastes.get(tacoId)

  // Cold start fallback: check Vercel Blob
  if (!paste) {
    const storage = getStorageAdapter()
    const storagePath = `pastes/${tacoId}.json`
    const rawBytes = await storage.getObject(storagePath)
    if (!rawBytes) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Taco Paste not found' } }, { status: 404 })
    }
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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON' } }, { status: 400 })
  }

  const commentData = body as { body?: string; author?: string }
  if (!commentData.body || commentData.body.trim().length === 0) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Comment body is required' } }, { status: 400 })
  }

  const now = new Date().toISOString()
  const nextSeq = paste.lastSequence + 1
  paste.lastSequence = nextSeq

  const ev = {
    id: `ev_${nextSeq}`,
    sequence: nextSeq,
    tacoId,
    body: commentData.body.trim(),
    author: commentData.author?.trim() || 'Anonymous Reviewer',
    occurredAt: now,
  }

  let evList = state.events.get(tacoId)
  if (!evList) {
    evList = []
    state.events.set(tacoId, evList)
  }
  evList.push(ev)
  broadcastPasteEvent(ev)

  return NextResponse.json(
    {
      changed: true,
      event: {
        id: ev.id,
        sequence: String(ev.sequence),
        tacoId: ev.tacoId,
        type: 'comment.created',
        occurredAt: ev.occurredAt,
        actor: { kind: 'guest', id: 'g_anon', displayName: ev.author, verified: false },
        data: { body: ev.body, threadId: `th_${nextSeq}` },
      },
    },
    { status: 201 },
  )
}
