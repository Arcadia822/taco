import { type NextRequest, NextResponse } from 'next/server'
import { validateCsrfAndOrigin } from '@/lib/csrf'
import {
  ConflictError,
  DatabaseNotConfiguredError,
  getDatabase,
  GoneError,
  NotFoundError,
  PayloadTooLargeError,
} from '@/lib/db'
import { broadcastTacoEvent } from '@/lib/server-state'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SEQUENCE_PATTERN = /^(0|[1-9][0-9]*)$/
const NAME_PATTERN = /^\S(?:[\s\S]*\S)?$/

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: tacoId } = await context.params

  // 1. Origin + CSRF check
  const csrfCheck = validateCsrfAndOrigin(req, tacoId)
  if (!csrfCheck.ok) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: csrfCheck.error } }, { status: csrfCheck.status })
  }

  // 2. Idempotency-Key check
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
    author?: string
    expectedStateVersion?: string
    expectedCommentsThroughSequence?: string
  }

  const author = typeof payload.author === 'string' ? payload.author.trim() : ''
  if (!author || author.length > 64 || !NAME_PATTERN.test(author)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'author must be non-empty string between 1 and 64 characters' } },
      { status: 400 },
    )
  }

  if (typeof payload.expectedStateVersion !== 'string' || !SEQUENCE_PATTERN.test(payload.expectedStateVersion)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'expectedStateVersion must be a non-negative decimal integer string' } },
      { status: 400 },
    )
  }

  if (
    typeof payload.expectedCommentsThroughSequence !== 'string' ||
    !SEQUENCE_PATTERN.test(payload.expectedCommentsThroughSequence)
  ) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'expectedCommentsThroughSequence must be a non-negative decimal integer string',
        },
      },
      { status: 400 },
    )
  }

  try {
    const db = getDatabase()
    const result = await db.commitHandoff(
      tacoId,
      {
        author,
        expectedStateVersion: payload.expectedStateVersion,
        expectedCommentsThroughSequence: payload.expectedCommentsThroughSequence,
      },
      idempotencyKey,
    )

    if (result.changed && result.event) {
      broadcastTacoEvent(result.event)
      return NextResponse.json(result, { status: 201 })
    }

    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: err.message } }, { status: 404 })
    }
    if (err instanceof GoneError) {
      return NextResponse.json({ error: { code: 'GONE', message: err.message } }, { status: 410 })
    }
    if (err instanceof ConflictError) {
      return NextResponse.json({ error: { code: 'CONFLICT', message: err.message } }, { status: 409 })
    }
    if (err instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: err.message } }, { status: 413 })
    }
    if (err instanceof DatabaseNotConfiguredError) {
      return NextResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: err.message } }, { status: 503 })
    }
    const message = err instanceof Error ? err.message : 'Internal Server Error'
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message } }, { status: 500 })
  }
}
