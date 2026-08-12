# Quickstart Verification: Taco Spec Kit Plugin

This procedure is the acceptance test for the user-facing README. Run it in a disposable directory with the currently supported Spec Kit CLI and a declared Agent integration.

## Install

```bash
specify init taco-plugin-smoke --integration codex --no-git
cd taco-plugin-smoke
specify extension add --dev /absolute/path/to/taco/extensions/taco
specify extension list
```

Installation passes only if `.specify/extensions/taco/` contains `extension.yml`, `commands/update.md`, `commands/review.md`, `bin/taco.mjs`, and `assets/taco-shell.html`, and if the selected integration exposes both Taco commands.

The installing Agent must also merge the Taco Spec Kit review policy from `docs/agent-installation.md` into the target project's `AGENTS.md`, preserving all existing instructions. Installation is incomplete until that durable policy is present.

## Package

Create a feature fixture containing `spec.md`, `plan.md`, `tasks.md`, a nested visible file, a hidden file, and another `.taco.html`. Then run only the installed Taco CLI:

```bash
node .specify/extensions/taco/bin/taco.mjs pack specs/001-smoke \
  --project-root "$PWD" \
  --ignore "private/**" \
  --json
```

The output must be `specs/001-smoke/001-smoke.taco.html`. It must include every eligible visible file, exclude hidden paths and every `.taco.html`, and report the explicit ignore separately.

## Review

After a human saves direct edits or comments in that Taco, preview before writing:

```bash
node .specify/extensions/taco/bin/taco.mjs sync \
  specs/001-smoke/001-smoke.taco.html \
  --project-root "$PWD" \
  --dry-run \
  --json
```

If there are no conflicts, the Agent imports, reads every open thread, updates canonical files, and runs `speckit.taco.update` so the same Taco becomes the next review copy.
