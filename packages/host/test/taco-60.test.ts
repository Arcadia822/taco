import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeSnapshotContentHash,
  type AutoSavePatch,
  type DocumentSnapshot,
} from '@taco/protocol'
import { ConflictError, SqliteDbAdapter } from '../src/lib/db'

const baselineSnapshot: DocumentSnapshot = {
  format: 'taco/files',
  version: 1,
  docId: 'doc_taco_60',
  title: 'Initial Title',
  root: 'specs/sample',
  files: [
    {
      id: 'file_spec',
      path: 'specs/sample/spec.md',
      mediaType: 'text/markdown',
      content: '# Spec V1\n\nOriginal text\n',
    },
  ],
  checkpoints: {
    version: 1,
    nodes: [
      {
        id: 'node_1',
        title: 'Review Node',
        after: [],
        documents: [{ path: 'specs/sample/spec.md' }],
      },
    ],
    documents: [
      { path: 'specs/sample/spec.md', status: 'freeze', updatedAt: '2026-10-11T10:00:00.000Z' },
    ],
  },
}

const snapshotWith = (overrides: Partial<DocumentSnapshot> = {}): DocumentSnapshot => ({
  ...baselineSnapshot,
  ...overrides,
})

describe('TACO-60 Host revision invariants', () => {
  let tempDir: string
  let dbPath: string
  let adapter: SqliteDbAdapter

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'taco-60-test-'))
    dbPath = join(tempDir, 'taco-60.db')
    adapter = new SqliteDbAdapter(dbPath)
  })

  afterEach(() => {
    vi.useRealTimers()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('seeds the initial revisionId as tacoId and preserves docId, comments, and host checkpoint status across sequential updates', async () => {
    const tacoId = randomUUID()
    const published = await adapter.publishTaco(tacoId, baselineSnapshot.title, baselineSnapshot)
    expect(published.revisionId).toBe(tacoId)
    expect(published.stateVersion).toBe('1')

    await adapter.mutateReviewThread(
      tacoId,
      {
        author: 'Alice',
        action: 'create',
        body: 'Please reword the opening line.',
        anchor: {
          path: 'specs/sample/spec.md',
          position: { start: 0, end: 9 },
          quote: { exact: '# Spec V1', prefix: '', suffix: '' },
        },
      },
      randomUUID(),
    )

    const state0 = await adapter.getSharedState(tacoId)
    expect(state0?.revisionId).toBe(tacoId)
    expect(state0?.commentsThroughSequence).toBe('2')

    const firstUpdate = snapshotWith({
      title: 'Title Revision 1',
      files: [
        {
          id: 'file_spec',
          path: 'specs/sample/spec.md',
          mediaType: 'text/markdown',
          content: '# Spec V2\n\nUpdated text\n',
        },
      ],
      checkpoints: {
        ...baselineSnapshot.checkpoints!,
        documents: [
          {
            path: 'specs/sample/spec.md',
            status: 'complete',
            updatedAt: '2026-10-11T11:00:00.000Z',
          },
        ],
      },
    })

    const rev1 = await adapter.createRevision(
      tacoId,
      {
        baseRevisionId: tacoId,
        expectedStateVersion: state0!.stateVersion,
        expectedCommentsThroughSequence: state0!.commentsThroughSequence,
        snapshot: firstUpdate,
      },
      randomUUID(),
    )
    expect(rev1.baseRevisionId).toBe(tacoId)
    expect(rev1.revisionId).not.toBe(tacoId)
    expect(rev1.stateVersion).toBe('2')

    const state1 = await adapter.getSharedState(tacoId)
    expect(state1?.revisionId).toBe(rev1.revisionId)
    expect(state1?.snapshot.docId).toBe('doc_taco_60')
    expect(state1?.snapshot.checkpoints?.documents[0].status).toBe('freeze')

    const threads = await adapter.getReviewThreads(tacoId)
    expect(threads).toHaveLength(1)
    expect(threads[0].messages[0].body).toBe('Please reword the opening line.')

    await expect(
      adapter.createRevision(
        tacoId,
        {
          baseRevisionId: tacoId,
          expectedStateVersion: state1!.stateVersion,
          expectedCommentsThroughSequence: state1!.commentsThroughSequence,
          snapshot: firstUpdate,
        },
        randomUUID(),
      ),
    ).rejects.toThrowError(ConflictError)
    expect((await adapter.getSharedState(tacoId))!.revisionId).toBe(rev1.revisionId)

    const rev2 = await adapter.createRevision(
      tacoId,
      {
        baseRevisionId: rev1.revisionId.toUpperCase(),
        expectedStateVersion: state1!.stateVersion,
        expectedCommentsThroughSequence: state1!.commentsThroughSequence,
        snapshot: snapshotWith({
          title: 'Title Revision 2',
          files: [
            {
              id: 'file_spec',
              path: 'specs/sample/spec.md',
              mediaType: 'text/markdown',
              content: '# Spec V3\n\nSecond revision text\n',
            },
          ],
        }),
      },
      randomUUID(),
    )
    expect(rev2.baseRevisionId).toBe(rev1.revisionId)
    expect(rev2.revisionId).not.toBe(rev1.revisionId)
    expect(rev2.stateVersion).toBe('3')

    const state2 = await adapter.getSharedState(tacoId)
    expect(state2?.revisionId).toBe(rev2.revisionId)
    expect(state2?.snapshot.title).toBe('Title Revision 2')
    expect(await adapter.getReviewThreads(tacoId)).toHaveLength(1)
  })

  it('rejects a revision carrying unacknowledged human autosave content, then accepts it once a handoff acknowledges it at the same timestamp', async () => {
    const tacoId = randomUUID()
    await adapter.publishTaco(tacoId, baselineSnapshot.title, baselineSnapshot)

    const autosave: AutoSavePatch = {
      protocol: 'taco-state/1',
      expectedStateVersion: '1',
      author: 'Bob',
      fileChanges: [
        {
          id: 'file_spec',
          path: 'specs/sample/spec.md',
          changeType: 'modified',
          content: '# Spec V1\n\nEdited directly in the browser by Bob\n',
        },
      ],
    }
    const autosaved = await adapter.autosaveSharedState(tacoId, autosave, randomUUID())
    expect(autosaved.stateVersion).toBe('2')

    const stateAfterBob = await adapter.getSharedState(tacoId)
    expect(stateAfterBob?.snapshot.files[0].content).toBe(
      '# Spec V1\n\nEdited directly in the browser by Bob\n',
    )

    const incoming = snapshotWith({
      title: 'Spec by author',
      files: [
        {
          id: 'file_spec',
          path: 'specs/sample/spec.md',
          mediaType: 'text/markdown',
          content: '# Spec V2\n\nAuthor rewrite\n',
        },
      ],
    })

    await expect(
      adapter.createRevision(
        tacoId,
        {
          baseRevisionId: tacoId,
          expectedStateVersion: '2',
          expectedCommentsThroughSequence: '0',
          snapshot: incoming,
        },
        randomUUID(),
      ),
    ).rejects.toThrowError(ConflictError)

    const fixedTime = new Date('2026-10-11T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(fixedTime)

    const handoff = await adapter.commitHandoff(
      tacoId,
      { author: 'Alice', expectedStateVersion: '2', expectedCommentsThroughSequence: '0' },
      randomUUID(),
    )
    expect(handoff.changed).toBe(true)
    expect(handoff.event?.occurredAt).toBe(fixedTime.toISOString())

    const state = await adapter.getSharedState(tacoId)
    const rev = await adapter.createRevision(
      tacoId,
      {
        baseRevisionId: tacoId,
        expectedStateVersion: state!.stateVersion,
        expectedCommentsThroughSequence: state!.commentsThroughSequence,
        snapshot: incoming,
      },
      randomUUID(),
    )
    // Identical handoff and revision timestamps must not be mistaken for new unacknowledged edits
    expect(rev.createdAt).toBe(handoff.event!.occurredAt)
    expect(rev.baseRevisionId).toBe(tacoId)
    expect((await adapter.getSharedState(tacoId))!.snapshot.files[0].content).toBe(
      '# Spec V2\n\nAuthor rewrite\n',
    )
  })

  it('replays an identical revision idempotently and hashes the stored snapshot with protocol JCS', async () => {
    const tacoId = randomUUID()
    const noCheckpointsSnapshot: DocumentSnapshot = {
      format: 'taco/files',
      version: 1,
      docId: 'doc_taco_60',
      title: 'Spec Without Checkpoints',
      root: 'specs/sample',
      files: [
        {
          id: 'file_spec',
          path: 'specs/sample/spec.md',
          mediaType: 'text/markdown',
          content: '# Pure spec\n',
        },
      ],
    }
    await adapter.publishTaco(tacoId, noCheckpointsSnapshot.title, noCheckpointsSnapshot)

    const idempotencyKey = randomUUID()
    const payload = {
      baseRevisionId: tacoId,
      expectedStateVersion: '1',
      expectedCommentsThroughSequence: '0',
      snapshot: {
        ...noCheckpointsSnapshot,
        title: 'Spec Without Checkpoints Revision 2',
        files: [
          {
            id: 'file_spec',
            path: 'specs/sample/spec.md',
            mediaType: 'text/markdown',
            content: '# Pure spec V2\n',
          },
        ],
      },
    }
    const first = await adapter.createRevision(tacoId, payload, idempotencyKey)
    expect(first.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(first.stateVersion).toBe('2')

    const replay = await adapter.createRevision(tacoId, payload, idempotencyKey)
    expect(replay).toEqual(first)

    await expect(
      adapter.createRevision(tacoId, { ...payload, expectedStateVersion: '99' }, idempotencyKey),
    ).rejects.toThrowError(ConflictError)
    expect((await adapter.getSharedState(tacoId))!.revisionId).toBe(first.revisionId)

    const stored = (await adapter.getSharedState(tacoId))!.snapshot
    expect(await computeSnapshotContentHash(stored)).toBe(first.contentHash)
    expect(stored.checkpoints).toBeUndefined()
  })

  it('backfills the initial published revision when migrating a pre-TACO-60 SQLite database', async () => {
    const legacyDbPath = join(tempDir, 'legacy.db')
    const tacoId = randomUUID()
    const now = new Date().toISOString()

    // Pre-TACO-60 layout: tacos without current_revision_id, no published_revisions table
    const legacy = new DatabaseSync(legacyDbPath)
    legacy.exec(`
      CREATE TABLE tacos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        last_sequence INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE publish_baselines (
        taco_id TEXT PRIMARY KEY REFERENCES tacos(id),
        title TEXT NOT NULL,
        root TEXT NOT NULL,
        snapshot_ref TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE shared_states (
        taco_id TEXT PRIMARY KEY REFERENCES tacos(id),
        state_version TEXT NOT NULL DEFAULT '1',
        comments_through_sequence TEXT NOT NULL DEFAULT '0',
        snapshot_ref TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    legacy
      .prepare(
        `INSERT INTO tacos (id, title, status, last_sequence, created_at, updated_at)
         VALUES (?, ?, 'open', 1, ?, ?)`,
      )
      .run(tacoId, baselineSnapshot.title, now, now)
    legacy
      .prepare(
        `INSERT INTO publish_baselines (taco_id, title, root, snapshot_ref, snapshot_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tacoId,
        baselineSnapshot.title,
        baselineSnapshot.root,
        `tacos/${tacoId}/publish.json`,
        JSON.stringify(baselineSnapshot),
        now,
      )
    legacy
      .prepare(
        `INSERT INTO shared_states (taco_id, state_version, comments_through_sequence, snapshot_ref, snapshot_json, updated_at)
         VALUES (?, '1', '0', ?, ?, ?)`,
      )
      .run(tacoId, `tacos/${tacoId}/state.json`, JSON.stringify(baselineSnapshot), now)
    legacy.close()

    const migrated = new SqliteDbAdapter(legacyDbPath)
    const state = await migrated.getSharedState(tacoId)
    expect(state?.revisionId).toBe(tacoId)

    const taco = await migrated.getTaco(tacoId)
    expect(taco?.currentRevisionId).toBe(tacoId)

    const rev = await migrated.createRevision(
      tacoId,
      {
        baseRevisionId: tacoId,
        expectedStateVersion: state!.stateVersion,
        expectedCommentsThroughSequence: state!.commentsThroughSequence,
        snapshot: snapshotWith({ title: 'Post-migration revision' }),
      },
      randomUUID(),
    )
    expect(rev.baseRevisionId).toBe(tacoId)
    expect(rev.revisionId).not.toBe(tacoId)
  })

  it('resolves the latest published revision when a legacy handoff row has no snapshot, and still rejects later unacknowledged edits', async () => {
    const tacoId = randomUUID()
    await adapter.publishTaco(tacoId, baselineSnapshot.title, baselineSnapshot)

    const handoff = await adapter.commitHandoff(
      tacoId,
      { author: 'Alice', expectedStateVersion: '1', expectedCommentsThroughSequence: '0' },
      randomUUID(),
    )
    expect(handoff.changed).toBe(true)

    // A release predating handoff snapshots leaves snapshot_json empty
    const external = new DatabaseSync(dbPath)
    external.prepare('UPDATE handoffs SET snapshot_json = NULL WHERE taco_id = ?').run(tacoId)
    external.close()

    const state = await adapter.getSharedState(tacoId)
    const rev = await adapter.createRevision(
      tacoId,
      {
        baseRevisionId: tacoId,
        expectedStateVersion: state!.stateVersion,
        expectedCommentsThroughSequence: state!.commentsThroughSequence,
        snapshot: snapshotWith({ title: 'Revision after legacy handoff' }),
      },
      randomUUID(),
    )
    expect(rev.baseRevisionId).toBe(tacoId)
    expect(rev.revisionId).not.toBe(tacoId)

    await adapter.autosaveSharedState(
      tacoId,
      {
        protocol: 'taco-state/1',
        expectedStateVersion: rev.stateVersion,
        author: 'Bob',
        fileChanges: [
          {
            id: 'file_spec',
            path: 'specs/sample/spec.md',
            changeType: 'modified',
            content: '# Spec V4\n\nBob edits after the revision\n',
          },
        ],
      },
      randomUUID(),
    )
    const stateAfter = await adapter.getSharedState(tacoId)
    expect(stateAfter?.snapshot.files[0].content).toBe(
      '# Spec V4\n\nBob edits after the revision\n',
    )
    await expect(
      adapter.createRevision(
        tacoId,
        {
          baseRevisionId: rev.revisionId,
          expectedStateVersion: stateAfter!.stateVersion,
          expectedCommentsThroughSequence: stateAfter!.commentsThroughSequence,
          snapshot: snapshotWith({ title: 'Another revision' }),
        },
        randomUUID(),
      ),
    ).rejects.toThrowError(ConflictError)
  })
})
