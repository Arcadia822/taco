---
title: "Taco verification feature map"
---

## Baseline

Read this index before picking coverage. Run from repository root with the build produced by `npm run build`. Use `node .cursor/skills/verify-taco/scripts/verify.mjs`; the runner starts a unique loopback port and a fresh Chromium context. No auth or shared browser profile is needed. It automatically runs doctor and cleanup. The English Complete artifact contains 15 files at generation time; derive paths from the bundle rather than hard-coding that count.

## Driving and proof conventions

Use Playwright `page`, `context`, `capture`, `step`, `doctor`, `reopen`, `outDir`, `bundle` and `assert` supplied to a scenario module by the runner. `capture('feature-before')` writes PNG and ARIA text; `step('feature/entry: user action', fn)` logs the action in the trace and JSON. Keep every artifact under the run's `outDir`. Select files through `button.file-row[data-path]`, comparing the actual path attribute when basenames repeat. Use labels/roles for inputs and buttons. Assertions may read `window.taco`; actions must use the UI.

Record each feature ID, entry point, attempted action and observed state. Verify every listed entry point affected by the change; a sidebar proof does not verify keyboard search, and a download does not verify directory writeback. Report unsupported/precondition-blocked paths explicitly. A task that only creates the initial skill needs one executed mapped feature, not all five.

## Features

| Map | User-visible coverage |
| --- | --- |
| [Browse and search](browse-search.md) | Sidebar, heading outline, keyboard search, embedded HTML |
| [Edit and manage files](edit-files.md) | Markdown rich/source editing, properties, new/rename/delete, text editors |
| [Anchored comments](comments.md) | Selection comment, author, reply/edit/delete/resolve, panel toggles |
| [Save and handoff](save-handoff.md) | Save, copy/download, unpack, clipboard and listener feedback |
| [Checkpoints](checkpoints.md) | Dashboard, required files, statuses, instructions, missing-file behavior |

## Evidence and scope

The default `scripts/browse.mjs` proves only the sidebar entry and rendered source agreement. Other recipes are maintenance seeds grounded in source; execute the matching paths when verifying their behavior. Evidence remains in `artifacts/verify-taco/<run>/` after cleanup. Public getters and final screenshots alone cannot prove a mutation; save and reopen its output where relevant.

Secondary surfaces are the optional `packages/cli` toolbox, `extensions/taco/bin/taco.mjs` and the `packages/host` Tacobin application. This map addresses the standalone browser product. Never claim a host/CLI/extension path passed based on a local Complete browser run.
