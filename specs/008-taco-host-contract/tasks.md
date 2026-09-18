---
title: 'Tasks: 008-taco-host-contract (Taco CLI & Host on Vercel)'
feature_branch: '008-taco-host-contract'
status: 'Complete'
taco_scope: 'tasks'
specification: 'spec.md'
plan: 'plan.md'
---

## Phase 1 — Shared Protocol Extraction & Standalone CLI Skeleton

- [x] T001 Establish npm workspaces and extract pure protocol validators (JCS canonicalization, JCS SHA-256, SafePath, and white-list projection) into `packages/protocol/`, with `src/` referencing the workspace package
- [x] T002 Initialize `packages/cli/` workspace with independent `package.json`/`tsconfig.json` and entrypoint `packages/cli/src/main.ts` (depends only on `@taco/protocol`)
- [x] T003 Implement CLI argument parser complying with `contracts/cli.md` (forbid `--json`/`--public`, exit 2 on unknown flags, default compact JSON on stdout, structured ErrorResponse on stderr)
- [x] T004 Implement offline `help` command producing `taco-cli-help/1` hierarchical JSON for root and individual subcommands
- [x] T005 Implement embedded guides loader and `skills list` / `skills read` commands producing `taco-cli-skills/1` JSON without network dependencies
- [x] T006 Implement local projection and dry-run preview for `publish --dry-run` and `update --dry-run`
- [x] T007 Add automated tests verifying CLI parser, offline help, embedded skills, and dry-run behavior

## Phase 2 — Serverless Host Core & Postgres/Blob Storage

- [x] T008 Initialize `packages/host/` Vercel Functions workspace (independent `package.json`/`tsconfig.json`, Node.js runtime, TypeScript, `@neondatabase/serverless` / `pg` connection pooling; depends only on `@taco/protocol`)
- [x] T009 Define PostgreSQL database schema migrations (`users`, `api_keys`, `tacos`, `revisions`, `events`, `upload_reservations`, `mutation_receipts`, `threads`, `reviewer_states`) with lock order and index design
- [x] T010 Implement `/v1/capabilities` returning protocol version, 32 MiB payload limit, 64 KiB control limit, and data retention policies
- [x] T011 Implement `/v1/anonymous-credentials` (rate-limited automatic User + ApiKey generation with salted hash storage)
- [x] T012 Implement `/v1/uploads` (upload reservation management, pending/committed discrimination, and short-lived private PUT presigned Blob URL generation)
- [x] T013 Implement lightweight atomic commit endpoints `POST /v1/tacos` and `POST /v1/tacos/{id}/revisions` (private Blob stream verification, Postgres per-Taco row lock, and revision.published event commit)
- [x] T014 Implement `/v1/tacos/{id}/reviews` mutation handling (comment.created, comment.replied, thread resolution, review completion, revision approval, and no-op idempotent semantics)
- [x] T015 Implement public read endpoints `GET /v1/tacos/{id}`, `GET /v1/tacos/{id}/revisions`, and `GET /v1/tacos/{id}/reviews` with cursor pagination
- [x] T016 Implement streaming endpoints `GET /v1/tacos/{id}/revisions/{rev}` and `GET /v1/tacos/{id}/export` (streaming JSON directly from private Blob to bypass 4.5 MB function limit)
- [x] T017 Add unit and integration tests for Host auth, upload reservations, concurrent revision conflict checking, and event commits

## Phase 3 — End-to-End CLI Remote Operations & Realtime WebSockets

- [x] T018 Implement CLI credential management (secure keychain storage with fallback to 0600 file permissions, origin binding, and environment variable overrides)
- [x] T019 Implement CLI two-phase upload flow (request reservation -> direct PUT to Blob -> commit with identical Idempotency-Key)
- [x] T020 Implement WebSocket subscription endpoint `GET /v1/tacos/{id}/subscribe` (high-watermark capture, replay backfill, 1s durable Postgres event tail polling, and 240s graceful 1012 rotation)
- [x] T021 Implement CLI `subscribe` command (NDJSON streaming stdout, backpressure handling, auto-reconnect on 1012 with cursor, and clean exit 0 on 1000 taco.closed)
- [x] T022 Implement CLI `events`, `close`, `export`, and `delete` commands
- [x] T023 Add end-to-end integration tests covering remote publish, base conflict detection, connection drop recovery, and export validation

## Phase 4 — Public Review Web Surface & Release Packaging

- [x] T024 Create minimal static review web application (read-only snapshot view, Markdown/PNG rendering, anchor highlighting, and discussion threads)
- [x] T025 Implement web guest session integration (`POST /v1/guest-session`, cookie auth, CSRF headers, and review submissions)
- [x] T026 Execute and verify the 21 acceptance scenarios defined in `spec.md` Section 10
- [x] T027 Setup standalone binary compilation pipeline (cross-platform executable packaging for macOS/Linux)
