import { type NextRequest, NextResponse } from 'next/server'
import { DatabaseNotConfiguredError, getDatabase } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: tacoId } = await context.params

  try {
    const db = getDatabase()
    const taco = await db.getTaco(tacoId)
    if (!taco) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Taco not found' } }, { status: 404 })
    }

    const versions = await db.listHistory(tacoId)
    return NextResponse.json({ versions }, { status: 200 })
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return NextResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: err.message } }, { status: 503 })
    }
    const message = err instanceof Error ? err.message : 'Internal Server Error'
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message } }, { status: 500 })
  }
}
