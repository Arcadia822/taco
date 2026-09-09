---
title: "Feature Specification: Local PNG Assets for Self-Contained Taco Reviews"
feature_branch: "007-local-png-assets"
created: "2026-09-09"
status: "Complete"
taco_scope: "spec"
input: |-
  GitHub issue #18: Support local PNG assets in self-contained Taco reviews.
---

## Objective

Taco reviews must be fully self-contained so reviewers, engineers, and stakeholders can inspect visual design artifacts, UI mockups, and architectural diagrams offline without depending on network access, remote image hosting, or the original source directory.

When a feature directory includes local PNG assets (such as `design/screen.png`), the Taco CLI must pack them as binary assets within the standalone Taco HTML bundle instead of failing with UTF-8 decode errors. The browser runtime must resolve both top-level (`design/screen.png`) and nested (`../design/screen.png`) relative Markdown image references against the bundled assets, rendering them offline. Saving the Taco and syncing changes back to the feature directory must remain strictly non-destructive, preserving image references in Markdown and never corrupting or overwriting existing local PNG files.

## User Scenarios & Testing

### User Story 1 — Pack local PNG assets with feature documents (Priority: P1)

As an author or reviewer running the Taco CLI, I want to pack a feature directory containing local PNG images without having to specify `--ignore`, so that visual evidence is bundled alongside specifications and plans.

**Why this priority**: Without this capability, any repository or feature directory containing screenshots, wireframes, or architecture diagrams fails packaging unless the user ignores those files, defeating the purpose of self-contained specification review.

**Independent Test**: Create a feature directory containing `spec.md` and `design/screen.png`. Run `taco pack` without `--ignore`. Verify the command succeeds, bundles the PNG with media type `image/png` and an embedded base64 data URL, and computes a SHA-256 hash across raw binary bytes.

**Acceptance Scenarios**:

1. **Given** a feature directory contains a valid `.png` file at `design/screen.png`, **When** `taco pack` executes without `--ignore`, **Then** it completes successfully and embeds the PNG file in the bundle with `mediaType: 'image/png'`.
2. **Given** a PNG file is bundled, **When** its contents are serialized, **Then** `content` is formatted as a valid base64 data URL (`data:image/png;base64,...`) and `sourceHash` matches the SHA-256 digest of the raw binary buffer.
3. **Given** a PNG file exceeds the maximum allowed size (10 MiB), **When** `taco pack` executes, **Then** it halts with an actionable error message indicating the file path, size, and limit.
4. **Given** a file with a `.png` extension is empty or corrupt (lacking the standard 8-byte PNG magic signature), **When** `taco pack` runs, **Then** it fails with an actionable error indicating the corrupted file.
5. **Given** an existing text-only Taco bundle, **When** `taco pack`, `taco validate`, and `taco sync` execute, **Then** they behave identically to prior versions without regression.

---

### User Story 2 — Offline Markdown image path resolution (Priority: P1)

As a reviewer opening a self-contained Taco document in a browser with no network connection and without the original repository directory, I want Markdown image references to resolve to the bundled PNG assets so that mockups and diagrams are displayed inline.

**Why this priority**: A review bundle that fails to display images when moved to another machine or opened offline fails the primary guarantee of self-contained Taco files.

**Independent Test**: Load a Taco document bundle in the browser DOM containing a root `spec.md` with `![UI](design/screen.png)` and a nested document `checklists/requirements.md` with `![UI](../design/screen.png)`. Run `resolveEmbeddedMarkdownAssets` and verify both `<img>` elements receive the matching embedded data URL in `src` while retaining their original relative paths in `data-taco-source`.

**Acceptance Scenarios**:

1. **Given** a root-level Markdown document references `![UI](design/screen.png)`, **When** the document renders in the viewer, **Then** the image resolves relative to the Markdown file directory and displays the embedded PNG data URL in `img.src`.
2. **Given** a nested Markdown document (e.g. `checklists/requirements.md`) references `![UI](../design/screen.png)`, **When** the document renders, **Then** relative path traversal (`..`) resolves accurately to `design/screen.png` within the bundle root.
3. **Given** an image source references an asset outside `bundle.root` or a non-existent file, **When** resolution runs, **Then** the image remains inert with `TRANSPARENT_PIXEL` and does not throw or corrupt the document.
4. **Given** any resolved image, **When** its DOM node is examined, **Then** `data-taco-source` preserves the exact original relative path string from the Markdown source.

---

### User Story 3 — Non-destructive save, edit, and sync (Priority: P1)

As an author syncing comments and document revisions back to the local repository, I want Taco to preserve Markdown image references and ensure binary PNG files on disk are never corrupted or unintentionally overwritten.

**Why this priority**: Corrupting source images or accidentally converting binary assets to UTF-8 text would result in data loss and destroy developer trust in Taco's synchronization workflow.

**Independent Test**: Edit text in a packaged Taco file containing PNG assets, save the bundle, and execute `taco sync`. Verify the Markdown document retains relative image syntax, the source PNG on disk is identified as `unchanged` by binary hash comparison, and unpack/write operations handle binary buffers safely.

**Acceptance Scenarios**:

1. **Given** a Taco bundle containing `image/png` files is saved after Markdown text edits, **When** the bundle is serialized, **Then** the Markdown source retains the original relative image paths and does not inline data URLs into Markdown text.
2. **Given** a local feature directory with an unchanged PNG file on disk, **When** `taco sync` runs, **Then** binary SHA-256 hash comparison reports the file as `unchanged` and skips rewriting it.
3. **Given** `taco sync` needs to create or update an `image/png` file (e.g. when forced or unpacked), **When** the file is written to disk, **Then** it decodes the base64 payload into a raw binary buffer, avoiding UTF-8 string encoding corruption.
4. **Given** `unpackBundle` is called in the browser runtime, **When** encountering `mediaType: 'image/png'`, **Then** it converts the data URL to a binary Blob so unpacked disk files are valid binary images.

## Key Entities

- **Binary PNG Asset**: A bundled file entry where `mediaType` is `image/png`, `content` is a validated base64 data URL (`data:image/png;base64,...`), and `sourceHash` is the hexadecimal SHA-256 digest of the raw binary bytes.
- **Relative Image Reference**: A Markdown image destination path (e.g. `design/screen.png`, `../design/screen.png`, `./design/screen.png`) referencing a sibling or relative path within the Taco bundle.
- **Resolved Asset URL**: The offline in-memory representation assigned to `HTMLImageElement.src`, pointing to the bundled base64 data URL while keeping `data-taco-source` set to the original relative path.
- **Binary Hash Comparison**: A comparison between the SHA-256 hash of a local disk file's raw bytes and the bundle file's `sourceHash` (or computed hash of the decoded base64 payload).

## Edge Cases

- **File extension casing**: Local files named with uppercase extensions like `.PNG` or mixed `.Png` are recognized as `image/png` and processed as binary PNG assets.
- **Leading `./` in paths**: References like `![Mockup](./design/screen.png)` resolve identically to `design/screen.png`.
- **Nested directory traversal (`..`)**: Traversal beyond the bundle root (e.g. `../../secret.png`) is rejected by path sanitization and safely ignored.
- **URI-encoded characters**: References containing encoded spaces (e.g. `design/screen%20shot.png`) or literal spaces (`design/screen shot.png`) resolve correctly against bundled file paths.
- **Empty PNG file**: A zero-byte `.png` file halts packaging with `Empty PNG image: <path>; PNG images must be non-empty`.
- **Corrupt PNG header**: A file ending in `.png` that does not begin with the standard 8-byte PNG signature (`89 50 4E 47 0D 0A 1A 0A`) halts packaging with an actionable corruption error.
- **Oversized PNG**: A PNG file larger than 10 MiB halts packaging with an actionable size error advising optimization or `--ignore`.
- **Mixed content bundles**: Bundles containing Markdown, YAML, HTML prototypes, Mermaid diagrams, and PNG assets package, validate, and sync simultaneously without collisions.

## Scope Boundaries

- **Explicit non-goals**:
  - Remote image fetching or uploading over HTTP/HTTPS.
  - Image editing, cropping, compression, or OCR.
  - Non-PNG raster or vector binary formats (e.g. JPEG, GIF, WebP, TIFF, AVIF).
  - Standalone image preview gallery or dedicated image editor tab (images are viewed via Markdown documents and existing source/other-files navigation).

## Success Criteria

- **SC-001**: `taco pack` embeds valid local PNG files up to 10 MiB without `--ignore`, generating valid `image/png` bundle entries with base64 data URLs.
- **SC-002**: Markdown renderer displays embedded PNG images offline from both top-level and nested Markdown documents using relative paths.
- **SC-003**: `taco sync` safely compares binary hashes of local PNG files and never corrupts or overwrites unchanged images on disk.
- **SC-004**: Browser `saveAndUnpack` extracts valid binary PNG files that match the original binary content byte-for-byte.
- **SC-005**: All existing CLI, model, and markdown asset tests pass without regressions.

## Assumptions

- PNG is the primary and standard image format for Spec Kit UI design artifacts, mockups, and exported diagrams.
- 10 MiB per image provides ample headroom for high-resolution screenshots and architectural diagrams while guarding against accidental multi-gigabyte bundle bloat.
