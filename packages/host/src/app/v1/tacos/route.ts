import { randomUUID } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { validateDocumentSnapshot } from '@taco/protocol'
import { ConflictError, DatabaseNotConfiguredError, getDatabase } from '@/lib/db'
import { getStorageAdapter } from '@/lib/storage-adapter'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Body must be an object' } }, { status: 400 })
  }

  const payload = body as {
    id?: string
    tacoId?: string
    protocol?: string
    snapshot?: unknown
  }

  if (payload.protocol !== 'taco-host/1' || !payload.snapshot) {
    return NextResponse.json(
      {
        error: {
          code: 'UNPROCESSABLE_ENTITY',
          message: 'Payload must be Taco data { protocol: "taco-host/1", snapshot: { format: "taco/files", ... } }',
        },
      },
      { status: 422 },
    )
  }

  const validated = validateDocumentSnapshot(payload.snapshot)
  if (!validated.ok) {
    return NextResponse.json(
      {
        error: {
          code: 'UNPROCESSABLE_ENTITY',
          message: validated.err,
        },
      },
      { status: 422 },
    )
  }

  const snapshot = validated.snapshot
  const tacoId = payload.id || payload.tacoId || randomUUID()
  const title = snapshot.title || 'Untitled Taco'

  try {
    const db = getDatabase()
    await db.publishTaco(tacoId, title, snapshot)

    // Also write to storage adapter if configured for legacy direct URL access
    try {
      const storage = getStorageAdapter()
      const rawBytes = new TextEncoder().encode(JSON.stringify(body))
      await storage.putObject(`pastes/${tacoId}.json`, rawBytes, 'application/json')
    } catch {
      // Storage adapter write is non-authoritative
    }

    const origin = req.nextUrl.origin
    const nowIso = new Date().toISOString()

    return NextResponse.json(
      {
        command: 'publish',
        host: origin,
        id: tacoId,
        tacoId,
        title,
        url: `${origin}/t/${tacoId}`,
        createdAt: nowIso,
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof ConflictError) {
      return NextResponse.json({ error: { code: 'CONFLICT', message: err.message } }, { status: 409 })
    }
    if (err instanceof DatabaseNotConfiguredError) {
      return NextResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: err.message } }, { status: 503 })
    }
    const message = err instanceof Error ? err.message : 'Internal Server Error'
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message } }, { status: 500 })
  }
}
