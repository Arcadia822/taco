-- Taco Host Schema Migration (Vercel Functions + Neon Postgres)
-- Consistent lock order: api_keys (FOR SHARE/UPDATE) -> upload_reservations (FOR UPDATE) -> tacos (FOR UPDATE)

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

CREATE TABLE IF NOT EXISTS upload_reservations (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK (purpose IN ('publish', 'update')),
  target_scope TEXT NOT NULL, -- 'global:publish' or taco UUID
  idempotency_key UUID NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL CHECK (payload_bytes > 0 AND payload_bytes <= 33554432),
  taco_id UUID NOT NULL,
  revision_id UUID NOT NULL,
  blob_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'abandoned')),
  expires_at TIMESTAMPTZ NOT NULL,
  url_valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_upload_reservations_scope UNIQUE (user_id, purpose, target_scope, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_upload_reservations_cleanup ON upload_reservations(status, expires_at);

CREATE TABLE IF NOT EXISTS tacos (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  current_revision_id UUID NULL, -- Deferrable or set on initial revision commit
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'expired', 'deleted')),
  last_sequence BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_tacos_owner_id ON tacos(owner_id);

CREATE TABLE IF NOT EXISTS revisions (
  id UUID PRIMARY KEY,
  taco_id UUID NOT NULL REFERENCES tacos(id) ON DELETE RESTRICT,
  parent_revision_id UUID NULL REFERENCES revisions(id) ON DELETE RESTRICT,
  publisher_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_doc_id TEXT NULL,
  content_hash TEXT NOT NULL,
  blob_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_revisions_taco_id ON revisions(taco_id, created_at);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  sequence BIGINT NOT NULL,
  taco_id UUID NOT NULL REFERENCES tacos(id) ON DELETE RESTRICT,
  revision_id UUID NULL REFERENCES revisions(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'guest')),
  actor_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  actor_verified BOOLEAN NOT NULL DEFAULT FALSE,
  data JSONB NOT NULL,
  CONSTRAINT uq_events_taco_seq UNIQUE (taco_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_events_taco_seq ON events(taco_id, sequence ASC);

CREATE TABLE IF NOT EXISTS mutation_receipts (
  taco_id UUID NOT NULL REFERENCES tacos(id) ON DELETE RESTRICT,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'guest')),
  actor_id TEXT NOT NULL,
  idempotency_key UUID NOT NULL,
  status_code INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (taco_id, actor_kind, actor_id, idempotency_key)
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

CREATE TABLE IF NOT EXISTS reviewer_states (
  revision_id UUID NOT NULL REFERENCES revisions(id) ON DELETE RESTRICT,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  actor_verified BOOLEAN NOT NULL DEFAULT FALSE,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at_sequence BIGINT NULL,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  approved_at TIMESTAMPTZ NULL,
  PRIMARY KEY (revision_id, actor_kind, actor_id)
);
