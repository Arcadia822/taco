import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getStorageAdapter } from '@/lib/storage-adapter'

export const dynamic = 'force-dynamic'

/**
 * Pure Pastebin Creation Endpoint:
 * - Directly uploads JSON data to Vercel Blob (no S3, no auth, no user needed)
 * - Returns public Taco URL
 */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, { status: 400 })
  }

  const payload = body as {
    protocol?: string
    snapshot?: {
      format?: string
      title?: string
      docId?: string
      root?: string
      files?: unknown[]
    }
  }

  if (payload.protocol !== 'taco-host/1' || !payload.snapshot || payload.snapshot.format !== 'taco/files') {
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

  const rawBytes = new TextEncoder().encode(JSON.stringify(body))
  const pasteId = randomUUID()
  const storageKey = `pastes/${pasteId}.json`

  const storage = getStorageAdapter()
  const blobUrl = await storage.putObject(storageKey, rawBytes, 'application/json')

  const origin = req.nextUrl.origin
  const title = payload.snapshot.title || 'Untitled Taco Paste'

  return NextResponse.json(
    {
      command: 'publish',
      host: origin,
      id: pasteId,
      tacoId: pasteId,
      title,
      blobUrl,
      url: `${origin}/t/${pasteId}`,
      createdAt: new Date().toISOString(),
    },
    { status: 201 },
  )
}
