---
title: "Feature Specification: Structured File Renderers and Complete Navigation"
feature_branch: "006-structured-file-renderers"
created: "2026-08-26"
status: "Complete"
taco_scope: "spec"
input: |-
  GitHub issue #7: Render OpenAPI, YAML, and Mermaid files and expose all unassigned files.
---

## Objective

Taco must make every packaged UTF-8 file discoverable and readable, then apply the most specific safe renderer available without replacing the file's canonical source. OpenAPI documents receive an API-oriented review view, generic YAML opens directly in a YAML-aware source editor, and standalone `.mmd` files receive Mermaid preview and source modes. Any recognition, parsing, rendering, or network failure degrades to editable source with an actionable error.

The feature closes the gap between packaging and review: a file reported as embedded by the CLI must never disappear merely because Taco has no specialized renderer or stage assignment for it.

## User Scenarios & Testing

### User Story 1 — Discover every packaged file (Priority: P1)

As a reviewer, I can find and open every file in the Taco bundle from the sidebar, including files that do not belong to Specify, Plan, or Tasks.

**Why this priority**: Rendering improvements are irrelevant when a packaged file has no reachable navigation entry. Missing navigation also makes Taco's packaging and sync reports misleading.

**Independent Test**: Package a fixture containing core files, convention-routed files, frontmatter-routed files, nested unassigned files, and unknown UTF-8 extensions; compare the bundle paths with all rendered sidebar file paths and open every entry.

**Acceptance Scenarios**:

1. **Given** a bundle contains files not assigned by a core filename, built-in convention, or valid `taco_scope`, **When** Taco builds the sidebar, **Then** it renders those files under one localized `Other files` group.
2. **Given** unassigned files occupy nested directories, **When** the group renders, **Then** it preserves their directory tree, sorts sibling directories and filenames deterministically, and keeps folder disclosure state independently from the three stage groups.
3. **Given** a bundle contains any mix of assigned and unassigned files, **When** navigation is derived, **Then** every `files[]` entry appears exactly once and no sidebar file path is duplicated.
4. **Given** an unknown valid UTF-8 file type, **When** the reviewer selects it, **Then** Taco opens its complete content in the plain source editor.
5. **Given** there are no unassigned files, **When** the sidebar renders, **Then** Taco omits the empty `Other files` group.
6. **Given** an otherwise-unassigned file is later assigned by a built-in convention or valid `taco_scope`, **When** navigation refreshes, **Then** it moves to that stage and disappears from `Other files` without losing selection or creating a duplicate.

---

### User Story 2 — Review and repair canonical YAML source (Priority: P1)

As a reviewer or author, I can inspect and edit exact YAML source with syntax highlighting, while invalid or advanced YAML remains visible and recoverable.

**Why this priority**: YAML is already a first-class packaged media type, yet treating it as unhighlighted text makes routine review needlessly error-prone. Re-serializing a parsed object would be worse: it can destroy comments, anchors, scalar styles, ordering, and document structure.

**Independent Test**: Open valid and invalid YAML fixtures containing comments, mappings, sequences, anchors, aliases, tags, directives, multi-document input, quoted values, and block scalars; edit source, save, reopen, and compare unchanged bytes and intentionally edited source.

**Acceptance Scenarios**:

1. **Given** a `.yaml` or `.yml` file, or a file with a YAML media type, **When** it opens without being recognized as OpenAPI, **Then** Taco displays Source directly and exposes no `Structure` tab.
2. **Given** valid YAML contains nested mappings, sequences, scalar values, anchors, aliases, tags, or multi-line scalars, **When** Source renders, **Then** YAML tokens are syntax-coloured without executing custom tags or resolving external resources.
3. **Given** Source is visible, **When** the user selects text or activates an anchored comment, **Then** the canonical source remains directly editable and selectable.
4. **Given** the user only opens, navigates, or comments on valid YAML, **When** the Taco is saved or unpacked, **Then** the YAML file content is byte-for-byte unchanged.
5. **Given** YAML source is invalid, **When** Taco parses or reparses it, **Then** Source becomes the active usable mode, the original text remains editable, and Taco shows an actionable parse error with line and column when available.
6. **Given** source has unsupported or loss-sensitive constructs, **When** Taco displays it, **Then** it keeps Source usable and does not normalize or rewrite the document.
7. **Given** the author repairs invalid YAML in Source, **When** the source becomes valid, **Then** the parse diagnostic clears without requiring a save or reload.

---

### User Story 3 — Review OpenAPI contracts as APIs and as canonical source (Priority: P1)

As a reviewer, I can understand an OpenAPI contract through an API-oriented overview while retaining the exact YAML or JSON source for editing and comments.

**Why this priority**: A generic tree exposes syntax but not the relationships reviewers need: operations, inputs, outputs, reusable schemas, servers, tags, and security requirements.

**Independent Test**: Open representative OpenAPI 3.0 and 3.1 YAML and JSON fixtures, malformed candidates, non-OpenAPI YAML and JSON, internal and external references, and documents with missing optional sections; verify recognition, overview content, source editing, and the complete fallback chain.

**Acceptance Scenarios**:

1. **Given** valid YAML or JSON parses to a root mapping/object with a valid string `openapi` field, **When** the file opens, **Then** Taco recognizes it by content rather than filename and initially displays the OpenAPI overview.
2. **Given** a recognized OpenAPI document, **When** the overview renders, **Then** Metadata matches Taco's Markdown property-table style; Servers, Tags, Schemas, and Security use the same simple key/value table; operations remain grouped by network path and HTTP method; the unprefixed operation path is formed as `<first-tag>/<operationId>`; operation tags are weak labels; and parameters and responses are semantic data tables.
3. **Given** OpenAPI content omits an optional section, **When** the overview renders, **Then** Taco omits or marks that section as empty without treating the document as unrenderable.
4. **Given** the reviewer switches to Source, **When** the editor renders, **Then** YAML or JSON syntax highlighting matches the source format and the canonical source is directly editable and commentable.
5. **Given** a file named `openapi.yaml` or `openapi.json` lacks a valid root `openapi` field, **When** Taco inspects it, **Then** filename alone does not activate the OpenAPI renderer.
6. **Given** OpenAPI recognition or shape validation fails but the YAML is valid, **When** the file is YAML, **Then** Taco falls back directly to YAML Source and retains a non-destructive diagnostic explaining why the OpenAPI view is unavailable.
7. **Given** OpenAPI recognition or shape validation fails but the JSON is valid, **When** the file is JSON, **Then** Taco falls back to the existing JSON source editor and retains a non-destructive diagnostic explaining why the OpenAPI view is unavailable.
8. **Given** parsing fails, **When** the file opens or is edited into that state, **Then** Taco falls back to syntax-coloured source with the parse error and never shows a stale overview as if it represented current source.
9. **Given** an OpenAPI value contains a URL, HTML-like text, a custom extension, or an external `$ref`, **When** the overview renders, **Then** Taco displays inert text, performs no automatic fetch or external reference resolution, and applies the existing explicit-link security policy to any user-activated link.

---

### User Story 4 — Preview standalone Mermaid files safely (Priority: P1)

As a reviewer or author, I can preview a standalone Mermaid source file, inspect or edit the raw diagram, and enlarge the rendered result without risking an empty document when rendering fails.

**Why this priority**: Taco already renders Mermaid inside Markdown, but `.mmd` files are packaged as plain text and may also be absent from navigation. Reusing the existing renderer should produce one consistent security and interaction model.

**Independent Test**: Open valid, invalid, malicious, and offline `.mmd` fixtures; switch modes, zoom, edit, comment, save, reopen, and compare source bytes while observing DOM execution and network behavior.

**Acceptance Scenarios**:

1. **Given** a file path ends in `.mmd` case-insensitively regardless of its current `mediaType`, **When** it opens, **Then** Taco recognizes it as Mermaid source and initially attempts Preview mode.
2. **Given** valid Mermaid source and an available renderer, **When** preview completes, **Then** Taco displays the diagram through the same post-render SVG sanitization path used by Mermaid code blocks, keeps the outer standalone host square so it does not clip the renderer's own rounded corners, and offers the existing zoom in, zoom out, reset, pan, and close controls.
3. **Given** the reviewer switches to Source, **When** the editor renders, **Then** Mermaid syntax is highlighted, the raw text is editable and selectable for anchored comments, and the saved authority remains only that text.
4. **Given** Mermaid parsing or rendering fails, **When** the failure is reported, **Then** Taco activates Source, preserves the full text, and shows a readable render error instead of an empty or stale preview.
5. **Given** the Mermaid runtime cannot load because the network is unavailable or blocked, **When** the file opens, **Then** Taco activates Source, identifies preview unavailability, and does not weaken the content-security or SVG sanitization policy.
6. **Given** a Mermaid file is opened and saved without source edits, **When** it is unpacked or reopened, **Then** its source is byte-for-byte unchanged and no rendered SVG is stored in `files[].content` or as parallel canonical state.
7. **Given** invalid Mermaid is repaired in Source, **When** the user requests Preview again, **Then** Taco renders the current source without requiring a save or reload.

---

### User Story 5 — Preserve editing, comments, save, sync, and collaboration across views (Priority: P1)

As an author or collaborator, I can move between derived views and source editing without losing changes, comments, access rules, or conflict detection.

**Why this priority**: A renderer that bypasses Taco's canonical store would create a second document state and silently break the product's core review workflow.

**Independent Test**: Exercise YAML, OpenAPI, Mermaid, and unknown text files through source edits, text-selection comments, save, save-copy, unpack, pack, sync dry-run/apply, read-only mode, and two-client collaboration.

**Acceptance Scenarios**:

1. **Given** a user edits a specialized file in Source, **When** input changes, **Then** the same `files[].content` value, dirty state, save path, collaboration operation, and conflict baseline used by generic source files update.
2. **Given** an anchored source comment exists, **When** the user switches to a derived view and back, saves, reopens, or receives a collaboration update, **Then** the comment remains attached by canonical source offsets and quote context or is honestly reported unresolved by the existing anchor rules.
3. **Given** a source selection creates a comment, **When** the comment is stored, **Then** no renderer-specific node identifier or rendered SVG/HTML becomes required to resolve it.
4. **Given** a read-only Taco, **When** any specialized file opens, **Then** derived views remain usable while source editing and new comment behavior follow the bundle's existing access rules.
5. **Given** remote collaboration changes the selected source, **When** Taco applies the update, **Then** the visible source and derived view are recomputed from the accepted canonical content and no stale structured view remains authoritative.
6. **Given** the CLI packs or syncs a file recognized by a newer runtime, **When** an older runtime opens the same bundle, **Then** the existing `path`, `mediaType`, and text `content` remain sufficient for a readable source fallback.

## Functional Requirements

### File classification and fallback

- **FR-001**: Taco MUST classify `.mmd` paths case-insensitively as Mermaid source even when their media type is `text/plain`.
- **FR-002**: Taco MUST continue to classify YAML and JSON from either recognized path extensions or media types; OpenAPI recognition MUST occur only after safe parsing of YAML or JSON content.
- **FR-003**: An OpenAPI candidate MUST parse to a root mapping/object whose own `openapi` property is a semantic-version string in the supported `3.0.x` or `3.1.x` line. A filename, media type, nested property, `swagger` field, or string occurrence alone MUST NOT trigger the OpenAPI renderer.
- **FR-004**: The deterministic renderer chain MUST be: recognized OpenAPI to OpenAPI overview to matching YAML or JSON source fallback; generic YAML directly to syntax-coloured YAML source; Mermaid to sanitized preview to Mermaid source; every other valid UTF-8 type to its existing specialized surface or plain source.
- **FR-005**: A failed derived view MUST NOT hide the file, clear its content, make source inaccessible, or retain a stale successful rendering for different current source.
- **FR-006**: Renderer selection MUST derive from the current canonical content and path. It MUST NOT require a bundle format-version change or new media type.

### Complete navigation

- **FR-007**: `FileNavigation` MUST render `StageNavigation.unassigned` in one localized `Other files` disclosure group after the three default stage groups when and only when it is non-empty.
- **FR-008**: The unassigned group MUST reuse the directory-tree behavior of stage files, including deterministic sorting, selected state, keyboard-operable disclosure controls, and persisted disclosure state.
- **FR-009**: For every valid bundle, the multiset of file paths rendered by sidebar file rows MUST equal the multiset of `bundle.files[].path` exactly.
- **FR-010**: Core filename routing, built-in convention routing, and valid `taco_scope` routing MUST retain their current precedence. This feature MUST NOT add `.mmd` or `data-model-diagram.mmd` as a new stage convention; otherwise-unassigned Mermaid files use the universal fallback group.
- **FR-011**: Selecting a file from `Other files` MUST use the same file selection, location persistence, narrow-layout, comments, and workspace-header behavior as selecting a staged file.

### YAML source

- **FR-012**: Generic YAML MUST open directly in editable Source and MUST NOT expose a Structure tab or derived YAML tree.
- **FR-013**: YAML parsing MUST use a safe schema and MUST NOT execute custom tags, instantiate executable language objects, access the filesystem, resolve external resources, or make network requests.
- **FR-014**: YAML parsing MAY inspect document shape for OpenAPI recognition and diagnostics, but Taco MUST NOT present or serialize a parsed YAML tree.
- **FR-015**: The YAML source editor MUST register YAML syntax highlighting and retain the existing overlay-based source comment highlights, selection behavior, tab insertion, scrolling, read-only state, and change callbacks. Live parsing and diagnostics MUST NOT detach the active textarea or lose its focus and caret after an input event.
- **FR-016**: Invalid YAML MUST remain visible and editable. Diagnostics MUST identify the parse problem and include one-based line and column when the parser provides them.
- **FR-017**: Taco MUST NOT serialize a parsed YAML object back into `files[].content` merely because the file was opened, viewed, commented on, or switched between modes. Source editors MUST remain mounted while a derived tab is active so returning to Source preserves the browser's native undo history.
- **FR-018**: YAML comments, key order, anchors, aliases, directives, tags, quoting, scalar styles, line endings, trailing newline state, and multi-document separators MUST remain byte-for-byte intact unless the user edits those source bytes.

### OpenAPI overview

- **FR-019**: OpenAPI recognition and overview rendering MUST support YAML and JSON documents carrying supported OpenAPI 3.x version strings, including 3.0.x and 3.1.x documents.
- **FR-020**: The overview MUST render Metadata with the same read-only property-table language as Markdown metadata, and MUST use that simple key/value table for Servers, Tags, Schemas, and Security. Each operation MUST emphasize its summary, display an unprefixed operation path as `<first-tag>/<operationId>` when a tag exists, render all operation tags as visually weak labels, present parameters and responses as semantic data tables, and retain request bodies and media types.
- **FR-021**: Missing optional OpenAPI sections MUST degrade locally. One absent or malformed optional section MUST NOT hide unrelated valid sections or the complete source.
- **FR-022**: OpenAPI extensions and unsupported fields MUST remain in source. The overview MAY omit them but MUST NOT delete, rewrite, or claim to fully validate them.
- **FR-023**: `$ref` values MUST be displayed as references without automatically resolving remote URLs, reading external files, or fetching referenced content.
- **FR-024**: All OpenAPI strings and derived labels MUST enter the DOM as inert text or through an existing context-appropriate sanitizer. Merely opening an OpenAPI file MUST produce no author-controlled network request, navigation, HTML execution, or CSS injection.
- **FR-025**: The OpenAPI overview MUST be read-only derived state. Editing and source-selection comments MUST occur against the canonical Source mode.
- **FR-026**: A YAML OpenAPI candidate that fails recognition or overview shape validation MUST retain highlighted YAML Source plus a concise OpenAPI diagnostic. A JSON candidate MUST retain JSON Source plus the diagnostic.

### Mermaid preview and source

- **FR-027**: Standalone Mermaid preview MUST reuse Taco's existing Mermaid runtime configuration, render queue, theme, strict Mermaid security level, post-render SVG sanitizer, loading state, error state, and zoom interaction rather than introducing a parallel rendering path. Its outer host MUST NOT apply a second border radius that clips the renderer's own rounded surface.
- **FR-028**: Standalone Mermaid Source MUST use the generic source editor contract with Mermaid-aware syntax highlighting, preserve focus and caret while editing, and remain the only saved authority. Rendered SVG and preview state MUST NOT be stored in the bundle, collaboration state, comments, or unpacked source file.
- **FR-029**: A Mermaid load or render failure MUST activate Source and expose a localized error. Raw exception content MUST be bounded and MUST NOT echo unrelated document content or credentials.
- **FR-030**: Preview retry after a source change or transient loader failure MUST use the current source and MUST pass through the same sanitizer before DOM insertion.
- **FR-031**: Mermaid preview controls MUST be keyboard accessible, have localized accessible names, respect reduced-motion preferences, and retain existing zoom bounds and reset behavior. OpenAPI and Mermaid view tabs MUST reuse the same shared tablist component and visual treatment as the Markdown Outline/Comments switch. The standalone preview entry MUST be a compact ghost magnifier icon rather than a text button.

### Canonical editing and interoperability

- **FR-032**: All specialized Source modes MUST update the existing Taco file store through the same file-content mutation path as the current JSON and plain-text editors.
- **FR-033**: Specialized renderers MUST honor `bundleCanWrite`; they MUST NOT introduce an editing path in reader copies.
- **FR-034**: Source comment anchors MUST continue to use canonical path, source offsets, exact quote, prefix, and suffix. Derived nodes MUST NOT become a required anchor authority.
- **FR-035**: Save, save-copy, unpack, pack, sync, conflict detection, local collaboration, and online collaboration MUST operate on raw `files[].content` and MUST NOT depend on a renderer-specific serialization.
- **FR-036**: Switching modes MUST NOT by itself mark the Taco dirty, emit a collaboration content operation, modify block projections, or alter source bytes.
- **FR-037**: Receiving accepted remote source changes MUST invalidate and recompute any derived view before presenting it as current.
- **FR-038**: Unknown valid UTF-8 files MUST remain accessible in the plain source editor regardless of extension or media type. Binary support remains outside Taco's packaging boundary.

## Key Entities

- **File classification**: The renderer category derived from a file's path, media type, and, for OpenAPI only, safely parsed current content.
- **Canonical source**: The exact text stored in `files[].content`, used by save, unpack, sync, collaboration, conflict detection, search, and source comment anchors.
- **Derived view**: A disposable, read-only projection of canonical source, such as a YAML tree, OpenAPI overview, or sanitized Mermaid SVG.
- **Renderer diagnostic**: A bounded, localized explanation of why recognition, parsing, loading, or rendering could not provide a derived view; it never replaces source.
- **Unassigned file**: A bundle file not claimed by core filename routing, built-in convention routing, or a valid `taco_scope` value.
- **Other files group**: The universal sidebar fallback containing every unassigned file exactly once while preserving its relative directory tree.

## Edge Cases

- A JSON document can contain an `openapi` key but fail OpenAPI shape checks; it remains readable as JSON source and does not receive a YAML tree.
- A YAML mapping can contain a nested `openapi` key or a non-string root value; neither activates the OpenAPI renderer.
- OpenAPI 2.0 documents identified only by `swagger: "2.0"` are not specialized by this feature and use the generic YAML or JSON fallback.
- YAML may contain multiple documents. They remain in Source, and an `openapi` key in one document does not make the multi-document stream a single OpenAPI document.
- YAML aliases may form recursive graph relationships. Source displays them without expanding or mutating the graph.
- Duplicate YAML mapping keys, custom tags, and parser warnings remain visible as diagnostics; Taco does not silently choose a normalized representation as canonical.
- OpenAPI paths may contain nonstandard method-like extension keys. Standard HTTP method keys are grouped as operations; all original keys remain available in source.
- External `$ref` values, server URLs, examples containing URLs, and Markdown-like descriptions do not trigger a fetch or active embedded rendering merely by opening the file.
- A Mermaid file may render once and later become invalid during editing. Taco removes or clearly invalidates the old preview before reporting the new failure.
- A bundle may contain `.MMD`, `.Yaml`, or misleading media types. Case-insensitive path recognition provides the documented fallback without changing stored media types.
- Two different files may share the same basename in different directories. Navigation identity and comment anchors remain full-path based.
- Locale-aware sorting must be deterministic for a given locale and must use a stable full-path tie-breaker when displayed names compare equally.
- The selected file can move between a stage and `Other files` after a source edit changes `taco_scope`; the same file remains selected by path.
- A read-only Taco can still switch derived/source modes and inspect source, but cannot mutate source through a hidden control or keyboard path.

## Scope Boundaries

- The Taco bundle format, format version, UTF-8 packaging boundary, and canonical `path`/`mediaType`/`content` fields do not change.
- The CLI may later emit a Mermaid-specific media type, but doing so is not required for this feature and cannot be required for recognition.
- This feature renders existing OpenAPI and Mermaid files; it does not generate contracts, diagrams, client SDKs, server stubs, mock servers, or documentation sites.
- The OpenAPI overview is a review projection, not a complete OpenAPI validator. It does not promise full semantic validation, dereferencing, linting, or external-reference resolution.
- Generic YAML derived preview and structured editing are out of scope. All YAML review and mutation occur in Source so comments, styles, anchors, ordering, and unsupported constructs are not silently normalized.
- Specialized stage routing for Mermaid files is out of scope. The universal `Other files` fallback is sufficient to guarantee discoverability.
- Binary preview, image preview, archive browsing, and arbitrary plugin renderers are out of scope.
- No renderer may relax Taco's existing content, URL, network, SVG, collaboration, or credential-handling security boundaries.

## Success Criteria

- **SC-001**: For every navigation fixture, automated tests prove a one-to-one equality between bundle file paths and sidebar file-row paths: 100% present, 0 duplicates, and 0 extra paths.
- **SC-002**: Valid OpenAPI 3.0 and 3.1 YAML and JSON fixtures are recognized by content and expose all required overview categories; filename-only and nested-key false positives remain at 0 across the recognition corpus.
- **SC-003**: Every invalid OpenAPI, YAML, and Mermaid fixture leaves 100% of its original source visible and editable when the bundle is writable, with a readable diagnostic and no empty viewer.
- **SC-004**: Opening, switching modes, commenting without source edits, saving, and unpacking the YAML and Mermaid preservation corpus produces byte-for-byte identical source for 100% of fixtures.
- **SC-005**: Source edits in YAML, OpenAPI, Mermaid, and unknown files pass the existing dirty-state, save, sync, collaboration, read-only, and conflict regression suites without a renderer-specific persistence path.
- **SC-006**: Browser security tests observe zero document-triggered script execution, automatic navigation, unapproved network requests, or unsanitized SVG insertion while opening the OpenAPI, YAML, and Mermaid attack corpus.
- **SC-007**: With Mermaid runtime loading forced offline or rendering forced to reject, every `.mmd` fixture opens Source automatically and remains selectable, commentable, and savable.
- **SC-008**: All new controls, diagnostics, and the `Other files` group have complete strings for every supported Taco locale and pass the repository's accessibility checks for keyboard operation, accessible names, visible focus, and non-colour-only error communication.

## Assumptions

- OpenAPI specialization targets OpenAPI 3.x because issue 7 requires the root `openapi` field; Swagger 2.0 uses a different root marker and remains on the generic fallback.
- The existing bundled `yaml` parser and existing Mermaid runtime/security path are the implementation foundations, but the requirements concern observable behavior rather than a mandatory internal module layout.
- OpenAPI Overview and Mermaid Preview are derived read-only surfaces. Generic YAML has no derived surface; source offsets and raw file content remain authoritative.
- `Other files` is a localized UI label, not a fourth Taco stage and not a new `taco_scope` value.
- Existing bundles with `.mmd` as `text/plain` and OpenAPI as ordinary YAML or JSON gain enhanced rendering without repackaging.
