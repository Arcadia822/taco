import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { state } from '@/lib/server-state'
import { getStorageAdapter } from '@/lib/storage-adapter'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const idempotencyKey = req.headers.get('idempotency-key')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Valid Bearer ApiKey required' } }, { status: 401 })
  }
  if (!idempotencyKey) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Missing Idempotency-Key header' } }, { status: 400 })
  }

  const secret = authHeader.slice(7).trim()
  const keyObj = state.apiKeys.get(secret)
  if (!keyObj || keyObj.revokedAt !== null) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or revoked ApiKey' } }, { status: 401 })
  }

  const body = (await req.json()) as {
    protocol: string
    purpose: 'publish' | 'update'
    tacoId?: string | null
    baseRevisionId?: string | null
    payloadHash: string
    payloadBytes: number
  }

  const scopeKey = `${keyObj.userId}:${body.purpose}:${body.tacoId || 'global'}:${idempotencyKey}`
  const existing = state.uploadsByIdempotency.get(scopeKey)

  const origin = req.nextUrl.origin
  const storage = getStorageAdapter()

  if (existing) {
    if (existing.status === 'committed') {
      return NextResponse.json({ uploadId: existing.id, status: 'committed' }, { status: 201 })
    }
    const uploadUrl = await storage.getPresignedUploadUrl(existing.storageKey, {
      maxBytes: existing.payloadBytes,
      validUntil: Date.now() + 15 * 60 * 1000,
      hostOrigin: origin,
    })
    return NextResponse.json(
      {
        uploadId: existing.id,
        status: 'pending',
        method: 'PUT',
        uploadUrl,
        headers: { 'Content-Type': 'application/json' },
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        maxBytes: existing.payloadBytes,
      },
      { status: 201 },
    )
  }

  const uploadId = randomUUID()
  const tacoId = body.tacoId || randomUUID()
  const revisionId = randomUUID()
  const storageKey = `tacos/${tacoId}/revisions/${revisionId}.json`

  const uploadUrl = await storage.getPresignedUploadUrl(storageKey, {
    maxBytes: body.payloadBytes,
    validUntil: Date.now() + 15 * 60 * 1000,
    hostOrigin: origin,
  })

  const reservation = {
    id: uploadId,
    userId: keyObj.userId,
    purpose: body.purpose,
    tacoId,
    revisionId,
    storageKey,
    payloadHash: body.payloadHash,
    payloadBytes: body.payloadBytes,
    status: 'pending' as const,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  }

  state.uploads.set(uploadId, reservation)
  state.uploadsByIdempotency.set(scopeKey, reservation)

  return NextResponse.json(
    {
      uploadId,
      status: 'pending',
      method: 'PUT',
      uploadUrl,
      headers: { 'Content-Type': 'application/json' },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      maxBytes: body.payloadBytes,
    },
    { status: 201 },
  )
}
