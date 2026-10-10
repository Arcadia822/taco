# Agent Development & Review Lessons Learned (LESSONS.md)

This document tracks high-frequency failure modes, architectural pitfalls, and regressions encountered during human-agent collaboration in Taco.

Guided by the principle **Encode Lessons in Structure**:

1. When an error or unexpected friction occurs, record it here with concrete evidence and root causes.
2. **Escalation Protocol**: Any lesson triggered **3 or more times** (`Occurrences >= 3`) MUST be escalated to a structural mechanism:
   - A hard CI static gate or pre-commit hook (e.g. `npm run check`, `package.json`, `.githooks/`), OR
   - A type-level impossibility (making illegal states unrepresentable), OR
   - A binding rule in `AGENTS.md`.

`Status` tracks the mandatory trigger, not the guard. `open` means the lesson is tracked below the `Occurrences >= 3` threshold; `escalated` means the threshold was reached and the lesson must carry a structural guard; `archived` means the risk no longer applies. An `open` lesson may already carry a guard, because a guard can land earlier when the fix is cheap. The `Guard` column is the mechanism that exists today; the `check:lessons` gate rejects any lesson at `Occurrences >= 3` that is not `escalated`.

---

## Escalation Index

| ID                                                                          | Title                                             | Occurrences |    Status     | Guard                                                                                |
| :-------------------------------------------------------------------------- | :------------------------------------------------ | :---------: | :-----------: | :----------------------------------------------------------------------------------- |
| [LESSON-001](#lesson-001-local-dependency-drift-pollutes-test-runs)         | Local Dependency Drift Pollutes Test Runs         |      1      |   **open**    | `package-lock.json`, `.github/workflows/ci.yml`                                      |
| [LESSON-002](#lesson-002-version-triples-desync-across-release-surfaces)    | Version Triples Desync Across Release Surfaces    |      2      |   **open**    | `scripts/sync-skill-version.mjs`, `tests/version.test.ts`                            |
| [LESSON-003](#lesson-003-tiptap-prosemirror-crash-on-markdown-code-in-bold) | Tiptap ProseMirror Crash on Markdown Code-in-Bold |      3      | **escalated** | `src/tiptap-editor.ts`, `tests/markdown-emphasis-code.test.ts`                       |
| [LESSON-004](#lesson-004-headless-mermaid-execution-fails-without-dom-mock) | Headless Mermaid Execution Fails Without DOM Mock |      1      |   **open**    | `skills/taco/scripts/lint-mermaid.mjs`, `tests/mermaid-lint.test.ts`                 |
| [LESSON-005](#lesson-005-artifact-id-downloads-nest-the-consumed-files)     | Artifact-ID Downloads Nest the Consumed Files     |      1      |   **open**    | `.github/workflows/ui-preview.yml`                                                   |
| [LESSON-006](#lesson-006-empty-docker-volume-copy-up-overrides-ownership)   | Empty Docker Volume Copy-Up Overrides Ownership   |      1      |   **open**    | `.github/workflows/ui-preview.yml`                                                   |
| [LESSON-007](#lesson-007-github-rejects-empty-asset-bootstrap-trees)        | GitHub Rejects Empty Asset Bootstrap Trees        |      1      |   **open**    | `.github/workflows/scripts/publish-preview.mjs`, `tests/ui-preview-pipeline.test.ts` |

---

## Lessons Register

### LESSON-001: Local Dependency Drift Pollutes Test Runs

- **ID**: `LESSON-001`
- **Category**: `dependencies`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: `package-lock.json`, `.github/workflows/ci.yml`

#### Symptom

Local tests fail with unexpected errors (e.g. editor marks or sanitization failures) despite unchanged application code. In PR #54 wrap-up, local `node_modules` drifted to Tiptap 3.31.3 and DOMPurify 3.4.16 while `package-lock.json` pinned 3.29.2 and 3.4.13.

#### Root Cause

Ad-hoc package installations (`npm install --no-save` or package additions without synchronized lockfiles) upgrade transitive dependencies in local `node_modules`, diverging from CI.

#### Evidence

- 2026-09-26 — PR #54: local dependency drift after ad-hoc package install caused image-sanitization and editor test failures resolved by `npm ci` (recorded in memory `fdc8fe3e`).

#### Prevention & Escalation

- Always restore clean lockfile state via `npm ci` before debugging local-only test regressions.
- CI strictly uses `npm ci` without `--force` or `--legacy-peer-deps`.
- Guard rule formalized in `package-lock.json` lockfile enforcement and `.github/workflows/ci.yml`.

---

### LESSON-002: Version Triples Desync Across Release Surfaces

- **ID**: `LESSON-002`
- **Category**: `release`
- **Occurrences**: 2
- **Status**: `open`
- **Guard**: `scripts/sync-skill-version.mjs`, `tests/version.test.ts`

#### Symptom

Release or build failures where `skills/taco/VERSION`, `package.json`, and CLI binaries report mismatched version strings, or manual edits to one surface fail to propagate to consumers.

#### Root Cause

Version numbers were previously maintained manually across disjoint configuration files (`package.json`, `packages/cli/package.json`, `skills/taco/VERSION`, `extensions/taco/extension.yml`).

#### Evidence

- 2026-09-27 — commit `881ac7e`: taco-cli `binaryVersion` desynced from package metadata, fixed by syncing `binaryVersion` with package.json automatically (PR #70).
- 2026-09-28 — spec `012-skill-update-notice`: `skills/taco/VERSION` desync resolved by adding `scripts/sync-skill-version.mjs` build sync and assertion.

#### Prevention & Escalation

- App, extension, and skill parity: root `package.json` is the authority for app/extension/skill versions; `scripts/sync-skill-version.mjs` keeps `skills/taco/VERSION` identical during build, and `tests/version.test.ts` asserts parity across `package.json`, `extensions/taco/extension.yml`, and `skills/taco/VERSION`.
- CLI and package parity: `packages/cli/package.json` is independently versioned; `packages/cli/src/help.ts` imports its own `../package.json` manifest, and release CI smoke-tests the built CLI `binaryVersion`.

---

### LESSON-003: Tiptap ProseMirror Crash on Markdown Code-in-Bold

- **ID**: `LESSON-003`
- **Category**: `editor`
- **Occurrences**: 3
- **Status**: `escalated`
- **Guard**: `src/tiptap-editor.ts`, `tests/markdown-emphasis-code.test.ts`

#### Symptom

Taco editor throws `Invalid collection of marks for node text: bold,code` and falls back to raw source mode when encountering inline code wrapped inside bold delimiters (e.g. `**\`--flag\`**`or`**\`code\`**`).

#### Root Cause

Default ProseMirror Code mark configuration excluded emphasis marks (`bold`, `italic`, etc.), making marked parser's nested output an illegal mark set on a single text node when parsing markdown tokens.

#### Evidence

- 2026-09-23 — TACO-10: spec review artifact opened in fallback source editor due to `Invalid collection of marks for node text: bold,code` on checkpoint bold code tokens (memory `c4ebcdce`).
- 2026-09-28 — TACO-21: first failure when rendering inline code wrapped in bold delimiters during initial spec.md draft delivery (memory `2692c292`).
- 2026-09-28 — TACO-21: second failure when re-editing spec.md introduced an uninspected bold code span that crashed headless Chromium verification (memory `2692c292`).

#### Prevention & Escalation

- Shipped preventive mechanism: `src/tiptap-editor.ts` configures `Code.extend({ excludes: 'code' })` so code marks self-exclude duplicate code marks without forbidding nesting inside bold or other emphasis marks.
- Document and mark normalizer: `normalizeNodeMarks` deduplicates and sorts marks cleanly, and `tests/markdown-emphasis-code.test.ts` asserts round-trip support for valid GFM nested combinations such as `**bold with \`code\` inside**`.
- Valid GFM emphasis and code combinations remain fully supported; never instruct authors or agents to strip or avoid supported syntax.

---

### LESSON-004: Headless Mermaid Execution Fails Without DOM Mock

- **ID**: `LESSON-004`
- **Category**: `rendering`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: `skills/taco/scripts/lint-mermaid.mjs`, `tests/mermaid-lint.test.ts`

#### Symptom

Valid Mermaid diagrams fail parse validation with `TypeError: My.addHook is not a function` when executed in headless Node environments without a full DOM.

#### Root Cause

`DOMPurify.sanitize()` unconditionally relies on DOM hooks (`addHook`). In headless environments without DOM emulation, DOMPurify stubs crash.

#### Evidence

- 2026-09-28 — TACO-19: headless Mermaid lint script crashed in Node environment without DOM mock, resolved in `specs/013-mermaid-editing-lint` / issue #51.

#### Prevention & Escalation

- Specialized Mermaid lint tool (`skills/taco/scripts/lint-mermaid.mjs`) bypasses headless DOMPurify hook crashes by safely patching sanitization stubs.
- Verifiable via `tests/mermaid-lint.test.ts`.

---

### LESSON-005: Artifact-ID Downloads Nest the Consumed Files

- **ID**: `LESSON-005`
- **Category**: `ci`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: `.github/workflows/ui-preview.yml`

#### Symptom

UI Preview passes local capture tests but fails on the runner with `ERR_MODULE_NOT_FOUND` for `/tmp/trusted-tools/view-registry.mjs`; screenshot publication is skipped.

#### Root Cause

`actions/download-artifact@v4` with `artifact-ids` defaults to `merge-multiple: false`, extracting files into an artifact-name subdirectory even for one selected artifact. Both tool imports and screenshot validation expect files at the destination root. Local tests of the scripts do not exercise this action behavior.

#### Evidence

- 2026-10-10 — disposable PR #127, [UI Preview run 38043585006](https://github.com/Arcadia822/taco/actions/runs/38043585006): download completed at `/tmp/trusted-tools/ui-preview-tools-38043585006`, then the root-level import failed.

#### Prevention & Escalation

- Set `merge-multiple: true` on both artifact-ID downloads when consumers expect the destination root; keep selecting only the exact trusted artifact ID.
- Verify the runner workflow through capture, sanitization, asset publication, and PR body injection before claiming the preview pipeline works. Local script tests alone do not establish the Actions extraction contract.

---

### LESSON-006: Empty Docker Volume Copy-Up Overrides Ownership

- **ID**: `LESSON-006`
- **Category**: `ci`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: `.github/workflows/ui-preview.yml`

#### Symptom

The privileged setup container completes its volume ownership initialization, but the later UID 1000 build container cannot extract the source archive into `/app` and exits 2.

#### Root Cause

The application volume remains empty after `chown`; default volume population on a subsequent mount can copy the image's application directory metadata back over the prepared ownership. The observed failure is a writable-directory contract mismatch between setup and build.

The image's pre-existing `/home/pwuser/.npm` cache is also root-owned: after disabling copy-up, npm itself rejected cache access. Non-root builds must use a fresh writable cache rather than inheriting image cache ownership.

#### Evidence

- 2026-10-10 — disposable PR #127, [repair probe 38044325874](https://github.com/Arcadia822/taco/actions/runs/38044325874): setup succeeded, then tar reported `Permission denied` for every source entry.

#### Prevention & Escalation

- Use `--mount type=volume,src=taco-preview-app,dst=/app,volume-nocopy` consistently during setup, build, and capture; initialize ownership once without populating the empty volume from an image. Keep untrusted build and capture at UID 1000 with dropped capabilities.
- Set `npm_config_cache=/tmp/npm-cache` for the build container so npm can install without changing the image's ownership or running the untrusted build as root.

---

### LESSON-007: GitHub Rejects Empty Asset Bootstrap Trees

- **ID**: `LESSON-007`
- **Category**: `ci`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: `.github/workflows/scripts/publish-preview.mjs`, `tests/ui-preview-pipeline.test.ts`

#### Symptom

Capture, sanitization, validation, and upload succeed, but the first publisher run fails with GitHub API 422 `Invalid tree info`.

#### Root Cause

The absent assets branch bootstrap submitted `{ tree: [] }` to the Git Trees API, which rejects an empty tree. Existing mocks accepted that payload and never exercised first-publication API behavior.

#### Evidence

- 2026-10-10 — disposable PR #127, [repair probe 38044557106](https://github.com/Arcadia822/taco/actions/runs/38044557106): Record succeeded; Publish failed at `POST /git/trees`.

#### Prevention & Escalation

- Initialize the orphan branch with a valid tree containing its generated-assets README. Retain `parents: []` and the existing create-ref race handling.
- The first-publication regression rejects empty tree requests and checks the orphan commit references the initialized tree.
