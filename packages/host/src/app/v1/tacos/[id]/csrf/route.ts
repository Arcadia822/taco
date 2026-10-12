import { type NextRequest, NextResponse } from 'next/server'
import { DatabaseNotConfiguredError, getDatabase, GoneError } from '@/lib/db'
import { generateCsrfNonce, generateCsrfToken } from '@/lib/csrf'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: tacoId } = await context.params

  try {
    const db = getDatabase()
    const taco = await db.getTaco(tacoId)
    if (!taco) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Taco not found' } }, { status: 404 })
    }
    if (taco.status === 'deleted' || taco.status === 'expired') {
      return NextResponse.json({ error: { code: 'GONE', message: 'Taco has expired or was deleted' } }, { status: 410 })
    }
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

  const nonce = generateCsrfNonce()
  const token = generateCsrfToken(tacoId, nonce)

  const res = NextResponse.json({ csrfToken: token }, { status: 200 })
  res.headers.set('X-Taco-CSRF', token)
  res.headers.set('Access-Control-Expose-Headers', 'X-Taco-CSRF')
  res.cookies.set('taco_csrf', nonce, {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
  })

  return res
}
