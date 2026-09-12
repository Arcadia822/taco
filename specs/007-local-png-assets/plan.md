---
title: "Implementation Plan: Local PNG Assets for Self-Contained Taco Reviews"
feature_branch: "007-local-png-assets"
created: "2026-09-09"
status: "Complete"
taco_scope: "plan"
specification: "spec.md"
---

## Summary

This plan outlines the architecture and execution steps for supporting local PNG assets in self-contained Taco reviews (GitHub Issue #18). The solution enables the Taco CLI to ingest binary PNG files, pack them into the standalone HTML bundle as base64 data URLs, resolve relative Markdown image paths in the offline browser runtime, and safely synchronize changes without corrupting or overwriting disk binaries.

## Technical Context

Currently, the Taco CLI (`extensions/taco/bin/taco.mjs`) attempts to decode all packaged files as UTF-8 via `TextDecoder('utf-8', { fatal: true })`. When encountering binary files like `.png`, it aborts packaging with `File is not valid UTF-8: ...; exclude it with --ignore`.

Additionally:
- `src/markdown-assets.ts` only resolves assets for a specific hardcoded document (`taco-product-spec` `README.md`) against a global asset map, ignoring relative links in ordinary feature specs.
- `src/model.ts` validates file paths and types but lacks explicit validation for `image/png` data URL payloads.
- `src/kernel/save.ts` `unpackBundle` writes file content as text strings into `Blob([content])`, which would corrupt binary base64 data URLs if unpacked as text.
- `sync` in `taco.mjs` reads disk files with `readFile(target, 'utf8')` and writes temporary files with `writeFile(temporary, change.content, 'utf8')`, which would corrupt binary files.

## Architecture Decisions

### 1. In-Bundle Storage Format: Base64 Data URL

Taco bundles are serialized as JSON inside a `<script type="application/taco+json" id="taco-document">` tag in a single standalone HTML file. To embed PNG assets without introducing multipart archives or breaking the pure JSON container model:
- PNG files are encoded as standard RFC 2397 Data URLs: `data:image/png;base64,<base64-data>`.
- The `mediaType` is set to `'image/png'`.
- The `sourceHash` is computed as the SHA-256 digest of the **raw binary Buffer**, ensuring accurate hash comparison against local files on disk during `taco sync`.
- Size is capped at 10 MiB per image with magic number validation (`\x89PNG\r\n\x1a\n`) to prevent bundle corruption or silent failures from non-PNG files renamed with a `.png` extension.

### 2. Relative Markdown Path Resolution

In Markdown, image references can be relative to the containing document's folder:
- Document: `specs/007-local-png-assets/spec.md` -> Directory: `specs/007-local-png-assets`
  - `![UI](design/screen.png)` -> Target: `specs/007-local-png-assets/design/screen.png`
- Document: `specs/007-local-png-assets/checklists/requirements.md` -> Directory: `specs/007-local-png-assets/checklists`
  - `![UI](../design/screen.png)` -> Target: `specs/007-local-png-assets/design/screen.png`

`src/markdown-assets.ts` will implement a path resolution utility:
1. Extract the directory portion of the active Markdown file path.
2. Resolve relative segments (`.` and `..`), preventing traversal outside `bundle.root`.
3. Support URI-decoded matching (handling spaces and `%20`).
4. Find the matching `image/png` file in `bundle.files`.
5. Update `img.src` to the embedded data URL while preserving the original relative path in `data-taco-source`.

### 3. Non-Destructive Save & Sync

- **Markdown Editor**: `SafeImage` in `src/tiptap-editor.ts` already stores `data-taco-source` as the authoritative source attribute and parses it back when exporting Markdown. Text edits in the WYSIWYG or source editor will never replace the relative path with the large data URL.
- **CLI Sync**:
  - For `image/png` files, `taco.mjs` reads the target file from disk as a raw `Buffer` (not UTF-8 text).
  - Compute SHA-256 hash over the raw disk buffer and compare with `file.sourceHash` or the hash of the decoded data URL.
  - If identical, mark as `unchanged`.
  - If creating or updating, decode the base64 data URL into a `Buffer` and write it directly without character encoding.
- **Browser Unpack (`src/kernel/save.ts`)**:
  - When `file.mediaType === 'image/png'`, convert base64 payload to an `ArrayBuffer`/`Uint8Array` before creating the `Blob`.

## File Changes & Implementation Slices

1. **CLI Packaging & Sync (`extensions/taco/bin/taco.mjs`)**:
   - Add `.png` to `mediaType` mapping (`image/png`).
   - In `collectFiles`, branch on `.png` extension: validate size (<=10 MiB), check magic bytes, encode to base64 data URL, compute raw SHA-256 hash.
   - In `validateBundle`, validate data URL structure for `image/png` files.
   - In `sync`, treat `image/png` as binary: read disk file as raw buffer, compare binary hash, write decoded buffer to disk.

2. **Model Validation (`src/model.ts`)**:
   - In `parseBundle`, validate that files with `mediaType: 'image/png'` have valid data URLs (`^data:image\/png;base64,[A-Za-z0-9+/=]+$`) and safe paths.

3. **Markdown Asset Resolution (`src/markdown-assets.ts`)**:
   - Implement `resolveRelativePath(fromPath, targetPath)`.
   - Generalize `resolveEmbeddedMarkdownAssets` to resolve all relative image paths against bundled `image/png` assets across all Taco documents.

4. **Browser Unpack (`src/kernel/save.ts`)**:
   - Enhance `writeHandle` to support binary data URLs when `mediaType === 'image/png'`.

5. **Test Coverage**:
   - Unit tests for CLI pack, validate, and sync with PNG fixtures in `tests/taco-cli.test.ts`.
   - Unit tests for relative path resolution with top-level and nested documents in `tests/markdown-assets.test.ts`.
   - Unit tests for model validation of PNG data URLs in `tests/model.test.ts`.
