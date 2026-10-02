import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { AutoSavePatch, DocumentSnapshot } from '@taco/protocol'
import { PostgresDbAdapter } from '../src/lib/db'

describe('PostgresDbAdapter Unit Fixtures & Regressions', () => {
  const sampleSnapshot: DocumentSnapshot = {
    format: 'taco/files',
    version: 1,
    docId: 'doc_pg_test',
    title: 'PG Test Doc',
    root: 'specs/sample',
    files: [
      {
        id: 'file_spec',
        path: 'specs/sample/spec.md',
        mediaType: 'text/markdown',
        content: '# Spec\n\nTarget content\n',
      },
    ],
  }

  it('verifies PG query fixtures: COMMIT before return in autosave, no JSON.parse on events actor/data, and transaction connection reuse', async () => {
    const executedQueries: { sql: string; params?: unknown[] }[] = []
    let connectCount = 0
    let currentStateVersion = '1'
    // Fake Pool & Client simulating pg
    const mockClient = {
      query: async (sql: string, params?: unknown[]) => {
        executedQueries.push({ sql, params })
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 1, rows: [] }
        }
        if (sql.includes('SELECT id, status FROM tacos WHERE id = $1 FOR UPDATE')) {
          return { rowCount: 1, rows: [{ id: params?.[0], status: 'open' }] }
        }
        if (sql.includes('SELECT id, last_sequence, status FROM tacos WHERE id = $1 FOR UPDATE')) {
          return { rowCount: 1, rows: [{ id: params?.[0], last_sequence: 1, status: 'open' }] }
        }
        if (sql.includes('SELECT action, response_body, status_code, request_hash FROM mutation_receipts')) {
          return { rowCount: 0, rows: [] }
        }
        if (sql.includes('UPDATE shared_states SET state_version = $1')) {
          currentStateVersion = String(params?.[0])
          return { rowCount: 1, rows: [] }
        }
        if (sql.includes('SELECT state_version, comments_through_sequence, snapshot_json FROM shared_states')) {
          return {
            rowCount: 1,
            rows: [
              {
                state_version: currentStateVersion,
                comments_through_sequence: '0',
                snapshot_json: JSON.stringify(sampleSnapshot),
              },
            ],
          }
        }
        if (sql.includes('SELECT title, root, snapshot_json FROM publish_baselines')) {
          return {
            rowCount: 1,
            rows: [
              {
                title: sampleSnapshot.title,
                root: sampleSnapshot.root,
                snapshot_json: JSON.stringify(sampleSnapshot),
              },
            ],
          }
        }
        if (sql.includes('SELECT id, started_at, closed_at FROM history_windows')) {
          return { rowCount: 0, rows: [] }
        }
        if (sql.includes('SELECT id, state_version, comments_through_sequence, payload_json FROM handoffs')) {
          return { rowCount: 0, rows: [] }
        }
        if (sql.includes('SELECT id, status, anchor, is_anchor_stale, created_at, updated_at FROM persistent_comment_threads')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'thread_1',
                status: 'open',
                anchor: JSON.stringify({
                  path: 'specs/sample/spec.md',
                  position: { start: 8, end: 22 },
                  quote: { exact: 'Target content', prefix: '# Spec\n\n', suffix: '\n' },
                }),
                is_anchor_stale: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          }
        }
        if (sql.includes('SELECT m.id, m.thread_id, m.author, m.body, m.created_at, m.deleted_at')) {
          return { rowCount: 0, rows: [] }
        }
        if (sql.includes('SELECT sequence, thread_id, type, author, occurred_at, message_id FROM comment_thread_actions')) {
          return { rowCount: 0, rows: [] }
        }
        if (sql.includes('SELECT status FROM tacos WHERE id = $1')) {
          return { rowCount: 1, rows: [{ status: 'open' }] }
        }
        if (sql.includes('SELECT id, taco_id, author, created_at, payload_json FROM handoffs WHERE id = $1 AND taco_id = $2')) {
          return { rowCount: 0, rows: [] }
        }
        return { rowCount: 1, rows: [] }
      },
      release: () => {},
    }

    const mockPool = {
      connect: async () => {
        connectCount++
        return mockClient
      },
      query: async (sql: string, params?: unknown[]) => {
        executedQueries.push({ sql, params })
        if (sql.includes('FROM events') && sql.includes('sequence > $2')) {
          const isStringActor = params?.[1] === 0n || params?.[1] === '0'
          return {
            rowCount: 1,
            rows: [
              {
                id: 'ev_1',
                sequence: '1',
                taco_id: 'taco_1',
                type: 'comment.created',
                occurred_at: new Date().toISOString(),
                // Native JSONB objects or strings returned by pg driver
                actor: isStringActor ? 'Alice' : { kind: 'user', id: 'alice' },
                data: { body: 'hello jsonb' },
              },
            ],
          }
        }
        return { rowCount: 0, rows: [] }
      },
    }

    const adapter = new PostgresDbAdapter('postgresql://fake:fake@localhost:5432/fake')
    // Inject mock pool and mark schema initialized
    const internalAdapter = adapter as unknown as Record<string, unknown>
    internalAdapter.pool = mockPool
    internalAdapter.schemaInitialized = true

    const tacoId = randomUUID()

    // 1. Verify autosave COMMIT before return
    const patch: AutoSavePatch = {
      protocol: 'taco-state/1',
      expectedStateVersion: '1',
      author: 'Alice',
      fileChanges: [
        {
          id: 'file_spec',
          path: 'specs/sample/spec.md',
          changeType: 'modified',
          mediaType: 'text/markdown',
          content: '# Spec\n\nModified content\n',
        },
      ],
    }

    const autosaveRes = await adapter.autosaveSharedState(tacoId, patch, randomUUID())
    expect(autosaveRes.stateVersion).toBe('2')

    // Find index of COMMIT and ensure it happened
    const commitIdx = executedQueries.findIndex((q) => q.sql === 'COMMIT')
    expect(commitIdx).toBeGreaterThan(0)

    // 2. Verify getEventsAfter does not do JSON.parse on actor / data
    const events = await adapter.getEventsAfter(tacoId, 0n)
    expect(events.length).toBe(1)
    expect(events[0].actor).toBe('Alice')
    expect(events[0].data).toEqual({ body: 'hello jsonb' })

    const eventsPage = await adapter.getEventsPage(tacoId, 1n, 10n, 10)
    expect(eventsPage.length).toBe(1)
    expect(eventsPage[0].actor).toEqual({ kind: 'user', id: 'alice' })
    expect(eventsPage[0].data).toEqual({ body: 'hello jsonb' })

    // 3. Verify commitHandoff reuses transaction client for getReviewThreads (connectCount does not increase during handoff)
    const connectCountBefore = connectCount
    const handoffRes = await adapter.commitHandoff(
      tacoId,
      { author: 'Alice', expectedStateVersion: '2', expectedCommentsThroughSequence: '0' },
      randomUUID(),
    )
    expect(handoffRes.changed).toBe(true)
    // Only 1 connect was needed for commitHandoff because getReviewThreads reused mockClient
    expect(connectCount - connectCountBefore).toBe(1)

    // 4. Verify getHandoff returns null when not found
    const handoff = await adapter.getHandoff(tacoId, randomUUID())
    expect(handoff).toBeNull()
  })
})
