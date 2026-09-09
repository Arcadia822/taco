# Implementation Plan: Taco Spec Kit Plugin

## Summary

Replace the prototype `create` contract with a complete project-local `update + review` extension. The extension owns the Taco CLI and production shell, stores the Taco inside its feature directory, packages all visible UTF-8 feature files except deterministic and explicit exclusions, and registers mandatory update hooks across the SDD lifecycle.

## Technical Context

- **Runtime**: Node.js 22 or newer
- **Extension host**: GitHub Spec Kit 0.16.x
- **Container**: `taco/files` version 1 embedded in a self-contained HTML shell
- **Canonical storage**: Spec Kit feature directory
- **Testing**: Vitest CLI fixtures plus a clean-project `specify extension add --dev` smoke test
- **Constraints**: Offline packaging/review; no npm publication; no external upload; preserve unrelated dirty worktree changes

## Architecture

1. `extension.yml` registers two Agent commands and mandatory post-stage hooks; `prepare-policy` selects the declared 5xP Process document or `docs/taco-process.md` and adds one imperative `AGENTS.md` reference.
2. `commands/update.md` resolves the active feature and delegates deterministic work to `bin/taco.mjs pack`.
3. `commands/review.md` performs conflict-safe import, hands comments to Agent reasoning, then invokes the same update path.
4. `bin/taco.mjs` owns path safety, inclusion/exclusion policy, baseline hashes, comment extraction, and atomic sync writes.
5. `assets/taco-shell.html` is generated from the production application and copied into the extension at build time.
6. Root and Agent-facing documentation expose one plugin installation model: install the Spec Kit extension and safely prepare its bounded process policy and Agent routing reference, thereby installing Taco in that project.

## Key Decisions

- Use the in-directory filename `<feature-name>.taco.html`; recursion is prevented by the packer, not by Agent prose.
- Hidden paths and all `*.taco.html` files are the only default exclusions.
- Visible non-text files and symlinks are errors unless explicitly excluded, preventing silent incomplete review bundles.
- `--ignore` accepts safe feature-relative paths and glob syntax. The explicit set is embedded in the bundle and inherited by refresh.
- Hooks cover standard Spec Kit operations; the update command contract covers canonical changes made outside those operations.
- Review preserves threads for human confirmation rather than asserting that a thread is resolved.

## Verification Strategy

1. Unit-test inclusion, default exclusions, glob/path ignores, persistence, invalid UTF-8, symlinks, refresh, sync, conflict refusal, and comment extraction.
2. Run the complete repository check, which rebuilds the single-file shell and synchronizes it into the extension.
3. Initialize a temporary Spec Kit project with a declared integration, install the extension, prepare and verify the Process policy and single `AGENTS.md` reference without losing prior instructions, inspect installed files/hooks/commands, and execute pack/sync using only installed extension assets.
4. Execute the documented Quickstart against that temporary project and compare actual paths with README examples.

## Constitution Check

No project constitution exists. Repository policy instead requires canonical feature files, CLI-only shell updates, dry-run review imports, exact-path authorization for force, and credential-safe handling; this plan preserves all five constraints.

## Process policy verification

Exercise root and context-directory 5xP routes, a linked context router, and a project without 5xP. Verify unrelated instructions, exact-stock legacy migration, repeat-run no-op, dry-run, structured statuses, and fail-closed customizations, ambiguity, and unsafe paths. Preflight both files and stage both outputs before committing; roll back any partial commit after a write failure. The offline installed CLI requires no new dependency.
