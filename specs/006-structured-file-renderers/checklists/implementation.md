---
title: "Implementation Audit: Structured File Renderers and Complete Navigation"
created: "2026-08-26"
status: "Complete"
---

## Completion Standard

Issue 7 is complete only when every packaged UTF-8 file is reachable exactly once, OpenAPI and Mermaid derived views degrade to canonical source, generic YAML opens canonical source directly, and the existing editing, comment, save, sync, collaboration, access-control, and security boundaries remain authoritative.

## Requirement Evidence

- [x] **FR-001** — `fileKind` recognizes `.mmd` case-insensitively before media-type fallback; model and browser tests cover `.MMD` and `text/plain`.
- [x] **FR-002** — YAML and JSON retain extension/media-type classification; OpenAPI analysis begins only after the matching parser succeeds.
- [x] **FR-003** — recognition requires one root object with its own supported semantic-version `openapi` field; tests reject nested markers, Swagger 2.0, unsupported versions, and invalid semantic versions.
- [x] **FR-004** — `createStructuredFileViewer` implements OpenAPI, YAML, Mermaid, JSON-source, and plain-source fallback paths.
- [x] **FR-005** — parser, loader, and renderer failure tests assert visible editable source and a diagnostic instead of an empty or stale viewer.
- [x] **FR-006** — classification derives from current path, media type, and source; no bundle field or format version changed.
- [x] **FR-007** — `FileNavigation` renders non-empty `StageNavigation.unassigned` after the three stages as localized `Other files`.
- [x] **FR-008** — the fallback reuses directory rendering, locale-aware stable sorting, selection, disclosure, and persisted open-state maps.
- [x] **FR-009** — browser regression compares the complete multiset of bundle paths with sidebar rows and rejects missing, duplicate, or extra paths.
- [x] **FR-010** — stage-routing rules are unchanged; `.mmd` remains unassigned unless an existing rule assigns it.
- [x] **FR-011** — fallback rows use the same `onSelect` path as staged rows; browser tests open Mermaid and unknown nested files from the group.
- [x] **FR-012** — generic YAML opens directly in highlighted Source with no Structure tab or derived tree.
- [x] **FR-013** — the bundled `yaml` parser runs with strict parsing and no custom executable schema, external resolver, filesystem, or network integration.
- [x] **FR-014** — parsing is limited to OpenAPI recognition and diagnostics; no parsed YAML tree is presented or serialized.
- [x] **FR-015** — `SourceEditor` registers YAML lowlight syntax while retaining its textarea, overlay, comments, tab, scrolling, read-only contract, focus, and caret across live reparsing.
- [x] **FR-016** — invalid-YAML tests assert source fallback and bounded parser diagnostics with parser-provided location text.
- [x] **FR-017** — mode-switch tests assert no change callback, keep the same connected Source textarea across derived tabs for native undo continuity, and never serialize a YAML projection.
- [x] **FR-018** — CRLF, comments, anchors, aliases, block scalars, and trailing-newline source remains byte-identical when viewed or mode-switched without edits.
- [x] **FR-019** — YAML and JSON OpenAPI 3.0.x and 3.1.x fixtures both open the overview.
- [x] **FR-020** — overview regressions cover shared Metadata-style KV tables for Metadata, Servers, Tags, Schemas, and Security; `<first-tag>/<operationId>` paths without a prefix; weak operation tags; and semantic parameter/response tables.
- [x] **FR-021** — each optional section is guarded and rendered independently; absent or malformed sections cannot suppress source or unrelated sections.
- [x] **FR-022** — extensions and unsupported values are only read from the derived projection and remain untouched in source.
- [x] **FR-023** — `$ref` is rendered as inert text; no resolver or fetch path exists.
- [x] **FR-024** — renderer tests insert hostile HTML-like OpenAPI strings and assert text preservation with no resulting `img` or `script` node.
- [x] **FR-025** — Overview has no editing control; source selection comments activate canonical Source before resolving the anchor.
- [x] **FR-026** — invalid OpenAPI YAML and JSON retain highlighted Source with a warning.
- [x] **FR-027** — standalone Mermaid calls the existing runtime, queue, theme, strict mode, SVG sanitizer, loading/error states, and zoom surface; its outer host has no competing corner radius.
- [x] **FR-028** — standalone Mermaid tests assert syntax highlighting, focus continuity during input, raw source changes only, and no persisted block or SVG state.
- [x] **FR-029** — module and render rejection tests assert localized source fallback; raw exceptions are not displayed.
- [x] **FR-030** — a rejected module promise is cleared for retry; retry and render-failure tests use current source through the sanitizer.
- [x] **FR-031** — OpenAPI/Mermaid modes and Outline/Comments use the shared tablist component; standalone preview exposes a localized ghost magnifier and keyboard-operable zoom controls with 50–200% bounds, reset, wheel zoom, pan, dialog close, and global reduced-motion CSS.
- [x] **FR-032** — YAML, JSON/OpenAPI, and Mermaid Source callbacks use `FileBrowser.updateFileContent`, the existing store mutation path.
- [x] **FR-033** — derived viewers receive `!bundleCanWrite`; unit and sealed-reader regressions assert read-only source.
- [x] **FR-034** — specialized viewers expose the existing `SourceEditorController`; integrated OpenAPI comments resolve by path, offsets, exact quote, prefix, and suffix.
- [x] **FR-035** — no renderer serializer was added; existing save, CLI pack/sync, collaboration, and conflict suites continue to pass against `files[].content`.
- [x] **FR-036** — view-switch tests assert no source callback, store mutation, blocks, or dirty transition.
- [x] **FR-037** — accepted remote updates repaint non-Markdown viewers and refresh navigation before the derived surface is treated as current.
- [x] **FR-038** — unknown UTF-8 extensions remain plain source files and are covered by fallback navigation and source-comment regressions; binary boundaries are unchanged.

## Outcome Evidence

- [x] **SC-001** — exact navigation equality is asserted in `tests/file-browser.test.ts`.
- [x] **SC-002** — recognition and false-positive corpus is asserted in `tests/structured-file-viewer.test.ts`.
- [x] **SC-003** — invalid YAML, JSON/OpenAPI, Mermaid load, and Mermaid render cases all assert visible source and diagnostics.
- [x] **SC-004** — YAML preservation covers CRLF and loss-sensitive constructs; Mermaid browser tests assert unchanged source before editing.
- [x] **SC-005** — full dirty-state, save, sync, collaboration, reader, and conflict suites pass with the new viewer path.
- [x] **SC-006** — hostile OpenAPI values remain inert text and standalone Mermaid reuses the security-tested SVG sanitizer; the full security suite passes.
- [x] **SC-007** — forced offline and forced render rejection both activate editable standalone Mermaid Source.
- [x] **SC-008** — every supported locale has non-empty structured-view labels; mode controls, errors, sidebar fallback, read-only behavior, focus, and accessibility checks pass.

## Verification Commands

```sh
npx tsc -b --pretty false
npm test
npm run check
git diff --check
```

The production build must finish with the single-file shell gate passing and `extensions/taco/assets/taco-shell.html` synchronized from the built runtime.
