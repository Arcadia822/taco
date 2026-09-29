-- Taco Host Schema Migration (Vercel Functions + Neon Postgres)
-- Consistent lock order: api_keys -> upload_reservations -> tacos -> shared_states

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('anonymous', 'registered')),
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS tacos (
  id UUID PRIMARY KEY,
  owner_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  current_revision_id UUID NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'expired', 'deleted')) DEFAULT 'open',
  last_sequence BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_tacos_status ON tacos(status);

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
  revision_id UUID NULL,
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
CREATE INDEX IF NOT EXISTS idx_listener_leases_expiry ON listener_leases(expires_at);

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
  purpose TEXT NOT NULL CHECK (purpose IN ('publish', 'update', 'review-edit')),
  taco_id UUID NOT NULL REFERENCES tacos(id) ON DELETE RESTRICT,
  idempotency_key UUID NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL CHECK (payload_bytes > 0 AND payload_bytes <= 33554432),
  status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'abandoned')),
  content TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_upload_reservations_scope UNIQUE (taco_id, purpose, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_upload_reservations_cleanup ON upload_reservations(status, expires_at);

-- Legacy tables for backwards compatibility with 008 contracts
CREATE TABLE IF NOT EXISTS revisions (
  id UUID PRIMARY KEY,
  taco_id UUID NOT NULL REFERENCES tacos(id) ON DELETE RESTRICT,
  parent_revision_id UUID NULL REFERENCES revisions(id) ON DELETE RESTRICT,
  publisher_id TEXT NOT NULL,
  source_doc_id TEXT NULL,
  content_hash TEXT NOT NULL,
  blob_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT NOT NULL,
  revision_id UUID NOT NULL REFERENCES revisions(id) ON DELETE RESTRICT,
  taco_id UUID NOT NULL REFERENCES tacos(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  anchor JSONB NULL,
  is_anchor_stale BOOLEAN NOT NULL DEFAULT FALSE,
  is_imported BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by TEXT NULL,
  resolved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (revision_id, id)
);

CREATE TABLE IF NOT EXISTS thread_messages (
  id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  revision_id UUID NOT NULL,
  author_kind TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_display_name TEXT NOT NULL,
  author_verified BOOLEAN NOT NULL DEFAULT FALSE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,
  PRIMARY KEY (revision_id, thread_id, id),
  FOREIGN KEY (revision_id, thread_id) REFERENCES threads(revision_id, id) ON DELETE CASCADE
);
