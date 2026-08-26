---
title: 'Feature Specification: Comment Message Editing and Deletion'
feature_branch: '005-comment-message-actions'
created: '2026-08-26'
status: 'Draft'
taco_scope: 'spec'
source_issue: 'https://github.com/Arcadia822/taco/issues/6'
---

## Objective

Taco must let a reviewer edit an eligible comment message or delete one selected message without destroying the surrounding discussion. Message actions must remain understandable in a standalone writable Taco, deterministic under multi-peer collaboration, backward-compatible with existing Taco files, and distinct from the existing thread-level actions.

The feature preserves Taco's file-first transport model. Comment messages remain embedded transport objects inside the `.taco.html`; Taco does not introduce an account service, a server-side comment database, or verified enterprise identity.

## Product Decisions

1. **A deleted message becomes a tombstone.** Taco retains the message ID, author label, creation time, and position in the thread, replaces its canonical body with a fixed non-sensitive sentinel, and records `deletedAt`. The UI renders a localized “Message deleted” placeholder.
2. **Root and reply deletion use the same rule.** Deleting the first message never deletes the thread or its replies. Deleting the only message leaves a one-message tombstoned thread until the user explicitly chooses `Delete thread`.
3. **Message order never changes after creation.** Messages remain ordered by `createdAt`, then stable `id`. Editing or deleting a message updates thread activity but does not move that message within the thread.
4. **Edits are author-scoped in collaborative use.** Taco uses a stable, local, opaque comment principal stored per document and browser profile. A user may edit only an undeleted message whose `authorId` matches that principal. The value supports UI continuity; it is not a verified account identity or an authorization boundary outside Taco's normal writable-file capability.
5. **Every writable participant may delete any active message.** Message deletion is governed only by the Taco's existing writable/read-only capability and the message's active state; it never checks `authorId` or display name. In Taco's human-and-Agent writing workflow, deletion is cleanup of shared review state rather than a message-ownership or moderation privilege. The result remains visible as a tombstone and never masquerades as an edit by the original author.
6. **Legacy messages are preserved conservatively.** A message without a matching stable principal, including messages whose `authorId` came from the former ephemeral sync actor, is not editable through the UI. It remains individually deletable in a writable Taco.
7. **No full edit history in this feature.** Taco records an optional `updatedAt` marker and renders an `Edited` label. It does not retain prior message bodies or provide revision browsing, undo-after-save, or secure erasure from historical copies.

## User Scenarios & Testing

### User Story 1 — Correct my own comment without replacing the discussion (Priority: P1)

As a reviewer, I can correct an eligible message in place while preserving the message identity, author attribution, creation time, anchor, replies, and thread status.

**Why this priority**: A typo or clarification should not require deleting an entire discussion or posting a corrective reply that leaves the original mistake as canonical text.

**Independent Test**: Create a message with the current stable comment principal, edit it, cancel a second edit, save and reopen the Taco, and verify that only the committed body and edit marker changed.

**Acceptance Scenarios**:

1. **Given** a writable Taco and an undeleted message whose `authorId` matches the current local comment principal, **When** the user invokes `Edit`, **Then** Taco replaces the static body with an in-place editor prefilled with the complete current body.
2. **Given** the in-place editor is open, **When** the user changes the body and chooses `Save`, **Then** Taco preserves `id`, `author`, `authorId`, and `createdAt`, writes the new trimmed non-empty body, records `updatedAt`, updates the parent thread's `updatedAt`, and marks the Taco dirty.
3. **Given** the in-place editor is open, **When** the user chooses `Cancel` or presses Escape, **Then** Taco restores the original body and performs no store commit, timestamp change, sync operation, or dirty-state transition.
4. **Given** the edited value is empty after trimming, **When** the user chooses `Save`, **Then** Taco rejects the edit, keeps the editor open, and exposes an accessible validation message.
5. **Given** the edited value equals the current body after normalization, **When** the user chooses `Save`, **Then** Taco exits edit mode without changing `updatedAt`, thread activity, dirty state, or collaboration state.
6. **Given** a message has a valid `updatedAt` and no `deletedAt`, **When** Taco renders it, **Then** Taco shows a localized `Edited` marker and exposes the edit time to assistive technology without replacing the original creation time.
7. **Given** another message, reply, anchor, or thread status exists, **When** one message is edited, **Then** those sibling and thread fields remain byte-for-byte unchanged except for the parent thread's `updatedAt`.

---

### User Story 2 — Delete one message while preserving the thread (Priority: P1)

As a reviewer with a writable Taco, I can retract one message without deleting sibling replies or causing the whole thread to disappear.

**Why this priority**: Individual deletion is the core safety improvement over the current all-or-nothing thread delete action.

**Independent Test**: Delete a middle reply, the root message, and the only message in three separate fixtures; verify the same tombstone representation, stable ordering, and explicit survival of the thread.

**Acceptance Scenarios**:

1. **Given** any undeleted message in a writable Taco, **When** the user invokes `Delete`, **Then** Taco asks for confirmation that names the message-level effect and states that the thread and other replies will remain.
2. **Given** the confirmation is cancelled, **When** Taco returns to the thread, **Then** no message, timestamp, dirty state, or sync state changes.
3. **Given** deletion is confirmed, **When** the store commits the operation, **Then** Taco preserves the message `id`, `author`, `authorId`, and `createdAt`, replaces `body` with the canonical deleted-message sentinel, records `deletedAt`, records the same value in `updatedAt`, and updates the parent thread's `updatedAt`.
4. **Given** a deleted reply has siblings before and after it, **When** the thread rerenders, **Then** the selected position contains a localized tombstone and every sibling keeps its ID, body, metadata, and relative order.
5. **Given** the first message has replies, **When** the first message is deleted, **Then** the first position becomes a tombstone, every reply remains visible, the anchor remains active, and Taco does not resolve or delete the thread.
6. **Given** the thread contains only one message, **When** that message is deleted, **Then** the thread remains with one tombstone and the separate `Delete thread` action remains available.
7. **Given** a message already has `deletedAt`, **When** Taco renders it, **Then** Taco offers neither `Edit` nor message-level `Delete` and never exposes the canonical sentinel as authored text.
8. **Given** a deleted message has an inconsistent non-sentinel `body` after parsing or a CRDT merge, **When** Taco materializes or serializes the bundle, **Then** Taco normalizes that body to the canonical deleted-message sentinel before it can be displayed or saved as live comment content.

---

### User Story 3 — Keep edits attributable while deletion follows document authority (Priority: P1)

As a collaborator, I can tell which actions I am allowed to perform, and Taco never lets a self-declared display name silently impersonate another message author.

**Why this priority**: Editing another participant's words while retaining their author label would be more damaging than the missing edit feature.

**Independent Test**: Open the same thread as the originating browser profile, a second writable profile, a read-only copy, and a fixture containing legacy messages; compare the available actions and resulting mutations.

**Acceptance Scenarios**:

1. **Given** a writable Taco and a matching stable `authorId`, **When** the message action menu opens, **Then** it includes `Edit` and `Delete`.
2. **Given** a writable Taco and a non-matching or missing `authorId`, **When** the message action menu opens, **Then** it omits `Edit` and retains `Delete`.
3. **Given** two messages use the same self-declared `author` text but different `authorId` values, **When** one participant opens the thread, **Then** matching the display name alone does not grant edit access.
4. **Given** a sealed reader or collaboration viewer copy, **When** any message or thread renders, **Then** Taco exposes no edit, delete, reply, resolve, reopen, or thread-delete controls.
5. **Given** the current browser creates a new root message or reply, **When** Taco serializes it, **Then** the message carries the browser profile's stable per-document comment principal in `authorId`, not the ephemeral CRDT actor ID.
6. **Given** the same browser profile reopens the same `docId`, **When** it views a message created under the new principal scheme, **Then** the principal matches and the message remains editable.
7. **Given** a different browser profile or device opens a copied Taco, **When** it views that message, **Then** possession of the file and reuse of the same display name do not automatically claim the original `authorId`.
8. **Given** a pre-feature message has a legacy or ephemeral `authorId`, **When** the upgraded Taco opens it, **Then** Taco preserves the field without migration, does not offer edit unless it genuinely matches the new local principal, and still permits explicit deletion in a writable copy.

---

### User Story 4 — Preserve behavior across save, CLI review, and collaboration (Priority: P1)

As a human or Agent reviewing a Taco, I receive the same message state after saving, reopening, unpacking, CLI inspection, or multi-peer synchronization.

**Why this priority**: A browser-only UI operation would break Taco's central handoff contract and could reintroduce deleted feedback into Agent workflows.

**Independent Test**: Exercise edit and deletion through browser save/reopen, `pack --from`, `comments --json`, human CLI output, and two CRDT replicas receiving operations in opposite orders.

**Acceptance Scenarios**:

1. **Given** a Taco file created before this feature and containing messages without `updatedAt` or `deletedAt`, **When** the new runtime opens and saves it without message actions, **Then** all comment messages round-trip without added fields or rewritten bodies.
2. **Given** an edited message, **When** the Taco is saved, reopened, or refreshed through `pack --from`, **Then** the new body, `updatedAt`, stable ordering, and original creation metadata remain unchanged.
3. **Given** a deleted message, **When** the Taco is saved, reopened, or refreshed, **Then** its tombstone, `deletedAt`, canonical sentinel, and position remain unchanged.
4. **Given** `taco comments --json`, **When** it reports an active edited message, **Then** the result includes its current body and optional `updatedAt`; **when** it reports a deleted message, **Then** it identifies the message as deleted without presenting the sentinel as actionable authored feedback.
5. **Given** human-readable CLI comment output, **When** a thread contains a deleted message, **Then** the output shows an explicit deleted-message placeholder in the correct position.
6. **Given** the Agent review flow receives a thread with deleted and active messages, **When** it presents open feedback, **Then** deleted bodies are treated as thread context only and are not handed to the Agent as requests that still require resolution.
7. **Given** two peers concurrently edit the same active message, **When** all valid operations are delivered in any order, **Then** both replicas converge on the same current body, edit metadata, message ordering, and thread ordering.
8. **Given** one peer edits while another deletes the same message, **When** all operations converge, **Then** `deletedAt` governs materialization, both replicas display a tombstone, and neither displays the concurrent edited body as live content.
9. **Given** one peer deletes the root while another appends a reply, **When** all operations converge, **Then** both replicas retain the thread, retain the reply, and materialize the root tombstone first.
10. **Given** a new runtime attempts live collaboration with an incompatible pre-feature sync protocol, **When** protocol versions differ, **Then** Taco refuses mixed-protocol mutation instead of silently dropping deletion metadata.

---

### User Story 5 — Distinguish message deletion from thread deletion (Priority: P2)

As a reviewer, I can clearly tell whether an action retracts one message or destroys the complete discussion.

**Why this priority**: The new action adds little safety if the existing generic delete control remains ambiguous.

**Independent Test**: Inspect and invoke both controls with keyboard and pointer input, including translated UI, and verify their confirmation copy and resulting data mutations.

**Acceptance Scenarios**:

1. **Given** a message action surface, **When** destructive actions are shown, **Then** the individual action is labelled `Delete message` or an equivalently unambiguous localized label.
2. **Given** the thread-level action row, **When** its destructive control is shown, **Then** it is labelled `Delete thread` and remains visually separate from message controls.
3. **Given** `Delete thread` is invoked, **When** Taco asks for confirmation, **Then** the dialog explicitly states that the complete thread and all messages will be removed.
4. **Given** either confirmation is open, **When** the user navigates by keyboard or assistive technology, **Then** the action name, affected scope, cancel path, and destructive confirmation are programmatically available.

## Edge Cases

- A message timestamp is malformed but the rest of the legacy bundle is readable: Taco preserves the source value and uses the existing fallback date display; message ordering falls back to stable `id` when timestamps compare equally or cannot be normalized.
- A message is being edited when a remote peer edits or deletes it: remote deletion closes the editor and renders the tombstone; a remote edit refreshes the editor only after warning that the source changed, and Taco must not overwrite it with a stale local save.
- A thread is deleted remotely while a local message editor or confirmation is open: the transient UI closes without recreating the thread.
- A message edit and thread delete occur concurrently: thread deletion governs thread liveness; the message edit must not resurrect the thread.
- A deleted root has an unresolved anchor: the existing unresolved-anchor behavior remains unchanged; deleting the message does not modify the anchor.
- A resolved thread contains active or deleted messages: writable users retain the same message permissions; editing or deleting a message does not implicitly reopen the thread.
- A user opens more than one message editor in the same thread: Taco permits at most one active message editor per thread and asks the user to save or cancel before opening another.
- A deleted-message sentinel appears as an ordinary authored body without `deletedAt`: Taco treats it as authored text. Only the explicit metadata marks a tombstone.
- The browser lacks persistent local storage: Taco creates an in-memory comment principal for that page session, warns that edit ownership will not survive reopening, and never falls back to the display name.

## Functional Requirements

### Message data contract

- **FR-001**: `TacoCommentMessage` MUST continue to require non-empty `id`, `author`, `body`, and `createdAt` fields and MAY contain `authorId`, `updatedAt`, and `deletedAt`.
- **FR-002**: `updatedAt` and `deletedAt`, when present, MUST be valid ISO-8601 timestamps accepted by Taco's bounded input validation.
- **FR-003**: An active message MUST NOT contain `deletedAt` and MUST have a non-empty authored body.
- **FR-004**: A deleted message MUST preserve its stable ID, author label, optional author ID, and creation timestamp; MUST contain `deletedAt`; and MUST store the exact canonical deleted-message sentinel in `body`.
- **FR-005**: For a newly deleted message, `updatedAt` MUST equal `deletedAt`. A later merge MUST NOT make the message active merely because a newer `body` register exists.
- **FR-006**: Taco MUST render deletion from `deletedAt`, not by comparing the body with the sentinel.
- **FR-007**: Taco MUST normalize a materialized message with `deletedAt` to the canonical sentinel before browser display, file save, CLI output projection, or collaboration snapshot export.
- **FR-008**: The bundle transport format MUST remain `taco/files` version 1; the new message fields are optional backward-compatible extensions.
- **FR-009**: Taco MUST preserve unknown extra message fields allowed by the bundle's forward-compatible transport behavior unless the security boundary explicitly rejects them.

### Ordering and thread lifecycle

- **FR-010**: Taco MUST materialize thread messages in ascending `createdAt` order with ascending stable `id` as the deterministic tie-breaker.
- **FR-011**: Editing or deleting a message MUST NOT change its message position or creation timestamp.
- **FR-012**: Editing or deleting a message MUST update the parent thread's `updatedAt`; path-level thread lists continue to sort by descending thread `updatedAt`.
- **FR-013**: A thread MUST remain valid when all of its messages are tombstones; Taco MUST NOT implicitly delete the thread because no active body remains.
- **FR-014**: Root-message deletion, reply deletion, and only-message deletion MUST use the same tombstone representation.
- **FR-015**: Only the explicit thread-delete operation MAY remove the `TacoCommentThread` and all of its messages as one destructive action.

### Editing behavior

- **FR-016**: An eligible message MUST expose an accessible in-place edit action with prefilled body, `Save`, and `Cancel` controls.
- **FR-017**: Save MUST reject empty or whitespace-only bodies and MUST treat an unchanged normalized value as a no-op.
- **FR-018**: A successful edit MUST preserve message identity and authorship fields, replace only the current body, set `updatedAt`, and commit through the existing comment store path.
- **FR-019**: Cancel MUST restore the pre-edit UI without mutating the bundle, store, CRDT document, dirty state, or timestamps.
- **FR-020**: Taco MUST display an edited marker only when `updatedAt` exists and `deletedAt` does not exist.
- **FR-021**: A stale local editor MUST NOT overwrite a message that a remote peer changed after editing began without an explicit conflict decision.

### Deletion behavior

- **FR-022**: Every active message in a writable Taco MUST expose an accessible message-delete action, subject to a confirmation that distinguishes it from thread deletion.
- **FR-023**: Confirmed deletion MUST write a tombstone through the existing comment store path and MUST NOT splice sibling messages or the parent thread from the bundle.
- **FR-024**: Deleted messages MUST render a localized placeholder and MUST expose no message edit or repeat-delete actions.
- **FR-025**: Message deletion MUST NOT alter thread anchor, status, creation time, or sibling data.
- **FR-026**: The thread-delete action MUST remain available, be renamed unambiguously, and retain separate confirmation and whole-thread semantics.

### Principal and permissions

- **FR-027**: Taco MUST maintain a stable, opaque comment principal per `docId` and browser profile, independent of the self-declared display name and CRDT session actor.
- **FR-028**: New root messages and replies MUST store that principal in `authorId`.
- **FR-029**: Taco MUST offer message editing only when the Taco is writable, the message is active, and the message `authorId` equals the current principal.
- **FR-030**: Taco MUST NOT grant edit access by comparing `author`, presence name, or any other self-declared display text.
- **FR-031**: Taco MUST permit every writable participant to delete any active message. The deletion gate MUST NOT compare `authorId`, `author`, presence name, or another ownership signal; it is derived solely from the existing writable-file capability and MUST NOT be described as verified message ownership.
- **FR-032**: A read-only Taco MUST expose no mutating message or thread controls and MUST reject attempted programmatic commits through the existing store guard.
- **FR-033**: When persistent storage is unavailable, Taco MUST use a session-only principal and clearly communicate that edit continuity will end with the session.

### Persistence, synchronization, and tooling

- **FR-034**: Browser save, save copy, autosave where applicable, reopen, CLI `pack --from`, and unpack MUST preserve active, edited, and deleted messages without changing sibling content or order.
- **FR-035**: Synchronized comment-message nodes MUST include the optional message timestamps, and sync validation MUST bound and validate them before CRDT application.
- **FR-036**: The live sync protocol MUST use a new protocol version when deletion metadata becomes part of the allowed operation vocabulary; incompatible peers MUST not partially synchronize message deletion.
- **FR-037**: CRDT convergence MUST make a tombstone dominate presentation in every edit-versus-delete interleaving, while whole-thread deletion continues to dominate message edits or insertions it causally covers.
- **FR-038**: `taco comments --json` MUST expose `updatedAt` and deletion state without returning the deleted sentinel as active feedback text.
- **FR-039**: Human-readable CLI output MUST preserve message positions and label tombstones explicitly.
- **FR-040**: Agent review instructions and comment projections MUST preserve complete thread context while excluding deleted messages from the set of open requests to act on.
- **FR-041**: Existing Taco files that omit all new fields MUST remain readable and writable without migration or format-version change.

### Interaction, accessibility, and localization

- **FR-042**: Message actions MUST be discoverable by pointer and keyboard and MUST have programmatic names that include their scope.
- **FR-043**: Opening edit mode MUST move focus into the editor; cancelling or saving MUST return focus to the originating message action.
- **FR-044**: Destructive confirmations MUST expose affected scope, consequence, cancel, and confirm controls without relying on color alone.
- **FR-045**: `Edited`, `Message deleted`, `Edit`, `Delete message`, `Delete thread`, validation errors, conflict notices, and storage-continuity notices MUST be localized in every locale Taco ships.
- **FR-046**: The message action layout MUST remain usable in the existing narrow comments panel without document-level horizontal overflow.

## Key Entities

- **Comment message**: One stable entry in a thread, identified independently from the thread and ordered by creation time plus ID.
- **Active message**: A message without `deletedAt`; its `body` is current authored feedback.
- **Edited message**: An active message with `updatedAt`; Taco exposes only the current body and an edit marker.
- **Deleted-message tombstone**: A message retaining structural metadata and position while carrying `deletedAt` and the canonical non-sensitive sentinel body.
- **Comment principal**: A stable local opaque identifier used to decide whether this browser profile may edit a message. It is not an account, verified person, or enterprise identity.
- **Thread activity time**: `TacoCommentThread.updatedAt`, changed by replies, status changes, message edits, and message deletions and used for deterministic thread ordering.
- **Thread delete**: The existing explicit operation that removes the complete thread and remains separate from message tombstoning.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every P1 acceptance scenario has an automated browser, model/store, CLI, or CRDT test at the lowest layer that can prove it without relying only on visual inspection.
- **SC-002**: In deletion fixtures containing multiple messages, the IDs, bodies, authorship metadata, and relative order of every non-target sibling are identical before and after the operation.
- **SC-003**: The root-delete plus concurrent-reply, reply-delete plus concurrent-edit, edit-versus-delete, and concurrent-edit fixtures converge to byte-equivalent synchronized documents on all replicas after full delivery.
- **SC-004**: A pre-feature `taco/files` version 1 fixture with no optional message timestamps opens, saves, repacks, and reopens without any comment diff when no message action is performed.
- **SC-005**: All sealed-reader and viewer fixtures expose zero mutating controls and reject direct store mutation attempts.
- **SC-006**: JSON and human CLI fixtures never present a deleted sentinel as an active request while retaining the tombstone's correct position in the thread history.
- **SC-007**: English and Simplified Chinese UI tests cover every new user-visible string and accessible destructive-action label.
- **SC-008**: The complete repository gate, including collaboration convergence, CLI round-trip, production build, shell synchronization, and existing regression tests, passes through `npm run check`.

## Assumptions

- The existing writable/read-only capability remains the complete authority for message deletion: every writable participant may delete any active message, and read-only participants may delete none. This feature does not add ownership, moderation, or server-side authorization layers.
- `authorId` is an opaque local continuity token and may be inspected or modified by someone who already controls a writable file. The UI rule prevents accidental impersonation; it is not tamper-proof identity.
- The canonical deleted-message sentinel is an implementation constant, not localized authored content. Localization occurs only at presentation boundaries.
- Optional fields can extend `taco/files` version 1 because existing bundle parsing accepts additional message keys while continuing to require a non-empty body.
- Live synchronization requires a protocol-version change because older peers do not understand the deletion marker and could otherwise present inconsistent state.

## Out of Scope

- Full message revision history, diff viewing, restoring an earlier body, or undo after the changed Taco has been saved and closed.
- Verified accounts, SSO, enterprise identity, display-name verification, moderation roles, or server-side ownership enforcement.
- Cryptographic signatures on individual comment messages or message operations.
- Secure deletion from previously distributed Taco copies, relay history, CRDT tombstone history, browser backups, or version-control history.
- Redesigning anchors, resolve/reopen behavior, collaboration invitations, presence, or the thread-level data model.
- Reactions, mentions, rich-text comment bodies, attachments, or per-message branching.
