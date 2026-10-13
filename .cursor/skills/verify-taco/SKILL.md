---
name: verify-taco
description: "Drive and prove the built Taco single-file review app (the .taco.html browser product) in a real headless Chromium session with captured evidence. Use for Taco UI verification, browser smoke runs, screenshots/ARIA traces, save/reopen proofs, comment or Checkpoint behavior checks, or when an agent needs a scripted proof of user-facing Taco behavior."
---

# Verify Taco

Verify the built standalone Complete Taco by launching a fresh instance and exercising real user actions. This skill is the internal proof path: evidence from it is never user-visible presentation of a delivered `.taco.html`.

## Launch

Build the product first (Node 22+, pinned Playwright dev dependency):

```bash
npm run build
npx playwright install chromium   # once per checkout
```

Then start a verification run against the artifact built above. The helper launches the instance, doctor-checks it and tears it down in one command:

```bash
node .cursor/skills/verify-taco/scripts/verify.mjs
node .cursor/skills/verify-taco/scripts/verify.mjs \
  --artifact dist-single/Taco_Spec.taco.html \
  --scenario .cursor/skills/verify-taco/scripts/edit-save.mjs \
  --out artifacts/verify-taco/my-run
```

`verify.mjs` reads `--artifact`, `--scenario`, `--out`, starts an owned ephemeral loopback server and an isolated Chromium context and prints a `ready` JSON line with `url`, `outDir`, `sha256`. On normal success or a caught runtime failure it emits a `complete` JSON line with `cleanup` and `ok`. Teardown closes the browser, context and its own port, verifies the port no longer responds and writes `result.json` with the observed cleanup status. Process interruption can bypass this cleanup and leave no result; inspect any retained evidence and start a fresh isolated run. Never share or reconnect to a user's browser instance.

## Doctor

The runner's first step is `doctor`, and it reruns `doctor` whenever anything looks off; read `doctor.json` first. It answers: is this instance ours and worth driving? It checks the owned server identity (`/doctor`, process PID), artifact SHA-256, `window.taco.format === 'taco/files'`, `validate().ok` with zero errors, the `#taco-document` block matching the bundle, and no uncaught page errors. If doctor fails, stop and re-run `npm run build` or start a new isolated run — do not diagnose against a stale or shared instance. The repo-root `/scripts/smoke-built-shell.mjs` and `/scripts/smoke-local-toolbox.mjs` remain useful auxiliary read-only/CLI checks.

## Drive

Read `features/README.md` first and pick the recipe for the user-facing feature under test. All user paths and selectors are mapped in `features/browse-search.md`, `features/edit-files.md`, `features/comments.md`, `features/save-handoff.md` and `features/checkpoints.md`. Scenario modules get `page`, `context`, `url`, `outDir`, `bundle`, `capture(name)`, `step(label, fn)`, `doctor()`, `reopen(path)` and `assert` (node:assert/strict); export `default async function(harness)`. Stable handles are `button.file-row[data-path]`, `main#taco-main .tiptap-editor-host .ProseMirror`, `textarea.source-editor-input`, `dialog.search-dialog`, `button.selection-comment-button`, `.comment-thread[data-thread-id]`, `button.save-button`, `.checkpoint-status-button`, `button.checkpoint-nav-item`. Prefer accessible roles/names and observed attributes over coordinates and row positions.

Default scenario (`scripts/browse.mjs`): drives the sidebar entry of the feature map and proves rendered content. `scripts/edit-save.mjs` exercises the real body edit and Save fallback path and reopens the downloaded artifact. Both are reference scenarios — inspect them before running.

## Evidence

Proof standards: exercise the real user path (no internal setters), capture the action and the resulting user-visible state (before/after screenshots + ARIA snapshots), and verify side effects. Verify what "dry-run"/test modes actually skip by observing files, network and git refs, not their names. Every scenario writes into `outDir`, plus `doctor.json`, `actions.json`, `network.json`, `result.json`, `trace.zip` and per-step PNG/`.aria.txt` captures. Mutation proofs require a second independent view: the public read-only API (`window.taco.readFile/listFiles/search/getCheckpoints/getReviewHandoff`) may confirm the in-memory state but must be followed by Save, a downloaded artifact (reopened through `reopen()`) or, where the harness supports it, canonical writeback evidence. A proof that drives one entry point is incomplete when the feature map lists others; record which entry points were driven and which were skipped and why. Mock only where a production boundary isolates the system. In particular, headless `window.showSaveFilePicker` exists and blocks native picker flow — the save scenario disables it exactly to test the download fallback, and this is not evidence of native directory-write behavior. Sensitive collaboration-enabled Taco files must not be shipped in artifacts or logs.

## Cleanup

The helper closes what it started (server, browser, context, trace) even on failure and records whether the port really closed; never kill by process name and never touch processes or ports it did not start. If interrupted before the `complete` line, inspect `result.json`/`actions.json` and call `node .cursor/skills/verify-taco/scripts/verify.mjs` on a fresh output directory rather than reaching into existing user runs. Scratch and failed-run state goes under `tmp/` or the run's out directory; **delete scratch but keep evidence**: `artifacts/verify-taco/<run>/` (screenshots, ARIA, JSON, trace) must survive teardown and is the named evidence location.

## Helpers

```bash
node .cursor/skills/verify-taco/scripts/verify.mjs [--artifact path] [--scenario path] [--out new-dir]
node .cursor/skills/verify-taco/scripts/verify.mjs --scenario .cursor/skills/verify-taco/scripts/browse.mjs
node .cursor/skills/verify-taco/scripts/verify.mjs --scenario .cursor/skills/verify-taco/scripts/edit-save.mjs
```

All helpers are non-interactive and self-cleaning. If a helper fails, inspect its `result.json` before rewriting steps; rerun cleanup-safe from a fresh run. See `SPEC.md` for the maintenance contract and `SOURCES.md` for evidence provenance.
