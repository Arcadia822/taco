import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { state } from '@/lib/server-state'

export const dynamic = 'force-dynamic'

export async function POST() {
  const userId = `usr_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const keyId = `key_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const rawSecret = `taco_live_${randomUUID().replace(/-/g, '')}`
  const now = new Date().toISOString()

  const user = {
    id: userId,
    kind: 'anonymous' as const,
    displayName: 'Anonymous Publisher',
    createdAt: now,
  }

  state.users.set(userId, user)
  state.apiKeys.set(rawSecret, {
    id: keyId,
    userId,
    prefix: 'taco_live_',
    keyHash: rawSecret,
    createdAt: now,
    revokedAt: null,
  })

  return NextResponse.json(
    {
      user,
      apiKey: {
        id: keyId,
        prefix: 'taco_live_',
        secret: rawSecret,
        createdAt: now,
        expiresAt: null,
      },
    },
    { status: 201 },
  )
}
