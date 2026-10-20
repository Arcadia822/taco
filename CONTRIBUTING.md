# Contributing to Taco

Taco welcomes focused issues and pull requests. The project is deliberately file-first: canonical files remain the source of truth, while navigation, outlines, comments, and search are derived views.

## Development setup

Requirements:

- Node.js 22 or newer
- npm

Install dependencies and start the development server:

```bash
npm ci
npm run dev
```

Development mode embeds `specs/001-taco-bento-product/` as the default Taco.

Run the unit tests:

```bash
npm test
```

## Before opening a pull request

A reviewable change should:

- State the user problem and the explicit out-of-scope boundary.
- Preserve backward compatibility for file formats and public interfaces, or document the migration.
- Add tests for changed parsing, saving, comments, navigation, collaboration, or CLI behavior.
- Keep Markdown as canonical content instead of introducing a Taco-specific business database.
- Avoid remote runtime dependencies in the core path. Optional network enhancements must be triggered explicitly and retain a source fallback.
- Follow the surrounding TypeScript and JavaScript style: two-space indentation, single quotes, and no semicolons.

Run the complete local gate:

```bash
npm run check
```

The command checks contributor-facing formatting, runs the test suite, and produces the single-file build. The relay integration suite is separate because it requires a running relay:

```bash
npm run relay:dev
npm run test:relay
```

The built shell smoke test opens `dist-single/Taco_Spec.taco.html` in headless Chromium. Install the browser once, then run the smoke test on the artifact produced by `npm run check`:

```bash
npx playwright install chromium
npm run test:browser
```

The smoke test fails on an uncaught page error, on an embedded bundle that disagrees with the public `window.taco` API, or when the sidebar and Markdown reader never mount the selected file. On Linux CI, `npx playwright install --with-deps chromium` also installs the required system libraries.

The major-workflow suite runs synthetic Complete/Lite reviews through browser actions and saves/reopens the results. CLI and Host proof use separate real runtimes:

```bash
npm run test:verify
npm run build --workspace @tacobin/cli # Bun required
node .agents/skills/verify-taco/scripts/verify.mjs --scenario .agents/skills/verify-taco/scripts/cli.mjs
npm run test:toolbox
npm run test:host
```

`test:verify` covers 51 browse/search, editing/file management, comments, saving/Handoff, Checkpoints and variant cases. For local development, use `npm run test:verify -- --feature comments`; CI rejects case/domain filters and runs the full registry. The separate CLI scenario proves packaging exclusions, byte-preserving extraction, reviewed-file diffs and conflict refusal after the CLI build. `test:toolbox` observes real two-round listener receipts. `test:host` builds an isolated local Next workspace, uses temporary SQLite and a fresh CSRF secret, and verifies nine browser/CLI persistence, Handoff, conflict and CSRF cases without production credentials. These commands require no Agent or model. Existing Vitest and Spec Kit installation checks remain separate gates.

Runs retain screenshots, ARIA, actions/network, traces, downloads and result manifests under `artifacts/verify-taco/`, `artifacts/smoke-host/`, and the toolbox output directory printed by the smoke (`TACO_SMOKE_OUT=artifacts/smoke-toolbox` in CI). CI uploads this evidence on success and failure. Native file/directory picker permission, OS browser transitions, live CDN delivery, production deployment and an agent acting on Handoff need their own checks and are not reported as automated passes.

## Generated artifacts

`dist-single/Taco_Spec.taco.html` is ignored local build output. `extensions/taco/assets/taco-shell.html` is the tracked generated shell consumed directly by the Spec Kit integration, so source changes that affect the build must update it.

After `npm run build`, inspect and commit the generated extension shell when it changes. CI rebuilds it and fails if the committed output drifts from source. Do not hand-edit generated HTML; fix the source or build script and rebuild.

## Formatting

The repository uses EditorConfig for baseline whitespace and Prettier for contributor-facing Markdown, YAML, and JSON files:

```bash
npm run format
npm run format:check
```

The existing application source keeps its established style. A future whole-tree formatter migration should be proposed and reviewed separately rather than mixed into a functional change.

## UI preview pipeline

The `UI Preview` workflow (`.github/workflows/ui-preview.yml`) attaches screenshots of the complete Taco bundle and the host application to a pull request. It runs on `pull_request_target` and fires when a pull request changes `packages/host/**` or `specs/**`, or carries the `ui-preview` label.

Because the rendered code comes from the pull request, the pipeline splits into three jobs: `detect` reads only trusted base-revision tooling, `record` runs the build, the browser, and the PNG sanitizer inside containers with no repository token, and `publish` is the only job with write permissions. Views are fixed in `.github/workflows/scripts/view-registry.mjs`; a pull request cannot add a URL, selector, viewport, or filename.

To work on it locally:

```bash
# Decision logic for a branch
node .github/workflows/scripts/detect-preview-paths.mjs --target origin/main --labels "ui-preview"

# Real capture against a local build, using a pinned Playwright outside the repo
npm run build
npm run --prefix packages/host build
npm run --prefix packages/host start -- --hostname 127.0.0.1 --port 4174 &
npm install --prefix /tmp/taco64-playwright --no-audit --no-fund --ignore-scripts playwright@1.56.1
/tmp/taco64-playwright/node_modules/.bin/playwright install chromium
node .github/workflows/scripts/capture-preview.mjs \
  --playwright-module /tmp/taco64-playwright/node_modules/playwright \
  --taco-file dist-single/Taco_Spec.taco.html \
  --host-url http://127.0.0.1:4174 \
  --out-dir artifacts/previews
node .github/workflows/scripts/validate-preview-png.mjs --dir artifacts/previews
```

`scripts` under `.github/workflows/scripts/` are trusted code: they run either on the base revision or inside a container next to untrusted input, so they must never read view definitions, URLs, selectors, or filenames from a pull request. The sanitizer (`.github/workflows/scripts/sanitize-preview-png.py`) needs the pinned Pillow build; the workflow installs it into a dedicated image. See [`specs/018-ui-preview/spec.md`](specs/018-ui-preview/spec.md) for the full design and the remaining limitations.

## Security reports

Do not disclose a suspected vulnerability in a public issue. Follow [`SECURITY.md`](SECURITY.md) and use GitHub's private vulnerability-reporting flow.

By participating, you agree to follow [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
