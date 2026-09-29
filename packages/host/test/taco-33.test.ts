import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AutoSavePatch, DocumentSnapshot } from '@taco/protocol'
import { generateCsrfNonce, generateCsrfToken, verifyCsrfToken } from '../src/lib/csrf'
import {
  computeCheckpointChanges,
  computeFileDiffs,
  ConflictError,
  DatabaseNotConfiguredError,
  getDatabase,
  GoneError,
  NotFoundError,
  PayloadTooLargeError,
  SqliteDbAdapter,
  ValidationError,
} from '../src/lib/db'

describe('TACO-33 Host Backend Persistence & Logic', () => {
  const sampleSnapshot: DocumentSnapshot = {
    format: 'taco/files',
    version: 1,
    docId: 'doc_test',
    title: 'TACO-33 Test Doc',
    root: 'specs/sample',
    files: [
      {
        id: 'file_spec',
        path: 'specs/sample/spec.md',
        mediaType: 'text/markdown',
        content: '# Original Spec\n\nLine 1\nLine 2\n',
      },
      {
        id: 'file_data',
        path: 'specs/sample/data.json',
        mediaType: 'application/json',
        content: '{"foo": "bar"}\n',
      },
    ],
    checkpoints: {
      version: 1,
      nodes: [
        {
          id: 'node_1',
          title: 'Review Step',
          after: [],
          documents: [{ path: 'specs/sample/spec.md' }],
        },
      ],
      documents: [
        {
          path: 'specs/sample/spec.md',
          status: 'todo',
          updatedAt: '2026-09-29T10:00:00.000Z',
        },
      ],
    },
  }

  it('enforces fail-closed when no database is configured', () => {
    const oldUrl = process.env.DATABASE_URL
    const oldPath = process.env.TACO_DB_PATH
    delete process.env.DATABASE_URL
    delete process.env.TACO_DB_PATH

    expect(() => getDatabase()).toThrowError(DatabaseNotConfiguredError)

    process.env.DATABASE_URL = oldUrl
    process.env.TACO_DB_PATH = oldPath
  })

  it('generates and verifies cryptographic HMAC CSRF tokens', () => {
    const tacoId = randomUUID()
    const nonce = generateCsrfNonce()
    const token = generateCsrfToken(tacoId, nonce)

    expect(verifyCsrfToken(tacoId, token, nonce)).toBe(true)
    expect(verifyCsrfToken(tacoId, token, 'wrong-nonce')).toBe(false)
    expect(verifyCsrfToken(randomUUID(), token, nonce)).toBe(false)
    expect(verifyCsrfToken(tacoId, 'invalid.token')).toBe(false)
  })

  it('publishes immutable baseline, persists shared state, and rejects re-publish', async () => {
    const testDbPath = `/tmp/taco-test-${randomUUID()}.db`
    const db = new SqliteDbAdapter(testDbPath)
    const tacoId = randomUUID()

    const pub = await db.publishTaco(tacoId, 'My Taco', sampleSnapshot)
    expect(pub.tacoId).toBe(tacoId)
    expect(pub.stateVersion).toBe('1')

    // Second publish must fail with ConflictError
    await expect(db.publishTaco(tacoId, 'My Taco 2', sampleSnapshot)).rejects.toThrowError(ConflictError)

    // Shared state is accessible
    const shared = await db.getSharedState(tacoId)
    expect(shared).not.toBeNull()
    expect(shared!.stateVersion).toBe('1')
    expect(shared!.commentsThroughSequence).toBe('0')
    expect(shared!.snapshot.title).toBe('TACO-33 Test Doc')

    try {
      unlinkSync(testDbPath)
    } catch {}
  })

  it('handles CAS concurrency conflict (409) and incremental autosave', async () => {
    const testDbPath = `/tmp/taco-test-${randomUUID()}.db`
    const db = new SqliteDbAdapter(testDbPath)
    const tacoId = randomUUID()

    await db.publishTaco(tacoId, 'Test', sampleSnapshot)

    // Conflict on wrong expectedStateVersion
    const badPatch: AutoSavePatch = {
      protocol: 'taco-state/1',
      expectedStateVersion: '99',
      author: 'Alice',
      fileChanges: [
        {
          path: 'specs/sample/spec.md',
          changeType: 'modified',
          mediaType: 'text/markdown',
          content: '# Updated Spec\n',
        },
      ],
    }
    await expect(db.autosaveSharedState(tacoId, badPatch, randomUUID())).rejects.toThrowError(ConflictError)

    // Success with matching version
    const goodPatch: AutoSavePatch = {
      protocol: 'taco-state/1',
      expectedStateVersion: '1',
      author: 'Alice',
      fileChanges: [
        {
          path: 'specs/sample/spec.md',
          changeType: 'modified',
          mediaType: 'text/markdown',
          content: '# Updated Spec\n\nLine 1\nLine 2 edited\n',
        },
      ],
    }
    const key = randomUUID()
    const res = await db.autosaveSharedState(tacoId, goodPatch, key)
    expect(res.stateVersion).toBe('2')
    expect(res.historyWindowId).toBeDefined()

    // Idempotency replay with same key
    const replay = await db.autosaveSharedState(tacoId, goodPatch, key)
    expect(replay.stateVersion).toBe('2')
    expect(replay.historyWindowId).toBe(res.historyWindowId)

    // Next version is now 2
    const shared = await db.getSharedState(tacoId)
    expect(shared!.stateVersion).toBe('2')
    expect(shared!.snapshot.files[0].content).toBe('# Updated Spec\n\nLine 1\nLine 2 edited\n')

    try {
      unlinkSync(testDbPath)
    } catch {}
  })

  it('manages 10-minute history windows', async () => {
    const testDbPath = `/tmp/taco-test-${randomUUID()}.db`
    const db = new SqliteDbAdapter(testDbPath)
    const tacoId = randomUUID()

    await db.publishTaco(tacoId, 'Test', sampleSnapshot)

    await db.autosaveSharedState(
      tacoId,
      {
        protocol: 'taco-state/1',
        expectedStateVersion: '1',
        author: 'Bob',
        fileChanges: [{ path: 'specs/sample/spec.md', changeType: 'modified', content: 'v2' }],
      },
      randomUUID(),
    )

    const list = await db.listHistory(tacoId)
    expect(list.length).toBe(1)
    expect(list[0].latestStateVersion).toBe('2')

    const detail = await db.getHistoryVersion(tacoId, list[0].id)
    expect(detail).not.toBeNull()
    expect(detail!.snapshot.files[0].content).toBe('v2')

    try {
      unlinkSync(testDbPath)
    } catch {}
  })

  it('records persistent comments with actions and message tombstones', async () => {
    const testDbPath = `/tmp/taco-test-${randomUUID()}.db`
    const db = new SqliteDbAdapter(testDbPath)
    const tacoId = randomUUID()

    await db.publishTaco(tacoId, 'Test', sampleSnapshot)

    // 1. Create thread
    const c1Key = randomUUID()
    const c1 = await db.mutateReviewThread(
      tacoId,
      {
        author: 'Charlie',
        action: 'create',
        body: 'Initial comment',
        anchor: null,
      },
      c1Key,
    )
    expect(c1.status).toBe(201)
    expect(c1.changed).toBe(true)
    const threadId = (c1.event.data as { threadId: string }).threadId
    const msgId = (c1.event.data as { messageId: string }).messageId

    // Idempotent replay: changed must be false and no new side effects
    const c1Replay = await db.mutateReviewThread(
      tacoId,
      {
        author: 'Charlie',
        action: 'create',
        body: 'Initial comment',
        anchor: null,
      },
      c1Key,
    )
    expect(c1Replay.status).toBe(201)
    expect(c1Replay.changed).toBe(false)
    expect(c1Replay.event.id).toBe(c1.event.id)

    // Reusing same key for autosave must fail with ConflictError (409)
    await expect(
      db.autosaveSharedState(
        tacoId,
        {
          protocol: 'taco-state/1',
          expectedStateVersion: '1',
          author: 'Charlie',
          fileChanges: [{ path: 'spec.md', changeType: 'modified', content: 'test' }],
        },
        c1Key,
      ),
    ).rejects.toThrowError(ConflictError)
    // 2. Reply to thread
    const c2 = await db.mutateReviewThread(
      tacoId,
      {
        author: 'Dave',
        action: 'reply',
        threadId,
        body: 'Reply message',
      },
      randomUUID(),
    )
    expect(c2.status).toBe(200)

    // 3. Resolve thread
    await db.mutateReviewThread(
      tacoId,
      {
        author: 'Dave',
        action: 'resolve',
        threadId,
      },
      randomUUID(),
    )

    // 4. Reopen thread
    await db.mutateReviewThread(
      tacoId,
      {
        author: 'Charlie',
        action: 'reopen',
        threadId,
      },
      randomUUID(),
    )

    // 5. Delete first message
    await db.mutateReviewThread(
      tacoId,
      {
        author: 'Charlie',
        action: 'delete',
        threadId,
        messageId: msgId,
      },
      randomUUID(),
    )

    const threads = await db.getReviewThreads(tacoId)
    expect(threads.length).toBe(1)
    expect(threads[0].status).toBe('open')
    // Tombstone message must not be duplicated by delete action join
    expect(threads[0].messages.length).toBe(2)
    // First message body is null (tombstone)
    expect(threads[0].messages[0].body).toBeNull()
    expect(threads[0].messages[0].deletedAt).not.toBeNull()
    expect(threads[0].messages[1].body).toBe('Reply message')
    // Actions history includes create, reply, resolve, reopen, delete
    expect(threads[0].actions.length).toBe(5)
    expect(threads[0].actions.map((a) => a.type)).toEqual(['create', 'reply', 'resolve', 'reopen', 'delete'])

    try {
      unlinkSync(testDbPath)
    } catch {}
  })

  it('performs handoff with full diff, incremental diff, checkpoint changes, and unchanged no-op', async () => {
    const testDbPath = `/tmp/taco-test-${randomUUID()}.db`
    const db = new SqliteDbAdapter(testDbPath)
    const tacoId = randomUUID()

    await db.publishTaco(tacoId, 'Test', sampleSnapshot)

    // Modify file and checkpoint
    const updatedCheckpoints = {
      ...sampleSnapshot.checkpoints!,
      documents: [
        {
          path: 'specs/sample/spec.md',
          status: 'complete' as const,
          updatedAt: '2026-09-29T10:05:00.000Z',
        },
      ],
    }

    await db.autosaveSharedState(
      tacoId,
      {
        protocol: 'taco-state/1',
        expectedStateVersion: '1',
        author: 'Alice',
        fileChanges: [
          {
            path: 'specs/sample/spec.md',
            changeType: 'modified',
            content: '# Updated Spec\n\nLine 1 modified\nLine 2\n',
          },
        ],
        checkpoints: updatedCheckpoints,
      },
      randomUUID(),
    )

    // First handoff
    const h1 = await db.commitHandoff(
      tacoId,
      {
        author: 'Reviewer Alice',
        expectedStateVersion: '2',
        expectedCommentsThroughSequence: '0',
      },
      randomUUID(),
    )

    expect(h1.changed).toBe(true)
    expect(h1.handoffId).toBeDefined()
    expect(h1.event?.type).toBe('review.handed_off')
    expect(h1.event?.actor).toBe('Reviewer Alice')

    // Read handoff
    const record = await db.getHandoff(tacoId, h1.handoffId!)
    expect(record).not.toBeNull()
    expect(record!.payload.changedFiles.length).toBe(1)
    expect(record!.payload.changedFiles[0].path).toBe('spec.md') // Root-relative per RelativeFilePath contract!
    expect(record!.payload.changedFiles[0].diff).toContain('-# Original Spec')
    expect(record!.payload.changedFiles[0].diff).toContain('+# Updated Spec')
    expect(record!.payload.checkpointChanges).toEqual([{ path: 'specs/sample/spec.md', from: 'todo', to: 'complete' }])

    const firstPage = await db.getEventsPage(tacoId, 0n, 2n, 1)
    expect(firstPage.map((event) => event.type)).toEqual(['revision.published'])
    const handoffPage = await db.getEventsPage(tacoId, 1n, 2n, 1)
    expect(handoffPage.map((event) => event.type)).toEqual(['review.handed_off'])
    expect(handoffPage[0].data).toMatchObject({ handoffId: h1.handoffId })

    // Immediate second handoff with no edits: must return changed: false and no event
    const h2 = await db.commitHandoff(
      tacoId,
      {
        author: 'Reviewer Alice',
        expectedStateVersion: '2',
        expectedCommentsThroughSequence: '0',
      },
      randomUUID(),
    )
    expect(h2.changed).toBe(false)
    expect(h2.handoffId).toBeNull()
    expect(h2.event).toBeNull()

    try {
      unlinkSync(testDbPath)
    } catch {}
  })

  it('manages listener leases and filtering expired listeners', async () => {
    const testDbPath = `/tmp/taco-test-${randomUUID()}.db`
    const db = new SqliteDbAdapter(testDbPath)
    const tacoId = randomUUID()

    await db.publishTaco(tacoId, 'Test', sampleSnapshot)

    const activeId = randomUUID()
    const now = new Date()
    await db.upsertListenerLease(tacoId, {
      listenerId: activeId,
      name: 'Agent Listener',
      harness: 'codex',
      model: 'gpt',
      modelId: 'gpt-5',
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60000).toISOString(),
    })

    const expiredId = randomUUID()
    await db.upsertListenerLease(tacoId, {
      listenerId: expiredId,
      name: 'Old Listener',
      lastSeenAt: new Date(now.getTime() - 100000).toISOString(),
      expiresAt: new Date(now.getTime() - 10000).toISOString(),
    })

    const listeners = await db.listListeners(tacoId)
    expect(listeners.length).toBe(1)
    expect(listeners[0].listenerId).toBe(activeId)
    expect(listeners[0].harness).toBe('codex')

    try {
      unlinkSync(testDbPath)
    } catch {}
  })

  it('ensures global event ID uniqueness across multiple tacos without PK collision', async () => {
    const testDbPath = `/tmp/taco-test-${randomUUID()}.db`
    const db = new SqliteDbAdapter(testDbPath)
    const tacoId1 = randomUUID()
    const tacoId2 = randomUUID()

    // Both tacos publish initial revision
    await db.publishTaco(tacoId1, 'Taco 1', sampleSnapshot)
    await db.publishTaco(tacoId2, 'Taco 2', sampleSnapshot)

    // Both tacos record event sequence 2
    const c1 = await db.mutateReviewThread(
      tacoId1,
      { author: 'User1', action: 'create', body: 'Comment on taco 1', anchor: null },
      randomUUID(),
    )
    const c2 = await db.mutateReviewThread(
      tacoId2,
      { author: 'User2', action: 'create', body: 'Comment on taco 2', anchor: null },
      randomUUID(),
    )

    expect(c1.event.id).toBe(`ev_${tacoId1}_2`)
    expect(c2.event.id).toBe(`ev_${tacoId2}_2`)
    expect(c1.event.id).not.toBe(c2.event.id)

    try {
      unlinkSync(testDbPath)
    } catch {}
  })

  it('enforces rename and add boundary invariants in autosave', async () => {
    const testDbPath = `/tmp/taco-test-${randomUUID()}.db`
    const db = new SqliteDbAdapter(testDbPath)
    const tacoId = randomUUID()

    await db.publishTaco(tacoId, 'Test', sampleSnapshot)

    // 1. Rename to existing destination path must fail
    const collPatch: AutoSavePatch = {
      protocol: 'taco-state/1',
      expectedStateVersion: '1',
      author: 'Alice',
      fileChanges: [
        {
          id: 'file_spec',
          previousPath: 'specs/sample/spec.md',
          path: 'specs/sample/data.json', // Already exists!
          changeType: 'renamed',
          content: 'collision test',
        },
      ],
    }
    await expect(db.autosaveSharedState(tacoId, collPatch, randomUUID())).rejects.toThrowError(
      'Rename target path already exists',
    )

    // 2. Rename with mismatched file ID must fail
    const idMismatchPatch: AutoSavePatch = {
      protocol: 'taco-state/1',
      expectedStateVersion: '1',
      author: 'Alice',
      fileChanges: [
        {
          id: 'wrong_id',
          previousPath: 'specs/sample/spec.md',
          path: 'specs/sample/spec_renamed.md',
          changeType: 'renamed',
          content: 'renamed text',
        },
      ],
    }
    await expect(db.autosaveSharedState(tacoId, idMismatchPatch, randomUUID())).rejects.toThrowError(
      'file id mismatch',
    )

    // 3. Rename with unsafe previousPath must fail
    const unsafePatch: AutoSavePatch = {
      protocol: 'taco-state/1',
      expectedStateVersion: '1',
      author: 'Alice',
      fileChanges: [
        {
          id: 'file_spec',
          previousPath: '../unsafe/escape.md',
          path: 'specs/sample/spec_renamed.md',
          changeType: 'renamed',
          content: 'renamed text',
        },
      ],
    }
    await expect(db.autosaveSharedState(tacoId, unsafePatch, randomUUID())).rejects.toThrowError('Unsafe previousPath')

    // 4. Adding already existing file must fail
    const addExistingPatch: AutoSavePatch = {
      protocol: 'taco-state/1',
      expectedStateVersion: '1',
      author: 'Alice',
      fileChanges: [
        {
          path: 'specs/sample/spec.md', // Already exists!
          changeType: 'added',
          content: 'duplicate add',
        },
      ],
    }
    await expect(db.autosaveSharedState(tacoId, addExistingPatch, randomUUID())).rejects.toThrowError(
      'Added file already exists',
    )

    try {
      unlinkSync(testDbPath)
    } catch {}
  })
  it('reconstructs previous handoff with rooted paths and deletion tombstones without duplicating files or losing IDs', async () => {
    const testDbPath = `/tmp/taco-test-${randomUUID()}.db`
    const db = new SqliteDbAdapter(testDbPath)
    const tacoId = randomUUID()

    await db.publishTaco(tacoId, 'Rooted Handoff Test', sampleSnapshot)

    // Autosave 1: modify specs/sample/spec.md (root-relative path in diff is spec.md)
    await db.autosaveSharedState(
      tacoId,
      {
        protocol: 'taco-state/1',
        expectedStateVersion: '1',
        author: 'Alice',
        fileChanges: [
          {
            path: 'specs/sample/spec.md',
            changeType: 'modified',
            content: '# Spec v1\n',
          },
        ],
      },
      randomUUID(),
    )

    // First handoff
    const h1 = await db.commitHandoff(
      tacoId,
      {
        author: 'Reviewer Alice',
        expectedStateVersion: '2',
        expectedCommentsThroughSequence: '0',
      },
      randomUUID(),
    )
    expect(h1.changed).toBe(true)
    const record1 = await db.getHandoff(tacoId, h1.handoffId!)
    expect(record1).not.toBeNull()
    expect(record1!.payload.changedFiles.length).toBe(1)
    expect(record1!.payload.changedFiles[0].path).toBe('spec.md')
    expect(record1!.payload.incrementalFiles.length).toBe(1)
    expect(record1!.payload.incrementalFiles[0].path).toBe('spec.md')

    // Autosave 2:
    // - Modify specs/sample/spec.md again to v2
    // - Delete specs/sample/data.json
    // - Add specs/sample/extra.txt
    await db.autosaveSharedState(
      tacoId,
      {
        protocol: 'taco-state/1',
        expectedStateVersion: '2',
        author: 'Bob',
        fileChanges: [
          {
            id: 'file_spec',
            path: 'specs/sample/spec.md',
            changeType: 'modified',
            content: '# Spec v2\n',
          },
          {
            id: 'file_data',
            path: 'specs/sample/data.json',
            changeType: 'deleted',
          },
          {
            path: 'specs/sample/extra.txt',
            changeType: 'added',
            content: 'extra content\n',
          },
        ],
      },
      randomUUID(),
    )

    // Second handoff
    const h2 = await db.commitHandoff(
      tacoId,
      {
        author: 'Reviewer Bob',
        expectedStateVersion: '3',
        expectedCommentsThroughSequence: '0',
      },
      randomUUID(),
    )
    expect(h2.changed).toBe(true)
    const record2 = await db.getHandoff(tacoId, h2.handoffId!)
    expect(record2).not.toBeNull()

    // changedFiles is relative to baseline:
    const cfPaths = record2!.payload.changedFiles.map((f) => f.path).sort()
    expect(cfPaths).toEqual(['data.json', 'extra.txt', 'spec.md'])

    // incrementalFiles is relative to handoff 1:
    // spec.md diff must be against "# Spec v1\n", NOT "# Original Spec\n"!
    const incMap = new Map(record2!.payload.incrementalFiles.map((f) => [f.path, f]))
    expect(incMap.has('spec.md')).toBe(true)
    const incSpec = incMap.get('spec.md')!
    expect(incSpec.changeType).toBe('modified')
    expect(incSpec.id).toBe('file_spec') // Stable ID preserved!
    expect(incSpec.diff).toContain('-# Spec v1')
    expect(incSpec.diff).toContain('+# Spec v2')
    expect(incSpec.diff).not.toContain('Original Spec')

    // data.json was present in handoff 1, deleted in handoff 2:
    expect(incMap.has('data.json')).toBe(true)
    const incData = incMap.get('data.json')!
    expect(incData.changeType).toBe('deleted')
    expect(incData.id).toBe('file_data')
    expect(incData.content).toBeNull()

    // extra.txt was added in handoff 2:
    expect(incMap.has('extra.txt')).toBe(true)
    const incExtra = incMap.get('extra.txt')!
    expect(incExtra.changeType).toBe('added')

    try {
      unlinkSync(testDbPath)
    } catch {}
  })

  it('enforces request hash binding on mutation receipts across autosave, review, and handoff', async () => {
    const testDbPath = `/tmp/taco-test-${randomUUID()}.db`
    const db = new SqliteDbAdapter(testDbPath)
    const tacoId = randomUUID()

    await db.publishTaco(tacoId, 'Idempotency Test', sampleSnapshot)

    const autosaveKey = randomUUID()
    const patch1: AutoSavePatch = {
      protocol: 'taco-state/1',
      expectedStateVersion: '1',
      author: 'Alice',
      fileChanges: [
        {
          path: 'specs/sample/spec.md',
          changeType: 'modified',
          content: 'Hello 1',
        },
      ],
    }

    // 1. First autosave succeeds
    const res1 = await db.autosaveSharedState(tacoId, patch1, autosaveKey)
    expect(res1.stateVersion).toBe('2')

    // 2. Replay with identical body succeeds and returns same result
    const res2 = await db.autosaveSharedState(tacoId, patch1, autosaveKey)
    expect(res2.stateVersion).toBe('2')

    // 3. Replay with different body and same key throws ConflictError (409)
    const patch2: AutoSavePatch = {
      protocol: 'taco-state/1',
      expectedStateVersion: '1',
      author: 'Alice',
      fileChanges: [
        {
          path: 'specs/sample/spec.md',
          changeType: 'modified',
          content: 'Hello Changed',
        },
      ],
    }
    await expect(db.autosaveSharedState(tacoId, patch2, autosaveKey)).rejects.toThrowError(ConflictError)

    // 4. Review thread mutation receipt binding
    const reviewKey = randomUUID()
    const rev1 = await db.mutateReviewThread(
      tacoId,
      {
        author: 'Charlie',
        action: 'create',
        threadId: 'th_test',
        body: 'Comment 1',
      },
      reviewKey,
    )
    expect(rev1.status).toBe(201)

    // Replay with different mutation throws ConflictError
    await expect(
      db.mutateReviewThread(
        tacoId,
        {
          author: 'Charlie',
          action: 'create',
          threadId: 'th_test',
          body: 'Comment DIFFERENT',
        },
        reviewKey,
      ),
    ).rejects.toThrowError(ConflictError)

    // 5. Handoff receipt binding
    const handoffKey = randomUUID()
    const h1 = await db.commitHandoff(
      tacoId,
      {
        author: 'Reviewer',
        expectedStateVersion: '2',
        expectedCommentsThroughSequence: '2',
      },
      handoffKey,
    )
    expect(h1.changed).toBe(true)

    // Replay handoff with different expected version throws ConflictError
    await expect(
      db.commitHandoff(
        tacoId,
        {
          author: 'Reviewer',
          expectedStateVersion: '99',
          expectedCommentsThroughSequence: '2',
        },
        handoffKey,
      ),
    ).rejects.toThrowError(ConflictError)

    try {
      unlinkSync(testDbPath)
    } catch {}
  })

  it('successfully autosaves newly added files with inline content and committed uploadId in SQLite', async () => {
    const testDbPath = `/tmp/taco-test-${randomUUID()}.db`
    const db = new SqliteDbAdapter(testDbPath)
    const tacoId = randomUUID()

    await db.publishTaco(tacoId, 'Add File Test', sampleSnapshot)

    // 1. Add file with inline content
    const addInlinePatch: AutoSavePatch = {
      protocol: 'taco-state/1',
      expectedStateVersion: '1',
      author: 'Alice',
      fileChanges: [
        {
          path: 'specs/sample/new_inline.txt',
          changeType: 'added',
          content: 'Hello inline addition\n',
        },
      ],
    }
    const res1 = await db.autosaveSharedState(tacoId, addInlinePatch, randomUUID())
    expect(res1.stateVersion).toBe('2')

    const state1 = await db.getSharedState(tacoId)
    expect(state1!.snapshot.files.some((f) => f.path === 'specs/sample/new_inline.txt')).toBe(true)

    // 2. Add file with uploadId
    const uploadText = 'Hello from committed upload'
    const uploadBytes = new TextEncoder().encode(uploadText)
    const uploadHash = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', uploadBytes))).map((b) => b.toString(16).padStart(2, '0')).join('')}`
    const reservation = await db.createUploadReservation(
      tacoId,
      {
        purpose: 'review-edit',
        payloadBytes: uploadBytes.byteLength,
        payloadHash: uploadHash,
      },
      randomUUID(),
    )
    await db.commitUploadContent(reservation.uploadId, uploadBytes)

    const addUploadPatch: AutoSavePatch = {
      protocol: 'taco-state/1',
      expectedStateVersion: '2',
      author: 'Alice',
      fileChanges: [
        {
          path: 'specs/sample/new_uploaded.txt',
          changeType: 'added',
          uploadId: reservation.uploadId,
        },
      ],
    }
    const res2 = await db.autosaveSharedState(tacoId, addUploadPatch, randomUUID())
    expect(res2.stateVersion).toBe('3')

    const state2 = await db.getSharedState(tacoId)
    const uploadedFile = state2!.snapshot.files.find((f) => f.path === 'specs/sample/new_uploaded.txt')
    expect(uploadedFile).toBeDefined()
    expect(uploadedFile!.content).toBe(uploadText)

    // Upload content should be cleared after autosave consumption
    const clearedContent = await db.getUploadContent(reservation.uploadId)
    expect(clearedContent).toBeNull()

    try {
      unlinkSync(testDbPath)
    } catch {}
  })

  it('enforces upload reservation quotas, taco existence check, and expiration cleanup', async () => {
    const testDbPath = `/tmp/taco-test-${randomUUID()}.db`
    const db = new SqliteDbAdapter(testDbPath)
    const tacoId = randomUUID()

    // 1. Non-existent Taco must throw NotFoundError
    await expect(
      db.createUploadReservation(
        randomUUID(),
        { purpose: 'review-edit', payloadBytes: 100, payloadHash: 'sha256:abcd' },
        randomUUID(),
      ),
    ).rejects.toThrowError(NotFoundError)

    await db.publishTaco(tacoId, 'Upload Quota Test', sampleSnapshot)

    // 2. Reservation exceeding cumulative 32 MiB throws PayloadTooLargeError
    await expect(
      db.createUploadReservation(
        tacoId,
        { purpose: 'review-edit', payloadBytes: 33554433, payloadHash: 'sha256:toolarge' },
        randomUUID(),
      ),
    ).rejects.toThrowError(PayloadTooLargeError)

    try {
      unlinkSync(testDbPath)
    } catch {}
  })
  it('serializes concurrent upload reservations and prevents parallel quota bypass via Promise.all', async () => {
    const testDbPath = `/tmp/taco-test-${randomUUID()}.db`
    const db = new SqliteDbAdapter(testDbPath)
    const tacoId = randomUUID()

    await db.publishTaco(tacoId, 'Concurrency Quota Test', sampleSnapshot)

    // Attempt 5 concurrent reservations of 10 MiB each (total 50 MiB, cap 32 MiB)
    // Under serialization, at most 3 can succeed (3 * 10 MiB = 30 MiB <= 32 MiB)
    // and the remaining 2 MUST be rejected with PayloadTooLargeError
    const TEN_MIB = 10 * 1024 * 1024
    const promises = Array.from({ length: 5 }, (_, i) =>
      db.createUploadReservation(
        tacoId,
        {
          purpose: 'review-edit',
          payloadBytes: TEN_MIB,
          payloadHash: `sha256:${'a'.repeat(63)}${i}`,
        },
        randomUUID(),
      ),
    )

    const results = await Promise.allSettled(promises)
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled.length).toBe(3)
    expect(rejected.length).toBe(2)
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(PayloadTooLargeError)
    }

    try {
      unlinkSync(testDbPath)
    } catch {}
  })
})
