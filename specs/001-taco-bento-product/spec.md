---
title: "Feature Specification: Taco File Browser"
---

## Product Thesis

Taco is a local browser that travels alongside a Spec Kit file tree. When a user opens a `.taco.html`, they see the original Markdown, YAML, JSON, and directory relationships — not a projection converted into another domain database.

The canonical source is the files. Stage navigation, the directory hierarchy, the WYSIWYG view, the in-document outline, and search results are all derived views.

## User Scenarios & Testing

### User Story 1 — Open and browse the complete spec (Priority: P1)

As a collaborator who receives a Taco, I want to open the file and see the complete specification material organized by the three working stages, so I can quickly identify the core and related documents for each stage.

**Independent Test**: Open the Taco offline, expand every folder level, and open each embedded file without producing any network request.

**Acceptance Scenarios**:

1. **Given** the Taco contains a feature-root `README.md`, **When** the user opens the file, **Then** the left side shows only the Specify, Plan, and Tasks groups, places `README.md` in Specify, and selects it by default.
2. **Given** the bundle contains core, convention, and other Markdown files, **When** navigation is derived, **Then** `README.md`, core, and convention paths are classified by built-in rules and other Markdown enters one of the three default stages through a valid YAML `taco_scope`, without producing extension or custom groups.
3. **Given** `contracts/`, `checklists/`, or another subdirectory contains multiple files, **When** they appear in navigation, **Then** the real directory hierarchy is preserved and the same physical directory is never split across multiple standard stages by a file declaration.
4. **Given** `checklists/` contains requirements and implementation checks, **When** navigation is derived, **Then** the whole directory is grouped under Plan as a quality gate after Plan and before Tasks.
5. **Given** the user hovers or keyboard-focuses one of the three group headings, **When** the group is collapsible, **Then** a centered disclosure icon appears on the right of the secondary heading; the left side of the heading must not occupy an icon slot.
6. **Given** the user selects any file, **When** the viewer updates, **Then** the file path, format, and raw content match the bundle exactly.
7. **Given** a narrow viewport, **When** the page loads, **Then** stage navigation is collapsed by default and can be opened from the control in the left sidebar header.

### User Story 2 — Read Markdown (Priority: P1)

As a spec reviewer, I want Markdown to be edited directly in a WYSIWYG surface like common docs/wiki pages while still saving canonical Markdown, so I get both writing efficiency and file fidelity.

**Independent Test**: Open Markdown containing headings, lists, checkboxes, tables, code blocks, a Mermaid diagram, and relative links, and verify that rendering, the outline, and the source agree.

**Acceptance Scenarios**:

1. **Given** the current file is Markdown, **When** it opens by default, **Then** directly editable WYSIWYG content is shown, and the in-document heading outline is shown by default in the right rail.
2. **Given** the user opens Markdown, **When** they look at the workspace header, **Then** no WYSIWYG/raw-Markdown mode switcher is shown.
3. **Given** the user edits Markdown, **When** they save, **Then** Taco serializes the updated canonical Markdown and produces no parallel structured data.
4. **Given** the user switches the current file, **When** the viewer updates, **Then** the workspace header shows that file's path relative to root after the bundle title.
5. **Given** a Markdown link points to another file inside the bundle, **When** the user clicks the link, **Then** Taco opens the target file within the current browser.
6. **Given** the Markdown contains scripts or event attributes, **When** it renders, **Then** the executable content is removed.
7. **Given** the current Markdown contains a `mermaid` fenced code block, **When** the WYSIWYG mode is used and the remote module is available, **Then** Taco loads the pinned Mermaid version on demand and renders SVG; when the module is unavailable or offline, it shows the editable canonical Mermaid source.
8. **Given** the user switches between the outline and comments in the right rail, **When** they click either tab, **Then** the two toggle within the same non-collapsible right-rail content area and reuse the shared 24px segmented control component.

### User Story 3 — Edit other text formats (Priority: P1)

As an engineering collaborator, I want YAML, JSON, and other text files to be directly editable, and to open standalone HTML prototypes from the spec, even when Taco does not yet understand their specialized semantics.

**Independent Test**: Open `.yaml`, `.json`, plain text, and an `.html` fixture; confirm the text source is editable, edits enter the canonical bundle, JSON is highlighted live, and the HTML card opens the canonical file URL in a new page regardless of the Taco file's own location.

**Acceptance Scenarios**:

1. **Given** the current file is JSON, **When** the user opens and edits it, **Then** Taco shows it in a source editor with no header, no large spacing, no border, and no background color, provides live syntax highlighting, and writes edits back to the canonical bundle.
2. **Given** the current file is YAML or unknown text, **When** the user opens and edits it, **Then** Taco shows the same undecorated generic source editor and saves the exact text without guessing field meaning.
3. **Given** the current file is an HTML prototype with its canonical `file:` URL, **When** the user selects it, **Then** Taco shows a single-line card above the file viewer containing only the file icon, title, and an "Open Preview" action; clicking it opens that real local HTML file in a separate browser page regardless of the Taco file's location and never embeds an iframe or executes HTML inside the Taco UI.

### User Story 4 — Use the single-file shell (Priority: P1)

As the holder of a local file, I want Taco to have the same single-file shell capabilities as Bento, so I can switch the interface language, export share copies with different permissions, and save this Taco file so it can be opened again.

**Independent Test**: Switch between the Chinese and English interface, open the share menu, save the current file, and re-parse the `taco/files` bundle inside it.

**Acceptance Scenarios**:

1. **Given** Taco is open locally, **When** the user switches language, **Then** the shell and browser controls switch language, but the spec file text is not translated or rewritten.
2. **Given** the user opens the share menu, **When** they choose an editor invitation or a read-only copy, **Then** Taco saves a file copy with the corresponding permission that never leaks the Owner private key; the share menu offers no live read-only or template export.
3. **Given** the user clicks Save, **When** the browser supports File System Access, **Then** Taco writes to the chosen `.taco.html`; when it is unsupported, Taco explains that the browser controls the download destination and downloads an equivalent file only after the user confirms.
4. **Given** the file sidebar is visible, **When** the user clicks the control in its header, **Then** the file sidebar collapses and a re-expand control appears in the workspace header.

### User Story 5 — Local and cross-device collaboration (Priority: P1)

As a user co-reviewing a spec, I want same-machine tabs to collaborate without any service, and after an explicitly configured blind relay, to let Taco copies on different devices sync edits, comments, and cursors in real time.

**Independent Test**: Open the same URL in two browser tabs, set different user names, edit the same Markdown file and create comments simultaneously, and verify content converges, comments are not lost, and members and cursors are mutually visible.

**Acceptance Scenarios**:

1. **Given** two tabs with the same `docId` and origin, **When** the second tab opens, **Then** the two discover each other over local broadcast and show the online members.
2. **Given** two people edit the same Markdown block, **When** the operations arrive in different orders, **Then** the CRDT ultimately produces identical content and does not let a last writer overwrite the other with a whole-document Markdown write.
3. **Given** two people create comments at different positions or at the same time, **When** the operations sync, **Then** the comment threads and messages are each preserved and signed with the corresponding user name.
4. **Given** one person focuses or selects text in the same file, **When** presence updates, **Then** the other sees a cursor or selection with the user name and a stable color.
5. **Given** the page has no relay, account, or network, **When** same-origin tabs collaborate, **Then** core sync still works.
6. **Given** the Owner configures a relay and sends an editor invitation, **When** another device opens the invitation copy, **Then** the two sync through AES-GCM ciphertext frames and a blind relay, and the relay cannot read file content.
7. **Given** the Owner removes a member or resets access, **When** the revoked device reconnects, **Then** the relay rejects that device or all old copies, and other non-revoked members are unaffected.

### User Story 6 — Spec Kit human/agent review loop (Priority: P1)

As a team using Spec Kit, I want the agent to automatically generate a reviewable Taco after `spec.md` is complete, and to safely write results back to the original files after a human saves edits and comments, so no second source of truth for the spec is created.

**Independent Test**: In a temporary Spec Kit project, package the feature directory, modify files inside the Taco and add anchored comments, preflight and sync, and verify the original path content updates, comments are machine-readable, and no file is written when there is a two-sided conflict.

**Acceptance Scenarios**:

1. **Given** the Taco extension is installed, **When** `speckit.specify` completes, **Then** the mandatory `after_specify` hook invokes the agent command and creates `<feature>.taco.html` beside the feature directory.
2. **Given** a human directly modifies files in Taco and saves, **When** the agent runs the review command, **Then** it preflights all paths and baselines first, then writes conflict-free content back to the canonical feature directory.
3. **Given** the Taco contains open comments, **When** the agent imports the review, **Then** the agent can read the thread ID, status, file path, anchored quote, line/column position, all messages, and stale status.
4. **Given** the same file changed in both the local source and the Taco after packaging, **When** the agent preflights the sync, **Then** the whole write is rejected with an accurate report of the conflicting paths and `--force` is never used automatically.
5. **Given** the agent has handled the comments and modified the canonical files, **When** the review completes, **Then** the same Taco is refreshed to the latest file content, the comment threads are preserved, and it awaits human confirmation.

### Edge Cases

- The bundle is empty, the JSON is corrupt, or the version is newer than the current runtime.
- Duplicate file paths, absolute paths, paths containing `..`, or files outside the declared root.
- Markdown containing raw HTML, scripts, an over-long code block, or a wide table.
- An HTML prototype lacks a valid canonical `file:` URL or its URL does not end in the validated project-relative file path; packaging rejects it instead of creating an embedded preview URL.
- A relative link points to a nonexistent file.
- File names and body text contain Chinese, spaces, or Unicode.
- A Taco edit and a canonical file both change after packaging.
- The anchored quote of a comment is directly edited away, so the thread can only be read as a stale comment.
- The feature directory contains binary files or symbolic links.

## Requirements

### Functional Requirements

- **FR-001**: The canonical bundle must preserve the relative path, media type, and raw text content of each Spec Kit file.
- **FR-002**: The runtime must not persist Markdown content such as Story, Requirement, Task, or Evidence as a second domain model.
- **FR-003**: The layout must first split the left file sidebar from the workspace; below the workspace header, the central document area and the in-document outline/comments local aux area follow. The outline and comments must toggle through the shared 24px segmented control, defaulting to the outline; the local aux area must not offer a collapsed state or a close control. The left side must organize files strictly by the three default stages — Specify, Plan, Tasks — and must not create extension or custom groups; the real directory hierarchy must be preserved. The collapse control must live in the left-rail header.
- **FR-004**: The default file must prefer `README.md` at the feature root, then fall back to `spec.md` when no root README exists. A root `README.md` must route to Specify without requiring `taco_scope` metadata.
- **FR-005**: Markdown must always use WYSIWYG editing and must not offer a raw-Markdown mode or a mode switch control.
- **FR-005a**: WYSIWYG editing must update the Markdown text in the canonical bundle; nothing may be written to disk before the user saves.
- **FR-005b**: The workspace header must show the current file's path relative to root after the bundle title; the Markdown viewer must show a separate file metadata title above the body along with the file-type icon consistent with the sidebar. That title is not part of the Markdown content and must not enter the in-document outline.
- **FR-005c**: The bundle title in the workspace header must be editable and write back to the document title in real time; the persisted `.taco.html` filename stem must always equal the bundle title normalized into a filename, with spaces and other non-filename characters converted to underscores. After a title change, saving must request the matching new filename and must not overwrite an old handle whose name no longer matches; a saved copy's `-copy` filename and the copy's bundle title must also match.
- **FR-005d**: WYSIWYG mode must edit the document content directly and must not show a separate formatting toolbar.
- **FR-005e**: The file metadata title must be editable and write back to `files[].title`; editing the title must not modify `files[].path`, the sidebar filename, the comment anchor path, or the on-disk filename. v0.3 provides no file rename capability.
- **FR-005f**: Leading YAML frontmatter must render as an Obsidian-style editable property component without entering the in-document outline or becoming a parallel metadata schema. Scalar, list, and nested values remain canonical YAML; legacy ``**Key**: value`` prose remains readable but is not generated for new metadata.
- **FR-005g**: `taco_scope` is stored in leading YAML frontmatter. Only the exact strings `spec`, `plan`, and `tasks` route a file; other text values remain editable and visibly invalid without creating a stage.
- **FR-006**: YAML, JSON, and unknown text formats must use an editable generic source view in v0.3; the view must not show a separate header, large spacing, border, or background color, editing must update `files[].content`, and JSON must provide live syntax highlighting while editing.
- **FR-006a**: `.html` and `.htm` files must be grouped under the Specify stage and shown as a non-embedded prototype card in the viewer. Every CLI-packaged HTML file must carry a canonical absolute `file:` URL whose decoded pathname ends in the validated project-relative file path. The committed showcase shell may instead carry the exact `../<project-relative-path>` reference so its bytes remain reproducible, and must resolve it only when the Taco itself is opened from `file:`. The preview action must open the validated URL in a new browser page with `noopener noreferrer`. Packaging and bundle validation must reject other missing or mismatched references; the runtime must never substitute a `data:` URL, Blob URL, iframe, or `innerHTML` execution.
- **FR-007**: Markdown H1–H3 must generate the in-document outline, toggling with comments as two tabs in the local aux area below the workspace header; the tabs must reuse the shared 24px segmented control component. An outline click must scroll to the corresponding visible heading, and body scrolling must sync the active outline item; the solid divider between the main content scrollbar and the body/local aux area must not be shown.
- **FR-007a**: Mermaid must not be bundled into the single-file runtime. Only when the currently rendered Markdown contains a `mermaid` fenced code block may it be loaded once on demand from a pinned remote ESM address; a document with no Mermaid must not issue a Mermaid request. When loading fails or the page is offline, the editable canonical Mermaid code block must be shown and must not block reading or editing the document.
- **FR-008**: Relative file links inside the bundle must navigate within Taco.
- **FR-009**: The product must support search by file path and by text content.
- **FR-010**: The bundle parser must reject duplicate paths, absolute paths, path traversal, and files outside the root.
- **FR-011**: The Markdown renderer must strip scripts, event attributes, and dangerous embedded content.
- **FR-012**: Core browsing must work offline; a resource request may be issued only when the user explicitly enables the Mermaid enhancement or online encrypted collaboration. When Mermaid is unavailable it must degrade to source, and when online collaboration is unavailable it must not affect local editing and saving.
- **FR-013**: The agent interface must be bounded to `listFiles`, `readFile`, and `search`.
- **FR-014**: The current implementation must not imply not-yet-existing YAML/JSON structured editing, Readiness, or ChangeSet capabilities; generic source editing must not be described as a format-specific form.
- **FR-015**: The right side of the central reading-area header must provide a comments entry, share, a save split button with text, and a globe-icon language switch; it must not provide a Markdown mode switch control. The dropdown provides Save, Save a copy, and Save & unpack to folder, and no help entry; search is only invoked by keyboard shortcut, and Bento's Slides editing tools must not be copied into the middle.
- **FR-016**: Saving must serialize the current canonical file bundle; it must not reverse-generate or reformat Markdown from the rendered result.
- **FR-016a**: Save & unpack must treat the directory the user confirms as the Taco sidebar file-tree root, write the Taco file itself directly into that directory, and write every bundle file by its sidebar-visible root-relative path, without creating an extra project-level `root` prefix directory for the bundle. That Taco file must become the subsequent save target; existing files not in the bundle must not be deleted. When the browser denies directory permission, the result must not be described as an already-completed "save cancelled".
- **FR-017**: Internationalization applies only to the product shell and must not modify file content in the bundle.
- **FR-018**: The three navigation groups must use secondary text with no left icon slot, and show a centered 24px disclosure control on the right only on hover or keyboard focus; the outline must express its collapsed state with closed/open folder icons, and the Taco header mark must be exactly 24×24px.
- **FR-019**: `checklists/` must be grouped entirely under Plan and must not duplicate the physical directory into Specify or Tasks because of one file's `taco_scope` property.
- **FR-020**: Each Markdown file must map its top-level Tiptap nodes to blocks with stable IDs. `files[].content` continues to hold canonical Markdown; block HTML is only a collaboration transport and editor-restoration structure and must not be promoted into a Story, Requirement, or Task business model.
- **FR-021**: Pages with the same origin and `docId` must sync the document title, Markdown blocks, and comments through `BroadcastChannel`; the sync protocol must support hello, missing-operation resend, snapshot merge, presence, heartbeat, and leave notification.
- **FR-022**: Concurrent merge must use the Bento-derived CRDT: file and block/comment nodes merge by stable ID, block `html` uses a token RGA, and sync operations use actor sequence, Lamport register, tombstones, and a version vector.
- **FR-023**: The user name must be stored per tab session and used as the comment signature, the online member name, and the remote cursor label; when unset it shows Guest, and the first comment must require a name.
- **FR-024**: Presence must include at least the actor, color, file ID, selection start/end position, and focused state; a member that leaves or times out must be removed from the online list and the cursor layer.
- **FR-025**: The Spec Kit extension must provide `speckit.taco.create` and `speckit.taco.review` commands and auto-trigger creation through a non-optional `after_specify` hook; the extension must not depend on an account, server, or network.
- **FR-026**: CLI packaging must recursively include UTF-8 text files under the feature directory, preserve project-relative paths and media types, record a SHA-256 baseline of each file's canonical content, and ignore symbolic links, Taco artifacts, and undecodable binary files.
- **FR-027**: CLI sync must validate the bundle, root, every file path, and all baselines before any write. When one two-sided conflict exists, a non-forced sync must not write any file, and a project file missing from the bundle must not be deleted.
- **FR-028**: The CLI must expose comment thread ID, status, path, quote, resolvable line/column, stale status, and all messages as machine-readable JSON. Agent review must read each open comment and explicitly classify it as handled, deferred, or stale.
- **FR-029**: When review refreshes the Taco it must preserve the comment threads and re-establish the sync baseline from the latest canonical file content; it must not automatically mark threads as resolved.
- **FR-030**: The share panel must provide name, members and roles, live status, editor invitation, read-only copy, stop/resume sharing, and access reset; it must not provide live read-only or template export. The Owner can revoke members per device.
- **FR-031**: Online collaboration must use client-side AES-GCM encryption; the relay may only receive ciphertext, room tokens, signed public keys, and revocation control frames, and must not receive plaintext documents, comments, or display names.
- **FR-032**: An editor invitation must carry an Owner-signed delegation and not the Owner private key; the member device generates its own signing key. A read-only copy must remove all collaboration credentials and set `access: reader`.
- **FR-033**: `access: reader` must enforce a read-only boundary on the editor, source input, comment actions, and `TacoStore.commit`; for compatibility with existing files, `collab.role: reader` must still enforce the same boundary and allow remote sync, but can no longer be exported from the share menu.
- **FR-034**: Taco must not use Bento's public relay by default. The relay address must be provided by build or deployment configuration and must not show an address input or configuration action in the share menu; when unconfigured, same-machine collaboration still works.

## Success Criteria

- **SC-001**: The number of feature-directory files in the build artifact matches the source directory.
- **SC-002**: A bundle round-trip of each file is byte-for-byte identical.
- **SC-003**: The number of scripts and event attributes executed in the Markdown security test is zero.
- **SC-004**: Opening a document with no Mermaid via `file://` must not request Mermaid; opening a document with Mermaid while the network is unavailable must show the raw code block, and the rest of the app remains usable.
- **SC-005**: At a 720px viewport there is no horizontal overflow, and stage navigation can be opened and closed.
- **SC-006**: The automated WCAG 2 A/AA audit has no violation.
- **SC-007**: Concurrent edits to the same block from two tabs produce completely identical JSON after operations are exchanged.
- **SC-008**: Comment threads created concurrently in two tabs are all preserved, and remote cursors/selections in the same file are visible.
- **SC-009**: When any packaged HTML prototype is selected, there is no iframe in the current Taco page; the preview link has `_blank` and `noopener noreferrer`, its URL is the canonical `file:` URL, and it never begins with `data:` or `blob:`.
- **SC-010**: CLI automation proves that a direct Taco edit can be written back to the original file, open comments return stable positions, preflight does not touch disk, and any two-sided conflict blocks partial writes of the other conflict-free files.
- **SC-011**: Automation proves that an editor invitation retains only the delegated write credential, a read-only copy retains no collaboration credential, and the Owner private key never enters a share copy.
- **SC-012**: Local relay verification proves that an editor's signed ciphertext operations can persist and replay, and that a revoked target device cannot resume writing.

## Deferred

- Structured editing and format-specific renderers for YAML/JSON/OpenAPI.
- Restore and version history UI.
- Readiness, traceability, diff, and agent patch; these must be derived from files in the future.

## Out of Scope

- A Story, Requirement, or Task database.
- Project-management boards, accounts, cloud workspaces, enterprise SSO, and organization directories.
- Agent auto-execution or a code-repository replacement.
- Parsing or rewriting relative CSS, JavaScript, images, and other dependencies of an HTML prototype; opening the canonical file leaves those references to the browser and filesystem.
