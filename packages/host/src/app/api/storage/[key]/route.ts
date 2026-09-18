import { NextRequest, NextResponse } from 'next/server'
import { getStorageAdapter } from '@/lib/storage-adapter'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params
  const decodedKey = decodeURIComponent(key)
  const bytes = new Uint8Array(await req.arrayBuffer())

  const storage = getStorageAdapter()
  await storage.putObject(decodedKey, bytes)

  return NextResponse.json({ ok: true, storedBytes: bytes.byteLength })
}
