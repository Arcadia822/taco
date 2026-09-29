import { type NextRequest, NextResponse } from 'next/server'
import { DatabaseNotConfiguredError, getDatabase, GoneError, NotFoundError, PayloadTooLargeError, sha256Hex } from '@/lib/db'
import { getStorageAdapter } from '@/lib/storage-adapter'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_STORAGE_BYTES = 32 * 1024 * 1024 // 32 MiB

async function readBoundedBody(req: NextRequest, maxBytes: number): Promise<{ bytes: Uint8Array; overflow: boolean }> {
  if (!req.body) {
    return { bytes: new Uint8Array(0), overflow: false }
  }
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        return { bytes: new Uint8Array(0), overflow: true }
      }
      chunks.push(value)
    }
  }

  const result = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes: result, overflow: false }
}

export async function PUT(req: NextRequest, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params
  const decodedKey = decodeURIComponent(key)

  // Early Content-Length check to avoid buffering oversized payloads
  const contentLength = req.headers.get('content-length')
  if (contentLength) {
    const parsedLength = parseInt(contentLength, 10)
    if (!Number.isNaN(parsedLength) && parsedLength > MAX_STORAGE_BYTES) {
      return NextResponse.json(
        { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload exceeds 32 MiB limit' } },
        { status: 413 },
      )
    }
  }

  // Stream bounded reading to prevent memory exhaustion
  const { bytes, overflow } = await readBoundedBody(req, MAX_STORAGE_BYTES)
  if (overflow) {
    return NextResponse.json(
      { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload exceeds 32 MiB limit' } },
      { status: 413 },
    )
  }

  // UUID keys are private upload reservations
  if (UUID_PATTERN.test(decodedKey)) {
    try {
      const db = getDatabase()
      const reservation = await db.getUploadReservation(decodedKey)
      if (!reservation) {
        return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Upload reservation not found' } }, { status: 404 })
      }

      if (new Date(reservation.expiresAt).getTime() < Date.now()) {
        return NextResponse.json({ error: { code: 'GONE', message: 'Upload reservation expired' } }, { status: 410 })
      }

      if (bytes.byteLength > reservation.payloadBytes) {
        return NextResponse.json(
          { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Uploaded bytes exceed reservation' } },
          { status: 413 },
        )
      }

      const hash = `sha256:${await sha256Hex(bytes)}`
      if (hash !== reservation.payloadHash) {
        return NextResponse.json(
          {
            error: {
              code: 'UNPROCESSABLE_ENTITY',
              message: `SHA-256 mismatch: expected ${reservation.payloadHash}, calculated ${hash}`,
            },
          },
          { status: 422 },
        )
      }

      // Idempotent re-upload of already committed reservation
      if (reservation.status === 'committed') {
        return NextResponse.json({ ok: true, uploadId: decodedKey, status: 'committed', storedBytes: bytes.byteLength }, { status: 200 })
      }

      await db.commitUploadContent(decodedKey, bytes)
      return NextResponse.json({ ok: true, uploadId: decodedKey, status: 'committed', storedBytes: bytes.byteLength }, { status: 200 })
    } catch (err) {
      if (err instanceof NotFoundError) {
        return NextResponse.json({ error: { code: 'NOT_FOUND', message: err.message } }, { status: 404 })
      }
      if (err instanceof GoneError) {
        return NextResponse.json({ error: { code: 'GONE', message: err.message } }, { status: 410 })
      }
      if (err instanceof PayloadTooLargeError) {
        return NextResponse.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: err.message } }, { status: 413 })
      }
      if (err instanceof DatabaseNotConfiguredError) {
        return NextResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: err.message } }, { status: 503 })
      }
      const message = err instanceof Error ? err.message : 'Internal Server Error'
      return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message } }, { status: 500 })
    }
  }

  // Non-UUID legacy storage path only
  try {
    const storage = getStorageAdapter()
    await storage.putObject(decodedKey, bytes)
    return NextResponse.json({ ok: true, storedBytes: bytes.byteLength })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Storage upload error'
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message } }, { status: 500 })
  }
}

export async function GET(req: NextRequest, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params
  const decodedKey = decodeURIComponent(key)

  if (UUID_PATTERN.test(decodedKey)) {
    try {
      const db = getDatabase()
      const reservation = await db.getUploadReservation(decodedKey)
      if (!reservation) {
        return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Upload reservation not found' } }, { status: 404 })
      }
      const content = await db.getUploadContent(decodedKey)
      if (content === null || reservation.status !== 'committed') {
        return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Upload content not found or not committed' } }, { status: 404 })
      }
      return new Response(content, {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (err) {
      if (err instanceof DatabaseNotConfiguredError) {
        return NextResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: err.message } }, { status: 503 })
      }
      const message = err instanceof Error ? err.message : 'Internal Server Error'
      return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message } }, { status: 500 })
    }
  }

  // Non-UUID legacy storage path
  try {
    const storage = getStorageAdapter()
    const data = await storage.getObject(decodedKey)
    if (!data) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Object not found' } }, { status: 404 })
    }
    return new Response(data as unknown as BodyInit, {
      headers: { 'Content-Type': 'application/octet-stream' },
    })
  } catch {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Object not found' } }, { status: 404 })
  }
}
