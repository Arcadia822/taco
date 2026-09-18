import { NextRequest, NextResponse } from 'next/server'
import { state } from '@/lib/server-state'
import { getStorageAdapter } from '@/lib/storage-adapter'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: tacoId } = await context.params
  let paste = state.pastes.get(tacoId)

  // Cold start fallback
  if (!paste) {
    const storage = getStorageAdapter()
    const storagePath = `pastes/${tacoId}.json`
    const rawBytes = await storage.getObject(storagePath)
    if (!rawBytes) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Taco not found' } }, { status: 404 })
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

  const searchParams = req.nextUrl.searchParams
  const after = searchParams.get('after') ? Number.parseInt(searchParams.get('after')!, 10) : 0

  const events = state.events.get(tacoId) || []
  const filtered = events.filter((e) => e.sequence > after)

  return NextResponse.json({
    events: filtered.map((e) => ({
      id: e.id,
      sequence: String(e.sequence),
      tacoId: e.tacoId,
      type: 'comment.created',
      occurredAt: e.occurredAt,
      data: { body: e.body },
      actor: { displayName: e.author },
    })),
    throughSequence: String(paste.lastSequence),
    nextCursor: null,
    hasMore: false,
  })
}
