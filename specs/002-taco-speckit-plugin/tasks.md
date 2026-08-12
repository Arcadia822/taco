# Tasks: Taco Spec Kit Plugin

## Phase 1 - Contract

- [x] T001 Capture installation, update, review, inclusion, ignore, and documentation requirements in `spec.md`.
- [x] T002 Define implementation and clean-project verification strategy in `plan.md`.
- [x] T003 Validate requirement quality with `checklists/requirements.md`.

## Phase 2 - Deterministic CLI

- [x] T004 Move default output inside the feature directory.
- [x] T005 Implement hidden-path and `*.taco.html` default exclusions.
- [x] T006 Implement repeatable safe `--ignore` paths/globs and persistence across refresh.
- [x] T007 Fail explicitly for unignored symlinks, unsupported entries, and non-UTF-8 files.
- [x] T008 Expand CLI fixtures for inclusion, exclusion, persistence, and failure behavior.

## Phase 3 - Spec Kit Integration

- [x] T009 Replace `speckit.taco.create` with `speckit.taco.update`.
- [x] T010 Register mandatory update hooks for feature-changing SDD lifecycle commands.
- [x] T011 Make review call the canonical update flow after Agent comment handling.
- [x] T012 Verify the installed extension contains the complete CLI and production shell and that installation preserves prior `AGENTS.md` content while adding Taco policy.

## Phase 4 - Documentation and Distribution

- [x] T013 Align English and Chinese README Quickstarts with the installed extension behavior.
- [x] T014 Align `docs/agent-installation.md` and `extensions/taco/README.md` with the same contract.
- [x] T015 Build the production single-file shell and synchronize the extension asset.

## Phase 5 - Verification

- [x] T016 Run CLI tests and the complete repository check.
- [x] T017 Install the extension and Taco project policy in a clean temporary Spec Kit project with a declared Agent integration.
- [x] T018 Run update and review smoke tests using only files installed into that project.
- [x] T019 Audit every functional requirement and Quickstart claim against observed evidence.
- [x] T020 Add capability-aware internal-browser presentation to generated update/review skills and all plugin-facing documentation.
