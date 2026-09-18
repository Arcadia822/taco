import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    protocol: 'taco-host/1',
    serverType: 'Next.js App Router (Self-Hostable & Vercel)',
    storage: 'Pluggable Object Storage (S3 / R2 / MinIO / Vercel Blob / Local)',
    limits: {
      maxPayloadBytes: 33554432, // 32 MiB
      maxControlRequestBytes: 65536,
      maxCommentBytes: 16384,
      maxFilesPerSnapshot: 2000,
      maxImageBytes: 10485760,
    },
    idempotency: { retentionSeconds: 86400 },
    retention: { policy: 'manual_only', defaultTtlSeconds: null },
  })
}
