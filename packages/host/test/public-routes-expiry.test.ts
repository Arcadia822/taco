import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { DocumentSnapshot } from '@taco/protocol'
import { DatabaseNotConfiguredError, SqliteDbAdapter } from '../src/lib/db.ts'
import * as dbModule from '../src/lib/db.ts'
import type { ObjectStorageAdapter } from '../src/lib/storage-adapter.ts'
import * as storageModule from '../src/lib/storage-adapter.ts'

import { POST as postPublishTaco } from '../src/app/v1/tacos/route.ts'
import { GET as getHistory } from '../src/app/v1/tacos/[id]/history/route.ts'
import { GET as getHistoryWindow } from '../src/app/v1/tacos/[id]/history/[windowId]/route.ts'
import { GET as getReviews } from '../src/app/v1/tacos/[id]/reviews/route.ts'
import { GET as getListeners } from '../src/app/v1/tacos/[id]/listeners/route.ts'
import { GET as getEvents } from '../src/app/v1/tacos/[id]/events/route.ts'
import { GET as getCsrf } from '../src/app/v1/tacos/[id]/csrf/route.ts'
import { GET as getStorage } from '../src/app/api/storage/[key]/route.ts'

interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}

interface PublishSuccessBody {
  command: string
  id: string
  tacoId: string
  expiresAt: string | null
}

let currentDb: SqliteDbAdapter | null = null
let dbUnavailable = false

vi.mock('../src/lib/db.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof dbModule>()
  return {
    ...actual,
    getDatabase: () => {
      if (dbUnavailable) {
        throw new DatabaseNotConfiguredError('Database is not configured')
      }
      return currentDb ?? actual.getDatabase()
    },
  }
})

const storageMockObjects = new Map<string, Uint8Array>()
const putObjectCalls: Array<{ key: string; data: Uint8Array }> = []

const mockStorageAdapter: ObjectStorageAdapter = {
  async putObject(key: string, data: Uint8Array): Promise<string> {
    putObjectCalls.push({ key, data })
    storageMockObjects.set(key, data)
    return `https://mock-blob.example.com/${key}`
  },
  async getObject(urlOrPath: string): Promise<Uint8Array | null> {
    const data = storageMockObjects.get(urlOrPath)
    if (!data) {
      return null
    }
    return data
  },
}

vi.mock('../src/lib/storage-adapter.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof storageModule>()
  return {
    ...actual,
    getStorageAdapter: () => mockStorageAdapter,
  }
})

describe('Host Public Routes Expiry & Lifecycle Regression Tests', () => {
  const sampleSnapshot: DocumentSnapshot = {
    format: 'taco/files',
    version: 1,
    docId: 'doc_expiry_test',
    title: 'Expiry Test Taco',
    root: 'specs/sample',
    files: [
      {
        id: 'file_spec',
        path: 'specs/sample/spec.md',
        mediaType: 'text/markdown',
        content: '# Expiry Spec\n',
      },
    ],
  }

  const setupTestDb = async () => {
    const testDbPath = `/tmp/taco-route-expiry-${randomUUID()}.db`
    const db = new SqliteDbAdapter(testDbPath)
    currentDb = db
    dbUnavailable = false
    const tacoId = randomUUID()
    await db.publishTaco(tacoId, 'Expiry Route Test', sampleSnapshot)
    return { testDbPath, db, tacoId }
  }

  const setTacoLifecycleStatus = (
    testDbPath: string,
    tacoId: string,
    target: 'expired' | 'deleted',
  ) => {
    const directDb = new DatabaseSync(testDbPath)
    if (target === 'expired') {
      directDb
        .prepare('UPDATE tacos SET expires_at = ?, status = ? WHERE id = ?')
        .run('1970-01-01T00:00:00.000Z', 'expired', tacoId)
    } else {
      directDb
        .prepare('UPDATE tacos SET status = ? WHERE id = ?')
        .run('deleted', tacoId)
    }
    directDb.close()
  }

  describe('POST /v1/tacos (Publication)', () => {
    it('does not write public legacy Blob copy to storage adapter', async () => {
      const { testDbPath, db } = await setupTestDb()
      try {
        putObjectCalls.length = 0
        const newTacoId = randomUUID()
        const req = new NextRequest('http://localhost:32167/v1/tacos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: newTacoId,
            protocol: 'taco-host/1',
            snapshot: sampleSnapshot,
          }),
        })
        const res = await postPublishTaco(req)
        expect(res.status).toBe(201)
        const body: PublishSuccessBody = await res.json()
        expect(body.tacoId).toBe(newTacoId)

        // Verify storage adapter putObject was NOT called for pastes/<uuid>.json
        const pasteCall = putObjectCalls.find((c) => c.key === `pastes/${newTacoId}.json`)
        expect(pasteCall).toBeUndefined()
        expect(putObjectCalls.length).toBe(0)
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })
  })

  describe('GET /v1/tacos/[id]/history', () => {
    it('returns 200 for open taco', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/history`)
        const res = await getHistory(req, { params: Promise.resolve({ id: tacoId }) })
        expect(res.status).toBe(200)
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })

    it('returns 410 when taco is expired', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        setTacoLifecycleStatus(testDbPath, tacoId, 'expired')
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/history`)
        const res = await getHistory(req, { params: Promise.resolve({ id: tacoId }) })
        expect(res.status).toBe(410)
        const body: ApiErrorBody = await res.json()
        expect(body.error.code).toBe('GONE')
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })

    it('returns 410 when taco is deleted', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        setTacoLifecycleStatus(testDbPath, tacoId, 'deleted')
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/history`)
        const res = await getHistory(req, { params: Promise.resolve({ id: tacoId }) })
        expect(res.status).toBe(410)
        const body: ApiErrorBody = await res.json()
        expect(body.error.code).toBe('GONE')
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })

    it('returns 404 when taco is not found', async () => {
      const { testDbPath } = await setupTestDb()
      try {
        const missingId = randomUUID()
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${missingId}/history`)
        const res = await getHistory(req, { params: Promise.resolve({ id: missingId }) })
        expect(res.status).toBe(404)
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })
  })

  describe('GET /v1/tacos/[id]/history/[windowId]', () => {
    it('returns 410 when taco is expired', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        setTacoLifecycleStatus(testDbPath, tacoId, 'expired')
        const windowId = randomUUID()
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/history/${windowId}`)
        const res = await getHistoryWindow(req, { params: Promise.resolve({ id: tacoId, windowId }) })
        expect(res.status).toBe(410)
        const body: ApiErrorBody = await res.json()
        expect(body.error.code).toBe('GONE')
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })

    it('returns 410 when taco is deleted', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        setTacoLifecycleStatus(testDbPath, tacoId, 'deleted')
        const windowId = randomUUID()
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/history/${windowId}`)
        const res = await getHistoryWindow(req, { params: Promise.resolve({ id: tacoId, windowId }) })
        expect(res.status).toBe(410)
        const body: ApiErrorBody = await res.json()
        expect(body.error.code).toBe('GONE')
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })
  })

  describe('GET /v1/tacos/[id]/reviews', () => {
    it('returns 200 for open taco', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/reviews`)
        const res = await getReviews(req, { params: Promise.resolve({ id: tacoId }) })
        expect(res.status).toBe(200)
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })

    it('returns 410 when taco is expired', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        setTacoLifecycleStatus(testDbPath, tacoId, 'expired')
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/reviews`)
        const res = await getReviews(req, { params: Promise.resolve({ id: tacoId }) })
        expect(res.status).toBe(410)
        const body: ApiErrorBody = await res.json()
        expect(body.error.code).toBe('GONE')
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })

    it('returns 410 when taco is deleted', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        setTacoLifecycleStatus(testDbPath, tacoId, 'deleted')
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/reviews`)
        const res = await getReviews(req, { params: Promise.resolve({ id: tacoId }) })
        expect(res.status).toBe(410)
        const body: ApiErrorBody = await res.json()
        expect(body.error.code).toBe('GONE')
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })
  })

  describe('GET /v1/tacos/[id]/listeners', () => {
    it('returns 200 for open taco', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/listeners`)
        const res = await getListeners(req, { params: Promise.resolve({ id: tacoId }) })
        expect(res.status).toBe(200)
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })

    it('returns 410 when taco is expired', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        setTacoLifecycleStatus(testDbPath, tacoId, 'expired')
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/listeners`)
        const res = await getListeners(req, { params: Promise.resolve({ id: tacoId }) })
        expect(res.status).toBe(410)
        const body: ApiErrorBody = await res.json()
        expect(body.error.code).toBe('GONE')
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })

    it('returns 410 when taco is deleted', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        setTacoLifecycleStatus(testDbPath, tacoId, 'deleted')
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/listeners`)
        const res = await getListeners(req, { params: Promise.resolve({ id: tacoId }) })
        expect(res.status).toBe(410)
        const body: ApiErrorBody = await res.json()
        expect(body.error.code).toBe('GONE')
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })
  })

  describe('GET /v1/tacos/[id]/events', () => {
    it('returns 200 for open taco', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/events`)
        const res = await getEvents(req, { params: Promise.resolve({ id: tacoId }) })
        expect(res.status).toBe(200)
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })

    it('returns 410 when taco is expired', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        setTacoLifecycleStatus(testDbPath, tacoId, 'expired')
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/events`)
        const res = await getEvents(req, { params: Promise.resolve({ id: tacoId }) })
        expect(res.status).toBe(410)
        const body: ApiErrorBody = await res.json()
        expect(body.error.code).toBe('GONE')
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })
  })

  describe('GET /v1/tacos/[id]/csrf', () => {
    it('returns 200 for open taco', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/csrf`)
        const res = await getCsrf(req, { params: Promise.resolve({ id: tacoId }) })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(typeof body.csrfToken).toBe('string')
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })

    it('returns 410 when taco is expired and does not mint a token', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        setTacoLifecycleStatus(testDbPath, tacoId, 'expired')
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/csrf`)
        const res = await getCsrf(req, { params: Promise.resolve({ id: tacoId }) })
        expect(res.status).toBe(410)
        const body: ApiErrorBody = await res.json()
        expect(body.error.code).toBe('GONE')
        expect(res.headers.get('X-Taco-CSRF')).toBeNull()
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })

    it('returns 410 when taco is deleted', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        setTacoLifecycleStatus(testDbPath, tacoId, 'deleted')
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/csrf`)
        const res = await getCsrf(req, { params: Promise.resolve({ id: tacoId }) })
        expect(res.status).toBe(410)
        const body: ApiErrorBody = await res.json()
        expect(body.error.code).toBe('GONE')
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })

    it('returns 404 when taco is missing', async () => {
      const { testDbPath } = await setupTestDb()
      try {
        const missingId = randomUUID()
        const req = new NextRequest(`http://localhost:32167/v1/tacos/${missingId}/csrf`)
        const res = await getCsrf(req, { params: Promise.resolve({ id: missingId }) })
        expect(res.status).toBe(404)
      } finally {
        currentDb = null
        try { unlinkSync(testDbPath) } catch {}
      }
    })
  })

  describe('GET /api/storage/[key] (Legacy Pastes Storage Gate)', () => {
    it('returns 410 when legacy paste taco is expired in DB', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        setTacoLifecycleStatus(testDbPath, tacoId, 'expired')
        storageMockObjects.set(`pastes/${tacoId}.json`, new Uint8Array([1, 2, 3]))

        const req = new NextRequest(`http://localhost:32167/api/storage/pastes%2F${tacoId}.json`)
        const res = await getStorage(req, { params: Promise.resolve({ key: `pastes%2F${tacoId}.json` }) })
        expect(res.status).toBe(410)
        const body: ApiErrorBody = await res.json()
        expect(body.error.code).toBe('GONE')
      } finally {
        currentDb = null
        storageMockObjects.clear()
        try { unlinkSync(testDbPath) } catch {}
      }
    })

    it('returns 410 when legacy paste taco is deleted in DB', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        setTacoLifecycleStatus(testDbPath, tacoId, 'deleted')
        storageMockObjects.set(`pastes/${tacoId}.json`, new Uint8Array([1, 2, 3]))

        const req = new NextRequest(`http://localhost:32167/api/storage/pastes%2F${tacoId}.json`)
        const res = await getStorage(req, { params: Promise.resolve({ key: `pastes%2F${tacoId}.json` }) })
        expect(res.status).toBe(410)
        const body: ApiErrorBody = await res.json()
        expect(body.error.code).toBe('GONE')
      } finally {
        currentDb = null
        storageMockObjects.clear()
        try { unlinkSync(testDbPath) } catch {}
      }
    })

    it('fails closed (503 SERVICE_UNAVAILABLE) when DB is unavailable', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        dbUnavailable = true
        storageMockObjects.set(`pastes/${tacoId}.json`, new Uint8Array([1, 2, 3]))

        const req = new NextRequest(`http://localhost:32167/api/storage/pastes%2F${tacoId}.json`)
        const res = await getStorage(req, { params: Promise.resolve({ key: `pastes%2F${tacoId}.json` }) })
        expect(res.status).toBe(503)
        const body: ApiErrorBody = await res.json()
        expect(body.error.code).toBe('SERVICE_UNAVAILABLE')
      } finally {
        dbUnavailable = false
        currentDb = null
        storageMockObjects.clear()
        try { unlinkSync(testDbPath) } catch {}
      }
    })

    it('preserves valid legacy baseline-only read when taco is not in DB', async () => {
      const { testDbPath } = await setupTestDb()
      try {
        const legacyOnlyId = randomUUID()
        const fakePasteBytes = new TextEncoder().encode(JSON.stringify({ legacy: true }))
        storageMockObjects.set(`pastes/${legacyOnlyId}.json`, fakePasteBytes)

        const req = new NextRequest(`http://localhost:32167/api/storage/pastes%2F${legacyOnlyId}.json`)
        const res = await getStorage(req, { params: Promise.resolve({ key: `pastes%2F${legacyOnlyId}.json` }) })
        expect(res.status).toBe(200)
        const receivedBytes = new Uint8Array(await res.arrayBuffer())
        expect(Array.from(receivedBytes)).toEqual(Array.from(fakePasteBytes))
      } finally {
        currentDb = null
        storageMockObjects.clear()
        try { unlinkSync(testDbPath) } catch {}
      }
    })

    it('allows read when taco in DB is open', async () => {
      const { testDbPath, tacoId } = await setupTestDb()
      try {
        const pasteBytes = new TextEncoder().encode(JSON.stringify({ open: true }))
        storageMockObjects.set(`pastes/${tacoId}.json`, pasteBytes)

        const req = new NextRequest(`http://localhost:32167/api/storage/pastes%2F${tacoId}.json`)
        const res = await getStorage(req, { params: Promise.resolve({ key: `pastes%2F${tacoId}.json` }) })
        expect(res.status).toBe(200)
        const receivedBytes = new Uint8Array(await res.arrayBuffer())
        expect(Array.from(receivedBytes)).toEqual(Array.from(pasteBytes))
      } finally {
        currentDb = null
        storageMockObjects.clear()
        try { unlinkSync(testDbPath) } catch {}
      }
    })
  })
})
