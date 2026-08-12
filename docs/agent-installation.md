# Taco — Agent installation

This is the machine-facing installation and review guide for an Agent adding Taco to a target Spec Kit project. Read [`README.md`](../README.md) for the product boundary and [`extensions/taco/README.md`](../extensions/taco/README.md) for the extension manifest contract. Instructions for contributors working in the Taco source repository live in [`AGENTS.md`](../AGENTS.md) and [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Installation boundary

Taco currently ships from this repository, not npm. Do not run `npm install -g taco`, `npx taco`, publish the private package, or substitute a development-server URL.

There are two distinct requested outcomes:

1. **Install Taco in a Spec Kit project:** install `extensions/taco/` and merge Taco's persistent review policy into the target project's `AGENTS.md`. Together these are the complete plugin installation: Agent commands, hooks, CLI, production browser shell, and durable project instructions.
2. **Build the standalone source artifact:** from the Taco source repository, build `dist-single/Taco_Spec.taco.html`.

Do not require the standalone artifact as a second installation step for a target Spec Kit project. The extension already carries the same production shell.

## Verify the Taco source checkout

From the Taco repository root, preserve unrelated changes and run:

```bash
npm ci
npm run check
```

`npm run check` format-checks documentation, runs tests, builds `dist-single/Taco_Spec.taco.html`, applies the shell gate, and copies that production shell to `extensions/taco/assets/taco-shell.html`. A listening Vite port is development evidence, not a finished build.

## Install Taco in an exact Spec Kit project

Confirm the exact target with the user. It must already be initialized by Spec Kit and have an active Agent integration. From that project root, require the `specify` command; a missing command or `.specify/` directory is a blocker.

```bash
specify extension add --dev /absolute/path/to/taco/extensions/taco
specify extension list
```

Verify all of these installed files:

```text
.specify/extensions/taco/extension.yml
.specify/extensions/taco/commands/update.md
.specify/extensions/taco/commands/review.md
.specify/extensions/taco/bin/taco.mjs
.specify/extensions/taco/assets/taco-shell.html
```

Also verify that the active Agent integration exposes `speckit.taco.update` and `speckit.taco.review`, and that `.specify/extensions.yml` registers Taco's mandatory post-lifecycle hooks. No target-project npm install is required.

## Install the project policy

Plugin installation is incomplete until the installing Agent updates the target project's existing `AGENTS.md`. Preserve every unrelated instruction and merge a compact policy equivalent to:

```md
## Taco Spec Kit review

- Keep each Spec Kit feature directory canonical. Store its review file at
  `<feature-directory>/<feature-name>.taco.html` and update it only through the
  installed Taco commands.
- After changing any feature artifact—including spec, plan, tasks, research,
  contracts, checklists, or recorded implementation progress—invoke
  `speckit.taco.update` before reporting the operation complete. In Codex this
  command is `$speckit-taco-update`.
- After a successful update, open the exact generated Taco in the Agent GUI's
  internal browser when available and verify it is displayed. Otherwise provide
  a clickable absolute path and state why automatic preview was unavailable.
- Import a saved human review through `speckit.taco.review` (in Codex,
  `$speckit-taco-review`). Preview before writing, stop on conflicts, and never
  use `--force` without explicit authorization for the exact paths.
- Read every open comment and its complete history, modify canonical files to
  address actionable feedback, then update the same Taco for the next review.
- Treat collaboration-enabled Taco files as potentially credential-bearing;
  do not send their contents to external services without user authorization.
```

Do not add packer's built-in Taco-output exclusion to `AGENTS.md`; the CLI owns that invariant. If the target has no `AGENTS.md`, create one containing this policy. Re-read the resulting file and verify that both the prior project instructions and Taco policy remain present.

## Update a feature Taco

The feature directory is canonical. Require its exact path and `spec.md`; never guess by modification time.

Using only the installed extension:

```bash
node .specify/extensions/taco/bin/taco.mjs pack "<FEATURE_DIR>" \
  --project-root "$PWD" \
  --json
```

For `specs/014-search/`, the fixed output is `specs/014-search/014-search.taco.html`. Report its absolute path, embedded file count, exclusions, and preserved comment count. Tell the human to save the Taco after editing or commenting; opening it alone does not modify canonical files.

Run `speckit.taco.update` after any canonical feature artifact change. Mandatory hooks cover the normal `specify`, `clarify`, `plan`, `checklist`, `tasks`, `analyze`, `implement`, and `converge` stages. If an Agent changes feature content outside those commands, it must update Taco before declaring that operation complete.

After update succeeds, use the active Agent GUI's internal browser or equivalent artifact preview to open the exact generated Taco. Reuse its existing preview surface when possible and verify the Taco is visible. If no such capability exists or local-file navigation is blocked, provide a clickable absolute path and report that it was not opened. Never upload a collaboration-enabled Taco, weaken browser security, or substitute a development URL merely to produce a preview.

### Packaging rules

- Include every visible UTF-8 regular file recursively.
- The packer itself excludes all `*.taco.html` files and all paths with a segment beginning `.`.
- Do not reproduce the Taco-output exclusion in Agent instructions; it is a deterministic packer invariant.
- Additional exclusions require repeatable `--ignore "<feature-relative-path-or-glob>"` parameters. Supported wildcards are `*`, `?`, and `**`.
- An existing Taco retains its explicit ignore set on refresh. Supplying new `--ignore` values replaces that set.
- Never silently omit a visible symlink, unsupported filesystem entry, or non-UTF-8 file. Let packaging fail with the exact path unless the user explicitly ignores it.

## Import a reviewed Taco

Use the exact saved Taco path. Before reading the complete embedded content, run the inert local credential/runtime preflight:

```bash
node .specify/extensions/taco/bin/taco.mjs validate "<TACO_FILE>" --json
```

If it reports `collab-secrets-present`, local inspection remains allowed, but do not upload, paste, attach, log, or ticket the complete Taco without the user's authorization. Removing credential fields later is not revocation; if the file may already have left the authorized boundary, direct the owner to Reset Access. If it reports `runtime-security-outdated`, refresh the Taco from canonical files before treating its runtime as hardened.

Then preview before writing:

```bash
node .specify/extensions/taco/bin/taco.mjs sync "<TACO_FILE>" \
  --project-root "$PWD" \
  --dry-run \
  --json
```

- Parse the complete result, including every file and comment.
- If any file is `conflict`, stop before writing and report exact paths.
- Never add `--force` unless the user authorizes the exact conflict paths.
- If conflict-free, rerun without `--dry-run` and require `applied: true`.
- Read every open comment's thread ID, path, quote, resolved position, stale state, and complete message history.
- Apply actionable feedback to canonical files. Defer ambiguous feedback or acceptance changes to the user.
- Classify every open thread as handled, deferred, or stale. Do not mark it resolved merely because nearby text changed.
- Invoke `speckit.taco.update` after comment handling and verify that it refreshed the same Taco while preserving threads.

Review never deletes a canonical file because it is absent from the Taco. Conflict handling is all-or-nothing.

## Credential boundary

A collaboration-enabled Taco may contain relay configuration or access credentials in its embedded state. Treat the complete file as potentially credential-bearing.

- Local CLI inspection and local Agent reasoning in the authorized project are allowed.
- Do not upload, paste, attach, log, or ticket the Taco content to an external model or service without explicit user authorization.
- Prefer structured CLI output when an external system only needs paths, counts, conflicts, or comment metadata.
- Revocation or key reset is an explicit user action; do not perform it as part of normal review.
- Previously generated Taco files carry their previous runtime until they are refreshed; updating this source checkout or the installed extension does not rewrite copies already distributed.

## Completion evidence

An installation or review is complete only when the requested outcome is observed:

- The exact target project lists Taco as installed.
- The installed directory contains both Agent commands, the CLI, and the production shell.
- Mandatory lifecycle hooks appear in `.specify/extensions.yml`.
- The target project's `AGENTS.md` retains its previous instructions and contains the Taco review policy.
- A generated Taco exists inside the expected feature directory with a nonzero embedded file count.
- The generated Taco was displayed in the available internal browser, or the completion report explicitly records the unavailable/blocked capability and clickable path fallback.
- Its reported default and explicit exclusions match the requested policy.
- A review import was previewed; any applied import reports `applied: true`.
- Every open comment was classified and the same Taco was refreshed.
- For source release work, the full test/build check passed and `dist-single/Taco_Spec.taco.html` matches the synchronized extension shell.
