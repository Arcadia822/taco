---
title: 'Implementation Plan: Comment Message Editing and Deletion'
feature_branch: '005-comment-message-actions'
created: '2026-08-26'
status: 'Draft'
taco_scope: 'plan'
specification: 'spec.md'
---

## Summary

Implement issue #6 as a message-state extension rather than a new comment subsystem. Reuse the existing `TacoCommentMessage` identity, comment store commits, per-file synchronized nodes, and CRDT liveness/order machinery. Add an inline message editor, per-message delete confirmation, stable local comment principal, tombstone rendering, CLI projections, and convergence coverage.

The implementation keeps `taco/files` at version 1. It adds optional message fields and bumps the live collaboration protocol so older peers cannot silently discard or misinterpret deletion state.

## Technical Context

The current runtime already provides the most important structural prerequisite:

- each `TacoCommentMessage` has a stable `id`;
- each message is projected as its own `comment-message` sync node below the file node;
- materialization already sorts messages by `createdAt`, then `id`;
- thread and message changes already flow through `{ kind: 'comments', path }` store commits;
- CRDT node tombstones and last-writer-wins registers already converge independently of DOM state.

The current gaps are concentrated in presentation, mutation helpers, identity continuity, optional message validation, protocol compatibility, and tests.

## Architecture Decisions

### 1. Message state model

Extend the transport type without changing its required legacy shape:

```ts
interface TacoCommentMessage {
  id: string
  author: string
  authorId?: string
  body: string
  createdAt: string
  updatedAt?: string
  deletedAt?: string
}
```

Use one canonical body sentinel for deleted messages:

```ts
const DELETED_COMMENT_BODY = '[Deleted message]'
```

The sentinel is deliberately non-empty so an older version-1 runtime can still parse the file. New code never decides deletion by body equality; only `deletedAt` creates a tombstone. A user may therefore write the same text as an ordinary active comment without ambiguity.

Centralize these operations in model/pure comment helpers rather than mutating message objects directly from the controller:

- `isDeletedMessage(message)`
- `normalizeCommentMessage(message)`
- `editCommentMessage(thread, messageId, body, timestamp)`
- `deleteCommentMessage(thread, messageId, timestamp)`
- `sortCommentMessages(messages)`

`normalizeCommentMessage` forces the sentinel whenever `deletedAt` exists. This prevents a concurrent body register from becoming visible after deletion and gives browser save, snapshots, and CLI projections one invariant.

### 2. Principal and permission policy

Do not reuse `TacoSyncSession.actor`: it is intentionally unique per session and cannot support edit continuity after reopen.

Add a small identity helper backed by local storage, scoped by `docId`, for example:

```text
taco-comment-principal:<docId> → opaque random identifier
```

The helper returns:

- a persisted principal when browser storage is available;
- a page-session principal plus a one-time continuity warning when persistence fails.

New root messages and replies write this value into `authorId`.

Permission helpers remain explicit and testable:

```ts
canEditMessage(bundle, message, principal) =
  bundleCanWrite(bundle)
  && !message.deletedAt
  && Boolean(message.authorId)
  && message.authorId === principal

canDeleteMessage(bundle, message) =
  bundleCanWrite(bundle)
  && !message.deletedAt

// Intentionally no authorId/display-name check: every writable participant
// may delete shared review state.
```

Display names do not participate. `authorId` participates only in edit eligibility; it never restricts deletion. Legacy messages are preserved but normally become delete-only because their former actor-derived `authorId` does not match the new principal.

This is an application UI rule, not a claim of verified ownership. A person who controls a writable Taco can still edit its JSON or source code; Taco must not describe the principal as an account identity.

### 3. UI state and interaction

Refactor `buildCommentThread` so every message is built by a dedicated `buildCommentMessage` method. Each active message receives a compact action menu or discoverable action buttons:

- `Edit` only when `canEditMessage` is true;
- `Delete message` when `canDeleteMessage` is true;
- no message actions on a tombstone or read-only copy.

Inline edit state is transient controller state keyed by `threadId/messageId` and stores the original body plus the revision observed when editing began. Only one editor may be open per thread.

Edit flow:

1. Replace the body with a textarea containing the current body.
2. Focus the textarea; expose Save and Cancel.
3. On Save, validate non-empty and changed content.
4. Before commit, compare the current message body/deletion state with the observed revision.
5. If unchanged, commit body and timestamps through the comment store.
6. If remotely changed, keep the local text and show an explicit stale-edit decision instead of overwriting.
7. Save or Cancel returns focus to the originating action.

Delete flow:

1. Open a scope-specific confirmation.
2. On confirm, call the pure tombstone helper inside one comment store commit.
3. Repaint comments and highlights only where necessary.
4. A remote deletion closes any local editor for that message.

Rename the existing thread action and confirmation to `Delete thread` so the two destructive scopes cannot be confused.

### 4. Ordering and thread activity

Keep the current materialized message order: ascending `createdAt`, then ascending `id`. Do not use message `updatedAt` for ordering.

A successful edit or deletion updates `thread.updatedAt`, so the path-level thread list may move the thread according to the existing descending activity sort. The behavior is deterministic and matches reply, resolve, and reopen activity.

A thread with only tombstones remains a valid thread. `applySyncDoc` must stop treating “no active bodies” as “no messages”; it should only omit a thread when no message nodes at all exist because the thread itself was deleted or malformed.

### 5. CRDT and protocol behavior

Keep each message as one existing CRDT child node. Editing emits field updates for `body` and `updatedAt`; deletion emits `body`, `updatedAt`, and `deletedAt` updates. No new operation kind is required.

Add `deletedAt` to the synchronized node vocabulary and validate both optional timestamps. Because an old peer rejects an unknown set key and does not understand tombstone presentation, increment the live protocol version (`SYNC_V`) and require exact compatibility before applying operations or snapshots.

Convergence rules:

- concurrent edit/edit: existing per-field LWW ordering selects one current body deterministically;
- edit/delete: any materialized message containing `deletedAt` is a tombstone regardless of the winning body register;
- delete/reply: independent message nodes survive and retain deterministic order;
- message edit/thread delete: thread/node liveness rules prevent the child edit from recreating a deleted parent;
- a later explicit undelete is not supported, so normal UI never removes `deletedAt`.

After remote application, normalize all deleted message bodies before exposing the bundle to the UI or persistence layer. A subsequent full projection/snapshot therefore carries the canonical sentinel.

### 6. Bundle, save, and CLI compatibility

Keep bundle version 1 because the new fields are optional and the required non-empty legacy body remains present.

Update all message projections:

- browser parser and type guards accept and validate `updatedAt` and `deletedAt`;
- sync node projection and rebuild retain both fields;
- save/reopen and `pack --from` preserve them;
- `comments --json` emits current active body, optional `updatedAt`, and explicit deletion state;
- deleted JSON entries omit active feedback text or return `body: null` plus `deleted: true` rather than exposing the sentinel as authored feedback;
- human output renders a stable `[message deleted]` presentation placeholder;
- Agent review receives complete ordered thread history but filters tombstones from actionable open messages.

An old runtime opening a newly saved file still sees a non-empty message body and does not reject the entire bundle. It may display the English sentinel literally because it does not know `deletedAt`; that is acceptable backward degradation and must be documented.

## Data Examples

### Edited active message

```json
{
  "id": "message-7f91",
  "author": "Ada",
  "authorId": "comment-principal-2f4a",
  "body": "Use the cache-safe path instead.",
  "createdAt": "2026-08-26T03:00:00.000Z",
  "updatedAt": "2026-08-26T03:12:00.000Z"
}
```

### Deleted message tombstone

```json
{
  "id": "message-7f91",
  "author": "Ada",
  "authorId": "comment-principal-2f4a",
  "body": "[Deleted message]",
  "createdAt": "2026-08-26T03:00:00.000Z",
  "updatedAt": "2026-08-26T03:15:00.000Z",
  "deletedAt": "2026-08-26T03:15:00.000Z"
}
```

## Permission Matrix

| Taco/message state | Edit message | Delete message | Delete thread |
|---|---:|---:|---:|
| Sealed reader or viewer | No | No | No |
| Writable, active, matching stable `authorId` | Yes | Yes | Yes |
| Writable, active, non-matching or missing `authorId` | No | Yes | Yes |
| Writable, legacy actor-derived `authorId` | Only on genuine match; normally No | Yes | Yes |
| Writable, tombstoned message | No | No | Yes |

## Change Map

### Runtime model and pure logic

- `src/model.ts`
  - add optional message timestamps;
  - validate ISO timestamps and tombstone invariants while retaining version-1 compatibility;
  - preserve extra fields according to the existing transport policy.
- `src/comments.ts`
  - add sentinel, sort, normalization, edit, deletion, and permission helpers;
  - keep anchor behavior unchanged.
- `src/identity.ts` or a focused `src/comment-identity.ts`
  - add the stable per-document comment principal and storage-failure fallback.

### Controller and presentation

- `src/comments-controller.ts`
  - render messages through a dedicated builder;
  - add per-message actions, inline edit state, stale-edit handling, and scoped confirmations;
  - use the stable principal for new roots and replies;
  - rename thread deletion and preserve focus.
- `src/styles.css`
  - style message action affordances, editor, tombstone, edited marker, validation, and narrow-panel behavior.
- `src/i18n.ts`
  - add all new strings in English and Simplified Chinese and include them in locale completeness tests.
- `src/ui-primitives.ts`
  - reuse or extend the existing confirmation/menu primitives only when needed; do not introduce a second dialog pattern.

### Store and collaboration

- `src/store.ts`
  - project and materialize optional message fields;
  - normalize tombstones after sync application;
  - keep created-time-plus-ID ordering.
- `src/sync/validation.ts`
  - add bounded timestamp validation and `deletedAt` to the allowed node keys;
  - reject malformed tombstones and incompatible snapshots atomically.
- `src/kernel/sync/crdt.ts` and `src/sync/session.ts`
  - bump the protocol version and update compatibility tests/messages;
  - retain existing operation algebra.
- `src/sync/online.ts` and relay tests
  - verify incompatible protocol refusal and normal signed-op transport; no relay schema change should be required.

### CLI, Agent flow, and documentation

- `extensions/taco/bin/taco.mjs`
  - preserve optional fields in validation and comment projections;
  - distinguish active and deleted messages in JSON and human output.
- `extensions/taco/commands/review.md`
  - instruct the Agent to read tombstones as context and process only active message bodies.
- `specs/001-taco-bento-product/data-model.md`
  - document optional message timestamps, tombstones, ordering, and local principal semantics.
- `specs/001-taco-bento-product/contracts/taco-document.md`
  - document version-1 extension and old-runtime degradation.
- README/changelog only where user-facing capability or release notes require it.

### Tests

- `tests/comments.test.ts`
  - pure edit/delete/normalize/order and permission tests.
- a controller-focused test file or existing browser/controller suite
  - action visibility, inline edit, validation, cancel, focus, confirmations, root/only-message behavior, and remote invalidation.
- `tests/model.test.ts`
  - legacy parse, optional timestamp validation, tombstone invariants, and forward-compatible round trip.
- `tests/collaboration.test.ts`
  - projection, materialization, protocol mismatch, and deterministic multi-replica interleavings.
- `tests/save.test.ts` and `tests/taco-cli.test.ts`
  - save/reopen, `pack --from`, JSON output, human output, and Agent-actionable filtering.
- `tests/i18n.test.ts` and accessibility tests
  - locale completeness, labels, focus return, and destructive-scope announcement.

## Implementation Sequence

1. Land the pure message model, sentinel invariant, ordering helper, stable principal, and tests without UI exposure.
2. Extend sync projection/validation and bump the live protocol; prove convergence and legacy bundle parsing.
3. Add controller edit/delete interactions and permission gating using the pure helpers.
4. Update CLI and Agent review projections so tombstones cannot become actionable feedback.
5. Update product data-model/contract documentation, refresh the generated Taco, and run the complete repository gate.

This order keeps data compatibility and convergence proven before the browser exposes destructive actions.

## Verification Strategy

### Unit and model verification

- active, edited, and tombstoned message validation;
- sentinel equality is not interpreted as deletion without `deletedAt`;
- edit no-op, empty validation, and cancel produce no mutation;
- deleting any position leaves all siblings unchanged;
- strict permission matrix without display-name fallback;
- storage-unavailable principal fallback.

### Collaboration verification

Use two and three `SyncState` replicas and replay operation batches in opposite and randomized valid orders for:

- concurrent edit/edit;
- edit/delete;
- root delete/concurrent reply;
- reply delete/concurrent sibling insert;
- message edit/concurrent thread delete;
- reconnect from a saved snapshot containing tombstones.

Assert byte-equivalent synchronized documents and identical materialized bundles after normalization.

### Round-trip and tooling verification

- browser save and reopen;
- `pack --from` refresh;
- inert CLI parse/validate;
- `comments --json` and human output;
- Agent review with a mixed active/deleted thread;
- old version-1 fixture with no optional fields and no diff after a no-op round trip.

### UI and accessibility verification

- pointer and keyboard action discovery;
- focus enters editor and returns to the trigger;
- Escape cancellation;
- explicit message-versus-thread confirmation text;
- tombstone and edit markers available to assistive technology;
- narrow comments panel and reduced-motion behavior;
- English and Simplified Chinese locale coverage.

### Repository gate

Run `npm run check` after rebuilding the single-file runtime and synchronizing the extension shell. The gate must include the new protocol, CLI, generated-shell, collaboration, and regression tests.

## Compatibility and Migration

- **Bundle format**: remains `taco/files` version 1.
- **Old files in new runtime**: open normally; optional fields are absent; legacy messages are preserved and normally delete-only.
- **New files in old runtime**: remain parseable because every message retains a non-empty body; edited markers are ignored and tombstones degrade to the canonical English sentinel.
- **Live mixed runtimes**: intentionally incompatible after the sync protocol bump; no partial message deletion synchronization.
- **Saved collaboration state**: a prior protocol snapshot is discarded and rebuilt from the canonical bundle according to existing version-mismatch behavior.
- **No automatic authorship migration**: Taco does not claim legacy messages by display name or rewrite old `authorId` values.

## Risks and Mitigations

- **Legacy comments become non-editable**: preserve deletion and whole-thread removal; document the limitation rather than trusting names. A future explicit claim/migration flow can be designed separately.
- **Tombstones accumulate**: messages are small and deletion context is valuable. Whole-thread delete remains the explicit garbage-collection path.
- **Concurrent body can out-stamp the sentinel**: presentation and serialization normalize from `deletedAt`, so the body can never become live while tombstoned.
- **Old runtime displays the sentinel literally**: this is deliberate graceful degradation required to keep version-1 parsing; new runtime localizes it.
- **Stable local principal is mistaken for verified identity**: use opaque naming in code/docs, never display it as an account, and keep all authorization language scoped to UI continuity.
- **Protocol bump interrupts live mixed-version rooms**: fail closed and provide an explicit incompatibility notice rather than silently losing deletion metadata.
- **Controller complexity creates stale overwrites**: store the observed message revision when edit mode opens and require an explicit conflict path before committing against remote changes.
