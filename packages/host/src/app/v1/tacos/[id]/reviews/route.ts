import { type NextRequest, NextResponse } from 'next/server'
import { validateTextAnchor } from '@taco/protocol'
import { validateCsrfAndOrigin } from '@/lib/csrf'
import {
  ConflictError,
  DatabaseNotConfiguredError,
  getDatabase,
  GoneError,
  NotFoundError,
  ValidationError,
} from '@/lib/db'
import { broadcastTacoEvent } from '@/lib/server-state'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NAME_PATTERN = /^\S(?:[\s\S]*\S)?$/

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: tacoId } = await context.params

  try {
    const db = getDatabase()
    const taco = await db.getTaco(tacoId)
    if (!taco) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Taco not found' } }, { status: 404 })
    }

    const threads = await db.getReviewThreads(tacoId)
    return NextResponse.json(threads, { status: 200 })
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return NextResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: err.message } }, { status: 503 })
    }
    const message = err instanceof Error ? err.message : 'Internal Server Error'
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message } }, { status: 500 })
  }
}

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
    action?: string
    threadId?: string
    messageId?: string
    anchor?: unknown
    body?: string
  }

  const author = typeof payload.author === 'string' ? payload.author.trim() : ''
  if (!author || author.length > 64 || !NAME_PATTERN.test(author)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'author must be non-empty string between 1 and 64 characters' } },
      { status: 400 },
    )
  }

  const action = payload.action
  if (!action || !['create', 'reply', 'resolve', 'reopen', 'delete'].includes(action)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid action. Allowed: create, reply, resolve, reopen, delete' } },
      { status: 400 },
    )
  }

  if (action === 'create') {
    if (typeof payload.body !== 'string' || payload.body.trim().length === 0 || payload.body.length > 16384) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'body must be string between 1 and 16384 characters' } },
        { status: 400 },
      )
    }
    if (payload.anchor !== null && payload.anchor !== undefined) {
      const anchorVal = validateTextAnchor(payload.anchor)
      if (!anchorVal.ok) {
        return NextResponse.json({ error: { code: 'UNPROCESSABLE_ENTITY', message: anchorVal.err } }, { status: 422 })
      }
    }
  } else if (action === 'reply') {
    if (!payload.threadId) {
      return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'threadId is required for reply' } }, { status: 400 })
    }
    if (typeof payload.body !== 'string' || payload.body.trim().length === 0 || payload.body.length > 16384) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'body must be string between 1 and 16384 characters' } },
        { status: 400 },
      )
    }
  } else if (action === 'delete') {
    if (!payload.threadId || !payload.messageId) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'threadId and messageId are required for delete' } },
        { status: 400 },
      )
    }
  } else {
    // resolve or reopen
    if (!payload.threadId) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: `threadId is required for ${action}` } },
        { status: 400 },
      )
    }
  }

  try {
    const db = getDatabase()
    const result = await db.mutateReviewThread(
      tacoId,
      {
        author,
        action: action as 'create' | 'reply' | 'resolve' | 'reopen' | 'delete',
        threadId: payload.threadId,
        messageId: payload.messageId,
        anchor: payload.anchor,
        body: payload.body?.trim(),
      },
      idempotencyKey,
    )

    if (result.changed) {
      broadcastTacoEvent(result.event)
    }

    return NextResponse.json(
      {
        changed: result.changed,
        event: result.event,
      },
      { status: result.status },
    )
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
