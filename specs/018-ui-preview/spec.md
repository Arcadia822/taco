---
title: '018-ui-preview'
feature_id: '018-ui-preview'
created: '2026-10-10'
status: 'Draft'
issue: 'https://github.com/Arcadia822/taco/issues/119'
linear: 'https://linear.app/castrel/issue/TACO-64'
input: |-
  TACO-64: GitHub Actions pull_request_target UI preview pipeline with deterministic views, container isolation, and branch-based assets.
---

## 1. Background & Goals

When contributors or automated agents submit pull requests touching Taco specifications (`specs/**`), the web host application (`packages/host/**`), or explicitly ask for visual verification via the `ui-preview` label, reviewers need immediate visual evidence of how changes affect both the standalone Taco experience and the hosted environment on the standard 1280x800 desktop viewport.

Existing CI (`.github/workflows/ci.yml`) validates formatting, tests, and shell synchronization, but does not render or snapshot UI artifacts. Running browser automation and preview rendering on pull requests requires stringent security boundaries: PR branches from public forks may contain untrusted code. Direct execution of untrusted fork code in a privileged `pull_request_target` runner risks leaking repository tokens (`GITHUB_TOKEN` with write permissions) or Actions environment credentials.

This specification defines the three-stage pipeline architecture (`detect` -> `record` -> `publish`), Docker container sandbox boundaries, a deterministic fixed view registry, container-side pixel re-encoding of captured PNGs, atomic orphan-branch asset storage on `ui-preview-assets`, and idempotent, demarcated PR body commentary.

## 2. Size & Resource Impact Estimates

### 2.1 Design-time estimates

Baselines below were measured against the revision this specification was written from (`git ls-tree` / `git cat-file -s`). The change column is the original design-time estimate; Section 9 records the measured outcome.

| Metric / Artifact                                           | Baseline Before (measured) | Estimated Change                                                                                       | Estimated Total             |
| :---------------------------------------------------------- | :------------------------- | :----------------------------------------------------------------------------------------------------- | :-------------------------- |
| Standalone Shell (`extensions/taco/assets/taco-shell.html`) | 2,846,082 bytes            | 0 bytes                                                                                                | 2,846,082 bytes             |
| Lite Shell (`extensions/taco/assets/taco-shell-lite.html`)  | 296,790 bytes              | 0 bytes                                                                                                | 296,790 bytes               |
| Skill Shell (`skills/taco/taco-shell.html`)                 | 2,737,618 bytes            | 0 bytes                                                                                                | 2,737,618 bytes             |
| Skill Lite Shell (`skills/taco/taco-shell-lite.html`)       | 188,326 bytes              | 0 bytes                                                                                                | 188,326 bytes               |
| Package Runtime Dependencies (`package.json`)               | 17 packages                | 0 packages                                                                                             | 17 packages                 |
| Repository Dev Dependencies (`package.json`)                | 10 packages                | 0 packages                                                                                             | 10 packages                 |
| CI Network / Image Dependency (Runner Image)                | N/A                        | +2 pinned images (`mcr.microsoft.com/playwright:v1.56.1-noble`, `python:3.12-slim` + `Pillow==12.3.0`) | 2 pinned images             |
| CI Pipeline Modules (`.github/workflows/scripts/**`)        | 2 scripts (13,455 bytes)   | +7 scripts (~42 KB) and 6 paired `.d.mts` declarations                                                 | 9 scripts plus declarations |
| CI Workflow Definition (`.github/workflows/ui-preview.yml`) | 0 bytes                    | +~12 KB                                                                                                | ~12 KB                      |
| Pipeline Tests (`tests/ui-preview-pipeline.test.ts`)        | 0 bytes                    | +~22 KB                                                                                                | ~22 KB                      |
| Preview PNG Artifact Payload per PR run (4 views)           | 0 bytes                    | ~400 KB - 1.6 MB total                                                                                 | ~400 KB - 1.6 MB            |

## 3. Architecture & Security Boundaries

```
[PR Event: pull_request_target]
       │
       ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Job 1: detect (trusted base revision, permissions: {contents: read})  │
│ - Evaluates the ui-preview label and the PR changed-file list         │
│ - Emits trusted metadata: pr number, full head SHA, repository        │
│ - Uploads the trusted tooling (base-revision scripts) as an artifact  │
│   and forwards its immutable artifact id to the record job            │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ (run_preview == true)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Job 2: record (permissions: {})                                       │
│ - No checkout and no repository token: trusted tooling arrives as a   │
│   downloaded artifact, the untrusted source is fetched anonymously    │
│ - Pinned playwright@1.56.1 is installed with --prefix into a trusted  │
│   directory before any PR code exists on disk                         │
│ - Build container: scratch volume, non-root, cap-drop ALL, network    │
│ - Capture container: same volume, network: none, container loopback   │
│ - Sanitizer container: independent image, network: none, pinned       │
│   Pillow, full pixel decode + fresh RGB/RGBA re-encode                │
│ - Rejects any extra or missing entry instead of normalizing the set   │
│ - Structural byte validation, then upload-artifact; the job publishes │
│   only the immutable artifact id                                     │
└──────────────────────────────┬───────────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Job 3: publish (permissions: {contents: write, pull-requests: write}) │
│ - Downloads the screenshots by immutable artifact id                  │
│ - Re-checks the live PR is open and still at the recorded head SHA    │
│ - Structural byte validation only; no image decoding                  │
│ - Commits images to the orphan branch `ui-preview-assets` via the Git │
│   Data API, rebuilding from the observed tip on a real ref conflict   │
│ - Re-reads head and body immediately before the body mutation and     │
│   rewrites only the demarcated preview block                          │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.1 Three-Job Workflow Division

1. **`detect`** runs on the trusted base revision with `contents: read` and `pull-requests: read`. It evaluates the label and the changed-file list, writes `run_preview`, and forwards `pr_number`, the full `head_sha`, the repository slug, and the immutable id of the trusted-tooling artifact.
2. **`record`** runs with `permissions: {}`. It never checks out the repository and never holds a repository token: the trusted scripts come from the detect artifact and the untrusted source tarball is fetched anonymously from `codeload.github.com` at the full head SHA. Build, capture, and sanitization all run inside Docker containers that are stopped before the next stage; the job then re-validates the sanitized set structurally and publishes only the screenshot artifact id.
3. **`publish`** runs with `contents: write` and `pull-requests: write` on a fresh runner. It verifies that the live PR is open and still at the recorded head SHA, verifies the artifact is exactly the registered PNG set, commits the assets, then re-reads the PR and rewrites only the marked body region.

Both artifact-ID downloads set `merge-multiple: true`: trusted tools must land directly in `/tmp/trusted-tools`, and sanitized screenshots directly in `downloaded-previews`. The default artifact-name subdirectory breaks the fixed imports and the publisher's exact-file-set validation.

### 3.2 Fixed View Registry

The capture pipeline never accepts view definitions from pull request code. `.github/workflows/scripts/view-registry.mjs` is the single source of truth for view ids, filenames, targets, and viewports, and every later stage re-derives its expectations from it.

| View ID        | Filename           | Target               | Viewport   | Purpose                                           |
| :------------- | :----------------- | :------------------- | :--------- | :------------------------------------------------ |
| `taco-desktop` | `taco-desktop.png` | Complete Taco bundle | 1280 x 800 | Desktop reader, navigation, and sidebar rendering |
| `host-desktop` | `host-desktop.png` | Host application     | 1280 x 800 | Hosted document loading, header, and toolbar      |

### 3.3 Container Isolation

Every container runs with `--cap-drop ALL`, `--security-opt no-new-privileges:true`, non-root uid 1000, memory/CPU/PID limits, and no host path that the untrusted code may write except the designated output directory.

| Stage    | Network        | Access                                                     | Notes                                                  |
| :------- | :------------- | :--------------------------------------------------------- | :----------------------------------------------------- |
| Build    | default bridge | `taco-preview-app` volume (rw), source tarball (ro)        | npm registry and `next/font` need egress               |
| Capture  | `none`         | `taco-preview-app` (rw), `/out` (rw), trusted tooling (ro) | app and browser talk over container loopback           |
| Sanitize | `none`         | `/out` (rw), trusted tooling (ro)                          | separate trusted image built before the artifact mount |

## 4. Asset Storage Strategy: `ui-preview-assets` Branch

- Screenshots are committed to an orphan branch named `ui-preview-assets`.
- Assets are stored under `previews/pr-{pr_number}/{view_id}-{head_sha}.png`, where `{head_sha}` is the full 40-character head commit.
- Markdown embeds link to immutable raw URLs: `https://raw.githubusercontent.com/{owner}/{repo}/{assets_commit_sha}/previews/pr-{pr_number}/{view_id}-{head_sha}.png`.
- Because commits are addressed by immutable SHA, images are cacheable by GitHub's Camo proxy. Availability of that proxy is outside this pipeline's control.
- Deleted paths remain in the branch history; the pipeline therefore bounds the capture set and PNG sizes rather than relying on Git storage reclamation.

## 5. PR Body Marker Contract

The publisher replaces only the region between the markers:

```markdown
<!-- taco:ui-preview:start -->

### 🌮 UI Preview (commit `{short_sha}`)

| Surface       |            Desktop (1280x800)             |
| :------------ | :---------------------------------------: |
| Complete Taco | ![{taco_desktop}]({raw_url_taco_desktop}) |
| Host / Demo   | ![{host_desktop}]({raw_url_host_desktop}) |

_Updated at {iso_timestamp} for commit `{short_sha}`. Actions run [{run_id}](https://github.com/{repo}/actions/runs/{run_id})_
<!-- taco:ui-preview:end -->
```

Each raw URL is `https://raw.githubusercontent.com/{repo}/{assets_commit_sha}/previews/pr-{pr_number}/{view_id}-{full_head_sha}.png`. When the markers are absent the block is appended after two newlines; when they are present only the enclosed text is replaced and everything outside is preserved byte for byte. Zero, one-sided, duplicated, or inverted markers abort publication.

## 6. Implementation Modules

1. `.github/workflows/ui-preview.yml`: the `detect` / `record` / `publish` workflow.
2. `.github/workflows/scripts/detect-preview-paths.mjs`: trusted path and label decision helpers.
3. `.github/workflows/scripts/view-registry.mjs`: fixed view definitions and the published asset path.
4. `.github/workflows/scripts/capture-preview.mjs`: trusted capture driver; imports a pinned Playwright module from an explicit path and waits on rendering state rather than fixed delays.
5. `.github/workflows/scripts/sanitize-preview-png.py`: container-side sanitizer; pinned Pillow, full decode, fresh RGB/RGBA re-encode. Any extra, missing, linked, non-PNG, multi-frame, or wrong-sized entry fails the run instead of being repaired.
6. `.github/workflows/scripts/validate-preview-png.mjs`: structural byte validator (no pixel decoding) used before upload and before publication.
7. `.github/workflows/scripts/update-pr-body.mjs`: marker parsing and body rendering.
8. `.github/workflows/scripts/publish-preview.mjs`: live-head guard, Git Data commits, PR body patch.
9. `tests/ui-preview-pipeline.test.ts`: unit and integration coverage for detection, markers, validation, capture guards, and publisher request payloads. Each script keeps a hand-written `.d.mts` declaration beside it, matching `extensions/taco/bin/*.d.mts`, so the suite is type-checked without a build step.

## 7. Operational & Verification Commands

```bash
# Path and label detection against the local base branch
node .github/workflows/scripts/detect-preview-paths.mjs --target origin/main --labels "ui-preview"

# Install the pinned Playwright module used by the container, into a temp prefix
npm install --prefix /tmp/taco64-playwright --no-audit --no-fund --ignore-scripts playwright@1.56.1
/tmp/taco64-playwright/node_modules/.bin/playwright install chromium

# Local capture smoke against a built bundle and a running host server
npm run build
npm run --prefix packages/host build
npm run --prefix packages/host start -- --hostname 127.0.0.1 --port 4174 &
node .github/workflows/scripts/capture-preview.mjs \
  --playwright-module /tmp/taco64-playwright/node_modules/playwright \
  --taco-file dist-single/Taco_Spec.taco.html \
  --host-url http://127.0.0.1:4174 \
  --out-dir artifacts/previews

# Structural validation of the captured set
node .github/workflows/scripts/validate-preview-png.mjs --dir artifacts/previews

# Container-equivalent sanitizer smoke: build the record-job image, then
# re-encode the captured set in place with the pinned Pillow build.
node --input-type=module -e '
  import { writeFileSync } from "node:fs";
  const { FIXED_VIEWS } = await import("./.github/workflows/scripts/view-registry.mjs");
  const views = FIXED_VIEWS.map((view) => ({
    filename: view.filename,
    width: view.viewport.width,
    height: view.viewport.height,
  }));
  writeFileSync("/tmp/taco64-expected.json", JSON.stringify({ views }, null, 2));
'
docker build --tag taco-preview-sanitizer - <<'DOCKERFILE'
FROM python:3.12-slim
RUN pip install --no-cache-dir --disable-pip-version-check Pillow==12.3.0
DOCKERFILE
docker run --rm --network none \
  --user "$(id -u):$(id -g)" \
  --volume "$PWD/artifacts/previews:/out" \
  --volume "/tmp/taco64-expected.json:/expected.json:ro" \
  --volume "$PWD/.github/workflows/scripts/sanitize-preview-png.py:/sanitize-preview-png.py:ro" \
  --workdir /out \
  taco-preview-sanitizer python3 /sanitize-preview-png.py --dir /out --expected /expected.json

# Unit and integration tests
npm test -- tests/ui-preview-pipeline.test.ts
```

## 8. Remaining Limitations

- **Local container unavailability**: a local workstation without a running Docker daemon can exercise the capture driver and the structural validator directly but cannot reproduce the container cgroup/namespace enforcement, the `network: none` boundary, or the container-side sanitizer run. Those boundaries are only observable when the workflow executes.
- **Pull request body race**: the publisher re-reads the PR (state, head SHA, body) immediately before patching and rewrites only the marked region, but the GitHub REST `PATCH /pulls/{n}` has no expected-head or body-version precondition. A concurrent human edit that lands between the re-read and the single PATCH can still be overwritten inside that window.
- **Assets branch scope**: `contents: write` is not scoped to the assets branch; the isolation here comes from the publisher only ever writing under `previews/pr-{n}/`.
- **Camo availability**: immutable raw URLs are used because they are stable and cacheable, not because GitHub's proxy is guaranteed.

## 9. Post-implementation Measurements

Measured with `npm run check`, file byte counts, and the local four-view capture followed by Pillow 12.3.0 sanitization on 2026-10-10.

| Artifact                           |       Estimated increase | Measured increase | Final bytes | Difference                                                           |
| ---------------------------------- | -----------------------: | ----------------: | ----------: | -------------------------------------------------------------------- |
| Complete `.taco.html`              |                        0 |                 0 |   2,846,082 | Matches estimate                                                     |
| Lite `.taco.html`                  |                        0 |                 0 |     296,790 | Matches estimate                                                     |
| Complete skill shell               |                        0 |                 0 |   2,737,618 | Matches estimate                                                     |
| Lite skill shell                   |                        0 |                 0 |     188,326 | Matches estimate                                                     |
| Skill directory                    |                        0 |                 0 |  14,091,559 | Matches estimate                                                     |
| CI scripts and declaration files   | 42,000 plus declarations |            46,675 |      60,130 | Validation, publisher conflict handling, declarations, and sanitizer |
| UI preview workflow                |                   12,000 |            12,714 |      12,714 | 714 bytes above estimate                                             |
| Four sanitized screenshot payloads |     400,000 to 1,600,000 |           348,203 |     348,203 | 51,797 bytes below the lower estimate                                |

`npm run check` passed all 635 tests across 55 files and built the production shells. The 21 preview tests cover marker preservation, stale heads, image structure, and publication errors. The capture script rendered all four registered views, and the same sanitizer script fully decoded and reencoded them locally. `actionlint` 1.7.12 accepted the workflow.

No product runtime dependency or network behavior changes. CI downloads the pinned Playwright module, container images, and Pillow, and publishes images through GitHub APIs. Docker isolation and the actual GitHub publisher have not been exercised locally because this workstation has no running Docker daemon and the new trusted workflow is not yet on the default branch. These are review limitations, not successful verification claims.

### 9.1 Artifact extraction layout repair

PR #127 exposed the runner-only failure in [run 38043585006](https://github.com/Arcadia822/taco/actions/runs/38043585006): `download-artifact` extracted the trusted files into an artifact-name subdirectory, while the record step imported `/tmp/trusted-tools/view-registry.mjs`. The publish download had the same layout mismatch.

Prepare estimate for this repair: two workflow inputs add 62 bytes to `.github/workflows/ui-preview.yml`; Complete/Lite products, skill directory, and release packages each grow 0 bytes. No new dependencies, permissions, or network behavior. Retargeting PR #127 to the repair branch did not exercise the candidate: [run 38044221393](https://github.com/Arcadia822/taco/actions/runs/38044221393) still logged the old `merge-multiple: false`. Pre-merge verification therefore uses a disposable `pull_request` workflow containing the repaired jobs unchanged, only on the same-repository probe branch; the production workflow keeps `pull_request_target`. The temporary workflow is removed after verification.

Develop measurements after `npm run check`: workflow estimate +62 bytes / measured +62 bytes (12,714 -> 12,776; deviation 0). Complete product 2,846,082 bytes, Lite product 296,790 bytes, Complete skill shell 2,737,618 bytes, Lite skill shell 188,326 bytes, and skill directory 14,091,559 bytes all remain byte-size identical (estimate 0 / measured 0 / deviation 0). Release payload inputs are unchanged. Local verification passed 645 tests across 56 files and the built-shell Chromium smoke; 21 preview tests passed. LESSONS tests retain behavioral assertions while removing the fixed four-entry output expectations exposed by adding this incident.

The first candidate probe [38044325874](https://github.com/Arcadia822/taco/actions/runs/38044325874) passed tool imports and exposed a second runner failure: the empty application volume was not writable by UID 1000 during source extraction after ownership setup. All three application-volume mounts now use `volume-nocopy` to prevent image population from overriding prepared metadata. This extends the workflow estimate by 95 bytes, from +62 to +157 bytes (measured 12,871 bytes; deviation 0), with the same zero product/dependency impact and unchanged untrusted-container privileges.

The next probe [38044453203](https://github.com/Arcadia822/taco/actions/runs/38044453203) passed archive extraction but npm rejected the image's root-owned `/home/pwuser/.npm` cache. Build now uses `npm_config_cache=/tmp/npm-cache`; the extra environment argument estimates and measures +52 bytes, bringing the final workflow increase to +209 bytes (12,923 total; deviation 0). No container user, capabilities, publication permissions, dependencies, or network boundaries change.

The third probe [38044557106](https://github.com/Arcadia822/taco/actions/runs/38044557106) completed all Docker build, capture, sanitization, validation, and screenshot upload steps. First publication then failed because GitHub rejects `{ tree: [] }` with 422 `Invalid tree info`. The assets bootstrap now creates a README tree with `parents: []`; estimate +250 bytes of CI publisher source / measured +240 bytes (8,433 -> 8,673; -10 bytes due to formatting), with 0 bytes added to product/skill/release payloads. A first-publication regression models the API's empty-tree rejection. Product build and Chromium smoke passed after this change. A separate existing local update-check test failed to report its temporary CLI version; the previous complete local suite and remote CI passed, and this environment failure is being investigated separately.

Final live probe [38044802162](https://github.com/Arcadia822/taco/actions/runs/38044802162) passed detect, isolated Docker build/capture, PNG sanitization/validation/upload, and GitHub publication. PR #127 received four immutable image links from assets commit `066ebb456f00dd0fba182bbde6fdf03d5a553173`; all four URLs returned PNGs at the registered dimensions, totaling 291,231 bytes. Desktop Taco and mobile Host images were visually inspected. This proves the repaired jobs through a same-repository disposable `pull_request` entry; the production `pull_request_target` event still requires the fix to reach main.

### 9.2 Dynamic Desktop UI Preview with Isolated Planner and Execution (TACO-68, TACO-62)

Transformation of fixed UI preview into dynamic PR-diff and DOM-outline-driven desktop preview.

#### Budget Estimation (Prepare)

- **Added npm runtime dependencies**: 0
- **Added npm dev dependencies**: 0
- **Workflow additions**: Independent planner job with isolated `PREVIEW_API_KEY` (compatible with `DEEPSEEK_API_KEY`), configurable `PREVIEW_API_BASE_URL` and `PREVIEW_MODEL`, zero-credential network-none capture executor, estimated workflow increase ~3,000 bytes.
- **Product byte growth**: Complete shell: 0 bytes; Lite shell: 0 bytes; skill directory: 0 bytes; release package: 0 bytes.
- **Network behavior**: Outbound network strictly confined to `plan` stage via configured OpenAI-compatible chat completions API (defaulting to DeepSeek or user-configured Command Code router `https://api.commandcode.ai/provider/v1`) and GitHub diff/blob/tree/ref APIs in `publish`. Capture and outline extraction containers are `--network none`.

#### Actual Measurements (Develop)

- **Complete shell** (`dist-single/Taco_Spec.taco.html`): 2,846,082 bytes (Delta: 0 bytes, deviation: 0)
- **Lite shell** (`dist-single/Taco_Spec_Lite.taco.html`): 296,789 bytes (Delta: 0 bytes, deviation: 0)
- **Skill complete shell** (`skills/taco/taco-shell.html`): 2,737,618 bytes (Delta: 0 bytes, deviation: 0)
- **Skill lite shell** (`skills/taco/taco-shell-lite.html`): 188,325 bytes (Delta: 0 bytes, deviation: 0)
- **Skill directory** (`skills/taco/`): 14,091,559 bytes (Delta: 0 bytes, deviation: 0)
- **Workflow** (`.github/workflows/ui-preview.yml`): 16,423 bytes (Estimated ~15,900 bytes, deviation +523 bytes due to 5-job security segmentation)
- **Unit & regression tests**: 653 tests across 57 files passing cleanly (`npm test`).

#### Trust Boundary & Failure Hardening

1. **Playwright resolution**: Resolves via `createRequire.resolve` entry to prevent Node ESM `ERR_UNSUPPORTED_DIR_IMPORT`.
2. **Isolated planner job**: `plan` job runs independently from PR code runners; `PREVIEW_API_KEY` (or legacy `DEEPSEEK_API_KEY`) is never mounted or accessible in untrusted build/capture containers.
3. **Strict schema enforcement**: `validatePreviewPlan` enforces action operands (`click.target`, `scroll.to`, `open-file.path`, bounded `wait.ms` 50-10000ms), and forbids empty shot lists.
4. **No fake fallback**: Missing keys, planner errors, or step execution errors explicitly produce `unavailable` or `failed` statuses without injecting fake homepage screenshots.

### 9.3 Review Defect Remediation & Model Routing Evaluation (TACO-68, PR #132)

Following independent review findings across correctness, security, and architecture, 7 defect groups were systematically remediated:

1. **DOM Outline Tag and Class Fidelity**: Replaced synthetic `g` wrapping in SVG traversal with actual element tag names (`rect.actor`, `text.actor`) and true DOM class lists. Disarmed fictional `g.actor.actor-box` references in favor of verified `rect.actor` and `text.actor` targets.
2. **Failure Screenshot Namespace and Disk Verification**: Reserved failure-related shot names (`failure`, `failure-state`) and enforced global reservation of all-scene failure filenames (`<scene-id>-failure.png`) against normal shot filenames in `plan-schema.mjs` to eliminate collisions with planned shots. Hardened `execute-preview.mjs` to register screenshot entries only when image files are successfully written to disk, ensuring failure manifests remain valid and publishable even when screenshots fail.
3. **Execution Environment Startup Resilience**: Enclosed environment readiness checks and Playwright launches in diagnostic error handlers that output structured failed manifests. Evaluated target requirements so taco-only plans do not block on host server readiness.
4. **Cross-Field Manifest Validation**: Enforced strict status enums (`passed`, `failed`, `unavailable`), validated shot filenames and duplicates against trusted plan expectations, and rejected contradictory states (such as failed scenes under an overall passed manifest).
5. **Canonical No-UI-Change Representation**: Aligned plan schema, execution, and validation so `ui_change: false` canonically requires `scenes: []`, eliminating `ERR_SCENE_COUNT` validation failures.
6. **Strict Budget Rejection Without Step Reordering**: Over-budget plans exceeding 12 steps or 3 scenes are strictly rejected as unavailable rather than reordering steps, preserving chronological interaction-caption alignment.
7. **Markdown Delimiter and Table Sanitization**: Disarmed boundary marker literals (`<!-- taco:ui-preview:start/end -->`) in dynamic summaries and captions, and escaped table pipes (`|`) and alt brackets (`[]`) in table cells and image alts, guaranteeing that updated PR bodies maintain exactly one valid marker pair without splitting table columns.

#### Budget Estimation (Prepare) vs Actual Measurements (Develop)

Artifact comparisons below use the repository's declared 2026-10-09 product baseline. The tracked skill shells are byte-identical to commit `907dd8b`; their reported growth predates this repair. This repair changes CI tooling and documentation, not the product runtime. Release archives were not packaged in this verification.

| Artifact                                                   | Estimated increase | Measured increase vs declared baseline |  Final bytes | Attribution                                                                             |
| :--------------------------------------------------------- | -----------------: | -------------------------------------: | -----------: | :-------------------------------------------------------------------------------------- |
| Complete product (`dist-single/Taco_Spec.taco.html`)       |                  0 |                                   +568 |    2,846,650 | Existing product baseline drift; not caused by this repair                              |
| Lite product (`dist-single/Taco_Spec_Lite.taco.html`)      |                  0 |                                   +522 |      297,311 | Existing product baseline drift; not caused by this repair                              |
| Skill Complete shell (`skills/taco/taco-shell.html`)       |                  0 |                                   +568 |    2,738,186 | 0 bytes versus `907dd8b`                                                                |
| Skill Lite shell (`skills/taco/taco-shell-lite.html`)      |                  0 |                                   +522 |      188,847 | 0 bytes versus `907dd8b`                                                                |
| Skill directory (`skills/taco/`)                           |                  0 |                                 +3,361 |   14,094,920 | Comparison to earlier recorded directory size; not attributed to this repair            |
| Release package                                            |                  0 |                           Not measured | Not packaged | No dependency or packaging inputs changed                                               |
| CI scripts and declarations (`.github/workflows/scripts/`) |                  0 |                   +11,768 vs `907dd8b` |      120,172 | Estimate omitted CI source growth; declarations and validation account for the increase |
| Added npm runtime dependencies                             |                  0 |                                      0 |            0 | Zero added runtime dependencies                                                         |
| Added network requests in build / capture                  |                  0 |                                      0 |            0 | Zero network requests; capture containers remain `--network none`                       |

#### Model Routing Evaluation: CommandCode Jev & Live Verification

Evaluation of CommandCode's `typesafe/jev` (`https://commandcode.ai/models/jev`) confirmed that Jev is a specialized fast classification model providing decision probabilities rather than generative text, selectors, or action sequences. While effective for category routing, it cannot generate dynamic UI interaction plans or Mermaid DOM navigation sequences. Accordingly, the pipeline retains `deepseek/deepseek-v4.1-flash` via the CommandCode OpenAI-compatible proxy (`https://api.commandcode.ai/provider/v1`) as the default dynamic planner, protected by the strict schema and validation boundaries detailed above.

In live execution of the model plan against the real TACO-67 change, 2 scenes passed (flowchart node selection and sequence diagram actor toolbar activation with verified screenshots) and 1 scene failed (`g.node[data-id="Bob"]` not found). Local sanitization, validation, and report rendering retained the failed diagnosis and failure screenshot. These images were not published to GitHub. The neo-gradient style remains unverified; the model reported it as `unseen`.

#### Verified Failure Resilience Paths

The failure handling and boundary enforcement paths were exercised and verified against real failure conditions:

1. **Playwright context launch abort (`/tmp/taco-68-context-failure`)**: When browser context creation fails, a structured failed diagnostic manifest (`status: "failed"`, 0 screenshots) is output and validated cleanly by `validate-preview-png.mjs` (`valid: true`).
2. **Screenshot write failure (`/tmp/taco-68-screenshot-failure`)**: When screenshot operations throw or fail to write, no phantom files are registered (`screenshots: []`), disk consistency is preserved, and the diagnostic manifest validates cleanly.
3. **Startup host unavailability for Taco-only scenes (`/tmp/taco-68-startup-after`)**: Preflight checks verify target requirements so Taco-only scenes do not block on external host servers, generating a valid passed manifest and verified screenshot (`taco-only-overview.png`).
4. **No-UI-change / unavailable plan (`/tmp/taco-68-unavailable-final`)**: Over-budget, invalid, or no-UI-change plans are rejected cleanly with canonical `status: "unavailable"` and `scenes: []`, producing valid manifests and safe PR comments without fake fallbacks.
5. **Pillow image sanitization and validation (`/tmp/taco-evidence/live-record-out`)**: All 4 captured screenshots (2 passed scenes + 1 graceful failure scene) were sanitized using pinned `Pillow==12.3.0` and validated across dimensions (1280x800) and byte budgets (273,833 total bytes) with 0 errors.

The final remote run [38135648472](https://github.com/Arcadia822/taco/actions/runs/38135648472) failed while building Host, before screenshot capture. `next/font` raised `TypeError: Cannot read properties of null (reading '1')` in the Google font loader for `src/app/page.tsx`. This run uses the trusted main workflow and does not verify the candidate dynamic planner. The PR remains Draft; local verification is not a green remote pipeline verdict.

### 9.4 Host Offline Font Migration & Build Resilience (TACO-68, PR #132)

#### Background & Failure Analysis

In remote run [38135648472](https://github.com/Arcadia822/taco/actions/runs/38135648472), the containerized Host build (`npm run --prefix packages/host build`) aborted during Next.js compilation of `packages/host/src/app/page.tsx`:

```text
TypeError: Cannot read properties of null (reading '1')
    at .../node_modules/next/dist/compiled/@next/font/dist/google/loader.js:122:78
```

Inspection of `@next/font/dist/google/loader.js` revealed that the loader extracts URLs from Google Fonts `@font-face` declarations via `/src: url\((.+?)\)/` and unconditionally executes `/\.(woff|woff2|eot|ttf|otf)$/.exec(googleFontFileUrl)[1]`. In environments where Google Fonts endpoints serve dynamic subset URLs or alternative routing without a standard font file extension at the path terminus, `.exec()` returns `null`, throwing a fatal `TypeError`.

To remove the external font response from the build inputs, `packages/host` was migrated from `next/font/google` to `next/font/local` using official variable WOFF2 fonts stored in `packages/host/src/app/fonts/`.

#### Budget Estimation (Prepare) vs Actual Measurements (Develop)

| Metric / Artifact                                           |                      Baseline Before |                         Prepare Estimate |                     Actual Measured | Deviation / Attribution                                                                             |
| :---------------------------------------------------------- | -----------------------------------: | ---------------------------------------: | ----------------------------------: | :-------------------------------------------------------------------------------------------------- |
| Complete product shell (`dist-single/Taco_Spec.taco.html`)  |                      2,846,650 bytes |                                  0 bytes |                     2,846,650 bytes | 0 bytes; Host font migration does not modify product shells                                         |
| Lite product shell (`dist-single/Taco_Spec_Lite.taco.html`) |                        297,311 bytes |                                  0 bytes |                       297,311 bytes | 0 bytes; Host font migration does not modify product shells                                         |
| Skill Complete shell (`skills/taco/taco-shell.html`)        |                      2,738,186 bytes |                                  0 bytes |                     2,738,186 bytes | 0 bytes; skill distribution untouched                                                               |
| Skill Lite shell (`skills/taco/taco-shell-lite.html`)       |                        188,847 bytes |                                  0 bytes |                       188,847 bytes | 0 bytes; skill distribution untouched                                                               |
| Host font assets (`packages/host/src/app/fonts/*.woff2`)    |                              0 bytes |                               ~185,000 B |                           182,740 B | -2,260 bytes; official variable full fonts (Geist 69.6K, Fira 113K)                                 |
| Added npm runtime dependencies                              |                           0 packages |                               0 packages |                          0 packages | 0 added dependencies; uses existing `next/font/local`                                               |
| Added npm dev dependencies                                  |                           0 packages |                               0 packages |                          0 packages | 0 added dependencies                                                                                |
| External Google Fonts CSS build requests                    |       2 requests plus font downloads | -2 CSS requests and their font downloads |                          0 requests | Production build passed with outbound network denied; browser loaded both fonts from the local Host |
| Host production route `/`                                   | Not compared across main integration |                       0 new dependencies | 58.1 kB route; 161 kB first-load JS | Next.js production build output; upstream main changes were also synchronized                       |

#### Font Provenance & Glyph Coverage Parity

1. **Geist Sans Variable (`Geist-Variable.woff2`)**:
   - **Version & Upstream**: Vercel Geist Font `v1.7.2` (`geist-font/Geist/webfonts/Geist[wght].woff2`).
   - **Size & Hash**: 69,652 bytes, SHA-256 `a369fcf5628ea2aa4e1b9e2ec6a5b3624e365bda588e1f0f2f12b564f728fbb8`.
   - **Weight Axis & Subsets**: Variable `wght 100-900` (retains weights 400, 500, 600, 700). Covers complete Latin, Latin Extended, Cyrillic, Vietnamese, and general currency/punctuation.
   - **License**: SIL Open Font License 1.1 ([`OFL-Geist.txt`](../../packages/host/src/app/fonts/OFL-Geist.txt)).
2. **Fira Code Variable (`FiraCode-Variable.woff2`)**:
   - **Version & Upstream**: Nikita Prokopov Fira Code `6.2` (`woff2/FiraCode-VF.woff2`).
   - **Size & Hash**: 113,088 bytes, SHA-256 `408e876a202f15ea6ee307a70a65cf40ceb222c589a0b17e0a3a371db96dd49f`.
   - **Weight Axis & Subsets**: Variable `wght 300-700` (retains weights 400, 500, 600, 700). Covers complete Latin, Latin Extended, Cyrillic, Greek, programming ligatures, and box/technical symbols.
   - **License**: SIL Open Font License 1.1 ([`OFL-FiraCode.txt`](../../packages/host/src/app/fonts/OFL-FiraCode.txt)).
3. **CSS Variable & Fallback Metrics Parity**:
   - Injects identical `--font-geist` and `--font-fira-code` CSS custom properties, leaving `packages/host/src/app/home.css` consumers completely untouched.
   - `next/font/local` reads font tables via Next.js's bundled `fontkit` and calculates fallback metrics for Arial to reduce layout shifts; measured CLS parity is not claimed.

#### Verification of the CI Font Repair

- Restored the lockfile environment with `npm ci --no-audit --no-fund` after integrating `main` (`2693d13`). The only merge conflict was `LESSONS.md`; retained both histories and assigned the dynamic-preview entry `LESSON-011` and the font incident `LESSON-012`.
- `npm run check`: 679 tests across 59 files passed, TypeScript and all shell builds passed, and the 12 lesson entries validated.
- `sandbox-exec -p '(version 1) (allow default) (deny network-outbound)' env NEXT_TELEMETRY_DISABLED=1 npm run --prefix packages/host build`: passed, including production prerendering, with outgoing network denied.
- Production Host browser smoke at `http://127.0.0.1:32272`: both local variable fonts loaded at weights 400–700, no Google Fonts requests, and no browser errors. Homepage screenshot inspected.
- `npm run test:browser`: 14 files loaded, 7 warnings, 0 errors. Complete/Lite product and skill shell bytes stayed unchanged from the repair baseline shown above.
- New font binaries total 182,740 bytes versus the 185,000-byte estimate (-2,260 bytes). The prior local build's 12 cached font subsets totaled 186,068 bytes; that cache comparison is not a controlled production before/after measurement. The full font files are both preloaded, increasing Latin-only first-load font transfer versus the prior two Latin subsets (65,628 bytes).
- No new npm dependencies or skill instructions. The Host README and font provenance record document the local-font contract; removed the unsupported `NEXT_FONT_GOOGLE_MOCKED` flags from both candidate workflow build jobs.

### 9.5 Screenshot-Free Publication Repair (TACO-78, PR #148)

#### Background & Failure Analysis

From 2026-10-12 onward, the `Publish UI Preview` job consistently failed on PR #144 (all 4 runs) and PR #145/146 (3 runs) with `GitHub API 422 Unprocessable Entity` for `POST /repos/Arcadia822/taco/git/trees: {"message":"Invalid tree info"}`. Preceding `collect`, `plan`, and `record` jobs succeeded.

Two defects combined to produce the failure:
1. **Planner output invalidation**: The planner emitted `ui_change: false` with a non-empty `scenes` array. `plan-schema.mjs` enforces the canonical invariant that `ui_change: false` requires `scenes: []`. `plan-preview.mjs` fell back to a plan with `summary: "Planner produced invalid plan: ..."`, and `execute-preview.mjs` cleanly produced an unavailable manifest with 0 screenshots.
2. **Empty tree submission**: `publish-preview.mjs` collected 0 blobs from the empty manifest and called `POST /git/trees` with `{ base_tree, tree: [] }`. GitHub rejects an empty tree array with HTTP 422. This is the second call site of `LESSON-007` (occurrences raised to 2).

#### Repair

1. **Guard against empty tree**: `uploadAssetsAndCommit` returns `null` immediately when `tree.length === 0`, bypassing `ensureAssetsBranch`, `POST /git/trees`, `POST /git/commits`, and `PATCH /git/refs`.
2. **Truthful PR block conclusion**: When no screenshots exist, `generatePreviewBlockMarkdown` inspects the plan via `isPlannerFailurePlan`. If the plan is a fallback (due to validation failure, planner API error, or missing key), it outputs `> ⚠️ **Preview planning failed.** The planner never produced a usable plan, so the summary above is its error, not a "no UI change" verdict.` If the plan legitimately reports no UI change, it outputs `*No UI preview was generated: this revision reports no UI change.*`
3. **Shared fallback markers**: `PLANNER_FALLBACK_SUMMARIES` and `isPlannerFailurePlan` in `plan-schema.mjs` prevent drift between the planner's fallback generators and the publisher's discriminator.
4. **Planner prompt invariant**: Rule 5 was added to `PLANNER_SYSTEM_PROMPT` in `plan-preview.mjs`, making explicit that `ui_change: false` requires `scenes: []`, and providing the canonical no-change JSON template.

#### Budget Estimation (Prepare) vs Actual Measurements (Develop)

| Metric / Artifact | Baseline Before | Prepare Estimate | Actual Measured | Deviation / Attribution |
| :--- | ---: | ---: | ---: | :--- |
| Complete product shell (`dist-single/Taco_Spec.taco.html`) | 2,853,111 bytes | 0 bytes | 2,853,111 bytes | 0 bytes; CI-only repair |
| Lite product shell (`dist-single/Taco_Spec_Lite.taco.html`) | 303,897 bytes | 0 bytes | 303,897 bytes | 0 bytes; CI-only repair |
| Skill Complete shell (`skills/taco/taco-shell.html`) | 2,740,554 bytes | 0 bytes | 2,740,554 bytes | 0 bytes; byte-identical SHA-256 (`6a4a49c6...`) |
| Skill Lite shell (`skills/taco/taco-shell-lite.html`) | 191,340 bytes | 0 bytes | 191,340 bytes | 0 bytes; byte-identical SHA-256 (`c7a5139b...`) |
| Skill directory (`skills/taco/`) | 25,616 KB | 0 bytes | 25,616 KB | 0 KB; skill distribution untouched |
| CI workflow scripts (`.github/workflows/scripts/`) | 39,400 bytes | ~3,000 bytes | 42,514 bytes | +3,114 bytes across 4 scripts and 2 declarations |
| Added npm runtime dependencies | 0 packages | 0 packages | 0 packages | 0 added dependencies |
| Added npm dev dependencies | 0 packages | 0 packages | 0 packages | 0 added dependencies |
| Added network calls in publication | 5 API calls | 0 calls | 0 calls on no-screenshot path | -5 GitHub REST calls (`ref`, `tree`, `commit`, `patch-ref`, `blobs`) when no screenshots exist |

#### Verification

- **Unit & regression tests**: Added 3 new tests in `tests/ui-preview-pipeline.test.ts` covering screenshot-free manifest publication, planner failure reporting, and `uploadAssetsAndCommit` returning `null`. Before the fix, the regression test reproduced GitHub's HTTP 422. After the fix, all 33 pipeline tests and all 788 suite tests pass (`npm test`).
- **Repository gate**: `npm run check` passes cleanly (Prettier, `check:lessons`, Vitest suite, and TypeScript build).
- **Real GitHub API verification**: Executed `runPublisher` directly against draft PR #148 (head `4982761`):
  - With planner-failure plan: exited status 0, assets branch tip untouched (`cf81bea1...`), PR body updated with `⚠️ Preview planning failed`.
  - With no-UI-change plan: exited status 0, assets branch tip untouched, PR body updated with `*No UI preview was generated: this revision reports no UI change.*`
