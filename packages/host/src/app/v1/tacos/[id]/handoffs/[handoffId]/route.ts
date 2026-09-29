import { type NextRequest, NextResponse } from 'next/server'
import { DatabaseNotConfiguredError, getDatabase, GoneError } from '@/lib/db'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, context: { params: Promise<{ id: string; handoffId: string }> }) {
  const { id: tacoId, handoffId } = await context.params

  if (!UUID_PATTERN.test(handoffId)) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Invalid UUID handoffId' } }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const handoff = await db.getHandoff(tacoId, handoffId)
    if (!handoff) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Handoff not found' } }, { status: 404 })
    }

    return NextResponse.json(handoff, { status: 200 })
  } catch (err) {
    if (err instanceof GoneError) {
      return NextResponse.json({ error: { code: 'GONE', message: err.message } }, { status: 410 })
    }
    if (err instanceof DatabaseNotConfiguredError) {
      return NextResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: err.message } }, { status: 503 })
    }
    const message = err instanceof Error ? err.message : 'Internal Server Error'
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message } }, { status: 500 })
  }
}
