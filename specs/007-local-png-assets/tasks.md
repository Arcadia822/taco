---
title: "Tasks: Local PNG Assets for Self-Contained Taco Reviews"
feature_branch: "007-local-png-assets"
created: "2026-09-09"
status: "Complete"
taco_scope: "tasks"
specification: "spec.md"
plan: "plan.md"
---

## Phase 1 — Planning & Specification

- [x] T001 Create `specs/007-local-png-assets/spec.md` with P1 user scenarios, independent tests, edge cases, and scope boundaries
- [x] T002 Create `specs/007-local-png-assets/plan.md` with architectural decisions, data models, and implementation steps
- [x] T003 Create `specs/007-local-png-assets/tasks.md` with phased task checklist

## Phase 2 — CLI Binary PNG Ingestion & Packaging

- [x] T004 Map `.png` extension to `image/png` in `extensions/taco/bin/taco.mjs`
- [x] T005 Update `collectFiles` in `extensions/taco/bin/taco.mjs` to read `.png` as binary buffers instead of decoding as UTF-8
- [x] T006 Add validation for PNG size (<=10 MiB), non-emptiness, and 8-byte magic header (`\x89PNG\r\n\x1a\n`)
- [x] T007 Encode binary PNG into `data:image/png;base64,...` data URL and compute `sourceHash` from raw binary buffer sha256
- [x] T008 Update `validateBundle` in `extensions/taco/bin/taco.mjs` to validate `image/png` data URL format and constraints

## Phase 3 — Model & Container Validation

- [x] T009 Add validation for `image/png` files in `parseBundle` (`src/model.ts`) to require a valid `data:image/png;base64,...` data URL format
- [x] T010 Ensure safe relative path checks apply consistently to bundled PNG assets

## Phase 4 — Markdown Image Path Resolution & Offline Rendering

- [x] T011 Implement relative path resolution helper in `src/markdown-assets.ts` handling sibling, parent (`..`), and nested paths relative to Markdown file directory
- [x] T012 Update `resolveEmbeddedMarkdownAssets` to match relative image references against bundled `image/png` files across all documents
- [x] T013 Update `HTMLImageElement.src` to the embedded data URL while preserving original relative path in `data-taco-source`

## Phase 5 — Non-Destructive Sync & Save

- [x] T014 Update `sync` in `extensions/taco/bin/taco.mjs` to read binary buffers for `image/png` files and compare SHA-256 binary hash
- [x] T015 Ensure `sync` writes binary buffers (`Buffer.from(base64, 'base64')`) without UTF-8 encoding when writing `image/png` files
- [x] T016 Update `writeHandle` / `unpackBundle` in `src/kernel/save.ts` to convert base64 data URLs to binary blobs when unpacking `image/png` files

## Phase 6 — Verification & Quality Assurance

- [x] T017 Add unit and integration tests for CLI packaging, corrupt/oversized validation, and sync in `tests/taco-cli.test.ts`
- [x] T018 Add unit tests for relative image resolution (top-level and nested `..`) in `tests/markdown-assets.test.ts`
- [x] T019 Add unit tests for `image/png` bundle validation and exact binary browser unpacking in `tests/model.test.ts` and `tests/save.test.ts`
- [x] T020 Run targeted test suites (`npx vitest run tests/taco-cli.test.ts tests/markdown-assets.test.ts tests/model.test.ts tests/save.test.ts`)
- [x] T021 Build Taco artifact (`npm run build`) and verify build succeeds
