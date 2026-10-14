---
name: verify-taco
description: 'Prove Taco browser and Agent CLI workflows with real user actions and captured evidence. Use for Taco UI verification, save/reopen, comments, Checkpoints, taco-cli authoring/inspection/diff/extraction, or local and hosted CLI review round trips.'
---

# Verify Taco

Verify Taco's Complete/Lite browser workflows and the Agent's real `taco-cli` operations. Run the built CLI directly; the skill supplies scenarios and evidence, not a second CLI product. Headless evidence does not establish user-visible opening of a delivered `.taco.html`.

## Launch

Build the product first (Node 22+, pinned Playwright dev dependency):

```bash
npm run build
npx playwright install chromium   # once per checkout
```

Build the CLI before CLI cases or full product acceptance (Bun required):

```bash
npm run build --workspace @tacobin/cli
node packages/cli/dist/main.js help
```

Run the 51-case browser suite, the two direct-command CLI scenarios and both real review round trips for full product acceptance:

```bash
npm run test:verify
node .agents/skills/verify-taco/scripts/verify.mjs --scenario .agents/skills/verify-taco/scripts/cli.mjs --out artifacts/verify-taco/cli-run
TACO_SMOKE_OUT=artifacts/smoke-toolbox npm run test:toolbox
npm run test:host -- --out artifacts/smoke-host/full-product-run
```

For a local focused run, select the affected domain or an arbitrary artifact:

```bash
npm run test:verify
npm run test:verify -- --feature edit-files --out artifacts/verify-taco/edit-run
node .agents/skills/verify-taco/scripts/verify.mjs --scenario .agents/skills/verify-taco/scripts/cli.mjs --out artifacts/verify-taco/cli-run
node .agents/skills/verify-taco/scripts/verify.mjs \
  --artifact dist-single/Taco_Spec.taco.html \
  --scenario tmp/my-taco-scenario.mjs \
  --out artifacts/verify-taco/my-run
```

`suite.mjs` generates disposable Complete/Lite fixtures and runs every registered browser case in its own immutable instance; the registry holds 51 cases across browse, edit, comments, save, checkpoints and variants. The CLI cases are not a registry domain — `npm run test:verify -- --feature cli` selects nothing — and run instead as the explicit ad-hoc module below. Local `--feature` and `--case` filters are rejected under CI. It writes `suite.json`, retains per-case evidence, continues after case failures and exits nonzero on failure. `verify.mjs` keeps the `--artifact`, `--scenario`, `--out` interface for arbitrary artifacts and ad-hoc scenarios. Its default covers browsing. `scripts/cli.mjs` spawns `node packages/cli/dist/main.js` with real arguments and opens CLI-produced/browser-saved artifacts for visible verification; run it after the CLI build, since the browser suite remains independently runnable before that build and CI does not yet invoke this scenario. Both runners require fresh evidence directories and close only owned browser/context/server resources. Never reconnect to a user's browser.

## Doctor

The runner's first step is `doctor`, and it reruns `doctor` whenever anything looks off; read `doctor.json` first. It answers: is this instance ours and worth driving? It checks the owned server identity (`/doctor`, process PID), artifact SHA-256, `window.taco.format === 'taco/files'`, `validate().ok` with zero errors, the `#taco-document` block matching the bundle, and no uncaught page errors. If doctor fails, stop and re-run `npm run build` or start a new isolated run — do not diagnose against a stale or shared instance. The repo-root `/scripts/smoke-built-shell.mjs` and `/scripts/smoke-local-toolbox.mjs` remain useful auxiliary read-only/CLI checks.

## Drive

Read `features/README.md` first and select the matching browser, CLI or Host recipe. Maps cover browse/search, edit/manage, comments, saving/Handoff, Checkpoints, variants/security and Agent CLI workflows. `scripts/registry.mjs` lists browser cases; domain modules export `cases` containing `id`, `feature` and `run(h)`. Ad-hoc modules, including `scripts/cli.mjs`, export `default async function(h)` and use `verify.mjs --scenario`. The harness supplies `page`, `context`, `url`, `outDir`, `bundle`, `fixture`, `capture`, `step`, `doctor`, `reopen`, `assert` and `boundary`. Use `scripts/ui.mjs` for user actions and `scripts/fixture.mjs` for deterministic paths. Prefer accessible roles/names and exact path/thread/message IDs over row positions.

Browser mutations act through the UI and prove persistence by download/reopen; public getters are assertions only. Read `SPEC.md` before changing lifecycle, fixtures or coverage and `SOURCES.md` for provenance. The two direct-command CLI scenarios in `scripts/cli.mjs` (`cli/pack-extract`, `cli/review-diff-extract`) spawn `node packages/cli/dist/main.js` with argument arrays, retain stdout/stderr/exit codes and reopen the packed or saved artifacts in the browser. The existing repo smokes cover the full round trips: `npm run test:toolbox` exercises local authoring (new, all six init templates, pack, verify, inspect, diff, extract) plus two listener feedback/refresh rounds with unauthenticated, tampered and stale receipts; `npm run test:host` exercises publish/subscribe/Handoff, autosave/reopen, comments, conflicts and CSRF against local Next/SQLite. Each keeps its own process lifecycle inside one product verification plan. A browser suite pass alone does not prove the Agent review loop. CI invokes browser, toolbox and Host commands without agents or production credentials; the CLI scenario still needs its own step after the CLI build.

## Evidence

Capture actions and visible results with screenshots/ARIA, command transcripts, network and trace. Inspect browser `suite.json`/`result.json`, Host `summary.json`, and the toolbox's printed outcome/evidence path. Mutation evidence includes the downloaded bundle and independently reopened view; a getter or toast alone is insufficient. Record file-access/clipboard substitutions with `boundary(description)`. Native permissions, OS browser opening, live CDN delivery, deployment and actual model consumption remain external boundaries. Synthetic fixtures only; credential-bearing live reviews must not enter logs or uploaded artifacts.

## Cleanup

Close only resources started by the run, attempt every cleanup even if another fails and record whether the owned port closed. Cleanup is bounded and ordered trace → context → browser → server; the server closes its listening socket and then its connections, and any cleanup timeout is recorded as that resource's error, never as `closed`. A setup that never settles is cancelled through its own signal and recorded in `cleanup.setup`, so leftover HTTP connections cannot keep Node alive (exit 13). Inspect `result.json` when interrupted before the `complete` line and start a fresh isolated run. Delete disposable workspaces but keep evidence in `artifacts/verify-taco/<run>/`, `artifacts/smoke-toolbox/` or `artifacts/smoke-host/`; CI uploads these even when verification fails. Never kill by process name or touch a shared user's review.

## Helpers

```bash
npm run test:verify [-- --out new-dir --feature feature-name]
node .agents/skills/verify-taco/scripts/verify.mjs [--artifact path] [--scenario path] [--out new-dir]
node .agents/skills/verify-taco/scripts/verify.mjs --scenario .agents/skills/verify-taco/scripts/cli.mjs --out new-directory
TACO_SMOKE_OUT=artifacts/smoke-toolbox npm run test:toolbox
npm run test:host -- --out artifacts/smoke-host/my-run
```

All helpers are non-interactive and own their cleanup. If one fails, read its outcome manifest or printed failure transcript before changing steps; restart cleanup-safe in a fresh evidence directory. Keep full CLI stdout for parsing, even if a logged projection is bounded. See `SPEC.md` for the maintenance contract and `SOURCES.md` for provenance.
