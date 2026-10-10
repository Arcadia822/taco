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

When contributors or automated agents submit pull requests touching Taco specifications (`specs/**`), the web host application (`packages/host/**`), or explicitly ask for visual verification via the `ui-preview` label, reviewers need immediate visual evidence of how changes affect both the standalone Taco experience and the hosted environment across desktop and mobile form factors.

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
| `taco-mobile`  | `taco-mobile.png`  | Complete Taco bundle | 375 x 812  | Narrow responsive layout and touch targets        |
| `host-desktop` | `host-desktop.png` | Host application     | 1280 x 800 | Hosted document loading, header, and toolbar      |
| `host-mobile`  | `host-mobile.png`  | Host application     | 375 x 812  | Hosted narrow layout and touch targets            |

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

| Surface       |            Desktop (1280x800)             |            Mobile (375x812)             |
| :------------ | :---------------------------------------: | :-------------------------------------: |
| Complete Taco | ![{taco_desktop}]({raw_url_taco_desktop}) | ![{taco_mobile}]({raw_url_taco_mobile}) |
| Host / Demo   | ![{host_desktop}]({raw_url_host_desktop}) | ![{host_mobile}]({raw_url_host_mobile}) |

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

Prepare estimate for this repair: two workflow inputs add 62 bytes to `.github/workflows/ui-preview.yml`; Complete/Lite products, skill directory, and release packages each grow 0 bytes. No new dependencies, permissions, or network behavior. Verification uses the existing disposable PR against the repair branch so `pull_request_target` executes the repaired trusted workflow before merge.

Develop measurements after `npm run check`: workflow estimate +62 bytes / measured +62 bytes (12,714 -> 12,776; deviation 0). Complete product 2,846,082 bytes, Lite product 296,790 bytes, Complete skill shell 2,737,618 bytes, Lite skill shell 188,326 bytes, and skill directory 14,091,559 bytes all remain byte-size identical (estimate 0 / measured 0 / deviation 0). Release payload inputs are unchanged. Local verification passed 645 tests across 56 files and the built-shell Chromium smoke; 21 preview tests passed. LESSONS tests retain behavioral assertions while removing the fixed four-entry output expectations exposed by adding this incident.
