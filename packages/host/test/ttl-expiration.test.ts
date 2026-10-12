import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentSnapshot } from '@taco/protocol'
import {
  calculateTacoExpiresAt,
  GoneError,
  isTacoExpired,
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
  afterEach(() => {
    vi.useRealTimers()
  })

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

  it('treats ttlSeconds: null as permanent taco with expires_at null', async () => {
    const dbPath = `/tmp/test-taco-ttl-null-${randomUUID()}.db`
    const adapter = new SqliteDbAdapter(dbPath)
    const baseTime = new Date('2026-10-12T00:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(baseTime)
    try {
      const tacoId = randomUUID()
      const res = await adapter.publishTaco(tacoId, 'Permanent Taco (null)', sampleSnapshot, { ttlSeconds: null })
      expect(res.expiresAt).toBeNull()

      const taco = await adapter.getTaco(tacoId)
      expect(taco).not.toBeNull()
      expect(taco!.expiresAt).toBeNull()
      expect(taco!.status).toBe('open')

      // Advance time by 100 days
      vi.advanceTimersByTime(100 * 86400 * 1000)

      const tacoAfterTime = await adapter.getTaco(tacoId)
      expect(tacoAfterTime).not.toBeNull()
      expect(tacoAfterTime!.expiresAt).toBeNull()
      expect(tacoAfterTime!.status).toBe('open')

      const state = await adapter.getSharedState(tacoId)
      expect(state).not.toBeNull()
    } finally {
      try { unlinkSync(dbPath) } catch {}
    }
  })

  it('treats ttlSeconds: 0 as permanent taco with expires_at null', async () => {
    const dbPath = `/tmp/test-taco-ttl-zero-${randomUUID()}.db`
    const adapter = new SqliteDbAdapter(dbPath)
    const baseTime = new Date('2026-10-12T00:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(baseTime)
    try {
      const tacoId = randomUUID()
      const res = await adapter.publishTaco(tacoId, 'Permanent Taco (0)', sampleSnapshot, { ttlSeconds: 0 })
      expect(res.expiresAt).toBeNull()

      const taco = await adapter.getTaco(tacoId)
      expect(taco).not.toBeNull()
      expect(taco!.expiresAt).toBeNull()
      expect(taco!.status).toBe('open')

      // Advance time by 100 days
      vi.advanceTimersByTime(100 * 86400 * 1000)

      const tacoAfterTime = await adapter.getTaco(tacoId)
      expect(tacoAfterTime).not.toBeNull()
      expect(tacoAfterTime!.expiresAt).toBeNull()
      expect(tacoAfterTime!.status).toBe('open')

      const state = await adapter.getSharedState(tacoId)
      expect(state).not.toBeNull()
    } finally {
      try { unlinkSync(dbPath) } catch {}
    }
  })

  it('deterministically sets default 30-day expires_at when ttlSeconds is omitted or undefined', async () => {
    const dbPath = `/tmp/test-taco-ttl-omitted-${randomUUID()}.db`
    const adapter = new SqliteDbAdapter(dbPath)
    const baseTime = new Date('2026-10-12T00:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(baseTime)
    try {
      const tacoId1 = randomUUID()
      const res1 = await adapter.publishTaco(tacoId1, 'Omitted Options', sampleSnapshot)
      const expected30Days = new Date(baseTime.getTime() + 30 * 86400 * 1000).toISOString()
      expect(res1.expiresAt).toBe(expected30Days)

      const taco1 = await adapter.getTaco(tacoId1)
      expect(taco1).not.toBeNull()
      expect(taco1!.expiresAt).toBe(expected30Days)
      expect(taco1!.status).toBe('open')

      const tacoId2 = randomUUID()
      const res2 = await adapter.publishTaco(tacoId2, 'Undefined TTL', sampleSnapshot, { ttlSeconds: undefined })
      expect(res2.expiresAt).toBe(expected30Days)

      const taco2 = await adapter.getTaco(tacoId2)
      expect(taco2).not.toBeNull()
      expect(taco2!.expiresAt).toBe(expected30Days)
      expect(taco2!.status).toBe('open')
    } finally {
      try { unlinkSync(dbPath) } catch {}
    }
  })

  it('transitions open taco to expired at the exact real expiry boundary using fake timers', async () => {
    const dbPath = `/tmp/test-taco-ttl-boundary-${randomUUID()}.db`
    const adapter = new SqliteDbAdapter(dbPath)
    const baseTime = new Date('2026-10-12T00:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(baseTime)
    try {
      const tacoId = randomUUID()
      const ttlSeconds = 60
      const res = await adapter.publishTaco(tacoId, 'Boundary Taco', sampleSnapshot, { ttlSeconds })
      const expectedExpiresAt = new Date(baseTime.getTime() + 60 * 1000).toISOString()
      expect(res.expiresAt).toBe(expectedExpiresAt)

      // 1 ms before boundary: still open and fully accessible
      vi.setSystemTime(new Date(baseTime.getTime() + 59_999))
      const tacoBefore = await adapter.getTaco(tacoId)
      expect(tacoBefore).not.toBeNull()
      expect(tacoBefore!.status).toBe('open')
      const stateBefore = await adapter.getSharedState(tacoId)
      expect(stateBefore).not.toBeNull()

      // Exactly at expiry boundary (60_000 ms): expired
      vi.setSystemTime(new Date(baseTime.getTime() + 60_000))
      const tacoAtBoundary = await adapter.getTaco(tacoId)
      expect(tacoAtBoundary).not.toBeNull()
      expect(tacoAtBoundary!.status).toBe('expired')
      await expect(adapter.getSharedState(tacoId)).rejects.toThrow(GoneError)

      // 1 ms past boundary: expired
      vi.setSystemTime(new Date(baseTime.getTime() + 60_001))
      const tacoAfter = await adapter.getTaco(tacoId)
      expect(tacoAfter).not.toBeNull()
      expect(tacoAfter!.status).toBe('expired')
      await expect(adapter.getSharedState(tacoId)).rejects.toThrow(GoneError)
    } finally {
      try { unlinkSync(dbPath) } catch {}
    }
  })

  it('evaluates isTacoExpired correctly across nondeleted states and permanent tacos', () => {
    const baseTime = new Date('2026-10-12T00:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(baseTime)

    const pastIso = new Date(baseTime.getTime() - 1000).toISOString()
    const futureIso = new Date(baseTime.getTime() + 1000).toISOString()

    // Open tacos
    expect(isTacoExpired({ status: 'open', expires_at: pastIso })).toBe(true)
    expect(isTacoExpired({ status: 'open', expires_at: futureIso })).toBe(false)
    expect(isTacoExpired({ status: 'open', expires_at: null })).toBe(false)
    expect(isTacoExpired({ status: 'open' })).toBe(false)

    // Closed tacos (nondeleted state with elapsed TTL is expired)
    expect(isTacoExpired({ status: 'closed', expires_at: pastIso })).toBe(true)
    expect(isTacoExpired({ status: 'closed', expires_at: futureIso })).toBe(false)
    expect(isTacoExpired({ status: 'closed', expires_at: null })).toBe(false)

    // Explicit expired status
    expect(isTacoExpired({ status: 'expired', expires_at: futureIso })).toBe(true)
  })

  it('calculates expiresAt correctly: defaults undefined to 30d, treats null and 0 as permanent', () => {
    const baseTime = new Date('2026-10-12T00:00:00.000Z')
    const expected30Days = new Date(baseTime.getTime() + 30 * 86400 * 1000).toISOString()

    expect(calculateTacoExpiresAt(undefined, baseTime)).toBe(expected30Days)
    expect(calculateTacoExpiresAt(null, baseTime)).toBeNull()
    expect(calculateTacoExpiresAt(0, baseTime)).toBeNull()
    expect(calculateTacoExpiresAt(3600, baseTime)).toBe(new Date(baseTime.getTime() + 3600 * 1000).toISOString())
  })
})
