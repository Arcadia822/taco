import { type NextRequest, NextResponse } from 'next/server'
import { generateCsrfNonce, generateCsrfToken } from '@/lib/csrf'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: tacoId } = await context.params
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
