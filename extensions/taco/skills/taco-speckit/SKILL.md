---
name: taco-speckit
description: Taco workflow inside an initialized Spec Kit project — assemble the feature review file by writing the bundle JSON into the shell, open it in the host browser when permitted, and consume human review via Handoff or browser inspection. Use in place of the generic taco skill whenever the target project has a .specify/ directory.
---

# Taco for Spec Kit projects

This is the Spec Kit-bound Taco flow, used when the Taco extension is installed in the target project (`.specify/extensions/taco/` via `specify extension add`) with commands, hooks, and persistent policy. For any directory outside such a project — RFCs, ADRs, architecture docs in a plain repo or sandbox, or a Spec Kit feature directory with only the generic skill installed — use the generic `taco` skill instead; the bundle format and workflow are identical.

## Commands

```text
speckit.taco.update [feature-directory] [--ignore path-or-glob]...
speckit.taco.review [path-to-file.taco.html]
```

- `update` creates or refreshes `<FEATURE_DIR>/<feature-name>.taco.html` by assembling the bundle JSON into the shell (no CLI). Mandatory hooks invoke it after `specify`, `clarify`, `plan`, `checklist`, `tasks`, `analyze`, `implement`, and `converge`; the Agent invariant also requires it after any canonical feature-artifact change made outside those commands.
- `review` consumes the saved review — Handoff text or the saved file's bundle — applies edits and comments to canonical files, and re-runs `update`.

## Authoring feature artifacts

Choose the carrier by information type; narrative and definitions must not live in the same file:

- `spec.md`: goals, scenarios, scope, constraints, acceptance criteria. `plan.md`: module boundaries, implementation order, risks, verification.
- Cross-component interactions, flows, sequences, state machines: write `diagrams/*.mmd` (Mermaid source) in the feature directory and link it from the prose; small in-place illustrations may stay embedded.
- HTTP APIs: maintain `contracts/openapi.yaml` (or `.json`) as the single authoritative definition. Markdown explains semantics and trade-offs; never keep a parallel full endpoint table.
- Data structures: `data-model.md` for entity relationships, invariants, lifecycle; JSON Schema (or the target protocol's native format) when machine validation is needed. Do not invent a new format to satisfy "data model".
- WebSocket/event protocols: message schemas plus sequence/state diagrams and short semantics — not OpenAPI.

Rules: relative links connect spec/plan to the authoritative files; one definition per contract, updated at the source; every standalone file must be real, parseable content that matches the prose (diagram edges/states, OpenAPI fields/responses, schema constraints). Small tasks (copy edits, local rule changes) stay single-file Markdown — no placeholder diagrams or schemas. These files are canonical feature artifacts: changing them requires `speckit.taco.update` per the Agent invariant.

## Presentation and verification

After creating or refreshing a Taco, always present its exact absolute path as a native clickable file. When the host explicitly supports and permits autonomous local HTML navigation, proactively open that file in its browser and verify the expected title and document content are visible; do not ask again just to open it — the file path is often hard to find. Preserve any existing unsaved review by using a separate tab instead of reloading it. If opening is unavailable, prohibited, or fails, keep the clickable-file handoff and report why it was not opened or verified. In Codex, retain the user-click handoff: do not autonomously navigate to `file://`. Never bypass restrictions with `data:`/Blob URLs, a development server, external uploads, or weakened browser security; keep credential-bearing files local.

Full procedures — bundle assembly rules (shell location, `taco/files` v1 shape, `\u003c` escaping, `docId`/`comments`/`navigation` preservation), conflict handling, and done-criteria — live in the installed command definitions:

- `.specify/extensions/taco/commands/update.md`
- `.specify/extensions/taco/commands/review.md`

The persistent workflow policy installed by `prepare-policy` (project process document + one `AGENTS.md` routing reference) governs when these commands run. Read it before any Spec Kit or Taco work in the project.

## Optional Spec Kit extension integration

The generic `taco` skill already covers Spec Kit feature directories — no project installation is required. An optional deeper integration exists for projects that want the commands registered as Spec Kit extension commands with mandatory lifecycle hooks and a persistent project policy:

```bash
specify extension add taco --from \
  https://github.com/Arcadia822/taco/releases/download/v0.7.0/taco-extension-v0.7.0.zip
```

The release URL pins a version and its asset name (`taco-extension-<version>.zip`); check the [releases page](https://github.com/Arcadia822/taco/releases) and substitute the latest tag and asset when a newer release exists. Development installs use `specify extension add --dev /absolute/path/to/taco/extensions/taco`. See `docs/agent-installation.md` for the complete contract.