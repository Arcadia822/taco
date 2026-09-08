# Taco — Agent installation

This is the machine-facing installation and review guide for an Agent adding Taco to a target Spec Kit project. Read [`README.md`](../README.md) for the product boundary and [`extensions/taco/README.md`](../extensions/taco/README.md) for the extension manifest contract. Instructions for contributors working in the Taco source repository live in [`AGENTS.md`](../AGENTS.md) and [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Installation boundary

Taco currently ships from this repository, not npm. Do not run `npm install -g taco`, `npx taco`, publish the private package, or substitute a development-server URL.

There are two distinct requested outcomes:

1. **Install Taco in a Spec Kit project:** install `extensions/taco/` and prepare Taco's persistent policy in project-owned process documentation and add one mandatory routing reference to `AGENTS.md`. Together these are the complete plugin installation: Agent commands, hooks, CLI, production browser shell, and durable project instructions.
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
node .specify/extensions/taco/bin/taco.mjs prepare-template \
  --project-root "$PWD" \
  --json
node .specify/extensions/taco/bin/taco.mjs prepare-policy \
  --project-root "$PWD" \
  --json
specify extension list
```

Verify all of these installed files:

```text
.specify/extensions/taco/extension.yml
.specify/extensions/taco/commands/update.md
.specify/extensions/taco/commands/review.md
.specify/extensions/taco/bin/taco.mjs
.specify/extensions/taco/assets/taco-shell.html
.specify/extensions/taco/policies/taco-agent-policy.md
.specify/extensions/taco/templates/spec-template.md
```

Also verify that the active Agent integration exposes `speckit.taco.update` and `speckit.taco.review`, and that `.specify/extensions.yml` registers Taco's mandatory post-lifecycle hooks. No target-project npm install is required.

## Install the authoring contract and project policy

Plugin installation is incomplete until `prepare-policy` reports `applied: true` and neither file has status `manual-merge`. The installed `.specify/extensions/taco/policies/taco-agent-policy.md` supplies the complete authoring and review policy. The CLI places that policy in project-owned process documentation; `AGENTS.md` contains only one imperative reference. Read and follow that reference before core commands such as `speckit.specify`; a post-generation Taco hook cannot prevent malformed Markdown that was already written.

### Process routing and safe migration

- A project declares 5xP in its `AGENTS.md` context routing, or in a linked context router. The CLI follows local relative Markdown links labeled `Context` or `5xP` (also `context.md` and `5xp.md`), then selects exactly one Process link by its `Process` label or `PROCESS.md` filename. Inline and full/collapsed reference-style links are supported. Routes are relative to the containing document, so `[Process](context/PROCESS.md)` and a context router linking `PROCESS.md` work equally. Fenced examples and HTML comments are not declarations. Routing is limited to 16 documents; unsupported or ambiguous routing requires a deliberate merge.
- The declared Process file must already exist. The CLI never assumes a root `PROCESS.md` and never infers 5xP from a generically named file alone. Without a 5xP declaration it uses `docs/taco-process.md`, without creating other 5xP documents.
- The complete policy is bounded by `<!-- taco:process-policy:start -->` and `<!-- taco:process-policy:end -->`. Preserve those markers. Unrelated Process and Agent instructions remain intact.
- `AGENTS.md` receives one instruction: “Before any Spec Kit or Taco work, read and follow the Taco workflow in [the selected process document].” It does not receive the full policy.
- Rerunning the command is a no-op. JSON reports absolute `processPath`, `model` (`5xp` or `dedicated`), per-file `process.status` and `agents.status` (`created`, `updated`, `unchanged`, or `manual-merge`), `migrated`, `dryRun`, and `applied`. `--dry-run --json` previews the same preparation without writing. A manual merge returns exit code 2 with a reason and writes neither file.
- To migrate an older installation, run `prepare-policy --dry-run --json` and then rerun without `--dry-run`. Only an exact stock Taco section from the shipped policy or former installation guide is removed from `AGENTS.md`; its full replacement is installed in the selected Process document. Existing customized sections, modified managed blocks, duplicate routes, missing or ambiguous Process destinations, symlinks, and paths outside the project fail closed.
- When manual merge is required, inspect the reported files, retain every local rule, and reconcile the local policy with the installed stock policy deliberately. Resolve the project's declared Process route before rerunning; never delete local customization merely to make preparation succeed. Keep project-specific rules outside the managed Taco block and retain one imperative reference in `AGENTS.md`.

The extension also supplies `templates/spec-template.md`. The installation command above materializes its YAML header into `.specify/templates/spec-template.md` while preserving the standard template body. If the project template is customized in an incompatible way, the CLI refuses to overwrite it and requires a deliberate manual merge. Verify that the effective project template begins with YAML frontmatter. New specifications use `title`, logical `feature_id`, `created`, `status`, and `input`, then begin at H2. The template deliberately omits `git_branch`; an Agent may add it only after verifying that an actual branch exists. The feature directory name is not evidence that Git created a branch.

The process policy must retain YAML `title`, logical `feature_id`, verified-only `git_branch`, `speckit.specify`, no repeated H1, an H2-first body, YAML `taco_scope` with the three routing values, canonical feature directories, update and native file presentation, local review preflight and conflict handling, complete comment handling, and collaboration credential boundaries. Re-read both resulting files: `AGENTS.md` must route to the selected process document and every unrelated instruction must remain. Do not add packer's built-in Taco-output exclusion to the policy; the CLI owns that invariant.

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

After update succeeds, always expose the exact generated Taco through the active Agent GUI's native clickable file or artifact presentation, similar to a local note attachment. In Codex, emit a clickable absolute file link and stop: the user's click is what hands the local HTML file to Browser. Do not first ask Browser to navigate to a `file://` URL, because Codex cannot autonomously complete that transition. Another Agent GUI may additionally open and verify the file only when it explicitly supports local HTML navigation. Never replace the local file with a `data:` URL, upload a collaboration-enabled Taco, weaken browser security, or substitute a development URL merely to produce a preview.

### Packaging rules

- Include every visible UTF-8 regular file recursively.
- The packer itself excludes all `*.taco.html` files and all paths with a segment beginning `.`.
- Do not reproduce the Taco-output exclusion in Agent instructions; it is a deterministic packer invariant.
- Additional exclusions require repeatable `--ignore "<feature-relative-path-or-glob>"` parameters. Supported wildcards are `*`, `?`, and `**`.
- An existing Taco retains its explicit ignore set on refresh. Supplying new `--ignore` values replaces that set.
- Never silently omit a visible symlink, unsupported filesystem entry, or non-UTF-8 file. Let packaging fail with the exact path unless the user explicitly ignores it.
- Every packaged `.html` or `.htm` file must receive its canonical absolute `file:` URL from the CLI. A missing or mismatched URL is a packaging error; do not hand-edit the Taco or replace it with a `data:` URL.
- Refreshing a legacy Taco is the migration path: `pack --from` may read the old bundle long enough to preserve its state, then rewrites every HTML entry with the canonical local URL. Standalone validation remains fail-closed for the legacy bundle before refresh.

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
- The installed directory contains both Agent commands, the CLI, the production shell, the YAML specification template, and `policies/taco-agent-policy.md`.
- Mandatory lifecycle hooks appear in `.specify/extensions.yml`.
- `.specify/templates/spec-template.md` begins with Taco's YAML authoring contract.
- The selected Process document contains the complete bounded Taco policy, including YAML `title`, no repeated H1, an H2-or-lower body start, and YAML `taco_scope`. `AGENTS.md` retains prior instructions and contains one mandatory reference; `prepare-policy` reports each file's status and a second run reports both unchanged.
- A generated Taco exists inside the expected feature directory with a nonzero embedded file count.
- The generated Taco was presented as a native clickable local file. Direct browser verification is additionally required only when the Agent GUI explicitly supports autonomous local HTML navigation; Codex records that opening occurs after the user's click.
- Its reported default and explicit exclusions match the requested policy.
- A review import was previewed; any applied import reports `applied: true`.
- Every open comment was classified and the same Taco was refreshed.
- For source release work, the full test/build check passed and `dist-single/Taco_Spec.taco.html` matches the synchronized extension shell.
