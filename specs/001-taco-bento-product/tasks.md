## Phase 1 — File-First Foundation

- [x] T001 Replace the Taco business schema with generic `TacoBundle` and `TacoFile` transport models in `src/model.ts`
- [x] T002 Validate root containment, safe relative paths, and unique file paths in `src/model.ts`
- [x] T003 Read the real feature directory during the Vite build and inject file content in `vite.config.ts`
- [x] T004 Replace the Agent entity API with `listFiles`, `readFile`, and `search` in `src/main.ts`
- [x] T005 Remove the legacy Story, Requirement, Task, Evidence, and ChangeSet implementations

## Phase 2 — File Browsing

- [x] T006 Build a hierarchical folder/file navigation interface in `src/file-browser.ts`
- [x] T007 Open a feature-root `README.md` by default, falling back to `spec.md`; preserve the selected path with the URL hash when served online and with session state when used offline via `file://`
- [x] T008 Integrate TOAST UI Editor's WYSIWYG and Markdown editing modes
- [x] T009 Generate H1–H3 navigation inside the Markdown document shell and wire up bundle-relative links
- [x] T010 Keep both editing modes in sync with the canonical Markdown
- [x] T011 Edit YAML, JSON, and unknown text in an undecorated generic source editor, with live syntax highlighting for JSON
- [x] T012 Add filename and full-text search
- [x] T013 Implement responsive layouts for desktop, tablet, and narrow screens

## Phase 3 — Bento Shell Alignment

- [x] T014 Keep the file sidebar collapse control on its own panel boundary
- [x] T015 Move the root-relative file path and the reusable 24px-tall WYSIWYG/Markdown text segmented control into the workspace Header; remove the document title row
- [x] T016 Match Bento's nine built-in shell languages: English, Japanese, Simplified Chinese, Traditional Chinese, Spanish, French, German, Italian, and Portuguese
- [x] T017 Add Share, a Castrel v2 save split button, and a globe language tool item; omit persistent help
- [x] T018 Reconnect the Bento-derived single-file serializer to the canonical file bundle
- [x] T019 Restructure the shell after Castrel: first the file/workspace/comments panels, then a Header and Content per panel; comments closed by default
- [x] T020 Move the collapsed panel's reopen control into the workspace Header and turn Header actions into ghost buttons
- [x] T021 Adopt TOAST UI Editor for in-memory WYSIWYG and Markdown editing, without its formatting toolbar

## Phase 4 — Validation

- [x] T022 Test bundle parsing, format classification, and path safety
- [x] T023 Test Markdown sanitization and deterministic heading anchors
- [x] T024 Test file browsing, the Castrel panel composition, ghost Header tool items, and Markdown editing
- [x] T025 Build the final self-contained `.taco.html`
- [ ] T026 Verify direct `file://` loading, offline browsing, and zero resource requests
- [ ] T027 Run responsive-browser and WCAG 2 A/AA checks (responsive-browser checks pass; the automated WCAG audit is still pending)

## Phase 5 — Stage Navigation

- [x] T031 Replace the undifferentiated physical file tree with Specify, Plan, and Tasks stage groups
- [x] T032 Put each stage's core file first, immediately followed by all other routed documents
- [x] T033 Preserve physical subdirectories such as `contracts/` within their stage
- [x] T034 Require other Markdown documents to declare a `Taco scope` enum of `spec | plan | tasks`
- [x] T035 Test enum parsing, three-stage routing, and directory preservation
- [x] T036 Remove the Custom and Extensions groups, keep `checklists/` under Plan, and align the 24px group/folder/Header icon construction with Codex

## Deferred

- [ ] T028 Add recovery and version history for the file map
- [ ] T029 Add format-specific renderer plugins for YAML and JSON
- [ ] T030 Derive optional traceability and readiness from Markdown without persisting a parallel model

## Phase 6 — Local Collaboration Prototype

- [x] T037 Add stable file and Tiptap top-level block identities while preserving the canonical Markdown
- [x] T038 Port Bento's generic CRDT kernel and bind `files` / `nodes` into the Taco shape
- [x] T039 Project Markdown blocks and comment threads/messages through a single TacoStore
- [x] T040 Add a same-origin `BroadcastChannel` session with hello, catch-up, snapshot merge, and presence heartbeats
- [x] T041 Add a per-tab display name for comments, presence avatars, and remote cursor labels
- [x] T042 Render remote selections/cursors and sync Markdown edits, title changes, and the comment lifecycle
- [x] T043 Add CRDT convergence tests for same-block edits and concurrent comments
- [x] T044 Verify that two live browser tabs editing the same file see each other's cursors

## Phase 7 — Standalone HTML Prototypes

- [x] T045 Classify `.html` / `.htm` files and route them to the Specify stage
- [x] T046 Render an HTML prototype card instead of an inline preview or source editor
- [x] T047 Open canonical HTML in a new page as a `text/html` Blob, with `noopener noreferrer`
- [x] T048 Revoke the transient Blob URL, and test classification, routing, and card behavior

## Phase 8 — Spec Kit Review Extension

- [x] T049 Add a schema v1 Spec Kit extension with `speckit.taco.create`, `speckit.taco.review`, and a mandatory `after_specify` hook
- [x] T050 Package an offline Node.js CLI and the Taco runtime shell inside the extension
- [x] T051 Add UTF-8 feature packing with safe project-relative paths, media types, and a per-file SHA-256 baseline
- [x] T052 Add all-or-nothing sync pre-checks, bidirectional conflict detection, and non-destructive writes
- [x] T053 Expose anchored comments as machine-readable threads, positions, messages, and staleness
- [x] T054 Preserve review threads when flushing canonical files back into the same Taco
- [x] T055 Test packing, direct-edit import, comment inspection, and conflict rejection in `tests/taco-cli.test.ts`
- [x] T056 Enforce a single normalized title/filename invariant across CLI packing, browser saves, copies, and the refreshed runtime shell
- [x] T057 Treat the selected unpack directory as the visible Taco tree root, and adopt the written-out Taco file for subsequent saves

## Phase 9 — Bento-Equivalent Sharing

- [x] T058 Extend the Taco bundle with Owner, delegated-editor, and reader collaboration capabilities
- [x] T059 Adapt Bento's AES-GCM WebSocket transport to the Taco CRDT session while keeping local BroadcastChannel sync
- [x] T060 Add a blind Cloudflare relay with signed writes, encrypted replay, rate limiting, and per-device revocation
- [x] T061 Replace the local toggle menu with People, live status, editor invites, live viewers, sealed readers, and a standalone template action
- [x] T062 Enforce reader mode across Tiptap, source input, comments, and the TacoStore change boundary
- [x] T063 Add Go Live, Stop Sharing, per-device removal, and Reset Access controls while keeping relay configuration out of the Share panel
- [x] T064 Test capability stripping, delegated invites, reader enforcement, bundle validation, and the share panel
- [x] T065 Verify the browser Owner flow with a standalone real relay client, including encrypted replay, viewer rejection, and member revocation
- [x] T066 Slim the share export down to editor invites and read-only copies, isolate online transport per session, and de-duplicate same-identity tabs in People
