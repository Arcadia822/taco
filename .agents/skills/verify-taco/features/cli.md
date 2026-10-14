---
title: 'Agent CLI authoring and review round trips'
---

## Sub-features

- `cli/pack-extract`: package a canonical directory with Unicode Markdown, PNG and embedded HTML; retain exact bytes on extraction; enforce hidden/ignored/container exclusions and write-free dry runs.
- `cli/review-diff-extract`: edit a CLI-produced Taco through the browser, download/reopen it, inspect actual content changes through the CLI, and extract the saved review without overwriting canonical files or conflicting destinations.
- Local listener round trip: `new`, all six `init` templates, `pack`, `verify`, `inspect`, `extract`, `diff`, `listen` and two `refresh` rounds. Real receipts must retain unsaved edits, comments, Checkpoint status, identity and metadata; refused/tampered/stale feedback must leave the artifact unchanged.
- Hosted round trip: actual `publish`, `subscribe` and `handoff` against an owned local Next/SQLite Host, with browser autosave, independent reopen, comments and conflict handling.

## How to get to it (user POV)

The Agent executes `taco-cli help` and the relevant subcommand help, then packages canonical files with `taco-cli pack <dir> --out <review.taco.html>`. The human reviews the artifact in the browser and either downloads it or clicks Handoff while `taco-cli listen <review.taco.html> --no-open` is active. The Agent reads changes with `diff`/`inspect`, applies attributable edits to canonical files, and refreshes the same Taco with the received receipt. CLI feedback never grants implementation approval or resolves human comment threads.

In this source checkout the actual built CLI entry is `node packages/cli/dist/main.js`; it is the npm binary's implementation, not a mocked command or another verification executable. `taco-cli verify` is one product command, not a replacement for exercising the other operations.

## Driving it with taco-cli and Playwright

Build the product and CLI first. Run all added direct-command cases:

```bash
npm run build
npm run build --workspace @tacobin/cli
node .agents/skills/verify-taco/scripts/verify.mjs --scenario .agents/skills/verify-taco/scripts/cli.mjs --out artifacts/verify-taco/cli-run
```

`scripts/cli.mjs` invokes the built CLI with argument arrays. Every command records its arguments, stdout, stderr and exit code under the case evidence directory. The existing browser harness owns browser resources, doctor and screenshots. The CLI cases reopen CLI-generated and browser-downloaded artifacts, check their mounted bundle and rendered content, and keep final artifacts after temporary canonical/extraction workspaces are removed.

Run the existing real local listener recipe for the complete Agent/human loop:

```bash
TACO_SMOKE_OUT=artifacts/smoke-toolbox npm run test:toolbox
```

This executes `scripts/smoke-local-toolbox.mjs`, whose `listen` subprocess emits an owned ready URL/hash. The browser edits, comments, changes Checkpoints and explicitly hands off. Read the durable receipt, reject pending/tampered feedback, apply the received text to the synthetic canonical directory, run `refresh`, and repeat. The existing script asserts retained identity/comments/navigation/metadata and stale first-round refusal; its printed output identifies retained evidence. It is part of verify-taco coverage even though it owns a separate lifecycle.

Run remote CLI operations against the isolated local Host:

```bash
npm run test:host -- --out artifacts/smoke-host/cli-host-run
```

Read that run's `summary.json` before claiming Host success. Full product acceptance requires the browser suite, the CLI scenario, the local toolbox and the Host commands; the CLI scenario alone proves only its two mapped cases. It stays an ad-hoc scenario so the browser registry does not acquire a dependency on a CLI built later in the job; CI therefore runs it as its own step between the CLI build and the toolbox smoke and uploads its evidence with the browser artifacts.

## Gotchas

- Each drive uses synthetic files and fresh evidence directories. Never run against a live user's review or production Host.
- Compare actual filesystem bytes before/after dry-run, diff and conflict refusal. A JSON `dryRun` field or zero exit code alone is insufficient.
- Saved UI changes must survive an independently reopened browser view and real CLI extraction. Preserve the original canonical directory until changes are deliberately applied.
- The listener is a one-Handoff process with its own PID and capability token. Do not assume a permanent daemon, fabricate receipts, log live tokens, or kill by process name.
- Native browser opening/file-picker grants, production deployment and an actual model consuming feedback remain external boundaries. Deterministic local CLI execution and parsing real receipts are automated proof.
