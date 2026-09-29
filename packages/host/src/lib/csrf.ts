import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'

const CSRF_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours
const DEV_SECRET = 'taco-dev-stable-csrf-secret-minimum-32-chars!'

export function getCsrfSecret(): string {
  const envSecret = process.env.TACO_CSRF_SECRET
  if (envSecret) {
    if (envSecret.length < 32) {
      throw new Error('TACO_CSRF_SECRET must be at least 32 characters')
    }
    return envSecret
  }
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new Error('TACO_CSRF_SECRET is required in production/Vercel environments')
  }
  return DEV_SECRET
}

export function generateCsrfNonce(): string {
  return randomBytes(16).toString('hex')
}

export function generateCsrfToken(tacoId: string, nonce: string): string {
  const secret = getCsrfSecret()
  const timestamp = Date.now().toString()
  const payload = `${tacoId}:${timestamp}:${nonce}`
  const sig = createHmac('sha256', secret).update(payload).digest('hex')
  return `${timestamp}.${nonce}.${sig}`
}

export function verifyCsrfToken(tacoId: string, token: string, expectedNonce?: string | null): boolean {
  try {
    const secret = getCsrfSecret()
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const [timestampStr, nonce, sig] = parts
    const timestamp = Number.parseInt(timestampStr, 10)
    if (Number.isNaN(timestamp)) return false

    const now = Date.now()
    if (timestamp > now + 60000 || now - timestamp > CSRF_MAX_AGE_MS) {
      return false
    }

    if (expectedNonce !== undefined && expectedNonce !== null) {
      if (nonce !== expectedNonce) {
        return false
      }
    }

    const payload = `${tacoId}:${timestampStr}:${nonce}`
    const expectedSig = createHmac('sha256', secret).update(payload).digest('hex')

    if (sig.length !== expectedSig.length) return false
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))
  } catch {
    return false
  }
}

export function validateOrigin(req: NextRequest): boolean {
  const secFetchSite = req.headers.get('sec-fetch-site')
  if (secFetchSite === 'cross-site') {
    return false
  }

  const origin = req.headers.get('origin')
  if (origin) {
    const expectedOrigin = req.nextUrl.origin
    // Strict equality check, no substring
    if (origin !== expectedOrigin) {
      return false
    }
  }

  return true
}

export function validateCsrfAndOrigin(
  req: NextRequest,
  tacoId: string,
): { ok: true } | { ok: false; status: 403; error: string } {
  if (!validateOrigin(req)) {
    return { ok: false, status: 403, error: 'Cross-origin request rejected' }
  }

  const csrfHeader = req.headers.get('x-taco-csrf')?.trim()
  if (!csrfHeader) {
    return { ok: false, status: 403, error: 'X-Taco-CSRF header required' }
  }

  const origin = req.headers.get('origin')
  const secFetchSite = req.headers.get('sec-fetch-site')
  const isBrowserContext = Boolean(origin || secFetchSite || req.cookies.has('taco_csrf'))
  const cookieNonce = req.cookies.get('taco_csrf')?.value ?? null

  if (isBrowserContext) {
    if (!cookieNonce) {
      return { ok: false, status: 403, error: 'Missing taco_csrf cookie in browser request' }
    }
    if (!verifyCsrfToken(tacoId, csrfHeader, cookieNonce)) {
      return { ok: false, status: 403, error: 'Invalid or expired CSRF token or nonce mismatch' }
    }
  } else {
    // Non-browser client (CLI/curl): verify HMAC signature; if cookie present, also verify nonce
    if (!verifyCsrfToken(tacoId, csrfHeader, cookieNonce)) {
      return { ok: false, status: 403, error: 'Invalid or expired CSRF token' }
    }
  }

  return { ok: true }
}
