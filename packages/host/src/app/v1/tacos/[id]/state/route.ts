import { type NextRequest, NextResponse } from 'next/server'
import type { AutoSavePatch } from '@taco/protocol'
import { generateCsrfNonce, generateCsrfToken, validateCsrfAndOrigin } from '@/lib/csrf'
import {
  ConflictError,
  DatabaseNotConfiguredError,
  getDatabase,
  GoneError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
} from '@/lib/db'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SEQUENCE_PATTERN = /^(0|[1-9][0-9]*)$/
const NAME_PATTERN = /^\S(?:[\s\S]*\S)?$/
const MAX_PATCH_BYTES = 1024 * 1024 // 1 MiB

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: tacoId } = await context.params

  try {
    const db = getDatabase()
    const shared = await db.getSharedState(tacoId)
    if (!shared) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Taco not found or has no publish baseline' } },
        { status: 404 },
      )
    }

    const nonce = generateCsrfNonce()
    const token = generateCsrfToken(tacoId, nonce)

    const res = NextResponse.json(
      {
        stateVersion: shared.stateVersion,
        commentsThroughSequence: shared.commentsThroughSequence,
        snapshot: shared.snapshot,
      },
      { status: 200 },
    )

    res.headers.set('X-Taco-CSRF', token)
    res.headers.set('Access-Control-Expose-Headers', 'X-Taco-CSRF')
    res.cookies.set('taco_csrf', nonce, {
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
    })

    return res
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return NextResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: err.message } }, { status: 503 })
    }
    const message = err instanceof Error ? err.message : 'Internal Server Error'
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message } }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
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

  // 3. UTF-8 byte length limit (1 MiB)
  const rawBodyText = await req.text()
  const rawBytes = new TextEncoder().encode(rawBodyText)
  if (rawBytes.byteLength > MAX_PATCH_BYTES) {
    return NextResponse.json(
      { error: { code: 'PAYLOAD_TOO_LARGE', message: 'AutoSave patch exceeds 1 MiB limit' } },
      { status: 413 },
    )
  }

  let body: unknown
  try {
    body = JSON.parse(rawBodyText)
  } catch {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Body must be an object' } }, { status: 400 })
  }

  const patch = body as Partial<AutoSavePatch>

  if (patch.protocol !== 'taco-state/1') {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'protocol must be "taco-state/1"' } },
      { status: 400 },
    )
  }

  if (typeof patch.expectedStateVersion !== 'string' || !SEQUENCE_PATTERN.test(patch.expectedStateVersion)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'expectedStateVersion must be a non-negative decimal integer string' } },
      { status: 400 },
    )
  }

  const author = typeof patch.author === 'string' ? patch.author.trim() : ''
  if (!author || author.length > 64 || !NAME_PATTERN.test(author)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'author must be non-empty string between 1 and 64 characters' } },
      { status: 400 },
    )
  }

  if (!Array.isArray(patch.fileChanges)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'fileChanges must be an array' } },
      { status: 400 },
    )
  }

  if (
    patch.fileChanges.length === 0 &&
    patch.checkpoints === undefined &&
    patch.title === undefined &&
    patch.navigation === undefined
  ) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Patch must contain at least one fileChange, checkpoints, title, or navigation' } },
      { status: 400 },
    )
  }

  if (patch.title !== undefined && (typeof patch.title !== 'string' || patch.title.trim().length === 0)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'title must be a non-empty string when provided' } },
      { status: 400 },
    )
  }

  try {
    const db = getDatabase()
    const result = await db.autosaveSharedState(
      tacoId,
      {
        protocol: 'taco-state/1',
        expectedStateVersion: patch.expectedStateVersion,
        author,
        fileChanges: patch.fileChanges,
        checkpoints: patch.checkpoints,
        title: patch.title,
        navigation: patch.navigation,
      },
      idempotencyKey,
    )
    return NextResponse.json(result, { status: 200 })
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
