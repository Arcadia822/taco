import { type NextRequest, NextResponse } from 'next/server'
import { validateCsrfAndOrigin } from '@/lib/csrf'
import { ConflictError, DatabaseNotConfiguredError, getDatabase, GoneError, NotFoundError, PayloadTooLargeError } from '@/lib/db'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/

export async function POST(req: NextRequest) {
  const idempotencyKey = req.headers.get('idempotency-key')?.trim()
  if (!idempotencyKey || !UUID_PATTERN.test(idempotencyKey)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Valid UUID Idempotency-Key header is required' } },
      { status: 400 },
    )
  }

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
    purpose?: string
    tacoId?: string
    payloadBytes?: number
    payloadHash?: string
  }

  const purpose = payload.purpose
  if (purpose !== 'review-edit') {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid purpose. Upload reservations only support: review-edit' } },
      { status: 400 },
    )
  }

  const tacoId = payload.tacoId
  if (!tacoId || !UUID_PATTERN.test(tacoId)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Valid UUID tacoId is required' } },
      { status: 400 },
    )
  }

  // Origin + CSRF check for review-edit
  const csrfCheck = validateCsrfAndOrigin(req, tacoId)
  if (!csrfCheck.ok) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: csrfCheck.error } }, { status: csrfCheck.status })
  }

  const payloadBytes = payload.payloadBytes
  if (typeof payloadBytes !== 'number' || payloadBytes < 1 || payloadBytes > 33554432) {
    return NextResponse.json(
      { error: { code: 'PAYLOAD_TOO_LARGE', message: 'payloadBytes must be between 1 and 33554432' } },
      { status: 413 },
    )
  }

  const payloadHash = payload.payloadHash
  if (!payloadHash || !SHA256_PATTERN.test(payloadHash)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'payloadHash must be format sha256:<64 hex chars>' } },
      { status: 400 },
    )
  }

  try {
    const db = getDatabase()
    const reservation = await db.createUploadReservation(
      tacoId,
      {
        purpose,
        payloadBytes,
        payloadHash,
      },
      idempotencyKey,
    )

    const origin = req.nextUrl.origin
    const uploadUrl = `${origin}/api/storage/${reservation.uploadId}`

    if (reservation.status === 'committed') {
      return NextResponse.json(
        {
          uploadId: reservation.uploadId,
          status: 'committed',
        },
        { status: 200 },
      )
    }

    return NextResponse.json(
      {
        uploadId: reservation.uploadId,
        status: 'pending',
        method: 'PUT',
        uploadUrl,
        headers: {
          'Content-Type': 'application/json',
        },
        expiresAt: reservation.expiresAt,
        maxBytes: payloadBytes,
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: err.message } }, { status: 404 })
    }
    if (err instanceof GoneError) {
      return NextResponse.json({ error: { code: 'GONE', message: err.message } }, { status: 410 })
    }
    if (err instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: err.message } }, { status: 413 })
    }
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
