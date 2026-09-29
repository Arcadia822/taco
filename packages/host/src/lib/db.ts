import { randomUUID } from 'node:crypto'
import type {
  AutoSavePatch,
  ChangedFile,
  CheckpointChange,
  CheckpointDefinitionDelta,
  CommentThread,
  DocumentSnapshot,
  FilePatch,
  HandoffCommit,
  HandoffEvent,
  HandoffPayload,
  HandoffRecord,
  SnapshotFile,
} from '@taco/protocol'
import { isSafePath, validateCheckpoints, validateDocumentSnapshot } from '@taco/protocol'
import pg from 'pg'
import { createUnifiedDiff } from './diff'

export class DatabaseNotConfiguredError extends Error {
  constructor(message = 'Durable transactional database is not configured. Set DATABASE_URL (PostgreSQL) or TACO_DB_PATH (SQLite, local only).') {
    super(message)
    this.name = 'DatabaseNotConfiguredError'
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class PayloadTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayloadTooLargeError'
  }
}

export class GoneError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoneError'
  }
}

export interface SharedStateResult {
  stateVersion: string
  commentsThroughSequence: string
  snapshot: DocumentSnapshot
}

export interface HistoryVersionSummary {
  id: string
  startedAt: string
  closedAt: string | null
  latestStateVersion: string
}

export interface HistoryVersionDetail extends HistoryVersionSummary {
  snapshot: DocumentSnapshot
}

export interface ListenerRecord {
  listenerId: string
  name?: string
  harness?: string
  model?: string
  modelId?: string
  lastSeenAt: string
  expiresAt: string
}

export interface UploadReservationRecord {
  id: string
  purpose: string
  tacoId: string
  idempotencyKey: string
  payloadHash: string
  payloadBytes: number
  status: 'pending' | 'committed'
  expiresAt: string
}

export interface StoredEvent {
  id: string
  sequence: string
  tacoId: string
  type: string
  occurredAt: string
  actor: unknown
  data: unknown
}

export interface TacoDb {
  publishTaco(tacoId: string, title: string, snapshot: DocumentSnapshot): Promise<{ tacoId: string; stateVersion: string }>
  getTaco(tacoId: string): Promise<{ id: string; title: string; status: string; lastSequence: string } | null>
  getSharedState(tacoId: string): Promise<SharedStateResult | null>
  autosaveSharedState(tacoId: string, patch: AutoSavePatch, idempotencyKey: string): Promise<{ stateVersion: string; savedAt: string; historyWindowId: string }>
  listHistory(tacoId: string): Promise<HistoryVersionSummary[]>
  getHistoryVersion(tacoId: string, windowId: string): Promise<HistoryVersionDetail | null>
  getReviewThreads(tacoId: string): Promise<CommentThread[]>
  mutateReviewThread(
    tacoId: string,
    actionPayload: {
      author: string
      action: 'create' | 'reply' | 'resolve' | 'reopen' | 'delete'
      threadId?: string
      messageId?: string
      anchor?: unknown
      body?: string
    },
    idempotencyKey: string,
  ): Promise<{ status: 200 | 201; changed: boolean; event: StoredEvent }>
  commitHandoff(
    tacoId: string,
    payload: { author: string; expectedStateVersion: string; expectedCommentsThroughSequence: string },
    idempotencyKey: string,
  ): Promise<HandoffCommit>
  getHandoff(tacoId: string, handoffId: string): Promise<HandoffRecord | null>
  listListeners(tacoId: string): Promise<ListenerRecord[]>
  upsertListenerLease(tacoId: string, listener: ListenerRecord): Promise<void>
  createUploadReservation(
    tacoId: string,
    params: { purpose: string; payloadBytes: number; payloadHash: string },
    idempotencyKey: string,
  ): Promise<{ uploadId: string; status: 'pending' | 'committed'; expiresAt: string }>
  getUploadReservation(uploadId: string): Promise<UploadReservationRecord | null>
  commitUploadContent(uploadId: string, rawBytes: Uint8Array): Promise<void>
  getUploadContent(uploadId: string): Promise<string | null>
  getEventsAfter(tacoId: string, afterSeq: bigint): Promise<StoredEvent[]>
  getEventsPage(tacoId: string, afterSeq: bigint, throughSeq: bigint, limit: number): Promise<StoredEvent[]>
}

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS tacos (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'expired', 'deleted')) DEFAULT 'open',
  last_sequence BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS publish_baselines (
  taco_id UUID PRIMARY KEY REFERENCES tacos(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  root TEXT NOT NULL,
  snapshot_ref TEXT NOT NULL,
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shared_states (
  taco_id UUID PRIMARY KEY REFERENCES tacos(id) ON DELETE RESTRICT,
  state_version TEXT NOT NULL DEFAULT '1',
  comments_through_sequence TEXT NOT NULL DEFAULT '0',
  snapshot_ref TEXT NOT NULL,
  snapshot_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS edit_logs (
  taco_id UUID NOT NULL REFERENCES tacos(id) ON DELETE RESTRICT,
  state_version TEXT NOT NULL,
  author_id TEXT NOT NULL,
  change_ref TEXT NOT NULL,
  file_changes JSONB NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (taco_id, state_version)
);

CREATE TABLE IF NOT EXISTS history_windows (
  id UUID PRIMARY KEY,
  taco_id UUID NOT NULL REFERENCES tacos(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ NULL,
  latest_state_version TEXT NOT NULL,
  snapshot_ref TEXT NOT NULL,
  snapshot_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_windows_taco ON history_windows(taco_id, started_at ASC);

CREATE TABLE IF NOT EXISTS persistent_comment_threads (
  id TEXT NOT NULL,
  taco_id UUID NOT NULL REFERENCES tacos(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  anchor JSONB NULL,
  is_anchor_stale BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (taco_id, id)
);

CREATE TABLE IF NOT EXISTS persistent_comment_messages (
  id TEXT NOT NULL,
  taco_id UUID NOT NULL,
  thread_id TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,
  PRIMARY KEY (taco_id, thread_id, id),
  FOREIGN KEY (taco_id, thread_id) REFERENCES persistent_comment_threads(taco_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comment_thread_actions (
  sequence BIGINT NOT NULL,
  taco_id UUID NOT NULL REFERENCES tacos(id) ON DELETE RESTRICT,
  thread_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('create', 'reply', 'resolve', 'reopen', 'delete')),
  author TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_id TEXT NULL,
  PRIMARY KEY (taco_id, sequence)
);

CREATE TABLE IF NOT EXISTS handoffs (
  id UUID PRIMARY KEY,
  taco_id UUID NOT NULL REFERENCES tacos(id) ON DELETE RESTRICT,
  author TEXT NOT NULL,
  state_version TEXT NOT NULL,
  event_sequence BIGINT NOT NULL,
  payload_ref TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  comments_through_sequence TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_handoffs_taco ON handoffs(taco_id, created_at ASC);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  sequence BIGINT NOT NULL,
  taco_id UUID NOT NULL REFERENCES tacos(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor JSONB NOT NULL,
  data JSONB NOT NULL,
  CONSTRAINT uq_events_taco_seq UNIQUE (taco_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_events_taco_seq ON events(taco_id, sequence ASC);

CREATE TABLE IF NOT EXISTS listener_leases (
  taco_id UUID NOT NULL REFERENCES tacos(id) ON DELETE RESTRICT,
  listener_id UUID NOT NULL,
  name TEXT NULL,
  harness TEXT NULL,
  model TEXT NULL,
  model_id TEXT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (taco_id, listener_id)
);

CREATE TABLE IF NOT EXISTS mutation_receipts (
  taco_id UUID NOT NULL REFERENCES tacos(id) ON DELETE RESTRICT,
  idempotency_key UUID NOT NULL,
  action TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_hash TEXT NULL,
  PRIMARY KEY (taco_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS upload_reservations (
  id UUID PRIMARY KEY,
  purpose TEXT NOT NULL,
  taco_id UUID NOT NULL REFERENCES tacos(id) ON DELETE RESTRICT,
  idempotency_key UUID NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'abandoned')),
  content TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_uploads_scope UNIQUE (taco_id, purpose, idempotency_key)
);
`

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS tacos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'expired', 'deleted')) DEFAULT 'open',
  last_sequence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publish_baselines (
  taco_id TEXT PRIMARY KEY REFERENCES tacos(id),
  title TEXT NOT NULL,
  root TEXT NOT NULL,
  snapshot_ref TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shared_states (
  taco_id TEXT PRIMARY KEY REFERENCES tacos(id),
  state_version TEXT NOT NULL DEFAULT '1',
  comments_through_sequence TEXT NOT NULL DEFAULT '0',
  snapshot_ref TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edit_logs (
  taco_id TEXT NOT NULL REFERENCES tacos(id),
  state_version TEXT NOT NULL,
  author_id TEXT NOT NULL,
  change_ref TEXT NOT NULL,
  file_changes TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  PRIMARY KEY (taco_id, state_version)
);

CREATE TABLE IF NOT EXISTS history_windows (
  id TEXT PRIMARY KEY,
  taco_id TEXT NOT NULL REFERENCES tacos(id),
  started_at TEXT NOT NULL,
  closed_at TEXT NULL,
  latest_state_version TEXT NOT NULL,
  snapshot_ref TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persistent_comment_threads (
  id TEXT NOT NULL,
  taco_id TEXT NOT NULL REFERENCES tacos(id),
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  anchor TEXT NULL,
  is_anchor_stale INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (taco_id, id)
);

CREATE TABLE IF NOT EXISTS persistent_comment_messages (
  id TEXT NOT NULL,
  taco_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT NULL,
  PRIMARY KEY (taco_id, thread_id, id),
  FOREIGN KEY (taco_id, thread_id) REFERENCES persistent_comment_threads(taco_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comment_thread_actions (
  sequence INTEGER NOT NULL,
  taco_id TEXT NOT NULL REFERENCES tacos(id),
  thread_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('create', 'reply', 'resolve', 'reopen', 'delete')),
  author TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  message_id TEXT NULL,
  PRIMARY KEY (taco_id, sequence)
);

CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  taco_id TEXT NOT NULL REFERENCES tacos(id),
  author TEXT NOT NULL,
  state_version TEXT NOT NULL,
  event_sequence INTEGER NOT NULL,
  payload_ref TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  comments_through_sequence TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL,
  taco_id TEXT NOT NULL REFERENCES tacos(id),
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  data TEXT NOT NULL,
  UNIQUE(taco_id, sequence)
);

CREATE TABLE IF NOT EXISTS listener_leases (
  taco_id TEXT NOT NULL REFERENCES tacos(id),
  listener_id TEXT NOT NULL,
  name TEXT NULL,
  harness TEXT NULL,
  model TEXT NULL,
  model_id TEXT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (taco_id, listener_id)
);

CREATE TABLE IF NOT EXISTS mutation_receipts (
  taco_id TEXT NOT NULL REFERENCES tacos(id),
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  request_hash TEXT NULL,
  PRIMARY KEY (taco_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS upload_reservations (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  taco_id TEXT NOT NULL REFERENCES tacos(id),
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'abandoned')),
  content TEXT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(taco_id, purpose, idempotency_key)
);
`

export function canonicalJsonStringify(val: unknown): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val)
  }
  if (Array.isArray(val)) {
    return '[' + val.map(canonicalJsonStringify).join(',') + ']'
  }
  const keys = Object.keys(val as Record<string, unknown>).sort()
  const entries = keys.map((k) => JSON.stringify(k) + ':' + canonicalJsonStringify((val as Record<string, unknown>)[k]))
  return '{' + entries.join(',') + '}'
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const hashBuf = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function toFullPath(p: string, root = '.'): string {
  if (root === '.' || p.startsWith(`${root}/`)) return p
  return `${root}/${p}`
}

export function toRelPath(fullPath: string, root = '.'): string {
  if (root === '.') return fullPath
  if (fullPath.startsWith(`${root}/`)) return fullPath.slice(root.length + 1)
  return fullPath
}

export function computeFileDiffs(
  baselineFiles: SnapshotFile[],
  currentFiles: SnapshotFile[],
  root = '.',
): ChangedFile[] {
  const baseMap = new Map<string, SnapshotFile>()
  const baseIdMap = new Map<string, SnapshotFile>()
  for (const f of baselineFiles) {
    baseMap.set(f.path, f)
    if (f.id) baseIdMap.set(f.id, f)
  }

  const currMap = new Map<string, SnapshotFile>()
  const currIdMap = new Map<string, SnapshotFile>()
  for (const f of currentFiles) {
    currMap.set(f.path, f)
    if (f.id) currIdMap.set(f.id, f)
  }

  const result: ChangedFile[] = []
  const handledCurrPaths = new Set<string>()
  const handledBasePaths = new Set<string>()

  // Check renames first (same non-empty id, different path)
  for (const curr of currentFiles) {
    if (curr.id && baseIdMap.has(curr.id)) {
      const base = baseIdMap.get(curr.id)!
      if (base.path !== curr.path) {
        handledCurrPaths.add(curr.path)
        handledBasePaths.add(base.path)
        const relPath = toRelPath(curr.path, root)
        const prevRelPath = toRelPath(base.path, root)
        const isMedia = curr.mediaType.startsWith('image/')
        const diff = isMedia ? null : createUnifiedDiff(base.content, curr.content, relPath)
        result.push({
          id: curr.id,
          path: relPath,
          previousPath: prevRelPath,
          changeType: 'renamed',
          mediaType: curr.mediaType,
          content: curr.content,
          diff,
        })
      }
    }
  }

  // Check additions and modifications
  for (const curr of currentFiles) {
    if (handledCurrPaths.has(curr.path)) continue
    handledCurrPaths.add(curr.path)

    const relPath = toRelPath(curr.path, root)
    const base = baseMap.get(curr.path)
    if (!base) {
      // Added
      const isMedia = curr.mediaType.startsWith('image/')
      const diff = isMedia ? null : createUnifiedDiff('', curr.content, relPath)
      result.push({
        id: curr.id,
        path: relPath,
        changeType: 'added',
        mediaType: curr.mediaType,
        content: curr.content,
        diff,
      })
    } else {
      handledBasePaths.add(base.path)
      if (base.content !== curr.content || base.mediaType !== curr.mediaType) {
        // Modified
        const isMedia = curr.mediaType.startsWith('image/')
        const diff = isMedia ? null : createUnifiedDiff(base.content, curr.content, relPath)
        result.push({
          id: curr.id,
          path: relPath,
          changeType: 'modified',
          mediaType: curr.mediaType,
          content: curr.content,
          diff,
        })
      }
    }
  }

  // Check deletions
  for (const base of baselineFiles) {
    if (handledBasePaths.has(base.path)) continue
    const relPath = toRelPath(base.path, root)
    const isMedia = base.mediaType.startsWith('image/')
    const diff = isMedia ? null : createUnifiedDiff(base.content, '', relPath)
    result.push({
      id: base.id,
      path: relPath,
      changeType: 'deleted',
      mediaType: base.mediaType,
      content: null,
      diff,
    })
  }

  return result
}

export function computeCheckpointChanges(
  fromState: DocumentSnapshot['checkpoints'] | null | undefined,
  toState: DocumentSnapshot['checkpoints'] | null | undefined,
): CheckpointChange[] {
  const fromDocs = new Map(fromState?.documents?.map((d) => [d.path, d.status]) ?? [])
  const toDocs = new Map(toState?.documents?.map((d) => [d.path, d.status]) ?? [])
  const allPaths = new Set([...fromDocs.keys(), ...toDocs.keys()])

  const changes: CheckpointChange[] = []
  for (const p of [...allPaths].sort()) {
    const from = fromDocs.get(p) ?? null
    const to = toDocs.get(p) ?? null
    if (from !== to) {
      changes.push({ path: p, from, to })
    }
  }
  return changes
}

export class PostgresDbAdapter implements TacoDb {
  private pool: pg.Pool
  private schemaInitialized = false

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString })
  }

  private async ensureSchema() {
    if (this.schemaInitialized) return
    const client = await this.pool.connect()
    try {
      await client.query(PG_SCHEMA)
      await client.query('ALTER TABLE mutation_receipts ADD COLUMN IF NOT EXISTS request_hash TEXT;')
      this.schemaInitialized = true
    } finally {
      client.release()
    }
  }

  async publishTaco(tacoId: string, title: string, snapshot: DocumentSnapshot): Promise<{ tacoId: string; stateVersion: string }> {
    await this.ensureSchema()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      // Check if publish baseline already exists
      const existing = await client.query('SELECT taco_id FROM publish_baselines WHERE taco_id = $1', [tacoId])
      if (existing.rowCount && existing.rowCount > 0) {
        throw new ConflictError('Taco already has an immutable publish baseline')
      }

      const now = new Date().toISOString()
      await client.query(
        `INSERT INTO tacos (id, title, status, last_sequence, created_at, updated_at)
         VALUES ($1, $2, 'open', 1, $3, $3)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = EXCLUDED.updated_at`,
        [tacoId, title, now],
      )

      await client.query(
        `INSERT INTO publish_baselines (taco_id, title, root, snapshot_ref, snapshot_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tacoId, title, snapshot.root, `tacos/${tacoId}/publish.json`, JSON.stringify(snapshot), now],
      )

      await client.query(
        `INSERT INTO shared_states (taco_id, state_version, comments_through_sequence, snapshot_ref, snapshot_json, updated_at)
         VALUES ($1, '1', '0', $2, $3, $4)`,
        [tacoId, `tacos/${tacoId}/state.json`, JSON.stringify(snapshot), now],
      )

      await client.query(
        `INSERT INTO events (id, sequence, taco_id, type, occurred_at, actor, data)
         VALUES ($1, 1, $2, 'revision.published', $3, $4, $5)`,
        [
          `ev_${tacoId}_1`,
          tacoId,
          now,
          JSON.stringify({ kind: 'user', id: 'agent', displayName: 'Agent', verified: true }),
          JSON.stringify({ title, root: snapshot.root }),
        ],
      )

      await client.query('COMMIT')
      return { tacoId, stateVersion: '1' }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async getTaco(tacoId: string): Promise<{ id: string; title: string; status: string; lastSequence: string } | null> {
    await this.ensureSchema()
    const res = await this.pool.query('SELECT id, title, status, last_sequence FROM tacos WHERE id = $1', [tacoId])
    if (res.rowCount === 0) return null
    const row = res.rows[0]
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      lastSequence: String(row.last_sequence),
    }
  }

  async getSharedState(tacoId: string): Promise<SharedStateResult | null> {
    await this.ensureSchema()
    const res = await this.pool.query(
      'SELECT state_version, comments_through_sequence, snapshot_json FROM shared_states WHERE taco_id = $1',
      [tacoId],
    )
    if (res.rowCount === 0) return null
    const row = res.rows[0]
    const snapshot = typeof row.snapshot_json === 'string' ? JSON.parse(row.snapshot_json) : row.snapshot_json
    return {
      stateVersion: row.state_version,
      commentsThroughSequence: row.comments_through_sequence,
      snapshot,
    }
  }

  async autosaveSharedState(
    tacoId: string,
    patch: AutoSavePatch,
    idempotencyKey: string,
  ): Promise<{ stateVersion: string; savedAt: string; historyWindowId: string }> {
    await this.ensureSchema()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      // 1. Lock taco row for concurrency & serialization
      const tacoRes = await client.query('SELECT id, status FROM tacos WHERE id = $1 FOR UPDATE', [tacoId])
      if (tacoRes.rowCount === 0) throw new NotFoundError('Taco not found')
      if (tacoRes.rows[0].status === 'deleted' || tacoRes.rows[0].status === 'expired') {
        throw new GoneError('Taco is closed, expired, or deleted')
      }

      // 2. Check idempotency receipt under the lock
      const requestHash = await sha256Hex(canonicalJsonStringify(patch))
      const receipt = await client.query(
        'SELECT action, response_body, status_code, request_hash FROM mutation_receipts WHERE taco_id = $1 AND idempotency_key = $2',
        [tacoId, idempotencyKey],
      )
      if (receipt.rowCount && receipt.rowCount > 0) {
        const row = receipt.rows[0]
        if (row.action !== 'autosave') {
          try {
            await client.query('ROLLBACK')
          } catch {}
          throw new ConflictError(`Idempotency key has already been used for a different action: ${row.action}`)
        }
        if (!row.request_hash || row.request_hash !== requestHash) {
          try {
            await client.query('ROLLBACK')
          } catch {}
          throw new ConflictError('Idempotency key has already been used with an unverified or different request payload')
        }
        await client.query('COMMIT')
        const body = typeof row.response_body === 'string'
          ? JSON.parse(row.response_body)
          : row.response_body
        return body
      }

      // Fetch current shared state
      const stateRes = await client.query(
        'SELECT state_version, comments_through_sequence, snapshot_json FROM shared_states WHERE taco_id = $1 FOR UPDATE',
        [tacoId],
      )
      if (stateRes.rowCount === 0) throw new NotFoundError('Taco has no shared review state')
      const current = stateRes.rows[0]
      if (current.state_version !== patch.expectedStateVersion) {
        throw new ConflictError(`Expected stateVersion ${patch.expectedStateVersion}, but current is ${current.state_version}`)
      }

      const currentSnapshot: DocumentSnapshot = typeof current.snapshot_json === 'string'
        ? JSON.parse(current.snapshot_json)
        : current.snapshot_json

      // Apply file changes with path normalization
      const root = currentSnapshot.root || '.'
      const filesMap = new Map<string, SnapshotFile>()
      for (const f of currentSnapshot.files) {
        filesMap.set(f.path, { ...f })
      }

      const usedUploadIds: string[] = []
      for (const fc of patch.fileChanges) {
        const fullPath = toFullPath(fc.path, root)
        const fullPrevPath = fc.previousPath ? toFullPath(fc.previousPath, root) : undefined

        if (!isSafePath(fc.path) || !isSafePath(fullPath)) {
          throw new ValidationError(`Unsafe file path: ${fc.path}`)
        }

        if (fc.changeType === 'deleted') {
          if (!filesMap.has(fullPath)) {
            throw new ValidationError(`Cannot delete non-existent file: ${fc.path}`)
          }
          filesMap.delete(fullPath)
        } else if (fc.changeType === 'renamed') {
          if (!fc.previousPath || !fullPrevPath || !fc.id) {
            throw new ValidationError('Rename must provide id and previousPath')
          }
          if (!isSafePath(fc.previousPath) || !isSafePath(fullPrevPath)) {
            throw new ValidationError(`Unsafe previousPath: ${fc.previousPath}`)
          }
          if (!filesMap.has(fullPrevPath)) {
            throw new ValidationError(`Cannot rename non-existent file: ${fc.previousPath}`)
          }
          if (fullPath !== fullPrevPath && filesMap.has(fullPath)) {
            throw new ValidationError(`Rename target path already exists: ${fc.path}`)
          }
          const prev = filesMap.get(fullPrevPath)!
          if (prev.id && prev.id !== fc.id) {
            throw new ValidationError(`Cannot rename: file id mismatch (expected ${prev.id}, got ${fc.id})`)
          }
          filesMap.delete(fullPrevPath)
          let content = fc.content
          if (fc.uploadId) {
            const upload = await client.query(
              'SELECT content, status FROM upload_reservations WHERE id = $1 AND taco_id = $2',
              [fc.uploadId, tacoId],
            )
            if (upload.rowCount === 0 || upload.rows[0].status !== 'committed' || upload.rows[0].content === null) {
              throw new ValidationError(`Upload ${fc.uploadId} is not committed or not found`)
            }
            content = upload.rows[0].content
            usedUploadIds.push(fc.uploadId)
          }
          if (content === null || content === undefined) {
            content = prev.content
          }

          filesMap.set(fullPath, {
            ...prev,
            id: fc.id,
            path: fullPath,
            mediaType: fc.mediaType || prev.mediaType,
            content,
          })
        } else if (fc.changeType === 'added') {
          if (filesMap.has(fullPath)) {
            throw new ValidationError(`Added file already exists: ${fc.path}`)
          }
          let content = fc.content
          if (fc.uploadId) {
            const upload = await client.query(
              'SELECT content, status FROM upload_reservations WHERE id = $1 AND taco_id = $2',
              [fc.uploadId, tacoId],
            )
            if (upload.rowCount === 0 || upload.rows[0].status !== 'committed' || upload.rows[0].content === null) {
              throw new ValidationError(`Upload ${fc.uploadId} is not committed or not found`)
            }
            content = upload.rows[0].content
            usedUploadIds.push(fc.uploadId)
          }
          if (content === null || content === undefined) {
            throw new ValidationError(`Added file missing content: ${fc.path}`)
          }
          filesMap.set(fullPath, {
            id: fc.id || randomUUID(),
            path: fullPath,
            mediaType: fc.mediaType || 'text/plain',
            content,
          })
        } else if (fc.changeType === 'modified') {
          if (!filesMap.has(fullPath)) {
            throw new ValidationError(`Cannot modify non-existent file: ${fc.path}`)
          }
          const prev = filesMap.get(fullPath)!
          let content = fc.content
          if (fc.uploadId) {
            const upload = await client.query(
              'SELECT content, status FROM upload_reservations WHERE id = $1 AND taco_id = $2',
              [fc.uploadId, tacoId],
            )
            if (upload.rowCount === 0 || upload.rows[0].status !== 'committed' || upload.rows[0].content === null) {
              throw new ValidationError(`Upload ${fc.uploadId} is not committed or not found`)
            }
            content = upload.rows[0].content
            usedUploadIds.push(fc.uploadId)
          }
          if (content === null || content === undefined) {
            throw new ValidationError(`Modified file missing content: ${fc.path}`)
          }
          filesMap.set(fullPath, {
            ...prev,
            id: fc.id || prev.id,
            path: fullPath,
            mediaType: fc.mediaType || prev.mediaType,
            content,
          })
        }
      }
      // Check minItems: 1 for files
      const newFiles = Array.from(filesMap.values())
      if (newFiles.length === 0) {
        throw new ValidationError('Snapshot files must contain at least one file (cannot delete last file)')
      }

      const nextSnapshot: DocumentSnapshot = {
        ...currentSnapshot,
        files: newFiles,
      }

      // Apply checkpoints if present
      if (patch.checkpoints !== undefined) {
        if (patch.checkpoints === null) {
          delete nextSnapshot.checkpoints
        } else {
          const cpVal = validateCheckpoints(patch.checkpoints, root)
          if (!cpVal.ok) {
            throw new ValidationError(`Invalid checkpoints at ${cpVal.path}: ${cpVal.err}`)
          }
          nextSnapshot.checkpoints = patch.checkpoints
        }
      }

      // Validate resulting snapshot
      const snapVal = validateDocumentSnapshot(nextSnapshot)
      if (!snapVal.ok) {
        throw new ValidationError(`Resulting snapshot invalid: ${snapVal.err}`)
      }

      // Check total snapshot size <= 32 MiB
      const snapStr = JSON.stringify(nextSnapshot)
      if (new TextEncoder().encode(snapStr).byteLength > 32 * 1024 * 1024) {
        throw new PayloadTooLargeError('Shared snapshot exceeds 32 MiB limit')
      }

      const nextVersion = String(BigInt(current.state_version) + 1n)
      const now = new Date()
      const nowIso = now.toISOString()

      // 10-minute history window logic
      const windowRes = await client.query(
        'SELECT id, started_at, closed_at FROM history_windows WHERE taco_id = $1 AND closed_at IS NULL ORDER BY started_at DESC LIMIT 1',
        [tacoId],
      )

      let historyWindowId: string
      const WINDOW_DURATION_MS = 10 * 60 * 1000

      if (windowRes.rowCount === 0) {
        historyWindowId = randomUUID()
        await client.query(
          `INSERT INTO history_windows (id, taco_id, started_at, closed_at, latest_state_version, snapshot_ref, snapshot_json)
           VALUES ($1, $2, $3, NULL, $4, $5, $6)`,
          [historyWindowId, tacoId, nowIso, nextVersion, `tacos/${tacoId}/windows/${historyWindowId}.json`, snapStr],
        )
      } else {
        const activeWin = windowRes.rows[0]
        const startTime = new Date(activeWin.started_at).getTime()
        if (now.getTime() - startTime >= WINDOW_DURATION_MS) {
          // Close old window
          const closedAt = new Date(startTime + WINDOW_DURATION_MS).toISOString()
          await client.query('UPDATE history_windows SET closed_at = $1 WHERE id = $2', [closedAt, activeWin.id])
          // Create new window
          historyWindowId = randomUUID()
          await client.query(
            `INSERT INTO history_windows (id, taco_id, started_at, closed_at, latest_state_version, snapshot_ref, snapshot_json)
             VALUES ($1, $2, $3, NULL, $4, $5, $6)`,
            [historyWindowId, tacoId, nowIso, nextVersion, `tacos/${tacoId}/windows/${historyWindowId}.json`, snapStr],
          )
        } else {
          // Update current open window
          historyWindowId = activeWin.id
          await client.query(
            `UPDATE history_windows SET latest_state_version = $1, snapshot_json = $2 WHERE id = $3`,
            [nextVersion, snapStr, historyWindowId],
          )
        }
      }

      // Record edit log with normalized relative paths
      const normalizedChanges = patch.fileChanges.map((fc) => ({
        ...fc,
        path: toRelPath(fc.path, root),
        ...(fc.previousPath ? { previousPath: toRelPath(fc.previousPath, root) } : {}),
      }))

      await client.query(
        `INSERT INTO edit_logs (taco_id, state_version, author_id, change_ref, file_changes, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tacoId, nextVersion, patch.author, '', JSON.stringify(normalizedChanges), nowIso],
      )

      // Update shared state
      await client.query(
        `UPDATE shared_states SET state_version = $1, snapshot_json = $2, updated_at = $3 WHERE taco_id = $4`,
        [nextVersion, snapStr, nowIso, tacoId],
      )

      const result = {
        stateVersion: nextVersion,
        savedAt: nowIso,
        historyWindowId,
      }

      // Record idempotency receipt
      await client.query(
        `INSERT INTO mutation_receipts (taco_id, idempotency_key, action, status_code, response_body, created_at, request_hash)
         VALUES ($1, $2, 'autosave', 200, $3, $4, $5)`,
        [tacoId, idempotencyKey, JSON.stringify(result), nowIso, requestHash],
      )

      for (const uid of usedUploadIds) {
        await client.query(
          'UPDATE upload_reservations SET content = NULL WHERE id = $1 AND taco_id = $2',
          [uid, tacoId],
        )
      }

      await client.query('COMMIT')
    } catch (err) {
      try {
        await client.query('ROLLBACK')
      } catch {}
      throw err
    } finally {
      client.release()
    }
  }

  async listHistory(tacoId: string): Promise<HistoryVersionSummary[]> {
    await this.ensureSchema()
    const res = await this.pool.query(
      `SELECT id, started_at, closed_at, latest_state_version
       FROM history_windows
       WHERE taco_id = $1
       ORDER BY started_at ASC`,
      [tacoId],
    )
    const now = Date.now()
    const WINDOW_DURATION_MS = 10 * 60 * 1000

    return res.rows.map((row) => {
      let closedAt = row.closed_at
      if (!closedAt) {
        const startTime = new Date(row.started_at).getTime()
        if (now - startTime >= WINDOW_DURATION_MS) {
          closedAt = new Date(startTime + WINDOW_DURATION_MS).toISOString()
        }
      }
      return {
        id: row.id,
        startedAt: new Date(row.started_at).toISOString(),
        closedAt: closedAt ? new Date(closedAt).toISOString() : null,
        latestStateVersion: row.latest_state_version,
      }
    })
  }

  async getHistoryVersion(tacoId: string, windowId: string): Promise<HistoryVersionDetail | null> {
    await this.ensureSchema()
    const res = await this.pool.query(
      `SELECT id, started_at, closed_at, latest_state_version, snapshot_json
       FROM history_windows
       WHERE taco_id = $1 AND id = $2`,
      [tacoId, windowId],
    )
    if (res.rowCount === 0) return null
    const row = res.rows[0]
    const now = Date.now()
    const WINDOW_DURATION_MS = 10 * 60 * 1000
    let closedAt = row.closed_at
    if (!closedAt) {
      const startTime = new Date(row.started_at).getTime()
      if (now - startTime >= WINDOW_DURATION_MS) {
        closedAt = new Date(startTime + WINDOW_DURATION_MS).toISOString()
      }
    }
    const snapshot = typeof row.snapshot_json === 'string' ? JSON.parse(row.snapshot_json) : row.snapshot_json
    return {
      id: row.id,
      startedAt: new Date(row.started_at).toISOString(),
      closedAt: closedAt ? new Date(closedAt).toISOString() : null,
      latestStateVersion: row.latest_state_version,
      snapshot,
    }
  }

  async getReviewThreads(tacoId: string): Promise<CommentThread[]> {
    await this.ensureSchema()
    const threadRes = await this.pool.query(
      `SELECT id, status, anchor, is_anchor_stale, created_at, updated_at
       FROM persistent_comment_threads
       WHERE taco_id = $1
       ORDER BY created_at ASC`,
      [tacoId],
    )

    const msgRes = await this.pool.query(
      `SELECT m.id, m.thread_id, m.author, m.body, m.created_at, m.deleted_at
       FROM persistent_comment_messages m
       JOIN comment_thread_actions a ON a.taco_id = m.taco_id AND a.thread_id = m.thread_id AND a.message_id = m.id AND a.type IN ('create', 'reply')
       WHERE m.taco_id = $1
       ORDER BY a.sequence ASC`,
      [tacoId],
    )

    const actRes = await this.pool.query(
      `SELECT sequence, thread_id, type, author, occurred_at, message_id
       FROM comment_thread_actions
       WHERE taco_id = $1
       ORDER BY sequence ASC`,
      [tacoId],
    )

    const messagesByThread = new Map<string, CommentThread['messages']>()
    for (const m of msgRes.rows) {
      let list = messagesByThread.get(m.thread_id)
      if (!list) {
        list = []
        messagesByThread.set(m.thread_id, list)
      }
      list.push({
        id: m.id,
        author: m.author,
        body: m.deleted_at ? null : m.body,
        createdAt: new Date(m.created_at).toISOString(),
        deletedAt: m.deleted_at ? new Date(m.deleted_at).toISOString() : null,
      })
    }

    const actionsByThread = new Map<string, CommentThread['actions']>()
    for (const a of actRes.rows) {
      let list = actionsByThread.get(a.thread_id)
      if (!list) {
        list = []
        actionsByThread.set(a.thread_id, list)
      }
      list.push({
        sequence: String(a.sequence),
        type: a.type,
        author: a.author,
        occurredAt: new Date(a.occurred_at).toISOString(),
        ...(a.message_id ? { messageId: a.message_id } : {}),
      })
    }

    return threadRes.rows.map((t) => {
      const anchor = t.anchor ? (typeof t.anchor === 'string' ? JSON.parse(t.anchor) : t.anchor) : null
      return {
        id: t.id,
        status: t.status,
        anchor,
        isAnchorStale: Boolean(t.is_anchor_stale),
        createdAt: new Date(t.created_at).toISOString(),
        updatedAt: new Date(t.updated_at).toISOString(),
        messages: messagesByThread.get(t.id) || [],
        actions: actionsByThread.get(t.id) || [],
      }
    })
  }

  async mutateReviewThread(
    tacoId: string,
    actionPayload: {
      author: string
      action: 'create' | 'reply' | 'resolve' | 'reopen' | 'delete'
      threadId?: string
      messageId?: string
      anchor?: unknown
      body?: string
    },
    idempotencyKey: string,
  ): Promise<{ status: 200 | 201; changed: boolean; event: StoredEvent }> {
    await this.ensureSchema()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const tacoRes = await client.query('SELECT id, last_sequence, status FROM tacos WHERE id = $1 FOR UPDATE', [tacoId])
      if (tacoRes.rowCount === 0) throw new NotFoundError('Taco not found')
      if (tacoRes.rows[0].status === 'deleted' || tacoRes.rows[0].status === 'expired') {
        throw new GoneError('Taco is closed, expired, or deleted')
      }

      // 2. Check idempotency receipt under the lock
      const requestHash = await sha256Hex(canonicalJsonStringify(actionPayload))
      const receipt = await client.query(
        'SELECT action, response_body, status_code, request_hash FROM mutation_receipts WHERE taco_id = $1 AND idempotency_key = $2',
        [tacoId, idempotencyKey],
      )
      if (receipt.rowCount && receipt.rowCount > 0) {
        const row = receipt.rows[0]
        if (row.action !== 'review') {
          try {
            await client.query('ROLLBACK')
          } catch {}
          throw new ConflictError(`Idempotency key has already been used for a different action: ${row.action}`)
        }
        if (!row.request_hash || row.request_hash !== requestHash) {
          try {
            await client.query('ROLLBACK')
          } catch {}
          throw new ConflictError('Idempotency key has already been used with an unverified or different request payload')
        }
        await client.query('COMMIT')
        const body = typeof row.response_body === 'string'
          ? JSON.parse(row.response_body)
          : row.response_body
        return { status: row.status_code as 200 | 201, changed: false, event: body.event }
      }

      const nextSequence = BigInt(tacoRes.rows[0].last_sequence) + 1n
      const nextSequenceStr = String(nextSequence)
      const nowIso = new Date().toISOString()
      let statusCode: 200 | 201 = 200
      let eventType = ''
      let eventData: Record<string, unknown> = {}

      if (actionPayload.action === 'create') {
        statusCode = 201
        eventType = 'comment.created'
        const threadId = actionPayload.threadId || randomUUID()
        const messageId = actionPayload.messageId || randomUUID()
        const body = actionPayload.body || ''
        const anchorJson = actionPayload.anchor ? JSON.stringify(actionPayload.anchor) : null

        await client.query(
          `INSERT INTO persistent_comment_threads (id, taco_id, status, anchor, is_anchor_stale, created_at, updated_at)
           VALUES ($1, $2, 'open', $3, FALSE, $4, $4)`,
          [threadId, tacoId, anchorJson, nowIso],
        )

        await client.query(
          `INSERT INTO persistent_comment_messages (id, taco_id, thread_id, author, body, created_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
          [messageId, tacoId, threadId, actionPayload.author, body, nowIso],
        )

        await client.query(
          `INSERT INTO comment_thread_actions (sequence, taco_id, thread_id, type, author, occurred_at, message_id)
           VALUES ($1, $2, $3, 'create', $4, $5, $6)`,
          [nextSequence, tacoId, threadId, actionPayload.author, nowIso, messageId],
        )

        eventData = { threadId, messageId, body, anchor: actionPayload.anchor || null }
      } else if (actionPayload.action === 'reply') {
        eventType = 'comment.replied'
        const threadId = actionPayload.threadId!
        const messageId = actionPayload.messageId || randomUUID()
        const body = actionPayload.body || ''

        const threadCheck = await client.query(
          'SELECT id FROM persistent_comment_threads WHERE id = $1 AND taco_id = $2',
          [threadId, tacoId],
        )
        if (threadCheck.rowCount === 0) throw new ValidationError(`Thread not found: ${threadId}`)

        await client.query(
          `INSERT INTO persistent_comment_messages (id, taco_id, thread_id, author, body, created_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
          [messageId, tacoId, threadId, actionPayload.author, body, nowIso],
        )

        await client.query(
          `UPDATE persistent_comment_threads SET updated_at = $1 WHERE id = $2 AND taco_id = $3`,
          [nowIso, threadId, tacoId],
        )

        await client.query(
          `INSERT INTO comment_thread_actions (sequence, taco_id, thread_id, type, author, occurred_at, message_id)
           VALUES ($1, $2, $3, 'reply', $4, $5, $6)`,
          [nextSequence, tacoId, threadId, actionPayload.author, nowIso, messageId],
        )

        eventData = { threadId, messageId, body }
      } else if (actionPayload.action === 'resolve') {
        eventType = 'thread.resolved'
        const threadId = actionPayload.threadId!
        const threadCheck = await client.query(
          'SELECT id, status FROM persistent_comment_threads WHERE id = $1 AND taco_id = $2',
          [threadId, tacoId],
        )
        if (threadCheck.rowCount === 0) throw new ValidationError(`Thread not found: ${threadId}`)

        await client.query(
          `UPDATE persistent_comment_threads SET status = 'resolved', updated_at = $1 WHERE id = $2 AND taco_id = $3`,
          [nowIso, threadId, tacoId],
        )

        await client.query(
          `INSERT INTO comment_thread_actions (sequence, taco_id, thread_id, type, author, occurred_at)
           VALUES ($1, $2, $3, 'resolve', $4, $5)`,
          [nextSequence, tacoId, threadId, actionPayload.author, nowIso],
        )

        eventData = { threadId }
      } else if (actionPayload.action === 'reopen') {
        eventType = 'thread.reopened'
        const threadId = actionPayload.threadId!
        const threadCheck = await client.query(
          'SELECT id, status FROM persistent_comment_threads WHERE id = $1 AND taco_id = $2',
          [threadId, tacoId],
        )
        if (threadCheck.rowCount === 0) throw new ValidationError(`Thread not found: ${threadId}`)

        await client.query(
          `UPDATE persistent_comment_threads SET status = 'open', updated_at = $1 WHERE id = $2 AND taco_id = $3`,
          [nowIso, threadId, tacoId],
        )

        await client.query(
          `INSERT INTO comment_thread_actions (sequence, taco_id, thread_id, type, author, occurred_at)
           VALUES ($1, $2, $3, 'reopen', $4, $5)`,
          [nextSequence, tacoId, threadId, actionPayload.author, nowIso],
        )

        eventData = { threadId }
      } else if (actionPayload.action === 'delete') {
        eventType = 'comment.deleted'
        const threadId = actionPayload.threadId!
        const messageId = actionPayload.messageId!

        await client.query(
          `UPDATE persistent_comment_messages SET body = NULL, deleted_at = $1 WHERE id = $2 AND thread_id = $3 AND taco_id = $4`,
          [nowIso, messageId, threadId, tacoId],
        )

        await client.query(
          `INSERT INTO comment_thread_actions (sequence, taco_id, thread_id, type, author, occurred_at, message_id)
           VALUES ($1, $2, $3, 'delete', $4, $5, $6)`,
          [nextSequence, tacoId, threadId, actionPayload.author, nowIso, messageId],
        )

        eventData = { threadId, messageId }
      }

      // Update comments_through_sequence in shared_states
      await client.query(
        `UPDATE shared_states SET comments_through_sequence = $1 WHERE taco_id = $2`,
        [nextSequenceStr, tacoId],
      )

      // Update tacos.last_sequence
      await client.query(`UPDATE tacos SET last_sequence = $1, updated_at = $2 WHERE id = $3`, [
        nextSequence,
        nowIso,
        tacoId,
      ])

      const event: StoredEvent = {
        id: `ev_${tacoId}_${nextSequenceStr}`,
        sequence: nextSequenceStr,
        tacoId,
        type: eventType,
        occurredAt: nowIso,
        actor: { kind: 'guest', id: actionPayload.author, displayName: actionPayload.author, verified: false },
        data: eventData,
      }

      await client.query(
        `INSERT INTO events (id, sequence, taco_id, type, occurred_at, actor, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          event.id,
          nextSequence,
          tacoId,
          event.type,
          event.occurredAt,
          JSON.stringify(event.actor),
          JSON.stringify(event.data),
        ],
      )

      await client.query(
        `INSERT INTO mutation_receipts (taco_id, idempotency_key, action, status_code, response_body, created_at, request_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tacoId, idempotencyKey, 'review', statusCode, JSON.stringify({ event }), nowIso, requestHash],
      )

      await client.query('COMMIT')
      return { status: statusCode, changed: true, event }
    } catch (err) {
      try {
        await client.query('ROLLBACK')
      } catch {}
      throw err
    } finally {
      client.release()
    }
  }

  async commitHandoff(
    tacoId: string,
    payloadReq: { author: string; expectedStateVersion: string; expectedCommentsThroughSequence: string },
    idempotencyKey: string,
  ): Promise<HandoffCommit> {
    await this.ensureSchema()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')

      // 1. Lock taco row for concurrency & serialization
      const tacoRes = await client.query('SELECT id, last_sequence, status FROM tacos WHERE id = $1 FOR UPDATE', [tacoId])
      if (tacoRes.rowCount === 0) throw new NotFoundError('Taco not found')
      if (tacoRes.rows[0].status === 'deleted' || tacoRes.rows[0].status === 'expired') {
        throw new GoneError('Taco is closed, expired, or deleted')
      }

      // 2. Check idempotency receipt under the lock
      const requestHash = await sha256Hex(canonicalJsonStringify(payloadReq))
      const receipt = await client.query(
        'SELECT action, response_body, status_code, request_hash FROM mutation_receipts WHERE taco_id = $1 AND idempotency_key = $2',
        [tacoId, idempotencyKey],
      )
      if (receipt.rowCount && receipt.rowCount > 0) {
        const row = receipt.rows[0]
        if (row.action !== 'handoff') {
          try {
            await client.query('ROLLBACK')
          } catch {}
          throw new ConflictError(`Idempotency key has already been used for a different action: ${row.action}`)
        }
        if (!row.request_hash || row.request_hash !== requestHash) {
          try {
            await client.query('ROLLBACK')
          } catch {}
          throw new ConflictError('Idempotency key has already been used with an unverified or different request payload')
        }
        await client.query('COMMIT')
        const body = typeof row.response_body === 'string'
          ? JSON.parse(row.response_body)
          : row.response_body
        return body
      }
      const baselineRes = await client.query(
        'SELECT title, root, snapshot_json FROM publish_baselines WHERE taco_id = $1',
        [tacoId],
      )
      if (baselineRes.rowCount === 0) throw new NotFoundError('Taco has no immutable publish baseline')

      const baselineSnapshot: DocumentSnapshot = typeof baselineRes.rows[0].snapshot_json === 'string'
        ? JSON.parse(baselineRes.rows[0].snapshot_json)
        : baselineRes.rows[0].snapshot_json

      const sharedRes = await client.query(
        'SELECT state_version, comments_through_sequence, snapshot_json FROM shared_states WHERE taco_id = $1 FOR UPDATE',
        [tacoId],
      )
      if (sharedRes.rowCount === 0) throw new NotFoundError('Shared state not found')
      const current = sharedRes.rows[0]

      // CAS checks
      if (current.state_version !== payloadReq.expectedStateVersion) {
        throw new ConflictError(`Expected stateVersion ${payloadReq.expectedStateVersion} does not match current ${current.state_version}`)
      }
      if (current.comments_through_sequence !== payloadReq.expectedCommentsThroughSequence) {
        throw new ConflictError(`Expected commentsThroughSequence ${payloadReq.expectedCommentsThroughSequence} does not match current ${current.comments_through_sequence}`)
      }

      const currentSnapshot: DocumentSnapshot = typeof current.snapshot_json === 'string'
        ? JSON.parse(current.snapshot_json)
        : current.snapshot_json

      // Check latest previous handoff
      const prevHandoffRes = await client.query(
        'SELECT id, state_version, comments_through_sequence, payload_json FROM handoffs WHERE taco_id = $1 ORDER BY created_at DESC LIMIT 1',
        [tacoId],
      )

      let previousSnapshot = baselineSnapshot
      if (prevHandoffRes.rowCount && prevHandoffRes.rowCount > 0) {
        const prev = prevHandoffRes.rows[0]
        // Check if anything changed since previous handoff
        if (
          prev.state_version === current.state_version &&
          prev.comments_through_sequence === current.comments_through_sequence
        ) {
          // Unchanged!
          const result: HandoffCommit = {
            changed: false,
            handoffId: null,
            event: null,
          }
          await client.query(
            `INSERT INTO mutation_receipts (taco_id, idempotency_key, action, status_code, response_body, created_at, request_hash)
             VALUES ($1, $2, 'handoff', 200, $3, NOW(), $4)
             ON CONFLICT (taco_id, idempotency_key) DO UPDATE SET response_body = EXCLUDED.response_body, request_hash = EXCLUDED.request_hash`,
            [tacoId, idempotencyKey, JSON.stringify(result), requestHash],
          )
          await client.query('COMMIT')
          return result
        }

        const prevPayload: HandoffPayload = typeof prev.payload_json === 'string'
          ? JSON.parse(prev.payload_json)
          : prev.payload_json
        // Reconstruct previous snapshot file state if possible or use current changedFiles baseline
        // Actually, incrementalFiles is relative to previous handoff's state
        // Let's build previous file list
        const prevFilesMap = new Map<string, SnapshotFile>()
        for (const f of baselineSnapshot.files) prevFilesMap.set(f.path, f)
        const root = baselineSnapshot.root || '.'
        for (const cf of prevPayload.changedFiles) {
          const fullPath = toFullPath(cf.path, root)
          const fullPrevPath = cf.previousPath ? toFullPath(cf.previousPath, root) : undefined
          if (cf.changeType === 'deleted') {
            prevFilesMap.delete(fullPath)
          } else if (cf.changeType === 'renamed' && fullPrevPath) {
            const prevFile = prevFilesMap.get(fullPrevPath)
            prevFilesMap.delete(fullPrevPath)
            prevFilesMap.set(fullPath, {
              id: cf.id || prevFile?.id,
              path: fullPath,
              mediaType: cf.mediaType || prevFile?.mediaType || 'text/plain',
              content: cf.content || '',
            })
          } else if (cf.changeType === 'added') {
            prevFilesMap.set(fullPath, {
              id: cf.id,
              path: fullPath,
              mediaType: cf.mediaType || 'text/plain',
              content: cf.content || '',
            })
          } else {
            // modified
            const prevFile = prevFilesMap.get(fullPath)
            prevFilesMap.set(fullPath, {
              id: cf.id || prevFile?.id,
              path: fullPath,
              mediaType: cf.mediaType || prevFile?.mediaType || 'text/plain',
              content: cf.content || '',
            })
          }
        }
        previousSnapshot = {
          ...baselineSnapshot,
          files: Array.from(prevFilesMap.values()),
          checkpoints: prevPayload.checkpoints || undefined,
        }
      }

      // Compute diffs
      const changedFiles = computeFileDiffs(baselineSnapshot.files, currentSnapshot.files, baselineSnapshot.root)
      const incrementalFiles = computeFileDiffs(previousSnapshot.files, currentSnapshot.files, baselineSnapshot.root)

      const checkpointChanges = computeCheckpointChanges(baselineSnapshot.checkpoints, currentSnapshot.checkpoints)
      const incrementalCheckpointChanges = computeCheckpointChanges(previousSnapshot.checkpoints, currentSnapshot.checkpoints)

      const checkpointDefinitionDelta: CheckpointDefinitionDelta = {
        from: baselineSnapshot.checkpoints || null,
        to: currentSnapshot.checkpoints || null,
      }
      const incrementalCheckpointDefinitionDelta: CheckpointDefinitionDelta = {
        from: previousSnapshot.checkpoints || null,
        to: currentSnapshot.checkpoints || null,
      }

      const comments = await this.getReviewThreads(tacoId)

      const handoffPayload: HandoffPayload = {
        root: baselineSnapshot.root,
        changedFiles,
        incrementalFiles,
        checkpointChanges,
        incrementalCheckpointChanges,
        checkpoints: currentSnapshot.checkpoints || null,
        checkpointDefinitionDelta,
        incrementalCheckpointDefinitionDelta,
        comments,
        commentsThroughSequence: current.comments_through_sequence,
      }

      const payloadStr = JSON.stringify(handoffPayload)
      if (new TextEncoder().encode(payloadStr).byteLength > 32 * 1024 * 1024) {
        throw new PayloadTooLargeError('Handoff payload exceeds 32 MiB limit')
      }

      const payloadHash = `sha256:${await sha256Hex(payloadStr)}`
      const handoffId = randomUUID()
      const nextSequence = BigInt(tacoRes.rows[0].last_sequence) + 1n
      const nextSequenceStr = String(nextSequence)
      const nowIso = new Date().toISOString()

      // Insert handoff
      await client.query(
        `INSERT INTO handoffs (id, taco_id, author, state_version, event_sequence, payload_ref, payload_hash, comments_through_sequence, payload_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          handoffId,
          tacoId,
          payloadReq.author,
          current.state_version,
          nextSequence,
          `tacos/${tacoId}/handoffs/${handoffId}.json`,
          payloadHash,
          current.comments_through_sequence,
          payloadStr,
          nowIso,
        ],
      )

      // Create event
      const handoffEvent: HandoffEvent = {
        kind: 'event',
        id: `ev_${tacoId}_${nextSequenceStr}`,
        sequence: nextSequenceStr,
        tacoId,
        type: 'review.handed_off',
        occurredAt: nowIso,
        actor: payloadReq.author,
        data: { handoffId },
      }

      await client.query(
        `INSERT INTO events (id, sequence, taco_id, type, occurred_at, actor, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          handoffEvent.id,
          nextSequence,
          tacoId,
          handoffEvent.type,
          handoffEvent.occurredAt,
          JSON.stringify(handoffEvent.actor),
          JSON.stringify(handoffEvent.data),
        ],
      )

      await client.query(`UPDATE tacos SET last_sequence = $1, updated_at = $2 WHERE id = $3`, [
        nextSequence,
        nowIso,
        tacoId,
      ])

      const commitResult: HandoffCommit = {
        changed: true,
        handoffId,
        event: handoffEvent,
      }

      await client.query(
        `INSERT INTO mutation_receipts (taco_id, idempotency_key, action, status_code, response_body, created_at, request_hash)
         VALUES ($1, $2, 'handoff', 201, $3, $4, $5)`,
        [tacoId, idempotencyKey, JSON.stringify(commitResult), nowIso, requestHash],
      )

      await client.query('COMMIT')
      return commitResult
    } catch (err) {
      try {
        await client.query('ROLLBACK')
      } catch {}
      throw err
    } finally {
      client.release()
    }
  }

  async getHandoff(tacoId: string, handoffId: string): Promise<HandoffRecord | null> {
    await this.ensureSchema()
    const tacoRes = await this.pool.query('SELECT status FROM tacos WHERE id = $1', [tacoId])
    if (tacoRes.rowCount === 0) return null
    if (tacoRes.rows[0].status === 'deleted' || tacoRes.rows[0].status === 'expired') {
      throw new GoneError('Taco is deleted or expired')
    }

    const res = await this.pool.query(
      'SELECT id, taco_id, author, created_at, payload_json FROM handoffs WHERE id = $1 AND taco_id = $2',
      [handoffId, tacoId],
    )
    if (res.rowCount === 0) return null
    const row = res.rows[0]
    const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json
    return {
      id: row.id,
      tacoId: row.taco_id,
      author: row.author,
      createdAt: new Date(row.created_at).toISOString(),
      payload,
    }
  }

  async listListeners(tacoId: string): Promise<ListenerRecord[]> {
    await this.ensureSchema()
    const res = await this.pool.query(
      `SELECT listener_id, name, harness, model, model_id, last_seen_at, expires_at
       FROM listener_leases
       WHERE taco_id = $1 AND expires_at > NOW()`,
      [tacoId],
    )
    return res.rows.map((r) => ({
      listenerId: r.listener_id,
      ...(r.name ? { name: r.name } : {}),
      ...(r.harness ? { harness: r.harness } : {}),
      ...(r.model ? { model: r.model } : {}),
      ...(r.model_id ? { modelId: r.model_id } : {}),
      lastSeenAt: new Date(r.last_seen_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
    }))
  }

  async upsertListenerLease(tacoId: string, listener: ListenerRecord): Promise<void> {
    await this.ensureSchema()
    await this.pool.query(
      `INSERT INTO listener_leases (taco_id, listener_id, name, harness, model, model_id, last_seen_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (taco_id, listener_id) DO UPDATE SET
         name = EXCLUDED.name,
         harness = EXCLUDED.harness,
         model = EXCLUDED.model,
         model_id = EXCLUDED.model_id,
         last_seen_at = EXCLUDED.last_seen_at,
         expires_at = EXCLUDED.expires_at`,
      [
        tacoId,
        listener.listenerId,
        listener.name || null,
        listener.harness || null,
        listener.model || null,
        listener.modelId || null,
        listener.lastSeenAt,
        listener.expiresAt,
      ],
    )
  }

  async createUploadReservation(
    tacoId: string,
    params: { purpose: string; payloadBytes: number; payloadHash: string },
    idempotencyKey: string,
  ): Promise<{ uploadId: string; status: 'pending' | 'committed'; expiresAt: string }> {
    await this.ensureSchema()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      // Serialize quota check + insert per Taco using row lock
      const tacoRes = await client.query('SELECT id, status FROM tacos WHERE id = $1 FOR UPDATE', [tacoId])
      if (tacoRes.rowCount === 0) throw new NotFoundError('Taco not found')
      if (tacoRes.rows[0].status === 'deleted' || tacoRes.rows[0].status === 'expired') {
        throw new GoneError('Taco is closed, expired, or deleted')
      }

      // Expiration cleanup within transaction
      await client.query('DELETE FROM upload_reservations WHERE expires_at < NOW()')

      // Check idempotency under the lock
      const existing = await client.query(
        'SELECT id, status, expires_at, payload_hash, payload_bytes FROM upload_reservations WHERE taco_id = $1 AND purpose = $2 AND idempotency_key = $3',
        [tacoId, params.purpose, idempotencyKey],
      )
      if (existing.rowCount && existing.rowCount > 0) {
        const row = existing.rows[0]
        if (row.payload_hash !== params.payloadHash || row.payload_bytes !== params.payloadBytes) {
          try { await client.query('ROLLBACK') } catch {}
          throw new ConflictError('Idempotency key reused with different upload parameters')
        }
        await client.query('COMMIT')
        return {
          uploadId: row.id,
          status: row.status,
          expiresAt: new Date(row.expires_at).toISOString(),
        }
      }

      // Quota check serialized under transaction lock
      const quotaRes = await client.query(
        `SELECT COUNT(*) as count, COALESCE(SUM(payload_bytes), 0) as total_bytes
         FROM upload_reservations
         WHERE taco_id = $1 AND expires_at >= NOW() AND (status = 'pending' OR (status = 'committed' AND content IS NOT NULL))`,
        [tacoId],
      )
      const activeCount = parseInt(quotaRes.rows[0]?.count || '0', 10)
      const unreferencedBytes = parseInt(quotaRes.rows[0]?.total_bytes || '0', 10)
      if (activeCount >= 10) {
        try { await client.query('ROLLBACK') } catch {}
        throw new PayloadTooLargeError('Too many active upload reservations for this Taco')
      }
      if (unreferencedBytes + params.payloadBytes > 33554432) {
        try { await client.query('ROLLBACK') } catch {}
        throw new PayloadTooLargeError('Cumulative unreferenced upload quota exceeded for this Taco (max 32 MiB)')
      }

      const uploadId = randomUUID()
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
      await client.query(
        `INSERT INTO upload_reservations (id, purpose, taco_id, idempotency_key, payload_hash, payload_bytes, status, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), $7)`,
        [uploadId, params.purpose, tacoId, idempotencyKey, params.payloadHash, params.payloadBytes, expiresAt],
      )

      await client.query('COMMIT')
      return {
        uploadId,
        status: 'pending',
        expiresAt,
      }
    } catch (err) {
      try { await client.query('ROLLBACK') } catch {}
      throw err
    } finally {
      client.release()
    }
  }

  async getUploadReservation(uploadId: string): Promise<UploadReservationRecord | null> {
    await this.ensureSchema()
    const res = await this.pool.query(
      'SELECT id, purpose, taco_id, idempotency_key, payload_hash, payload_bytes, status, expires_at FROM upload_reservations WHERE id = $1',
      [uploadId],
    )
    if (res.rowCount === 0) return null
    const r = res.rows[0]
    return {
      id: r.id,
      purpose: r.purpose,
      tacoId: r.taco_id,
      idempotencyKey: r.idempotency_key,
      payloadHash: r.payload_hash,
      payloadBytes: r.payload_bytes,
      status: r.status,
      expiresAt: new Date(r.expires_at).toISOString(),
    }
  }

  async commitUploadContent(uploadId: string, rawBytes: Uint8Array): Promise<void> {
    await this.ensureSchema()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const res = await client.query(
        'SELECT taco_id, payload_bytes, status, expires_at FROM upload_reservations WHERE id = $1 FOR UPDATE',
        [uploadId],
      )
      if (res.rowCount === 0) throw new NotFoundError('Upload reservation not found')
      const r = res.rows[0]
      if (new Date(r.expires_at).getTime() < Date.now()) {
        throw new GoneError('Upload reservation expired')
      }

      // Lock taco row to serialize against other reservations/commits on same taco
      await client.query('SELECT id FROM tacos WHERE id = $1 FOR UPDATE', [r.taco_id])

      const quotaRes = await client.query(
        `SELECT COALESCE(SUM(payload_bytes), 0) as total_bytes
         FROM upload_reservations
         WHERE taco_id = $1 AND id != $2 AND expires_at >= NOW() AND status = 'committed' AND content IS NOT NULL`,
        [r.taco_id, uploadId],
      )
      const unreferencedBytes = parseInt(quotaRes.rows[0]?.total_bytes || '0', 10)
      if (unreferencedBytes + r.payload_bytes > 33554432) {
        throw new PayloadTooLargeError('Committed unreferenced upload quota exceeded (max 32 MiB)')
      }
      const content = new TextDecoder().decode(rawBytes)
      await client.query(
        `UPDATE upload_reservations SET content = $1, status = 'committed' WHERE id = $2`,
        [content, uploadId],
      )
      await client.query('COMMIT')
    } catch (err) {
      try { await client.query('ROLLBACK') } catch {}
      throw err
    } finally {
      client.release()
    }
  }

  async getUploadContent(uploadId: string): Promise<string | null> {
    await this.ensureSchema()
    const res = await this.pool.query('SELECT content FROM upload_reservations WHERE id = $1', [uploadId])
    if (res.rowCount === 0) return null
    return res.rows[0].content
  }

  async getEventsAfter(tacoId: string, afterSeq: bigint): Promise<StoredEvent[]> {
    await this.ensureSchema()
    const res = await this.pool.query(
      `SELECT id, sequence, taco_id, type, occurred_at, actor, data
       FROM events
       WHERE taco_id = $1 AND sequence > $2
       ORDER BY sequence ASC`,
      [tacoId, afterSeq],
    )
    return res.rows.map((r) => ({
      id: r.id,
      sequence: String(r.sequence),
      tacoId: r.taco_id,
      type: r.type,
      occurredAt: new Date(r.occurred_at).toISOString(),
      actor: typeof r.actor === 'string' ? JSON.parse(r.actor) : r.actor,
      data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
    }))
  }

  async getEventsPage(tacoId: string, afterSeq: bigint, throughSeq: bigint, limit: number): Promise<StoredEvent[]> {
    await this.ensureSchema()
    const res = await this.pool.query(
      `SELECT id, sequence, taco_id, type, occurred_at, actor, data
       FROM events WHERE taco_id = $1 AND sequence > $2 AND sequence <= $3
       ORDER BY sequence ASC LIMIT $4`,
      [tacoId, afterSeq.toString(), throughSeq.toString(), limit],
    )
    return res.rows.map((r) => ({
      id: r.id,
      sequence: String(r.sequence),
      tacoId: r.taco_id,
      type: r.type,
      occurredAt: new Date(r.occurred_at).toISOString(),
      actor: typeof r.actor === 'string' ? JSON.parse(r.actor) : r.actor,
      data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
    }))
  }
}

interface SqliteStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
}

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
}

interface SqliteTacoRow {
  id: string
  title: string
  status: string
  last_sequence: number | bigint
  created_at: string
  updated_at: string
}

interface SqliteSharedStateRow {
  state_version: string
  comments_through_sequence: string
  snapshot_json: string
}

interface SqliteReceiptRow {
  action: string
  response_body: string
  status_code: number
  request_hash?: string | null
}

interface SqliteHistoryWindowRow {
  id: string
  started_at: string
  closed_at: string | null
  latest_state_version: string
  snapshot_json: string
}

interface SqliteCommentThreadRow {
  id: string
  status: 'open' | 'resolved'
  anchor: string | null
  is_anchor_stale: number | boolean
  created_at: string
  updated_at: string
}

interface SqliteCommentMessageRow {
  id: string
  thread_id: string
  author: string
  body: string | null
  created_at: string
  deleted_at: string | null
}

interface SqliteCommentActionRow {
  sequence: number | bigint
  thread_id: string
  type: 'create' | 'reply' | 'resolve' | 'reopen' | 'delete'
  author: string
  occurred_at: string
  message_id: string | null
}

interface SqliteHandoffRow {
  id: string
  taco_id: string
  author: string
  state_version: string
  event_sequence: number | bigint
  payload_ref: string
  payload_hash: string
  comments_through_sequence: string
  payload_json: string
  created_at: string
}

interface SqliteListenerRow {
  listener_id: string
  name: string | null
  harness: string | null
  model: string | null
  model_id: string | null
  last_seen_at: string
  expires_at: string
}

interface SqliteUploadReservationRow {
  id: string
  purpose: string
  taco_id: string
  idempotency_key: string
  payload_hash: string
  payload_bytes: number
  status: 'pending' | 'committed' | 'abandoned'
  content: string | null
  created_at: string
  expires_at: string
}

interface SqliteEventRow {
  id: string
  sequence: number | bigint
  taco_id: string
  type: string
  occurred_at: string
  actor: string
  data: string
}

export class SqliteDbAdapter implements TacoDb {
  private db: SqliteDatabase
  private schemaInitialized = false

  constructor(dbPath: string) {
    // Dynamic import/require of node:sqlite
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDatabase }
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA busy_timeout = 5000;')
    this.ensureSchema()
  }

  private ensureSchema() {
    if (this.schemaInitialized) return
    this.db.exec(SQLITE_SCHEMA)
    try {
      this.db.exec('ALTER TABLE mutation_receipts ADD COLUMN request_hash TEXT;')
    } catch {}
    this.schemaInitialized = true
  }

  async publishTaco(tacoId: string, title: string, snapshot: DocumentSnapshot): Promise<{ tacoId: string; stateVersion: string }> {
    this.ensureSchema()
    const now = new Date().toISOString()

    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.db.prepare('SELECT taco_id FROM publish_baselines WHERE taco_id = ?').get(tacoId)
      if (existing) {
        throw new ConflictError('Taco already has an immutable publish baseline')
      }

      this.db
        .prepare(
          `INSERT INTO tacos (id, title, status, last_sequence, created_at, updated_at)
           VALUES (?, ?, 'open', 1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
        )
        .run(tacoId, title, now, now)

      this.db
        .prepare(
          `INSERT INTO publish_baselines (taco_id, title, root, snapshot_ref, snapshot_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(tacoId, title, snapshot.root, `tacos/${tacoId}/publish.json`, JSON.stringify(snapshot), now)

      this.db
        .prepare(
          `INSERT INTO shared_states (taco_id, state_version, comments_through_sequence, snapshot_ref, snapshot_json, updated_at)
           VALUES (?, '1', '0', ?, ?, ?)`,
        )
        .run(tacoId, `tacos/${tacoId}/state.json`, JSON.stringify(snapshot), now)

      this.db
        .prepare(
          `INSERT INTO events (id, sequence, taco_id, type, occurred_at, actor, data)
           VALUES (?, 1, ?, 'revision.published', ?, ?, ?)`,
        )
        .run(
          `ev_${tacoId}_1`,
          tacoId,
          now,
          JSON.stringify({ kind: 'user', id: 'agent', displayName: 'Agent', verified: true }),
          JSON.stringify({ title, root: snapshot.root }),
        )

      this.db.exec('COMMIT')
      return { tacoId, stateVersion: '1' }
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  async getTaco(tacoId: string): Promise<{ id: string; title: string; status: string; lastSequence: string } | null> {
    this.ensureSchema()
    const row = this.db.prepare('SELECT id, title, status, last_sequence FROM tacos WHERE id = ?').get(tacoId) as unknown as SqliteTacoRow | undefined
    if (!row) return null
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      lastSequence: String(row.last_sequence),
    }
  }

  async getSharedState(tacoId: string): Promise<SharedStateResult | null> {
    this.ensureSchema()
    const row = this.db
      .prepare('SELECT state_version, comments_through_sequence, snapshot_json FROM shared_states WHERE taco_id = ?')
      .get(tacoId) as unknown as SqliteSharedStateRow | undefined
    if (!row) return null
    return {
      stateVersion: row.state_version,
      commentsThroughSequence: row.comments_through_sequence,
      snapshot: JSON.parse(row.snapshot_json),
    }
  }

  async autosaveSharedState(
    tacoId: string,
    patch: AutoSavePatch,
    idempotencyKey: string,
  ): Promise<{ stateVersion: string; savedAt: string; historyWindowId: string }> {
    this.ensureSchema()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const taco = this.db.prepare('SELECT id, status FROM tacos WHERE id = ?').get(tacoId) as unknown as SqliteTacoRow | undefined
      if (!taco) throw new NotFoundError('Taco not found')
      if (taco.status === 'deleted' || taco.status === 'expired') {
        throw new GoneError('Taco is closed, expired, or deleted')
      }

      const requestHash = await sha256Hex(canonicalJsonStringify(patch))
      const receipt = this.db
        .prepare('SELECT action, response_body, status_code, request_hash FROM mutation_receipts WHERE taco_id = ? AND idempotency_key = ?')
        .get(tacoId, idempotencyKey) as unknown as SqliteReceiptRow | undefined
      if (receipt) {
        if (receipt.action !== 'autosave') {
          try {
            this.db.exec('ROLLBACK')
          } catch {}
          throw new ConflictError(`Idempotency key has already been used for a different action: ${receipt.action}`)
        }
        if (!receipt.request_hash || receipt.request_hash !== requestHash) {
          try {
            this.db.exec('ROLLBACK')
          } catch {}
          throw new ConflictError('Idempotency key has already been used with an unverified or different request payload')
        }
        this.db.exec('COMMIT')
        return JSON.parse(receipt.response_body)
      }
      const current = this.db
        .prepare('SELECT state_version, comments_through_sequence, snapshot_json FROM shared_states WHERE taco_id = ?')
        .get(tacoId) as unknown as SqliteSharedStateRow | undefined
      if (!current) throw new NotFoundError('Taco has no shared review state')
      if (current.state_version !== patch.expectedStateVersion) {
        throw new ConflictError(`Expected stateVersion ${patch.expectedStateVersion}, but current is ${current.state_version}`)
      }

      const currentSnapshot: DocumentSnapshot = JSON.parse(current.snapshot_json)
      const filesMap = new Map<string, SnapshotFile>()
      for (const f of currentSnapshot.files) filesMap.set(f.path, { ...f })

      const root = currentSnapshot.root || '.'
      const usedUploadIds: string[] = []
      for (const fc of patch.fileChanges) {
        const fullPath = toFullPath(fc.path, root)
        const fullPrevPath = fc.previousPath ? toFullPath(fc.previousPath, root) : undefined

        if (!isSafePath(fc.path) || !isSafePath(fullPath)) {
          throw new ValidationError(`Unsafe file path: ${fc.path}`)
        }
        if (fc.changeType === 'deleted') {
          if (!filesMap.has(fullPath)) throw new ValidationError(`Cannot delete non-existent file: ${fc.path}`)
          filesMap.delete(fullPath)
        } else if (fc.changeType === 'renamed') {
          if (!fc.previousPath || !fullPrevPath || !fc.id) throw new ValidationError('Rename must provide id and previousPath')
          if (!isSafePath(fc.previousPath) || !isSafePath(fullPrevPath)) throw new ValidationError(`Unsafe previousPath: ${fc.previousPath}`)
          if (!filesMap.has(fullPrevPath)) throw new ValidationError(`Cannot rename non-existent file: ${fc.previousPath}`)
          if (fullPath !== fullPrevPath && filesMap.has(fullPath)) {
            throw new ValidationError(`Rename target path already exists: ${fc.path}`)
          }
          const prev = filesMap.get(fullPrevPath)!
          if (prev.id && prev.id !== fc.id) {
            throw new ValidationError(`Cannot rename: file id mismatch (expected ${prev.id}, got ${fc.id})`)
          }
          filesMap.delete(fullPrevPath)
          let content = fc.content
          if (fc.uploadId) {
            const up = this.db.prepare('SELECT content, status FROM upload_reservations WHERE id = ? AND taco_id = ?').get(fc.uploadId, tacoId) as unknown as SqliteUploadReservationRow | undefined
            if (!up || up.status !== 'committed' || up.content === null) throw new ValidationError(`Upload ${fc.uploadId} is not committed or not found`)
            content = up.content
            usedUploadIds.push(fc.uploadId)
          }
          if (content === null || content === undefined) content = prev.content
          filesMap.set(fullPath, {
            ...prev,
            id: fc.id,
            path: fullPath,
            mediaType: fc.mediaType || prev.mediaType,
            content,
          })
        } else if (fc.changeType === 'added') {
          if (filesMap.has(fullPath)) throw new ValidationError(`Added file already exists: ${fc.path}`)
          let content = fc.content
          if (fc.uploadId) {
            const up = this.db.prepare('SELECT content, status FROM upload_reservations WHERE id = ? AND taco_id = ?').get(fc.uploadId, tacoId) as unknown as SqliteUploadReservationRow | undefined
            if (!up || up.status !== 'committed' || up.content === null) throw new ValidationError(`Upload ${fc.uploadId} is not committed or not found`)
            content = up.content
            usedUploadIds.push(fc.uploadId)
          }
          if (content === null || content === undefined) throw new ValidationError(`Added file missing content: ${fc.path}`)
          filesMap.set(fullPath, {
            id: fc.id || randomUUID(),
            path: fullPath,
            mediaType: fc.mediaType || 'text/plain',
            content,
          })
        } else if (fc.changeType === 'modified') {
          if (!filesMap.has(fullPath)) throw new ValidationError(`Cannot modify non-existent file: ${fc.path}`)
          const prev = filesMap.get(fullPath)!
          let content = fc.content
          if (fc.uploadId) {
            const up = this.db.prepare('SELECT content, status FROM upload_reservations WHERE id = ? AND taco_id = ?').get(fc.uploadId, tacoId) as unknown as SqliteUploadReservationRow | undefined
            if (!up || up.status !== 'committed' || up.content === null) throw new ValidationError(`Upload ${fc.uploadId} is not committed or not found`)
            content = up.content
            usedUploadIds.push(fc.uploadId)
          }
          if (content === null || content === undefined) throw new ValidationError(`Modified file missing content: ${fc.path}`)
          filesMap.set(fullPath, {
            ...prev,
            id: fc.id || prev.id,
            path: fullPath,
            mediaType: fc.mediaType || prev.mediaType,
            content,
          })
        }
      }

      const newFiles = Array.from(filesMap.values())
      if (newFiles.length === 0) {
        throw new ValidationError('Snapshot files must contain at least one file (cannot delete last file)')
      }

      const nextSnapshot: DocumentSnapshot = {
        ...currentSnapshot,
        files: newFiles,
      }

      if (patch.checkpoints !== undefined) {
        if (patch.checkpoints === null) {
          delete nextSnapshot.checkpoints
        } else {
          const cpVal = validateCheckpoints(patch.checkpoints, root)
          if (!cpVal.ok) {
            throw new ValidationError(`Invalid checkpoints at ${cpVal.path}: ${cpVal.err}`)
          }
          nextSnapshot.checkpoints = patch.checkpoints
        }
      }
      const snapVal = validateDocumentSnapshot(nextSnapshot)
      if (!snapVal.ok) throw new ValidationError(`Resulting snapshot invalid: ${snapVal.err}`)

      const snapStr = JSON.stringify(nextSnapshot)
      if (new TextEncoder().encode(snapStr).byteLength > 32 * 1024 * 1024) {
        throw new PayloadTooLargeError('Shared snapshot exceeds 32 MiB limit')
      }

      const nextVersion = String(BigInt(current.state_version) + 1n)
      const now = new Date()
      const nowIso = now.toISOString()
      const WINDOW_DURATION_MS = 10 * 60 * 1000

      const activeWin = this.db
        .prepare('SELECT id, started_at FROM history_windows WHERE taco_id = ? AND closed_at IS NULL ORDER BY started_at DESC LIMIT 1')
        .get(tacoId) as unknown as SqliteHistoryWindowRow | undefined
      let historyWindowId: string
      if (!activeWin) {
        historyWindowId = randomUUID()
        this.db
          .prepare(
            `INSERT INTO history_windows (id, taco_id, started_at, closed_at, latest_state_version, snapshot_ref, snapshot_json)
             VALUES (?, ?, ?, NULL, ?, ?, ?)`,
          )
          .run(historyWindowId, tacoId, nowIso, nextVersion, `tacos/${tacoId}/windows/${historyWindowId}.json`, snapStr)
      } else {
        const startTime = new Date(activeWin.started_at).getTime()
        if (now.getTime() - startTime >= WINDOW_DURATION_MS) {
          const closedAt = new Date(startTime + WINDOW_DURATION_MS).toISOString()
          this.db.prepare('UPDATE history_windows SET closed_at = ? WHERE id = ?').run(closedAt, activeWin.id)
          historyWindowId = randomUUID()
          this.db
            .prepare(
              `INSERT INTO history_windows (id, taco_id, started_at, closed_at, latest_state_version, snapshot_ref, snapshot_json)
               VALUES (?, ?, ?, NULL, ?, ?, ?)`,
            )
            .run(historyWindowId, tacoId, nowIso, nextVersion, `tacos/${tacoId}/windows/${historyWindowId}.json`, snapStr)
        } else {
          historyWindowId = activeWin.id
          this.db
            .prepare('UPDATE history_windows SET latest_state_version = ?, snapshot_json = ? WHERE id = ?')
            .run(nextVersion, snapStr, historyWindowId)
        }
      }

      // Record edit log with normalized relative paths
      const normalizedChanges = patch.fileChanges.map((fc) => ({
        ...fc,
        path: toRelPath(fc.path, root),
        ...(fc.previousPath ? { previousPath: toRelPath(fc.previousPath, root) } : {}),
      }))

      this.db
        .prepare(
          `INSERT INTO edit_logs (taco_id, state_version, author_id, change_ref, file_changes, changed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(tacoId, nextVersion, patch.author, '', JSON.stringify(normalizedChanges), nowIso)

      this.db
        .prepare('UPDATE shared_states SET state_version = ?, snapshot_json = ?, updated_at = ? WHERE taco_id = ?')
        .run(nextVersion, snapStr, nowIso, tacoId)

      const result = {
        stateVersion: nextVersion,
        savedAt: nowIso,
        historyWindowId,
      }

      this.db
        .prepare(
          `INSERT INTO mutation_receipts (taco_id, idempotency_key, action, status_code, response_body, created_at, request_hash)
           VALUES (?, ?, 'autosave', 200, ?, ?, ?)`,
        )
        .run(tacoId, idempotencyKey, JSON.stringify(result), nowIso, requestHash)
      for (const uid of usedUploadIds) {
        this.db.prepare('UPDATE upload_reservations SET content = NULL WHERE id = ? AND taco_id = ?').run(uid, tacoId)
      }
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {}
      throw err
    }
  }

  async listHistory(tacoId: string): Promise<HistoryVersionSummary[]> {
    this.ensureSchema()
    const rows = this.db
      .prepare('SELECT id, started_at, closed_at, latest_state_version FROM history_windows WHERE taco_id = ? ORDER BY started_at ASC')
      .all(tacoId) as unknown as SqliteHistoryWindowRow[]
    const now = Date.now()
    const WINDOW_DURATION_MS = 10 * 60 * 1000

    return rows.map((r) => {
      let closedAt = r.closed_at
      if (!closedAt) {
        const startTime = new Date(r.started_at).getTime()
        if (now - startTime >= WINDOW_DURATION_MS) {
          closedAt = new Date(startTime + WINDOW_DURATION_MS).toISOString()
        }
      }
      return {
        id: r.id,
        startedAt: r.started_at,
        closedAt: closedAt || null,
        latestStateVersion: r.latest_state_version,
      }
    })
  }

  async getHistoryVersion(tacoId: string, windowId: string): Promise<HistoryVersionDetail | null> {
    this.ensureSchema()
    const r = this.db
      .prepare('SELECT id, started_at, closed_at, latest_state_version, snapshot_json FROM history_windows WHERE taco_id = ? AND id = ?')
      .get(tacoId, windowId) as unknown as SqliteHistoryWindowRow | undefined
    if (!r) return null

    const now = Date.now()
    const WINDOW_DURATION_MS = 10 * 60 * 1000
    let closedAt = r.closed_at
    if (!closedAt) {
      const startTime = new Date(r.started_at).getTime()
      if (now - startTime >= WINDOW_DURATION_MS) {
        closedAt = new Date(startTime + WINDOW_DURATION_MS).toISOString()
      }
    }
    return {
      id: r.id,
      startedAt: r.started_at,
      closedAt: closedAt || null,
      latestStateVersion: r.latest_state_version,
      snapshot: JSON.parse(r.snapshot_json),
    }
  }

  async getReviewThreads(tacoId: string): Promise<CommentThread[]> {
    this.ensureSchema()
    const threads = this.db
      .prepare('SELECT id, status, anchor, is_anchor_stale, created_at, updated_at FROM persistent_comment_threads WHERE taco_id = ? ORDER BY created_at ASC')
      .all(tacoId) as unknown as SqliteCommentThreadRow[]

    const messages = this.db
      .prepare(`SELECT m.id, m.thread_id, m.author, m.body, m.created_at, m.deleted_at
                FROM persistent_comment_messages m
                JOIN comment_thread_actions a ON a.taco_id = m.taco_id AND a.thread_id = m.thread_id AND a.message_id = m.id AND a.type IN ('create', 'reply')
                WHERE m.taco_id = ? ORDER BY a.sequence ASC`)
      .all(tacoId) as unknown as SqliteCommentMessageRow[]

    const actions = this.db
      .prepare('SELECT sequence, thread_id, type, author, occurred_at, message_id FROM comment_thread_actions WHERE taco_id = ? ORDER BY sequence ASC')
      .all(tacoId) as unknown as SqliteCommentActionRow[]
    const messagesByThread = new Map<string, CommentThread['messages']>()
    for (const m of messages) {
      let list = messagesByThread.get(m.thread_id)
      if (!list) {
        list = []
        messagesByThread.set(m.thread_id, list)
      }
      list.push({
        id: m.id,
        author: m.author,
        body: m.deleted_at ? null : m.body,
        createdAt: m.created_at,
        deletedAt: m.deleted_at || null,
      })
    }

    const actionsByThread = new Map<string, CommentThread['actions']>()
    for (const a of actions) {
      let list = actionsByThread.get(a.thread_id)
      if (!list) {
        list = []
        actionsByThread.set(a.thread_id, list)
      }
      list.push({
        sequence: String(a.sequence),
        type: a.type,
        author: a.author,
        occurredAt: a.occurred_at,
        ...(a.message_id ? { messageId: a.message_id } : {}),
      })
    }

    return threads.map((t) => ({
      id: t.id,
      status: t.status,
      anchor: t.anchor ? JSON.parse(t.anchor) : null,
      isAnchorStale: Boolean(t.is_anchor_stale),
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      messages: messagesByThread.get(t.id) || [],
      actions: actionsByThread.get(t.id) || [],
    }))
  }

  async mutateReviewThread(
    tacoId: string,
    actionPayload: {
      author: string
      action: 'create' | 'reply' | 'resolve' | 'reopen' | 'delete'
      threadId?: string
      messageId?: string
      anchor?: unknown
      body?: string
    },
    idempotencyKey: string,
  ): Promise<{ status: 200 | 201; changed: boolean; event: StoredEvent }> {
    this.ensureSchema()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const taco = this.db.prepare('SELECT id, last_sequence, status FROM tacos WHERE id = ?').get(tacoId) as unknown as SqliteTacoRow | undefined
      if (!taco) throw new NotFoundError('Taco not found')
      if (taco.status === 'deleted' || taco.status === 'expired') {
        throw new GoneError('Taco is closed, expired, or deleted')
      }

      const requestHash = await sha256Hex(canonicalJsonStringify(actionPayload))
      const receipt = this.db
        .prepare('SELECT action, response_body, status_code, request_hash FROM mutation_receipts WHERE taco_id = ? AND idempotency_key = ?')
        .get(tacoId, idempotencyKey) as unknown as SqliteReceiptRow | undefined
      if (receipt) {
        if (receipt.action !== 'review') {
          try {
            this.db.exec('ROLLBACK')
          } catch {}
          throw new ConflictError(`Idempotency key has already been used for a different action: ${receipt.action}`)
        }
        if (!receipt.request_hash || receipt.request_hash !== requestHash) {
          try {
            this.db.exec('ROLLBACK')
          } catch {}
          throw new ConflictError('Idempotency key has already been used with an unverified or different request payload')
        }
        this.db.exec('COMMIT')
        const parsedReceipt = JSON.parse(receipt.response_body) as { event: StoredEvent }
        return { status: receipt.status_code as 200 | 201, changed: false, event: parsedReceipt.event }
      }
      const nextSequence = BigInt(taco.last_sequence) + 1n
      const nextSequenceStr = String(nextSequence)
      const nowIso = new Date().toISOString()
      let statusCode: 200 | 201 = 200
      let eventType = ''
      let eventData: Record<string, unknown> = {}

      if (actionPayload.action === 'create') {
        statusCode = 201
        eventType = 'comment.created'
        const threadId = actionPayload.threadId || randomUUID()
        const messageId = actionPayload.messageId || randomUUID()
        const body = actionPayload.body || ''
        const anchorJson = actionPayload.anchor ? JSON.stringify(actionPayload.anchor) : null

        this.db
          .prepare(
            `INSERT INTO persistent_comment_threads (id, taco_id, status, anchor, is_anchor_stale, created_at, updated_at)
             VALUES (?, ?, 'open', ?, 0, ?, ?)`,
          )
          .run(threadId, tacoId, anchorJson, nowIso, nowIso)

        this.db
          .prepare(
            `INSERT INTO persistent_comment_messages (id, taco_id, thread_id, author, body, created_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(messageId, tacoId, threadId, actionPayload.author, body, nowIso)

        this.db
          .prepare(
            `INSERT INTO comment_thread_actions (sequence, taco_id, thread_id, type, author, occurred_at, message_id)
             VALUES (?, ?, ?, 'create', ?, ?, ?)`,
          )
          .run(Number(nextSequence), tacoId, threadId, actionPayload.author, nowIso, messageId)

        eventData = { threadId, messageId, body, anchor: actionPayload.anchor || null }
      } else if (actionPayload.action === 'reply') {
        eventType = 'comment.replied'
        const threadId = actionPayload.threadId!
        const messageId = actionPayload.messageId || randomUUID()
        const body = actionPayload.body || ''

        const tCheck = this.db.prepare('SELECT id FROM persistent_comment_threads WHERE id = ? AND taco_id = ?').get(threadId, tacoId)
        if (!tCheck) throw new ValidationError(`Thread not found: ${threadId}`)

        this.db
          .prepare(
            `INSERT INTO persistent_comment_messages (id, taco_id, thread_id, author, body, created_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(messageId, tacoId, threadId, actionPayload.author, body, nowIso)

        this.db.prepare('UPDATE persistent_comment_threads SET updated_at = ? WHERE id = ? AND taco_id = ?').run(nowIso, threadId, tacoId)

        this.db
          .prepare(
            `INSERT INTO comment_thread_actions (sequence, taco_id, thread_id, type, author, occurred_at, message_id)
             VALUES (?, ?, ?, 'reply', ?, ?, ?)`,
          )
          .run(Number(nextSequence), tacoId, threadId, actionPayload.author, nowIso, messageId)

        eventData = { threadId, messageId, body }
      } else if (actionPayload.action === 'resolve') {
        eventType = 'thread.resolved'
        const threadId = actionPayload.threadId!
        const tCheck = this.db.prepare('SELECT id, status FROM persistent_comment_threads WHERE id = ? AND taco_id = ?').get(threadId, tacoId)
        if (!tCheck) throw new ValidationError(`Thread not found: ${threadId}`)

        this.db.prepare("UPDATE persistent_comment_threads SET status = 'resolved', updated_at = ? WHERE id = ? AND taco_id = ?").run(nowIso, threadId, tacoId)

        this.db
          .prepare(
            `INSERT INTO comment_thread_actions (sequence, taco_id, thread_id, type, author, occurred_at)
             VALUES (?, ?, ?, 'resolve', ?, ?)`,
          )
          .run(Number(nextSequence), tacoId, threadId, actionPayload.author, nowIso)

        eventData = { threadId }
      } else if (actionPayload.action === 'reopen') {
        eventType = 'thread.reopened'
        const threadId = actionPayload.threadId!
        const tCheck = this.db.prepare('SELECT id, status FROM persistent_comment_threads WHERE id = ? AND taco_id = ?').get(threadId, tacoId)
        if (!tCheck) throw new ValidationError(`Thread not found: ${threadId}`)

        this.db.prepare("UPDATE persistent_comment_threads SET status = 'open', updated_at = ? WHERE id = ? AND taco_id = ?").run(nowIso, threadId, tacoId)

        this.db
          .prepare(
            `INSERT INTO comment_thread_actions (sequence, taco_id, thread_id, type, author, occurred_at)
             VALUES (?, ?, ?, 'reopen', ?, ?)`,
          )
          .run(Number(nextSequence), tacoId, threadId, actionPayload.author, nowIso)

        eventData = { threadId }
      } else if (actionPayload.action === 'delete') {
        eventType = 'comment.deleted'
        const threadId = actionPayload.threadId!
        const messageId = actionPayload.messageId!

        this.db
          .prepare('UPDATE persistent_comment_messages SET body = NULL, deleted_at = ? WHERE id = ? AND thread_id = ? AND taco_id = ?')
          .run(nowIso, messageId, threadId, tacoId)

        this.db
          .prepare(
            `INSERT INTO comment_thread_actions (sequence, taco_id, thread_id, type, author, occurred_at, message_id)
             VALUES (?, ?, ?, 'delete', ?, ?, ?)`,
          )
          .run(Number(nextSequence), tacoId, threadId, actionPayload.author, nowIso, messageId)

        eventData = { threadId, messageId }
      }

      this.db.prepare('UPDATE shared_states SET comments_through_sequence = ? WHERE taco_id = ?').run(nextSequenceStr, tacoId)
      this.db.prepare('UPDATE tacos SET last_sequence = ?, updated_at = ? WHERE id = ?').run(Number(nextSequence), nowIso, tacoId)

      const event: StoredEvent = {
        id: `ev_${tacoId}_${nextSequenceStr}`,
        sequence: nextSequenceStr,
        tacoId,
        type: eventType,
        occurredAt: nowIso,
        actor: { kind: 'guest', id: actionPayload.author, displayName: actionPayload.author, verified: false },
        data: eventData,
      }

      this.db
        .prepare('INSERT INTO events (id, sequence, taco_id, type, occurred_at, actor, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(event.id, Number(nextSequence), tacoId, event.type, event.occurredAt, JSON.stringify(event.actor), JSON.stringify(event.data))

      this.db
        .prepare(
          `INSERT INTO mutation_receipts (taco_id, idempotency_key, action, status_code, response_body, created_at, request_hash)
           VALUES (?, ?, 'review', ?, ?, ?, ?)`,
        )
        .run(tacoId, idempotencyKey, statusCode, JSON.stringify({ event }), nowIso, requestHash)

      this.db.exec('COMMIT')
      return { status: statusCode, changed: true, event }
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {}
      throw err
    }
  }

  async commitHandoff(
    tacoId: string,
    payloadReq: { author: string; expectedStateVersion: string; expectedCommentsThroughSequence: string },
    idempotencyKey: string,
  ): Promise<HandoffCommit> {
    this.ensureSchema()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const taco = this.db.prepare('SELECT id, last_sequence, status FROM tacos WHERE id = ?').get(tacoId) as unknown as SqliteTacoRow | undefined
      if (!taco) throw new NotFoundError('Taco not found')
      if (taco.status === 'deleted' || taco.status === 'expired') {
        throw new GoneError('Taco is closed, expired, or deleted')
      }

      const requestHash = await sha256Hex(canonicalJsonStringify(payloadReq))
      const receipt = this.db
        .prepare('SELECT action, response_body, status_code, request_hash FROM mutation_receipts WHERE taco_id = ? AND idempotency_key = ?')
        .get(tacoId, idempotencyKey) as unknown as SqliteReceiptRow | undefined
      if (receipt) {
        if (receipt.action !== 'handoff') {
          try {
            this.db.exec('ROLLBACK')
          } catch {}
          throw new ConflictError(`Idempotency key has already been used for a different action: ${receipt.action}`)
        }
        if (!receipt.request_hash || receipt.request_hash !== requestHash) {
          try {
            this.db.exec('ROLLBACK')
          } catch {}
          throw new ConflictError('Idempotency key has already been used with an unverified or different request payload')
        }
        this.db.exec('COMMIT')
        return JSON.parse(receipt.response_body) as HandoffCommit
      }
      const baseline = this.db.prepare('SELECT title, root, snapshot_json FROM publish_baselines WHERE taco_id = ?').get(tacoId) as unknown as SqliteSharedStateRow | undefined
      if (!baseline) throw new NotFoundError('Taco has no immutable publish baseline')
      const baselineSnapshot: DocumentSnapshot = JSON.parse(baseline.snapshot_json)

      const current = this.db.prepare('SELECT state_version, comments_through_sequence, snapshot_json FROM shared_states WHERE taco_id = ?').get(tacoId) as unknown as SqliteSharedStateRow | undefined

      if (current.state_version !== payloadReq.expectedStateVersion) {
        throw new ConflictError(`Expected stateVersion ${payloadReq.expectedStateVersion} does not match current ${current.state_version}`)
      }
      if (current.comments_through_sequence !== payloadReq.expectedCommentsThroughSequence) {
        throw new ConflictError(`Expected commentsThroughSequence ${payloadReq.expectedCommentsThroughSequence} does not match current ${current.comments_through_sequence}`)
      }

      const currentSnapshot: DocumentSnapshot = JSON.parse(current.snapshot_json)
      const prev = this.db
        .prepare('SELECT id, state_version, comments_through_sequence, payload_json FROM handoffs WHERE taco_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(tacoId) as unknown as SqliteHandoffRow | undefined
      let previousSnapshot = baselineSnapshot
      if (prev) {
        if (
          prev.state_version === current.state_version &&
          prev.comments_through_sequence === current.comments_through_sequence
        ) {
          const result: HandoffCommit = {
            changed: false,
            handoffId: null,
            event: null,
          }
          this.db
            .prepare(
              `INSERT INTO mutation_receipts (taco_id, idempotency_key, action, status_code, response_body, created_at, request_hash)
               VALUES (?, ?, 'handoff', 200, ?, ?, ?)
               ON CONFLICT(taco_id, idempotency_key) DO UPDATE SET response_body = excluded.response_body, request_hash = excluded.request_hash`,
            )
            .run(tacoId, idempotencyKey, JSON.stringify(result), new Date().toISOString(), requestHash)
          this.db.exec('COMMIT')
          return result
        }

        const prevPayload: HandoffPayload = JSON.parse(prev.payload_json)
        const prevFilesMap = new Map<string, SnapshotFile>()
        for (const f of baselineSnapshot.files) prevFilesMap.set(f.path, f)
        const root = baselineSnapshot.root || '.'
        for (const cf of prevPayload.changedFiles) {
          const fullPath = toFullPath(cf.path, root)
          const fullPrevPath = cf.previousPath ? toFullPath(cf.previousPath, root) : undefined
          if (cf.changeType === 'deleted') {
            prevFilesMap.delete(fullPath)
          } else if (cf.changeType === 'renamed' && fullPrevPath) {
            const prevFile = prevFilesMap.get(fullPrevPath)
            prevFilesMap.delete(fullPrevPath)
            prevFilesMap.set(fullPath, {
              id: cf.id || prevFile?.id,
              path: fullPath,
              mediaType: cf.mediaType || prevFile?.mediaType || 'text/plain',
              content: cf.content || '',
            })
          } else if (cf.changeType === 'added') {
            prevFilesMap.set(fullPath, {
              id: cf.id,
              path: fullPath,
              mediaType: cf.mediaType || 'text/plain',
              content: cf.content || '',
            })
          } else {
            // modified
            const prevFile = prevFilesMap.get(fullPath)
            prevFilesMap.set(fullPath, {
              id: cf.id || prevFile?.id,
              path: fullPath,
              mediaType: cf.mediaType || prevFile?.mediaType || 'text/plain',
              content: cf.content || '',
            })
          }
        }
        previousSnapshot = {
          ...baselineSnapshot,
          files: Array.from(prevFilesMap.values()),
          checkpoints: prevPayload.checkpoints || undefined,
        }
      }

      const changedFiles = computeFileDiffs(baselineSnapshot.files, currentSnapshot.files, baselineSnapshot.root)
      const incrementalFiles = computeFileDiffs(previousSnapshot.files, currentSnapshot.files, baselineSnapshot.root)
      const checkpointChanges = computeCheckpointChanges(baselineSnapshot.checkpoints, currentSnapshot.checkpoints)
      const incrementalCheckpointChanges = computeCheckpointChanges(previousSnapshot.checkpoints, currentSnapshot.checkpoints)

      const checkpointDefinitionDelta: CheckpointDefinitionDelta = {
        from: baselineSnapshot.checkpoints || null,
        to: currentSnapshot.checkpoints || null,
      }
      const incrementalCheckpointDefinitionDelta: CheckpointDefinitionDelta = {
        from: previousSnapshot.checkpoints || null,
        to: currentSnapshot.checkpoints || null,
      }

      const comments = await this.getReviewThreads(tacoId)

      const handoffPayload: HandoffPayload = {
        root: baselineSnapshot.root,
        changedFiles,
        incrementalFiles,
        checkpointChanges,
        incrementalCheckpointChanges,
        checkpoints: currentSnapshot.checkpoints || null,
        checkpointDefinitionDelta,
        incrementalCheckpointDefinitionDelta,
        comments,
        commentsThroughSequence: current.comments_through_sequence,
      }

      const payloadStr = JSON.stringify(handoffPayload)
      if (new TextEncoder().encode(payloadStr).byteLength > 32 * 1024 * 1024) {
        throw new PayloadTooLargeError('Handoff payload exceeds 32 MiB limit')
      }

      const payloadHash = `sha256:${await sha256Hex(payloadStr)}`
      const handoffId = randomUUID()
      const nextSequence = BigInt(taco.last_sequence) + 1n
      const nextSequenceStr = String(nextSequence)
      const nowIso = new Date().toISOString()

      this.db
        .prepare(
          `INSERT INTO handoffs (id, taco_id, author, state_version, event_sequence, payload_ref, payload_hash, comments_through_sequence, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          handoffId,
          tacoId,
          payloadReq.author,
          current.state_version,
          Number(nextSequence),
          `tacos/${tacoId}/handoffs/${handoffId}.json`,
          payloadHash,
          current.comments_through_sequence,
          payloadStr,
          nowIso,
        )

      const handoffEvent: HandoffEvent = {
        kind: 'event',
        id: `ev_${tacoId}_${nextSequenceStr}`,
        sequence: nextSequenceStr,
        tacoId,
        type: 'review.handed_off',
        occurredAt: nowIso,
        actor: payloadReq.author,
        data: { handoffId },
      }

      this.db
        .prepare('INSERT INTO events (id, sequence, taco_id, type, occurred_at, actor, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(
          handoffEvent.id,
          Number(nextSequence),
          tacoId,
          handoffEvent.type,
          handoffEvent.occurredAt,
          JSON.stringify(handoffEvent.actor),
          JSON.stringify(handoffEvent.data),
        )

      this.db.prepare('UPDATE tacos SET last_sequence = ?, updated_at = ? WHERE id = ?').run(Number(nextSequence), nowIso, tacoId)

      const commitResult: HandoffCommit = {
        changed: true,
        handoffId,
        event: handoffEvent,
      }

      this.db
        .prepare(
          `INSERT INTO mutation_receipts (taco_id, idempotency_key, action, status_code, response_body, created_at, request_hash)
           VALUES (?, ?, 'handoff', 201, ?, ?, ?)`,
        )
        .run(tacoId, idempotencyKey, JSON.stringify(commitResult), nowIso, requestHash)

      this.db.exec('COMMIT')
      return commitResult
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {}
      throw err
    }
  }

  async getHandoff(tacoId: string, handoffId: string): Promise<HandoffRecord | null> {
    this.ensureSchema()
    const taco = this.db.prepare('SELECT status FROM tacos WHERE id = ?').get(tacoId) as unknown as SqliteTacoRow | undefined
    if (!taco) return null
    if (taco.status === 'deleted' || taco.status === 'expired') {
      throw new GoneError('Taco is deleted or expired')
    }

    const row = this.db.prepare('SELECT id, taco_id, author, created_at, payload_json FROM handoffs WHERE id = ? AND taco_id = ?').get(handoffId, tacoId) as unknown as SqliteHandoffRow | undefined
    return {
      id: row.id,
      tacoId: row.taco_id,
      author: row.author,
      createdAt: row.created_at,
      payload: JSON.parse(row.payload_json),
    }
  }

  async listListeners(tacoId: string): Promise<ListenerRecord[]> {
    this.ensureSchema()
    const nowIso = new Date().toISOString()
    const rows = this.db.prepare('SELECT listener_id, name, harness, model, model_id, last_seen_at, expires_at FROM listener_leases WHERE taco_id = ? AND expires_at > ?').all(tacoId, nowIso) as unknown as SqliteListenerRow[]
    return rows.map((r) => ({
      listenerId: r.listener_id,
      ...(r.name ? { name: r.name } : {}),
      ...(r.harness ? { harness: r.harness } : {}),
      ...(r.model ? { model: r.model } : {}),
      ...(r.model_id ? { modelId: r.model_id } : {}),
      lastSeenAt: r.last_seen_at,
      expiresAt: r.expires_at,
    }))
  }

  async upsertListenerLease(tacoId: string, listener: ListenerRecord): Promise<void> {
    this.ensureSchema()
    this.db
      .prepare(
        `INSERT INTO listener_leases (taco_id, listener_id, name, harness, model, model_id, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(taco_id, listener_id) DO UPDATE SET
           name = excluded.name,
           harness = excluded.harness,
           model = excluded.model,
           model_id = excluded.model_id,
           last_seen_at = excluded.last_seen_at,
           expires_at = excluded.expires_at`,
      )
      .run(
        tacoId,
        listener.listenerId,
        listener.name || null,
        listener.harness || null,
        listener.model || null,
        listener.modelId || null,
        listener.lastSeenAt,
        listener.expiresAt,
      )
  }

  async createUploadReservation(
    tacoId: string,
    params: { purpose: string; payloadBytes: number; payloadHash: string },
    idempotencyKey: string,
  ): Promise<{ uploadId: string; status: 'pending' | 'committed'; expiresAt: string }> {
    this.ensureSchema()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare("DELETE FROM upload_reservations WHERE expires_at < datetime('now')").run()

      const taco = this.db.prepare('SELECT id, status FROM tacos WHERE id = ?').get(tacoId) as unknown as SqliteTacoRow | undefined
      if (!taco) throw new NotFoundError('Taco not found')
      if (taco.status === 'deleted' || taco.status === 'expired') {
        throw new GoneError('Taco is closed, expired, or deleted')
      }

      const existing = this.db.prepare('SELECT id, status, expires_at, payload_hash, payload_bytes FROM upload_reservations WHERE taco_id = ? AND purpose = ? AND idempotency_key = ?').get(tacoId, params.purpose, idempotencyKey) as unknown as SqliteUploadReservationRow | undefined
      if (existing) {
        if (existing.payload_hash !== params.payloadHash || existing.payload_bytes !== params.payloadBytes) {
          try { this.db.exec('ROLLBACK') } catch {}
          throw new ConflictError('Idempotency key reused with different upload parameters')
        }
        this.db.exec('COMMIT')
        return {
          uploadId: existing.id,
          status: existing.status,
          expiresAt: existing.expires_at,
        }
      }

      const quota = this.db
        .prepare(`SELECT COUNT(*) as count, COALESCE(SUM(payload_bytes), 0) as total_bytes
                  FROM upload_reservations
                  WHERE taco_id = ? AND expires_at >= datetime('now') AND (status = 'pending' OR (status = 'committed' AND content IS NOT NULL))`)
        .get(tacoId) as unknown as { count: number; total_bytes: number }
      if (quota.count >= 10) {
        try { this.db.exec('ROLLBACK') } catch {}
        throw new PayloadTooLargeError('Too many active upload reservations for this Taco')
      }
      if (quota.total_bytes + params.payloadBytes > 33554432) {
        try { this.db.exec('ROLLBACK') } catch {}
        throw new PayloadTooLargeError('Cumulative unreferenced upload quota exceeded for this Taco (max 32 MiB)')
      }
      const uploadId = randomUUID()
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
      this.db
        .prepare(
          `INSERT INTO upload_reservations (id, purpose, taco_id, idempotency_key, payload_hash, payload_bytes, status, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(uploadId, params.purpose, tacoId, idempotencyKey, params.payloadHash, params.payloadBytes, new Date().toISOString(), expiresAt)

      this.db.exec('COMMIT')
      return {
        uploadId,
        status: 'pending',
        expiresAt,
      }
    } catch (err) {
      try { this.db.exec('ROLLBACK') } catch {}
      throw err
    }
  }

  async getUploadReservation(uploadId: string): Promise<UploadReservationRecord | null> {
    this.ensureSchema()
    const r = this.db.prepare('SELECT id, purpose, taco_id, idempotency_key, payload_hash, payload_bytes, status, expires_at FROM upload_reservations WHERE id = ?').get(uploadId) as unknown as SqliteUploadReservationRow | undefined
    if (!r) return null
    return {
      id: r.id,
      purpose: r.purpose,
      tacoId: r.taco_id,
      idempotencyKey: r.idempotency_key,
      payloadHash: r.payload_hash,
      payloadBytes: r.payload_bytes,
      status: r.status,
      expiresAt: r.expires_at,
    }
  }

  async commitUploadContent(uploadId: string, rawBytes: Uint8Array): Promise<void> {
    this.ensureSchema()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const r = this.db.prepare('SELECT taco_id, payload_bytes, status, expires_at FROM upload_reservations WHERE id = ?').get(uploadId) as unknown as SqliteUploadReservationRow | undefined
      if (!r) throw new NotFoundError('Upload reservation not found')
      if (new Date(r.expires_at).getTime() < Date.now()) {
        throw new GoneError('Upload reservation expired')
      }
      const quota = this.db
        .prepare(`SELECT COALESCE(SUM(payload_bytes), 0) as total_bytes
                  FROM upload_reservations
                  WHERE taco_id = ? AND id != ? AND expires_at >= datetime('now') AND status = 'committed' AND content IS NOT NULL`)
        .get(r.taco_id, uploadId) as unknown as { total_bytes: number }
      if (quota.total_bytes + r.payload_bytes > 33554432) {
        try { this.db.exec('ROLLBACK') } catch {}
        throw new PayloadTooLargeError('Committed unreferenced upload quota exceeded (max 32 MiB)')
      }
      const content = new TextDecoder().decode(rawBytes)
      this.db.prepare("UPDATE upload_reservations SET content = ?, status = 'committed' WHERE id = ?").run(content, uploadId)
      this.db.exec('COMMIT')
    } catch (err) {
      try { this.db.exec('ROLLBACK') } catch {}
      throw err
    }
  }

  async getUploadContent(uploadId: string): Promise<string | null> {
    const r = this.db.prepare('SELECT content FROM upload_reservations WHERE id = ?').get(uploadId) as unknown as { content: string | null } | undefined
    return r.content
  }

  async getEventsAfter(tacoId: string, afterSeq: bigint): Promise<StoredEvent[]> {
    this.ensureSchema()
    const rows = this.db
      .prepare('SELECT id, sequence, taco_id, type, occurred_at, actor, data FROM events WHERE taco_id = ? AND sequence > ? ORDER BY sequence ASC')
      .all(tacoId, Number(afterSeq)) as unknown as SqliteEventRow[]
    return rows.map((r) => ({
      id: r.id,
      sequence: String(r.sequence),
      tacoId: r.taco_id,
      type: r.type,
      occurredAt: r.occurred_at,
      actor: JSON.parse(r.actor),
      data: JSON.parse(r.data),
    }))
  }

  async getEventsPage(tacoId: string, afterSeq: bigint, throughSeq: bigint, limit: number): Promise<StoredEvent[]> {
    this.ensureSchema()
    const rows = this.db
      .prepare(`SELECT id, sequence, taco_id, type, occurred_at, actor, data FROM events
                WHERE taco_id = ? AND sequence > ? AND sequence <= ? ORDER BY sequence ASC LIMIT ?`)
      .all(tacoId, afterSeq, throughSeq, limit) as unknown as SqliteEventRow[]
    return rows.map((r) => ({
      id: r.id,
      sequence: String(r.sequence),
      tacoId: r.taco_id,
      type: r.type,
      occurredAt: r.occurred_at,
      actor: JSON.parse(r.actor),
      data: JSON.parse(r.data),
    }))
  }
}

let activeDb: TacoDb | null = null

export function getDatabase(): TacoDb {
  if (activeDb) return activeDb

  // Fail-closed enforcement:
  // If Vercel is detected, DATABASE_URL must be provided
  if (process.env.VERCEL) {
    if (!process.env.DATABASE_URL) {
      throw new DatabaseNotConfiguredError(
        'Vercel deployment detected but DATABASE_URL is not configured. Ephemeral or SQLite storage is forbidden in Vercel. Configure DATABASE_URL with a PostgreSQL database.',
      )
    }
    activeDb = new PostgresDbAdapter(process.env.DATABASE_URL)
    return activeDb
  }

  if (process.env.DATABASE_URL) {
    activeDb = new PostgresDbAdapter(process.env.DATABASE_URL)
    return activeDb
  }

  if (process.env.TACO_DB_PATH) {
    activeDb = new SqliteDbAdapter(process.env.TACO_DB_PATH)
    return activeDb
  }

  throw new DatabaseNotConfiguredError()
}
