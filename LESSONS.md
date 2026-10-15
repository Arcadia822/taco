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

| ID                                                                                             | Title                                                                | Occurrences |    Status     | Guard                                                                                                          |
| :--------------------------------------------------------------------------------------------- | :------------------------------------------------------------------- | :---------: | :-----------: | :------------------------------------------------------------------------------------------------------------- |
| [LESSON-001](#lesson-001-local-dependency-drift-pollutes-test-runs)                            | Local Dependency Drift Pollutes Test Runs                            |      1      |   **open**    | `package-lock.json`, `.github/workflows/ci.yml`                                                                |
| [LESSON-002](#lesson-002-version-triples-desync-across-release-surfaces)                       | Version Triples Desync Across Release Surfaces                       |      2      |   **open**    | `scripts/sync-skill-version.mjs`, `tests/version.test.ts`                                                      |
| [LESSON-003](#lesson-003-tiptap-prosemirror-crash-on-markdown-code-in-bold)                    | Tiptap ProseMirror Crash on Markdown Code-in-Bold                    |      3      | **escalated** | `src/tiptap-editor.ts`, `tests/markdown-emphasis-code.test.ts`                                                 |
| [LESSON-004](#lesson-004-headless-mermaid-execution-fails-without-dom-mock)                    | Headless Mermaid Execution Fails Without DOM Mock                    |      1      |   **open**    | `skills/taco/scripts/lint-mermaid.mjs`, `tests/mermaid-lint.test.ts`                                           |
| [LESSON-005](#lesson-005-artifact-id-downloads-nest-the-consumed-files)                        | Artifact-ID Downloads Nest the Consumed Files                        |      1      |   **open**    | `.github/workflows/ui-preview.yml`                                                                             |
| [LESSON-006](#lesson-006-empty-docker-volume-copy-up-overrides-ownership)                      | Empty Docker Volume Copy-Up Overrides Ownership                      |      1      |   **open**    | `.github/workflows/ui-preview.yml`                                                                             |
| [LESSON-007](#lesson-007-github-rejects-empty-asset-bootstrap-trees)                           | GitHub Rejects Empty Asset Bootstrap Trees                           |      2      |   **open**    | `.github/workflows/scripts/publish-preview.mjs`, `tests/ui-preview-pipeline.test.ts`                           |
| [LESSON-008](#lesson-008-occupied-preview-port-serves-another-worktree)                        | Occupied Preview Port Serves Another Worktree                        |      1      |   **open**    | Unique preview ports and rendered workflow verification                                                        |
| [LESSON-009](#lesson-009-legacy-service-tests-do-not-prove-production-routes)                  | Legacy Service Tests Do Not Prove Production Routes                  |      1      |   **open**    | CLI-to-Next runtime smoke                                                                                      |
| [LESSON-010](#lesson-010-revision-migrations-must-preserve-legacy-tables-and-event-order)      | Revision Migrations Must Preserve Legacy Tables and Event Order      |      1      |   **open**    | `packages/host/test/taco-60.test.ts`                                                                           |
| [LESSON-011](#lesson-011-dynamic-preview-boundary-discrepancies-and-marker-injection)          | Dynamic Preview Boundary Discrepancies & Marker Injection            |      1      |   **open**    | `.github/workflows/scripts/plan-schema.mjs`, `tests/dynamic-preview-plan.test.ts`                              |
| [LESSON-012](#lesson-012-nextjs-google-font-loader-crashes-on-non-extension-endpoints)         | Next.js Google Font Loader Crashes on Non-Extension Endpoints        |      1      |   **open**    | `packages/host/src/app/fonts/`, `packages/host/src/app/page.tsx`                                               |
| [LESSON-013](#lesson-013-green-vitest-does-not-prove-type-level-integrity)                     | Green vitest Does Not Prove Type-Level Integrity                     |      1      |   **open**    | `npm run check` (`tsc -b`), `scripts/build-shells.mjs`                                                         |
| [LESSON-014](#lesson-014-browser-action-receipts-do-not-prove-iframe-interaction)              | Browser Action Receipts Do Not Prove Iframe Interaction              |      1      |   **open**    | Observe frame output; explicit frame interaction                                                               |
| [LESSON-015](#lesson-015-cli-bundling-changes-helper-entrypoint-identity)                      | CLI Bundling Changes Helper Entrypoint Identity                      |      1      |   **open**    | Installed npm/native runtime smoke and deferred helper defaults                                                |
| [LESSON-016](#lesson-016-conditional-assertions-and-default-environments-create-hollow-greens) | Conditional Assertions and Default Environments Create Hollow Greens |      1      |   **open**    | `scripts/smoke-local-toolbox.mjs`, `packages/cli/test/write-safety.test.ts`                                    |
| [LESSON-017](#lesson-017-runtime-ddl-and-expiry-consumers-diverge)                             | Runtime DDL and Expiry Consumers Diverge                             |      1      |   **open**    | Real PostgreSQL bootstrap/upgrade and expired-route regression smoke                                           |
| [LESSON-018](#lesson-018-temporary-postgresql-binaries-omit-dylib-aliases)                     | Temporary PostgreSQL Binaries Omit Dylib Aliases                     |      1      |   **open**    | Inspect otool dependencies and restore aliases only in disposable runtime                                      |
| [LESSON-019](#lesson-019-verifiers-must-match-runtime-contracts-and-native-keyboards)          | Verifiers Must Match Runtime Contracts and Native Keyboards          |      3      | **escalated** | Full browser registry, native caret/selection invariants and real Next/CLI smoke in `.github/workflows/ci.yml` |
| [LESSON-020](#lesson-020-fresh-worker-checkout-tooling-assumptions)                            | Fresh Worker Checkout Tooling Assumptions                            |      1      |   **open**    | Resolve package names from manifests and commit identity before delivery                                       |

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
- **Occurrences**: 2
- **Status**: `open`
- **Guard**: `.github/workflows/scripts/publish-preview.mjs`, `tests/ui-preview-pipeline.test.ts`

#### Symptom

Capture, sanitization, validation, and upload succeed, but a publisher run fails with GitHub API 422 `Invalid tree info`. It first appeared while bootstrapping the absent assets branch, and it recurs on an ordinary upload whenever the revision produced no screenshots.

#### Root Cause

Two call sites submitted an empty `tree` array to the Git Trees API, which rejects it: the absent-branch bootstrap, and the per-upload tree that collected no blobs because the manifest held no screenshots. Existing mocks accepted the empty payload and never exercised the real API contract.

#### Evidence

- 2026-10-10 — disposable PR #127, [repair probe 38044557106](https://github.com/Arcadia822/taco/actions/runs/38044557106): Record succeeded; Publish failed at `POST /git/trees`.
- 2026-10-12 — PR #146, [run 38238299098](https://github.com/Arcadia822/taco/actions/runs/38238299098): Collect, Plan and Record succeeded; Publish failed at `POST /git/trees` with an empty tree because an invalid plan left the manifest without screenshots. A local run of the publisher against PR #148 reproduced the identical 422.

#### Prevention & Escalation

- Initialize the orphan branch with a valid tree containing its generated-assets README. Retain `parents: []` and the existing create-ref race handling.
- The first-publication regression rejects empty tree requests and checks the orphan commit references the initialized tree.
- Never send an empty tree to the Git data API. A revision with no screenshots skips the tree, commit, ref, and branch-bootstrap calls, so the job ends without an API error.

---

### LESSON-011: Dynamic Preview Boundary Discrepancies and Marker Injection

- **ID**: `LESSON-011`
- **Category**: `ci`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: `.github/workflows/scripts/plan-schema.mjs`, `tests/dynamic-preview-plan.test.ts`

#### Symptom

Dynamic preview runs produced unexpected failures across 7 defect clusters: unescaped marker literals in model summaries duplicated PR body delimiters and broke subsequent updates with `PrBodyMarkerError`; synthetic SVG tags (`g.actor.actor-box` instead of `rect.actor`/`text.actor`) caused locateElement failures; phantom failure shots registered without successful disk writes triggered `ERR_MISSING_FILE`; `ui_change=false` with non-empty scenes passed plan schema but failed directory validation with `ERR_SCENE_COUNT`; environment startup failures did not write diagnostic manifests; and over-budget plans reordered steps destructively.

#### Root Cause

Contract drift between untrusted model planning and downstream validator expectations. Specifically, SVG outline generation assumed `g` container tags for all child nodes, schema validation permitted contradictory `ui_change=false` scenes and unreserved failure shot names, execution error handlers unconditionally registered screenshot artifacts without verifying filesystem persistence, and PR body markdown interpolation lacked escaping for table pipes, brackets, and demarcated boundary markers. Furthermore, model evaluations confirmed CommandCode Jev (`typesafe/jev`) provides typed decision probabilities rather than text/selector generation, reaffirming that deepseek-v4.1-flash remains the appropriate dynamic planner default while strict boundary validation guards execution. Additionally, local environments lacking pre-installed Pillow (`PIL`) require an isolated pinned virtual environment (`Pillow==12.3.0`) for image sanitization during developer verification.

#### Evidence

- 2026-10-11 — Independent PR Review, Security, and Architecture audits on PR #132 (freeze head `dbda425`, worktree `feat/taco-62-dynamic-preview`); repro of duplicate markers via `updatePrBodyWithBlock`, phantom screenshot failure under browser abort, locator mismatch, and local environment missing PIL module.

#### Prevention & Escalation

- Enforce exact SVG tag and class preservation in `dom-outline.mjs`.
- Strictly reserve failure shot names (`failure`, `failure-state`) and globally reserve all-scene failure filenames (`<scene-id>-failure.png`) in `plan-schema.mjs`.
- Ensure `ui_change: false` canonically requires `scenes: []` across plan schema, execution, and PNG validation.
- Guarantee execution startup failures write valid diagnostic manifests, and register failure screenshots only when disk writes succeed.
- Sanitize dynamic text before markdown table/alt interpolation and validate the final PR body retains exactly one marker pair.
- Provide isolated pinned `Pillow==12.3.0` virtual environments for local sanitization runs when Docker daemon is not active.

---

### LESSON-012: Next.js Google Font Loader Crashes on Non-Extension Endpoints

- **ID**: `LESSON-012`
- **Category**: `ci`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: `packages/host/src/app/fonts/`, `packages/host/src/app/page.tsx`

#### Symptom

Containerized Host application build (`npm run --prefix packages/host build`) fails abruptly during Next.js page compilation with `TypeError: Cannot read properties of null (reading '1') at loader.js:122:78`, aborting the preview workflow before UI capture begins.

#### Root Cause

Next.js `@next/font/google` loader (`loader.js:122`) relies on an unverified regular expression assumption: after extracting font resource URLs from Google Fonts `@font-face` CSS declarations, it executes `/\.(woff|woff2|eot|ttf|otf)$/.exec(googleFontFileUrl)[1]`. When Google Fonts returns dynamically routed or edge-cached endpoint URLs that do not end with a standard font file extension at the URL terminus, `.exec()` evaluates to `null`. Indexing `[1]` on `null` triggers an uncaught `TypeError`. Furthermore, ad-hoc build flags such as `NEXT_FONT_GOOGLE_MOCKED=1` are unsupported by Next.js and fail to bypass the loader.

#### Evidence

- 2026-10-11 — PR #132 UI preview run [38135648472](https://github.com/Arcadia822/taco/actions/runs/38135648472): `taco-preview-build` container exited status 1 during `next build` on `src/app/page.tsx` due to `TypeError: Cannot read properties of null (reading '1')` in `next/dist/compiled/@next/font/dist/google/loader.js:122:78`.

#### Prevention & Escalation

- Eliminate external build-time font network requests by migrating `packages/host` to `next/font/local`.
- Bundle self-contained, official variable WOFF2 fonts (`Geist-Variable.woff2` and `FiraCode-Variable.woff2`) under OFL-1.1 with full subset/glyph coverage.
- Preserve identical CSS custom properties (`--font-geist` and `--font-fira-code`) and font metrics to prevent visual regressions and layout shifts.
- Never rely on fake Google font mocks or suppressing loader errors.

---

### LESSON-008: Occupied Preview Port Serves Another Worktree

- **ID**: `LESSON-008`
- **Category**: `tooling`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: Unique preview ports and rendered workflow verification

#### Symptom

A preview tool reports a new Next service ready, then the process exits. The browser still loads a homepage containing code removed from the current worktree.

#### Root Cause

The readiness port was already occupied by a different Next process. Port availability proved that some server was listening, not that the newly launched process served this worktree.

#### Evidence

- 2026-10-11, TACO-61. Port 32168 served the old environment setup row. `lsof` showed an existing Next listener. A service launched from this worktree on port 32169 rendered the updated workflow without that row.

#### Prevention & Escalation

- Assign a unique port to each worktree preview and launch from the package directory.
- Verify a changed rendered element before treating readiness as proof. Report readiness mismatches to the tool owner.

---

### LESSON-009: Legacy Service Tests Do Not Prove Production Routes

- **ID**: `LESSON-009`
- **Category**: `architecture`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: CLI-to-Next runtime smoke

#### Symptom

TACO-60 has a revision implementation in the legacy `TacoHostService`, while the actual CLI reports `Network update is not implemented` and the production Next routes do not expose revisions.

#### Root Cause

The authenticated staged-upload service and the public Next review routes use different persistence paths. Service tests alone cannot establish that a feature exists in the running Host.

#### Evidence

- 2026-10-11 — TACO-60: actual CLI update against the local Next Host exited 2 before implementation. Production mapping found no revision pointer in `TacoDb` despite the legacy service revision method.

#### Prevention & Escalation

- Trace the command through its HTTP route and active database adapter before reusing a legacy implementation.
- Exercise the built CLI against the running Next Host and inspect the served document and persisted review state.

---

### LESSON-010: Revision Migrations Must Preserve Legacy Tables and Event Order

- **ID**: `LESSON-010`
- **Category**: `architecture`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: `packages/host/test/taco-60.test.ts`

#### Symptom

TACO-60 revision initialization collided with the legacy authenticated `revisions` table. A local Host update also failed a foreign-key check after a development singleton retained a revision pointer without its new revision row.

#### Root Cause

The public review model reused a legacy table name with incompatible required columns. Migration initially seeded only null pointers. Timestamp ordering and using the current event cursor as the baseline revision sequence also made acknowledged Handoffs unreliable.

#### Evidence

- 2026-10-11 — TACO-60 runtime smoke: built CLI returned `FOREIGN KEY constraint failed`; after migration and restart, two updates preserved identity and review state. An actual content patch followed by update returned conflict exit code 4.

#### Prevention & Escalation

- Store public snapshots in `published_revisions`, preserving the legacy `revisions` table and its consumers.
- Seed missing baseline rows independently of the current pointer. Update the pointer only while null, and retain the initial event sequence of 1.
- Persist Handoff snapshots and compare event sequences. A legacy null snapshot can use live state only when its acknowledged state version matches.
- Runtime probes and regression tests must use valid `FilePatch` content and observe the saved edit before checking conflict rejection.

---

### LESSON-013: Green vitest Does Not Prove Type-Level Integrity

- **ID**: `LESSON-013`
- **Category**: `tooling`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: `npm run check` (`tsc -b`), `scripts/build-shells.mjs`

#### Symptom

A change reports a fully green test run while `tsc -b` fails: widening `FileKind` in `src/model.ts` left `Record<FileKind, IconName>` in `src/ui-primitives.ts` without the new `html` key (TS2741), and `tests/model.test.ts` used `TacoFile` without importing it (TS2304).

#### Root Cause

vitest transpiles TypeScript without type-checking, so exhaustiveness of `Record<union, …>` maps and missing type imports pass the test runner and surface only in the compiler step of `npm run build`.

#### Evidence

- 2026-10-11 — TACO-70: the inline-HTML slice extended `FileKind` with `html`; 57 test files / 663 tests passed, then `npm run build` failed on the icon map and the missing type import.

#### Prevention & Escalation

- Treat `tsc -b` (via `npm run check`) as the completion gate for any TypeScript change; a green test run alone is not verification.
- When widening a union type, change its exhaustive `Record<…>` maps in the same edit and grep for other consumers.

---

### LESSON-014: Browser Action Receipts Do Not Prove Iframe Interaction

- **ID**: `LESSON-014`
- **Category**: `tooling`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: Observe iframe output after interaction; use an explicit frame handle when wrapper targeting is ambiguous.

#### Symptom

An Ego browser click on a button inside the HTML preview returned successfully, but the iframe output stayed `Ready`. Screenshot capture subsequently timed out.

#### Root Cause

The wrapper action receipt did not establish that the cross-origin iframe handler ran. A direct managed Chromium frame click on the same artifact executed the handler and showed the expected result; the exact wrapper failure remains unconfirmed.

#### Evidence

- 2026-10-11, TACO-70 review repair: direct frame interaction showed `Action passed; parent access blocked` in both local and canonical Host shells. The wrapper mismatch was reported through the tool QA channel.

#### Prevention & Escalation

- Verify the visible result inside the frame before claiming an action succeeded.
- Classify a wrapper or screenshot timeout separately from product behavior, and retain the successful frame-level runtime evidence.

---

### LESSON-015: CLI Bundling Changes Helper Entrypoint Identity

- **ID**: `LESSON-015`
- **Category**: `tooling`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: Installed npm/native runtime smoke and deferred helper defaults

#### Symptom

Importing the shared Mermaid helper prevented both CLI test suites from collecting with `TypeError: The URL must be of scheme file`. A source-only executable guard also becomes true when the helper is bundled into the CLI entrypoint.

#### Root Cause

The helper eagerly converted its module-relative default Shell URL into an OS path during import. Test transforms can supply a non-file module URL. Bundling changes module identity to the consuming executable, so comparing only `import.meta.url` and `process.argv[1]` does not distinguish the helper's standalone entrypoint.

#### Evidence

- 2026-10-11 — `npm test` failed before CLI assertions at `skills/taco/scripts/lint-mermaid.mjs:73`. Release source review identified the same module-identity assumption in both shared helper entrypoint guards.

#### Prevention & Escalation

- Resolve standalone helper defaults only when that standalone path is invoked.
- Keep helper entrypoint guards false in npm and native CLI bundles.
- Exercise the installed npm package and native binary without an installed Skill. A successful source import does not establish the packaged runtime contract.

---

### LESSON-016: Conditional Assertions and Default Environments Create Hollow Greens

- **ID**: `LESSON-016`
- **Category**: `tooling`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: `scripts/smoke-local-toolbox.mjs`, `packages/cli/test/write-safety.test.ts` (node environment pragma)

#### Symptom

`scripts/smoke-local-toolbox.mjs` reported `ok: true` for HTML iframe rendering while it never opened the HTML page: the check ran only `if (await htmlFileRow.isVisible())`, and with a Checkpoint graph the page sits in the collapsed `Unassigned files` group. New CLI regression tests reported passing by their authors but failed under the repository default: the embedded Mermaid parser does not load under the root `jsdom` environment, so `verify` exited 2 before reaching the code under test.

#### Root Cause

A guard that skips an assertion when its precondition fails turns a regression into a silent pass. `vite.config.ts` sets `test.environment: 'jsdom'` for browser tests; CLI tests inherit it unless they opt out.

#### Evidence

- 2026-10-12 — PR #144 independent review: hiding the HTML row still produced `ok: true`. After the assertion became mandatory it failed on the collapsed group, proving the check had never run. Two new CLI suites failed with `Bundled Mermaid parser failed to load from embedded shell` until marked `// @vitest-environment node`.

#### Prevention & Escalation

- Assert a smoke precondition instead of branching on it; expand collapsed UI explicitly before asserting visibility.
- Start every `packages/cli/test/*.test.ts` file that exercises the embedded Shell with `// @vitest-environment node`.
- Run the full suite from the repository root after integrating parallel slices; a per-file pass in another worker's environment is not evidence.

---

### LESSON-017: Runtime DDL and Expiry Consumers Diverge

- **ID**: `LESSON-017`
- **Category**: `architecture`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: Real PostgreSQL bootstrap/upgrade and expired-route regression smoke

#### Symptom

PR #145 passed 87 Host/CLI tests, while a real PostgreSQL publish failed with SQLSTATE 42703. Expired history remained readable, permanent TTL became 30 days, and an expired subscription handshake exited as a cursor gap.

#### Root Cause

The standalone schema.sql contained expires_at, but the actual PG_SCHEMA and runtime migration did not. SQLite-only TTL tests and PostgreSQL mocks bypassed initialization. Consumers treated a non-null expired Taco as readable, null was conflated with omission, and nested HTTP 410 handlers intercepted the new outer error mapping.

#### Evidence

- 2026-10-12 — PR #145 review and repair: original PostgresDbAdapter against a disposable real PostgreSQL cluster raised `column "expires_at" of relation "tacos" does not exist`; live Next/CLI probes reproduced permanent-value, history-read, and subscription-exit failures.

#### Prevention & Escalation

- Validate both runtime DDL and existing-database migration against real SQL, not only a schema reference or mock Pool.
- Test the same expired resource across all public content readers and both subscription handshake/online termination paths.
- Keep undefined (default) distinct from null/zero (permanent), and keep expiry access control distinct from physical reclamation.

---

### LESSON-018: Temporary PostgreSQL Binaries Omit Dylib Aliases

- **ID**: `LESSON-018`
- **Category**: `tooling`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: Inspect otool dependencies and restore aliases only in disposable runtime

#### Symptom

The isolated @embedded-postgres/darwin-arm64 package's initdb aborted before database initialization: dyld could not find libicudata.77.dylib, then postgres could not load libzstd.1.dylib.

#### Root Cause

The archive includes versioned dylib files but omits shorter alias names referenced by its binaries and libraries.

#### Evidence

- 2026-10-12 — TACO-53 PostgreSQL smoke: otool -L identified missing ICU, zstd, lz4 and z aliases. Creating aliases to the packaged versioned libraries in the temporary runtime allowed initdb and postgres to start.

#### Prevention & Escalation

- Classify loader failures as verification setup failures; inspect linked dependencies before retrying.
- Restore aliases only inside a disposable runtime. Do not add verification tooling to project dependencies or modify system libraries.

---

### LESSON-019: Verifiers Must Match Runtime Contracts and Native Keyboards

- **ID**: `LESSON-019`
- **Category**: `tooling`
- **Occurrences**: 3
- **Status**: `escalated`
- **Guard**: Full browser registry, native caret/selection invariants and real Next/CLI smoke in `.github/workflows/ci.yml`

#### Symptom

The first integrated TACO-81 browser run executed 51 cases and failed 13 despite the unchanged product passing the existing gate. Examples included comparing a `readFile()` object with a string, passing a Page to a helper expecting a harness, and empty textarea selections. The Host verifier also rejected the returned `localhost` URL because it had constructed its origin with `127.0.0.1`.

The later integrated pass exposed two more contract gaps in the same verification infrastructure. Setup could remain pending after every owned resource had closed, so Node exited 13 with an unsettled top-level await instead of retaining a case result. Separately, removing Host signal handlers before cleanup lost its summary, and a signal during summary writing could leave `ok:true` evidence alongside exit 143.

#### Root Cause

Scenario slices inferred API shapes and UI controls instead of following the shared contract. The source-textarea probe on macOS Chromium showed `ControlOrMeta+End` leaving the caret unchanged while `Meta+ArrowDown` reached offset 6209. A rich editor needs its own observed focus and selection proof: inheriting the textarea mapping and checking only that the token exists can pass even when the token prefixes the first H1. NextURL normalizes loopback hostnames before the Host constructs its publish response; the CLI forwards that response unchanged.

With the pinned Playwright, closing a context while `context.newPage()` is in flight can orphan that promise even after both context and browser closes return. Closing the browser directly without first closing its context rejected the pending call in about 11ms. An unraced orphan leaves an unsettled top-level await; once the owned handles disappear, Node exits 13. The failing run had not reached doctor, and server keep-alive did not reproduce the failure. Host removed its signal handlers too early and sampled its summary before the asynchronous write, allowing later signals to bypass cleanup or leave stale success evidence.

#### Evidence

- 2026-10-14 — TACO-81 integrated `CI=1 npm run test:verify`: 51 executed, 38 passed, 13 failed; `npm run test:host` stopped after publish at the hostname equality assertion. The run manifests retain the failures and owned-resource cleanup proof.
- 2026-10-14 — TACO-81 second integrated pass: the retained lifecycle probe shows the orphan. `artifacts/verify-taco/lifecycle-87991ba5/probes.json` fails with `deadline-500: Unclosed setup: Setup settling timed out after 3000ms` even though trace, context, browser, server and port all report `closed`; after racing setup against its own cancellation, `artifacts/verify-taco/lifecycle-ed5e833e/probes.json` stays `ok:true` with every deadline scenario `ok:false`, all owned resources `closed` and trace retained when it had started. On the Host side, `artifacts/smoke-host/cleanup-signal-a164f9bc/cleanup-signal-proof.json` records a real SIGTERM with `summaryRetained: false` and `survivingOwnedGroups: []` — summary loss, not a demonstrated surviving process — while the corrected handler version `artifacts/smoke-host/cleanup-signal-b5161716/cleanup-signal-proof.json` records `summaryRetained: true`, exit code 143, `interrupted: SIGTERM` and every owned resource closed. The Host pass itself now reaches 9/9 (`artifacts/smoke-host/2026-10-14T07-33-29-074Z-4a57f3cc/summary.json`, 0 failed) once the receipt parsed the full stdout instead of a truncated tail.
- 2026-10-14 — The third integrated pass added a final-paragraph invariant and exposed the remaining rich-caret defect: `artifacts/verify-taco/suite-2026-10-14T07-55-18.870Z-2c84753d/suite.json` records 41/51 with 10 failures. The rich-comment failure screenshot shows the token prefixing the first H1 while the final paragraph remains empty. The local toolbox's same invariant also failed before its first handoff. The full-suite CI gate now carries these selection and placement assertions; a syntactically valid helper or a matching token substring cannot establish a native input pass.
  The caret-state probe ruled out content rebuilding: before Enter, the DOM caret was already at the last paragraph but the editor still held `from=1 / docSize=121`. Native start/end moves plus bounded settling produced `from=120`, the new final token paragraph and its exact quote. A/B evidence under `artifacts/verify-taco/ab-1-*` records 4/4 failures without settling and 4/4 passes with it; `val4-*`, `val5-1` and `valsrc*` cover rich-editor and Lite-textarea surfaces. Native Select All + ArrowRight was rejected by its probe because editor AllSelection survived and typing replaced the entire document.

#### Prevention & Escalation

- Read actual getter return values and helper signatures before writing consumer assertions; keep one canonical helper signature and migrate every caller.
- Keep native caret positioning in one shared helper, but verify focus, collapsed selection and the actual document end on each editor surface before typing. Require new comment tokens to occupy their final paragraph and assert the exact selected quote. Every caller reuses that helper; the full browser registry and local listener smoke enforce these invariants in CI.
- Verify the returned publish URL against the owned loopback port and fetch its actual page instead of requiring an incidental hostname spelling.
- Run the complete registered browser suite and real CLI/Next smoke after integrating slices; syntax checks and individual author reports do not establish scenario success.
- Race non-interruptible setup operations against explicit cancellation (`setupOperation`/`cancelSetup`) instead of assuming disposal settles every Playwright call. Bound native launch by the remaining case budget and HTTP probes with `AbortSignal` timeouts.
- Keep signal handlers installed until cleanup and summary writing finish. If the first signal arrives during a summary write, refresh its interruption fields and rewrite it before setting exit 143 and removing handlers. Keep one cleanup path and ignore repeat signals during it.
- Never truncate a machine payload for an assertion. The Host receipt failure came from feeding a `tail(stdout, 8000)` log projection into `JSON.parse`, which discarded the head of the CLI's JSON; parse the full stdout and bound only the human log projection.

---

### LESSON-020: Fresh Worker Checkout Tooling Assumptions

- **ID**: `LESSON-020`
- **Category**: `tooling`
- **Occurrences**: 1
- **Status**: `open`
- **Guard**: Resolve package names from manifests and commit identity before delivery

#### Symptom

TACO-84 Host preview failed with `No workspaces found` for an inferred package name; commit failed because the fresh worker had no Git author identity.

#### Root Cause

The Host manifest uses `taco-server`, not the inferred scoped name, and ephemeral workers need not inherit a Git author configuration.

#### Evidence

- 2026-10-15: `npm --prefix packages/host run dev -- --hostname 127.0.0.1 --port 4184` started successfully and returned HTTP 200. `gh api user` supplied the authenticated public identity for explicit per-command commit attribution.

#### Prevention & Escalation

- Use the manifest or package directory instead of inventing workspace names. Resolve public author identity before committing; never read credentials or modify global Git configuration.
