---
name: taco-speckit
description: Taco workflow inside an initialized Spec Kit project, using the installed Spec Kit extension commands (speckit.taco.update / speckit.taco.review) with lifecycle hooks, feature resolver, and Spec Kit templates. Use in place of the generic taco skill whenever the target project has a .specify/ directory.
---

# Taco for Spec Kit projects

This is the Spec Kit-bound Taco flow. It assumes the Taco extension is installed in the target project (`.specify/extensions/taco/`) via `specify extension add`. For any directory outside a Spec Kit project — RFCs, ADRs, architecture docs in a plain repo or sandbox — use the generic `taco` skill instead; the underlying CLI (`pack` / `sync` / `validate` / `comments`) is identical.

## Commands

```text
speckit.taco.update [feature-directory] [--ignore path-or-glob]...
speckit.taco.review [path-to-file.taco.html]
```

- `update` creates or refreshes `<FEATURE_DIR>/<feature-name>.taco.html`. Mandatory hooks invoke it after `specify`, `clarify`, `plan`, `checklist`, `tasks`, `analyze`, `implement`, and `converge`; the Agent invariant also requires it after any canonical feature-artifact change made outside those commands.
- `review` validates, previews, and imports the saved Taco, gives every open comment thread to the Agent, requires canonical-file edits before re-running `update`, and re-presents the refreshed Taco.

After creating or refreshing a Taco, always present its exact absolute path as a native clickable file. When the host explicitly supports and permits autonomous local HTML navigation, proactively open that file in its browser and verify the expected title and document content are visible; do not ask again just to open it. Preserve any existing unsaved review by using a separate tab instead of reloading it. If opening is unavailable, prohibited, or fails, keep the clickable-file handoff and report why it was not opened or verified. In Codex, retain the user-click handoff: do not autonomously navigate to `file://`. Never bypass restrictions with `data:`/Blob URLs, a development server, external uploads, or weakened browser security; keep credential-bearing files local.

Full procedures, presentation policy (native clickable-file handoff, no `data:` URLs), conflict rules (`--dry-run` first, never `--force` without explicit authorization), and done-criteria live in the installed command definitions:

- `.specify/extensions/taco/commands/update.md`
- `.specify/extensions/taco/commands/review.md`

The persistent workflow policy installed by `prepare-policy` (project process document + one `AGENTS.md` routing reference) governs when these commands run. Read it before any Spec Kit or Taco work in the project.

## Installation

Run from the exact initialized Spec Kit project:

```bash
specify extension add taco --from \
  https://github.com/Arcadia822/taco/releases/download/v0.6.0/taco-extension-v0.6.0.zip
node .specify/extensions/taco/bin/taco.mjs prepare-template --project-root "$PWD" --json
node .specify/extensions/taco/bin/taco.mjs prepare-policy --project-root "$PWD" --json
```

The release URL pins a version and its asset name (`taco-extension-<version>.zip`); check the [releases page](https://github.com/Arcadia822/taco/releases) and substitute the latest tag and asset when a newer release exists.

Development installs use `specify extension add --dev /absolute/path/to/taco/extensions/taco`. `prepare-policy --dry-run --json` previews; exit code 2 means manual merge is required — never force it. See `docs/agent-installation.md` for the complete contract.
