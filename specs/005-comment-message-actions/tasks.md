---
title: 'Tasks: Comment Message Editing and Deletion'
feature_branch: '005-comment-message-actions'
created: '2026-08-26'
status: 'Draft'
taco_scope: 'tasks'
specification: 'spec.md'
plan: 'plan.md'
---

## Phase 1 — Contract and pure message model

- [x] T001 Add optional `updatedAt` and `deletedAt` fields to `TacoCommentMessage` without changing `taco/files` version 1
- [x] T002 Add bounded ISO timestamp validation and legacy-message round-trip fixtures in `src/model.ts` and `tests/model.test.ts`
- [x] T003 Define the canonical non-empty deleted-message sentinel and ensure body equality alone never creates a tombstone
- [x] T004 Add pure helpers for message ordering, tombstone detection, normalization, edit, and deletion in `src/comments.ts`
- [x] T005 Require `deletedAt` materialization and serialization to normalize the body to the canonical sentinel
- [x] T006 Add unit tests proving edit invariants, no-op behavior, all deletion positions, all-tombstone threads, and unchanged siblings

## Phase 2 — Stable principal and permission rules

- [x] T007 Add a stable opaque comment principal scoped by `docId` and browser profile, separate from the CRDT session actor and display name
- [x] T008 Add a session-only fallback and one-time continuity notice for unavailable persistent storage
- [x] T009 Store the new principal in `authorId` for every newly created root message and reply
- [x] T010 Add pure `canEditMessage` and `canDeleteMessage` helpers: edit requires matching principal, while delete requires only a writable Taco and an active message
- [x] T011 Add tests proving every writable profile can delete matching, non-matching, missing, and legacy-author messages, while edit remains principal-scoped and read-only/tombstoned messages remain immutable

## Phase 3 — Message interaction and presentation

- [x] T012 Refactor `CommentsController` to build each message through a dedicated render method with stable message/thread data attributes
- [x] T013 Add accessible per-message Edit and Delete message actions with permission gating and no controls in read-only copies
- [x] T014 Implement one inline editor per thread with prefilled body, Save, Cancel, Escape handling, empty validation, no-op detection, and focus return
- [x] T015 Detect a remote edit or deletion after edit mode opens and prevent a stale local save from silently overwriting it
- [x] T016 Implement message deletion confirmation and commit the tombstone without splicing the thread or sibling messages
- [x] T017 Render localized tombstones and Edited markers while preserving author and creation metadata
- [x] T018 Rename and separate the existing destructive action and confirmation as Delete thread
- [x] T019 Add narrow-panel, keyboard, focus-visible, validation, tombstone, and reduced-motion styling
- [x] T020 Add English and Simplified Chinese strings and locale-completeness tests for every new interaction and notice

## Phase 4 — Store, CRDT, and live compatibility

- [x] T021 Extend sync node projection and materialization to preserve optional message timestamps and normalize tombstones
- [x] T022 Add `deletedAt` to the validated synchronized node vocabulary and reject malformed message state atomically
- [x] T023 Increment the live sync protocol version and add explicit incompatible-peer handling and tests
- [x] T024 Add convergence tests for concurrent edit/edit and assert identical materialized body, metadata, and ordering
- [x] T025 Add convergence tests for edit/delete and assert tombstone presentation regardless of the winning body register
- [x] T026 Add convergence tests for root delete/concurrent reply and reply delete/concurrent sibling insertion
- [x] T027 Add a message edit/concurrent thread delete test proving child mutation cannot resurrect a deleted thread
- [x] T028 Add saved-snapshot and reconnect tests for edited and tombstoned messages

## Phase 5 — Save, CLI, and Agent review flow

- [x] T029 Add browser save/reopen and `pack --from` round-trip fixtures for active, edited, deleted, root-deleted, and all-tombstone threads
- [x] T030 Extend `taco comments --json` with optional edit metadata and explicit deletion state without exposing the sentinel as active feedback
- [x] T031 Update human-readable CLI output to show tombstones in their ordered thread positions
- [x] T032 Update `speckit.taco.review` instructions and projections so deleted messages remain context but are never treated as open requests
- [x] T033 Add CLI and Agent-flow tests containing mixed active, edited, and deleted messages
- [x] T034 Verify a pre-feature version-1 fixture has no comment diff after an action-free browser and CLI round trip

## Phase 6 — Documentation, accessibility, and release gate

- [x] T035 Update the product data model with message states, ordering, tombstones, principal semantics, and legacy behavior
- [x] T036 Update the Taco container contract with optional fields, old-runtime sentinel degradation, and live protocol incompatibility
- [x] T037 Add UI tests for root deletion, only-message deletion, resolved threads, remote deletion during edit, and remote thread removal during confirmation
- [x] T038 Add accessibility tests for action names, destructive scope, validation announcements, editor focus, and focus restoration
- [x] T039 Add a regression test proving identical display names never grant edit permission
- [x] T040 Update the changelog and user-facing capability documentation without claiming verified identity or secure erasure
- [x] T041 Run `npm run check`, rebuild the self-contained runtime, synchronize the extension shell, and resolve every regression
- [x] T042 Refresh `005-comment-message-actions.taco.html` from the canonical feature directory and review the generated artifact through Taco
