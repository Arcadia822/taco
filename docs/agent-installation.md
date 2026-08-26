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
node .specify/extensions/taco/bin/taco.mjs prepare-template \
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

Plugin installation is incomplete until the installing Agent updates the target project's existing `AGENTS.md`. Read the installed `.specify/extensions/taco/policies/taco-agent-policy.md`, preserve every unrelated project instruction, and merge that policy. The resulting prompt governs later core Spec Kit commands such as `speckit.specify`; a post-generation Taco hook cannot prevent malformed Markdown that was already written.

The extension also supplies `templates/spec-template.md`. The installation command above materializes its YAML header into `.specify/templates/spec-template.md` while preserving the standard template body. If the project template is customized in an incompatible way, the CLI refuses to overwrite it and requires a deliberate manual merge. Verify that the effective project template begins with YAML frontmatter. New specifications use `title`, logical `feature_id`, `created`, `status`, and `input`, then begin at H2. The template deliberately omits `git_branch`; an Agent may add it only after verifying that an actual branch exists. The feature directory name is not evidence that Git created a branch.

The merged policy must be equivalent to:

```md
## Taco Spec Kit authoring and review

- Write new Spec Kit Markdown metadata as leading YAML frontmatter. Put document
  titles in `title`; never imitate metadata with `## title: "..."` or bold prose.
- Use `feature_id` for the logical numbered feature identifier. Add `git_branch`
  only after verifying that an actual Git branch exists.
- When `speckit.specify` creates `spec.md`, do not add an ATX or Setext H1 that
  repeats the YAML title. Begin the body at H2 or lower. Preserve existing
  authored H1 content during unrelated edits.
- For an otherwise-unassigned Markdown file, write `taco_scope` in YAML. Offer
  `spec`, `plan`, and `tasks`; preserve other text values but do not route them.
  Do not generate the legacy `**Taco scope**: ...` form.
- Keep each Spec Kit feature directory canonical. Store its review file at
  `<feature-directory>/<feature-name>.taco.html` and update it only through the
  installed Taco commands.
- After changing any feature artifact—including spec, plan, tasks, research,
  contracts, checklists, or recorded implementation progress—invoke
  `speckit.taco.update` before reporting the operation complete. In Codex this
  command is `$speckit-taco-update`.
- After a successful update, present the exact generated Taco through the Agent
  GUI's native clickable file or artifact surface. In Codex, return a clickable
  absolute file link and let the user's click open it in Browser; do not attempt
  autonomous `file://` navigation. Other GUIs may open and verify it directly
  only when they explicitly support local HTML navigation.
- Import a saved human review through `speckit.taco.review` (in Codex,
  `$speckit-taco-review`). Preview before writing, stop on conflicts, and never
  use `--force` without explicit authorization for the exact paths.
- Read every open comment and its complete history, modify canonical files to
  address actionable feedback, then update the same Taco for the next review.
- Treat collaboration-enabled Taco files as potentially credential-bearing;
  do not send their contents to external services without user authorization.
```

Do not add packer's built-in Taco-output exclusion to `AGENTS.md`; the CLI owns that invariant. If the target has no `AGENTS.md`, create one containing this policy. Re-read the resulting file and verify that prior project instructions remain present and that all of these literal contracts survived the merge: YAML `title`, logical `feature_id`, verified-only `git_branch`, `speckit.specify`, no repeated H1, body begins at H2, YAML `taco_scope`, and the three routing values.

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
- The target project's `AGENTS.md` retains its previous instructions and contains Taco's authoring and review policy, including YAML `title`, no repeated H1, an H2-or-lower body start, and YAML `taco_scope`.
- A generated Taco exists inside the expected feature directory with a nonzero embedded file count.
- The generated Taco was presented as a native clickable local file. Direct browser verification is additionally required only when the Agent GUI explicitly supports autonomous local HTML navigation; Codex records that opening occurs after the user's click.
- Its reported default and explicit exclusions match the requested policy.
- A review import was previewed; any applied import reports `applied: true`.
- Every open comment was classified and the same Taco was refreshed.
- For source release work, the full test/build check passed and `dist-single/Taco_Spec.taco.html` matches the synchronized extension shell.
