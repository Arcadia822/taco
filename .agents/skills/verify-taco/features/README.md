---
title: 'Taco verification feature map'
---

## Baseline

Run from repository root after `npm run build`. `npm run test:verify` executes the registered browser domains with synthetic fixtures, owned loopback ports and fresh Chromium contexts. No Agent, auth or shared browser is needed. Build the CLI with `npm run build --workspace @tacobin/cli` (Bun required) before the separate direct-command scenario, local toolbox and local Host recipes. For arbitrary artifacts use `verify.mjs`; suite cases use `scripts/fixture.mjs`, while CLI scenarios also package actual temporary canonical directories.

## Driving and proof conventions

Use Playwright `page`, `context`, `capture`, `step`, `doctor`, `reopen`, `outDir`, `bundle` and `assert` supplied by the runner. `capture('feature-before')` writes PNG and ARIA; `step('feature/entry: user action', fn)` logs the action in trace and JSON. Keep evidence under `outDir`. Select files through `button.file-row[data-path]`; use labels/roles for inputs and buttons. Assertions may read `window.taco`; browser actions use the UI. CLI actions spawn the actual built `taco-cli` entry and assert output, exit codes and real filesystem changes. CLI-produced artifacts must also be opened and observed.

Use `npm run test:verify -- --feature <domain>` for local focused runs; CI rejects filters and runs every registered case. Read `scripts/registry.mjs` for exact IDs and manual boundaries, then the mapped domain module for assertions. Each independent entry point needs its own proof; source observation and one Save entry do not prove other entries or native permission.

## Features

| Map                                    | User-visible coverage                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [Browse and search](browse-search.md)  | Sidebar, heading outline, keyboard search, embedded HTML                                                                             |
| [Edit and manage files](edit-files.md) | Markdown rich/source editing, properties, new/rename/delete, text editors                                                            |
| [Anchored comments](comments.md)       | Selection comment, author, reply/edit/delete/resolve, panel toggles                                                                  |
| [Save and handoff](save-handoff.md)    | Save, copy/download, unpack, clipboard and listener feedback                                                                         |
| [Checkpoints](checkpoints.md)          | Dashboard, required files, statuses, instructions, missing-file behavior                                                             |
| [Variants and security](variants.md)   | Complete/Lite offline behavior, theme, language, responsive panel, hostile content                                                   |
| [Agent CLI workflows](cli.md)          | Direct pack/verify/inspect/diff/extract, dry-run/refusal and browser round trips; real local listener/refresh and hosted CLI recipes |

## Evidence and scope

Default ad-hoc `scripts/browse.mjs` covers arbitrary built products. Browser suite outcomes live in `suite.json` and each case's `result.json`. The `scripts/cli.mjs` scenario runs via `verify.mjs --scenario .agents/skills/verify-taco/scripts/cli.mjs --out <fresh-directory>` and retains command transcripts, downloaded artifacts, screenshots/ARIA, actions, network and trace. CI runs it as its own step between the CLI build and the toolbox smoke (evidence directory `artifacts/verify-taco/ci-cli`), because the browser registry runs before the CLI build and holds only the 51 browser cases. Retain evidence after cleanup. Never report boundaries, skipped paths or another surface as passed.

Run `TACO_SMOKE_OUT=artifacts/smoke-toolbox npm run test:toolbox` after the CLI build for actual local commands and two-round listener receipts. Run `npm run test:host -- --out artifacts/smoke-host/new-run` for real CLI publication/subscription/Handoff, Next routes, SQLite autosave/reopen, comments and conflicts. Both are part of this skill's product coverage and retain separate owned lifecycles. Existing Vitest covers kernel/protocol/Host contracts, and CI verifies Spec Kit installation. Native OS permissions, live external delivery, production credentials and actual model consumption remain outside fixed local CI proof.
