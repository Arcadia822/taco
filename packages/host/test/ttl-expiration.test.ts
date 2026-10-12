import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DocumentSnapshot } from '@taco/protocol'
import {
  GoneError,
  SqliteDbAdapter,
} from '../src/lib/db'

describe('TACO-53 TTL Expiration Lifecycle', () => {
  const sampleSnapshot: DocumentSnapshot = {
    format: 'taco/files',
    version: 1,
    docId: 'doc_ttl_test',
    title: 'TTL Expiration Test Doc',
    root: 'specs/sample',
    files: [
      {
        id: 'file_spec',
        path: 'specs/sample/spec.md',
        mediaType: 'text/markdown',
        content: '# Spec\n',
      },
    ],
  }

  it('sets default 30-day expires_at when ttlSeconds is omitted', async () => {
    const dbPath = `/tmp/test-taco-ttl-default-${randomUUID()}.db`
    const adapter = new SqliteDbAdapter(dbPath)
    try {
      const tacoId = randomUUID()
      const res = await adapter.publishTaco(tacoId, 'Default TTL', sampleSnapshot)
      expect(res.expiresAt).toBeDefined()
      expect(typeof res.expiresAt).toBe('string')
      const expiresTime = new Date(res.expiresAt!).getTime()
      const nowTime = Date.now()
      // Should be around 30 days from now (within 5 seconds tolerance)
      const diffDays = (expiresTime - nowTime) / (86400 * 1000)
      expect(diffDays).toBeGreaterThan(29.9)
      expect(diffDays).toBeLessThan(30.1)

      const taco = await adapter.getTaco(tacoId)
      expect(taco).not.toBeNull()
      expect(taco!.status).toBe('open')
      expect(taco!.expiresAt).toBe(res.expiresAt)
    } finally {
      try { unlinkSync(dbPath) } catch {}
    }
  })

  it('sets custom expires_at when ttlSeconds is provided', async () => {
    const dbPath = `/tmp/test-taco-ttl-custom-${randomUUID()}.db`
    const adapter = new SqliteDbAdapter(dbPath)
    try {
      const tacoId = randomUUID()
      const res = await adapter.publishTaco(tacoId, 'Custom TTL', sampleSnapshot, { ttlSeconds: 3600 })
      expect(res.expiresAt).toBeDefined()
      const expiresTime = new Date(res.expiresAt!).getTime()
      const nowTime = Date.now()
      const diffHours = (expiresTime - nowTime) / (3600 * 1000)
      expect(diffHours).toBeGreaterThan(0.99)
      expect(diffHours).toBeLessThan(1.01)
    } finally {
      try { unlinkSync(dbPath) } catch {}
    }
  })

  it('marks taco as expired and throws GoneError when expires_at has passed', async () => {
    const dbPath = `/tmp/test-taco-ttl-expired-${randomUUID()}.db`
    const adapter = new SqliteDbAdapter(dbPath)
    try {
      const tacoId = randomUUID()
      // Publish with 0-second TTL (or in the past)
      await adapter.publishTaco(tacoId, 'Expired TTL', sampleSnapshot, { ttlSeconds: 1 })

      // Artificially wind back expires_at in the database to simulate passage of time
      const pastTime = new Date(Date.now() - 5000).toISOString()
      interface SqliteInternal {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } }
      }
      const internalAdapter: SqliteInternal = adapter as unknown as SqliteInternal
      internalAdapter.db
        .prepare('UPDATE tacos SET expires_at = ? WHERE id = ?')
        .run(pastTime, tacoId)

      // getTaco should report status 'expired'
      const taco = await adapter.getTaco(tacoId)
      expect(taco).not.toBeNull()
      expect(taco!.status).toBe('expired')

      // getSharedState should throw GoneError
      await expect(adapter.getSharedState(tacoId)).rejects.toThrow(GoneError)

      // createRevision should throw GoneError
      await expect(
        adapter.createRevision(
          tacoId,
          {
            baseRevisionId: tacoId,
            expectedStateVersion: '1',
            expectedCommentsThroughSequence: '0',
            snapshot: sampleSnapshot,
          },
          randomUUID(),
        ),
      ).rejects.toThrow(GoneError)
    } finally {
      try { unlinkSync(dbPath) } catch {}
    }
  })
})
