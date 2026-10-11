import { type NextRequest, NextResponse } from 'next/server'
import { validateDocumentSnapshot } from '@taco/protocol'
import { validateCsrfAndOrigin } from '@/lib/csrf'
import {
  ConflictError,
  DatabaseNotConfiguredError,
  getDatabase,
  GoneError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
} from '@/lib/db'
import { broadcastTacoEvent } from '@/lib/server-state'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REVISION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SEQUENCE_PATTERN = /^(0|[1-9][0-9]*)$/
const MAX_REVISION_BYTES = 32 * 1024 * 1024

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: tacoId } = await context.params
  const csrf = validateCsrfAndOrigin(req, tacoId)
  if (!csrf.ok) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: csrf.error } }, { status: csrf.status })
  }
  const idempotencyKey = req.headers.get('idempotency-key')?.trim()
  if (!idempotencyKey || !UUID_PATTERN.test(idempotencyKey)) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Valid UUID Idempotency-Key header is required' } }, { status: 400 })
  }
  const raw = await req.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_REVISION_BYTES) {
    return NextResponse.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Revision exceeds 32 MiB limit' } }, { status: 413 })
  }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Body must be an object' } }, { status: 400 })
  }
  const payload = body as Record<string, unknown>
  const { baseRevisionId, expectedStateVersion, expectedCommentsThroughSequence } = payload
  if (typeof baseRevisionId !== 'string' || !REVISION_UUID_PATTERN.test(baseRevisionId)) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'baseRevisionId must be a UUID' } }, { status: 400 })
  }
  if (
    typeof expectedStateVersion !== 'string' || !SEQUENCE_PATTERN.test(expectedStateVersion) ||
    typeof expectedCommentsThroughSequence !== 'string' || !SEQUENCE_PATTERN.test(expectedCommentsThroughSequence)
  ) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Expected state and comments versions must be decimal integer strings' } }, { status: 400 })
  }
  const validated = validateDocumentSnapshot(payload.snapshot)
  if (!validated.ok) {
    return NextResponse.json({ error: { code: 'UNPROCESSABLE_ENTITY', message: validated.err } }, { status: 422 })
  }
  try {
    const result = await getDatabase().createRevision(tacoId, {
      baseRevisionId,
      expectedStateVersion,
      expectedCommentsThroughSequence,
      snapshot: validated.snapshot,
    }, idempotencyKey)
    broadcastTacoEvent(result.event)
    const origin = req.nextUrl.origin
    return NextResponse.json({
      command: 'update',
      host: origin,
      tacoId: result.tacoId,
      revisionId: result.revisionId,
      baseRevisionId: result.baseRevisionId,
      title: result.title,
      url: `${origin}/t/${tacoId}`,
      stateVersion: result.stateVersion,
      createdAt: result.createdAt,
      contentHash: result.contentHash,
    }, { status: 201 })
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: err.message } }, { status: 404 })
    }
    if (err instanceof ConflictError) {
      return NextResponse.json({ error: { code: 'CONFLICT', message: err.message } }, { status: 409 })
    }
    if (err instanceof GoneError) {
      return NextResponse.json({ error: { code: 'GONE', message: err.message } }, { status: 410 })
    }
    if (err instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: err.message } }, { status: 413 })
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: { code: 'UNPROCESSABLE_ENTITY', message: err.message } }, { status: 422 })
    }
    if (err instanceof DatabaseNotConfiguredError) {
      return NextResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: err.message } }, { status: 503 })
    }
    const message = err instanceof Error ? err.message : 'Internal Server Error'
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message } }, { status: 500 })
  }
}
