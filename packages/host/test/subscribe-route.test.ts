import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { SqliteDbAdapter } from '../src/lib/db.ts'
import * as dbModule from '../src/lib/db.ts'
import { subscribeToTacoEvents } from '../src/lib/server-state.ts'
import { GET } from '../src/app/v1/tacos/[id]/subscribe/route.ts'

let currentDb: SqliteDbAdapter | null = null

vi.mock('../src/lib/db.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof dbModule>()
  return {
    ...actual,
    getDatabase: () => currentDb ?? actual.getDatabase(),
  }
})

describe('Subscribe Route Unicode Metadata and Lifecycle', () => {
  const sampleSnapshot = {
    format: 'taco/files',
    version: 1,
    docId: 'doc_sub_test',
    title: 'Subscribe Route Test',
    root: 'specs/sample',
    files: [
      {
        id: 'file_spec',
        path: 'specs/sample/spec.md',
        mediaType: 'text/markdown',
        content: '# Test Spec\n',
      },
    ],
  }

  const setupTestDb = async () => {
    const testDbPath = `/tmp/taco-sub-test-${randomUUID()}.db`
    const db = new SqliteDbAdapter(testDbPath)
    currentDb = db
    const tacoId = randomUUID()
    await db.publishTaco(tacoId, 'Subscribe Test', sampleSnapshot as unknown as Parameters<typeof db.publishTaco>[2])
    return { testDbPath, db, tacoId }
  }

  it('decodes encoded unicode headers (X-Taco-Listener-Name and X-Taco-Model-Id) and validates lengths', async () => {
    const { testDbPath, db, tacoId } = await setupTestDb()
    try {
      const chineseName = '评审智能体'
      const chineseModelId = '通义千问-2.5-max'

      const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/subscribe`, {
        headers: {
          'x-taco-listener-name': encodeURIComponent(chineseName),
          'x-taco-model-id': encodeURIComponent(chineseModelId),
          'x-taco-session': encodeURIComponent('中文会话测试'),
        },
      })

      const res = await GET(req, { params: Promise.resolve({ id: tacoId }) })
      expect(res.status).toBe(200)

      // Cancel response body stream to release lease/heartbeat/poll timers
      await res.body?.cancel('test cleanup')

      // Verify the lease recorded the decoded unicode string
      const listeners = await db.listListeners(tacoId)
      expect(listeners.length).toBe(1)
      expect(listeners[0].name).toBe(chineseName)
      expect(listeners[0].modelId).toBe(chineseModelId)
      expect(listeners[0].sessionTitle).toBe('中文会话测试')
    } finally {
      currentDb = null
      try {
        unlinkSync(testDbPath)
      } catch {}
    }
  })

  it('rejects malformed percent-encoding in X-Taco-Listener-Name and X-Taco-Model-Id with HTTP 400', async () => {
    const { testDbPath, tacoId } = await setupTestDb()
    try {
      // Malformed X-Taco-Listener-Name
      const reqBadName = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/subscribe`, {
        headers: {
          'x-taco-listener-name': '%E4%B8%ZZ', // invalid percent encoding
        },
      })
      const resBadName = await GET(reqBadName, { params: Promise.resolve({ id: tacoId }) })
      expect(resBadName.status).toBe(400)
      const errName = (await resBadName.json()) as { error: { message: string } }
      expect(errName.error.message).toContain('Invalid X-Taco-Listener-Name: malformed percent-encoding')

      // Malformed X-Taco-Model-Id
      const reqBadModelId = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/subscribe`, {
        headers: {
          'x-taco-model-id': '%',
        },
      })
      const resBadModelId = await GET(reqBadModelId, { params: Promise.resolve({ id: tacoId }) })
      expect(resBadModelId.status).toBe(400)
      const errModelId = (await resBadModelId.json()) as { error: { message: string } }
      expect(errModelId.error.message).toContain('Invalid X-Taco-Model-Id: malformed percent-encoding')
    } finally {
      currentDb = null
      try {
        unlinkSync(testDbPath)
      } catch {}
    }
  })

  it('validates decoded length boundaries (max 64 for listenerName, max 128 for modelId)', async () => {
    const { testDbPath, tacoId } = await setupTestDb()
    try {
      // Overlong decoded listenerName (> 64 chars)
      const overlongName = '中'.repeat(65)
      const reqOverlongName = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/subscribe`, {
        headers: {
          'x-taco-listener-name': encodeURIComponent(overlongName),
        },
      })
      const resOverlongName = await GET(reqOverlongName, { params: Promise.resolve({ id: tacoId }) })
      expect(resOverlongName.status).toBe(400)
      const errName = (await resOverlongName.json()) as { error: { message: string } }
      expect(errName.error.message).toContain('X-Taco-Listener-Name must be between 1 and 64 characters')

      // Overlong decoded modelId (> 128 chars)
      const overlongModelId = '模'.repeat(129)
      const reqOverlongModel = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/subscribe`, {
        headers: {
          'x-taco-model-id': encodeURIComponent(overlongModelId),
        },
      })
      const resOverlongModel = await GET(reqOverlongModel, { params: Promise.resolve({ id: tacoId }) })
      expect(resOverlongModel.status).toBe(400)
      const errModel = (await resOverlongModel.json()) as { error: { message: string } }
      expect(errModel.error.message).toContain('X-Taco-Model-Id must be between 1 and 128 characters')
    } finally {
      currentDb = null
      try {
        unlinkSync(testDbPath)
      } catch {}
    }
  })

  it('canceling stream during replay returns cleanly with zero resource leaks and stops timers', async () => {
    const { testDbPath, db, tacoId } = await setupTestDb()
    try {
      // Commit some events to replay
      await db.mutateReviewThread(
        tacoId,
        {
          author: 'Tester',
          action: 'create',
          body: 'First comment',
        },
        randomUUID(),
      )

      // Intercept getEventsAfter to hold the replay promise until after client cancel()
      const originalGetEventsAfter = db.getEventsAfter.bind(db)
      const replayStarted = Promise.withResolvers<void>()
      const releaseReplay = Promise.withResolvers<void>()

      db.getEventsAfter = async (id: string, after: bigint) => {
        replayStarted.resolve()
        await releaseReplay.promise
        return originalGetEventsAfter(id, after)
      }

      const req = new NextRequest(`http://localhost:32167/v1/tacos/${tacoId}/subscribe?after=0`)
      const res = await GET(req, { params: Promise.resolve({ id: tacoId }) })
      expect(res.status).toBe(200)

      const body = res.body
      expect(body).not.toBeNull()

      const reader = body!.getReader()
      // Read initial ready frame
      const first = await reader.read()
      expect(first.done).toBe(false)
      expect(new TextDecoder().decode(first.value)).toContain('"kind":"ready"')

      // Wait until replay is actively executing (holding the async db query)
      await replayStarted.promise

      // Spy on global timer creation to verify no timers remain active after cancel
      const activeIntervals = new Set<NodeJS.Timeout>()
      const origSetInterval = globalThis.setInterval
      const origClearInterval = globalThis.clearInterval
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
        const timer = origSetInterval(fn, ms, ...args)
        activeIntervals.add(timer)
        return timer
      }) as unknown as typeof setInterval)
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(((timer?: NodeJS.Timeout | string | number) => {
        if (timer) activeIntervals.delete(timer as NodeJS.Timeout)
        return origClearInterval(timer)
      }) as unknown as typeof clearInterval)

      // Spy on subscribeToTacoEvents from server-state to verify no live subscription is added or retained
      const globalForState = globalThis as unknown as {
        __tacoServerRuntimeState?: { subscribers: Map<string, Set<unknown>> }
      }
      const subsBeforeCancel =
        globalForState.__tacoServerRuntimeState?.subscribers.get(tacoId)?.size ?? 0

      // Cancel stream while replay is awaiting
      await reader.cancel('client abort during replay')

      // Release the held replay db query and allow start() async continuation to finish
      releaseReplay.resolve()

      // Ensure reader is closed
      const afterCancel = await reader.read()
      expect(afterCancel.done).toBe(true)

      // Yield event loop tick for the start() continuation after db query to complete
      await new Promise<void>((r) => setTimeout(r, 0))

      // Assert: no live subscription was added to runtimeState for this tacoId
      const subsAfterContinuation =
        globalForState.__tacoServerRuntimeState?.subscribers.get(tacoId)?.size ?? 0
      expect(subsAfterContinuation).toBe(subsBeforeCancel)

      // Assert: no live timers (poll/heartbeat/lease) remain active
      expect(activeIntervals.size).toBe(0)

      setIntervalSpy.mockRestore()
      clearIntervalSpy.mockRestore()
    } finally {
      vi.restoreAllMocks()
      currentDb = null
      try {
        unlinkSync(testDbPath)
      } catch {}
    }
  })
})
