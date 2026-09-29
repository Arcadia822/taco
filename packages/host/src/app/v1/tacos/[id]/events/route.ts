import { type NextRequest, NextResponse } from 'next/server'
import { DatabaseNotConfiguredError, getDatabase } from '@/lib/db'

export const dynamic = 'force-dynamic'

const SEQUENCE = /^(0|[1-9][0-9]*)$/
const MAX_SEQUENCE = 9223372036854775807n

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: tacoId } = await context.params
  const afterParam = req.nextUrl.searchParams.get('after') ?? '0'
  const throughParam = req.nextUrl.searchParams.get('through')
  const limitParam = req.nextUrl.searchParams.get('limit') ?? '100'
  if (
    !SEQUENCE.test(afterParam) || BigInt(afterParam) > MAX_SEQUENCE ||
    (throughParam !== null && (!SEQUENCE.test(throughParam) || BigInt(throughParam) > MAX_SEQUENCE)) ||
    !/^[1-9][0-9]*$/.test(limitParam) || Number(limitParam) > 500
  ) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid event cursor or limit' } }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const taco = await db.getTaco(tacoId)
    if (!taco) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Taco not found' } }, { status: 404 })
    }
    if (taco.status === 'deleted' || taco.status === 'expired') {
      return NextResponse.json({ error: { code: 'GONE', message: 'Taco is deleted or expired' } }, { status: 410 })
    }
    const after = BigInt(afterParam)
    const latest = BigInt(taco.lastSequence)
    if (after > latest) {
      return NextResponse.json({ error: { code: 'CURSOR_EXPIRED', message: 'Requested cursor is beyond the latest event' } }, { status: 410 })
    }
    const through = throughParam === null ? latest : BigInt(throughParam)
    if (through > latest || through < after) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid through sequence' } }, { status: 400 })
    }
    const limit = Number(limitParam)
    const page = await db.getEventsPage(tacoId, after, through, limit + 1)
    const hasMore = page.length > limit
    const events = hasMore ? page.slice(0, limit) : page
    return NextResponse.json({
      events,
      throughSequence: through.toString(),
      nextCursor: hasMore ? events[events.length - 1].sequence : null,
      hasMore,
    })
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return NextResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: err.message } }, { status: 503 })
    }
    const message = err instanceof Error ? err.message : 'Internal Server Error'
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message } }, { status: 500 })
  }
}
