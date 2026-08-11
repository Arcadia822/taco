# Feature Specification: Taco Spec Kit Plugin

**Feature Branch**: `002-taco-speckit-plugin`
**Created**: 2026-08-11
**Status**: Complete
**Input**: Make Taco an installable Spec Kit extension whose installation is the complete Taco installation for a target project.

## User Scenarios & Testing

### User Story 1 - Install Taco once in a Spec Kit project (Priority: P1)

As a Spec Kit user, I ask an Agent to install the Taco plugin in one exact initialized project. After installation, that project has everything needed to create, open, update, and review Taco files; there is no second Taco package, service, or application installation.

**Why this priority**: If extension installation is not the product installation, the Quickstart promises a workflow the user still cannot run.

**Independent Test**: Initialize a clean Spec Kit project, install `extensions/taco/`, and verify the registered Agent commands, mandatory lifecycle hooks, CLI, and offline Taco shell all exist in the installed extension.

**Acceptance Scenarios**:

1. **Given** an initialized Spec Kit project and the Taco extension source, **When** the extension is installed, **Then** Spec Kit lists Taco and installs the command prompts, CLI, and self-contained shell under `.specify/extensions/taco/`.
2. **Given** only the installed extension in the target project, **When** its CLI packages a feature directory, **Then** the resulting `.taco.html` opens without a Taco service or a separate Taco runtime installation.
3. **Given** a project that is not initialized with Spec Kit, **When** installation is requested, **Then** the Agent stops with the missing precondition instead of creating an unrelated integration.

---

### User Story 2 - Keep one Taco current through the SDD lifecycle (Priority: P1)

As a user, I receive one Taco file inside the feature directory after specification. Whenever an Agent changes any artifact in that feature directory—including specification, clarification, plan, checklist, task, analysis, or implementation progress—it refreshes the same Taco before completing that operation.

**Why this priority**: A review copy that stops at `spec.md` is a misleading snapshot, not a feature review artifact.

**Independent Test**: Run the update command on a feature containing `spec.md`, `plan.md`, `tasks.md`, and nested artifacts; change each class of artifact and verify the same Taco path is refreshed with all current content.

**Acceptance Scenarios**:

1. **Given** `specs/014-search/`, **When** `speckit.taco.update` runs, **Then** it creates or refreshes `specs/014-search/014-search.taco.html`.
2. **Given** a standard Spec Kit lifecycle command changes the active feature, **When** that command finishes, **Then** a mandatory Taco hook invokes `speckit.taco.update` exactly once.
3. **Given** an Agent changes a feature artifact outside a lifecycle command, **When** it finishes the change, **Then** it invokes `speckit.taco.update` before reporting completion.
4. **Given** an existing Taco with comments, **When** update refreshes it, **Then** current canonical files replace embedded copies while comment threads and stable document identity remain present.
5. **Given** the active Agent GUI has an internal browser, **When** update succeeds, **Then** the Agent opens and verifies the exact generated Taco for immediate review; if the capability is unavailable or blocks local files, it reports a clickable absolute path and the failed presentation state without uploading the Taco.

---

### User Story 3 - Review in Taco and converge through the Agent (Priority: P1)

As a reviewer, I edit and comment in Taco, save it, and ask the Agent to review it. The Agent previews the import, imports direct edits when conflict-free, reads every open comment, changes the canonical feature artifacts to address actionable feedback, and refreshes the same Taco for the next review round.

**Why this priority**: Comments are requests for Agent reasoning, not raw patches and not decoration.

**Independent Test**: Edit embedded Markdown and add an anchored comment, then execute review and verify preview-before-write, canonical changes, comment classification, and refresh of the same Taco.

**Acceptance Scenarios**:

1. **Given** a saved Taco whose canonical files have not diverged, **When** `speckit.taco.review` runs, **Then** direct edits are imported and every open comment with its complete message history is presented to the Agent.
2. **Given** actionable review feedback, **When** the Agent handles it, **Then** it edits canonical feature files first and runs Taco update afterward.
3. **Given** both the Taco copy and canonical copy of a file changed since packaging, **When** review previews the import, **Then** it performs no writes and reports the exact conflict paths.
4. **Given** an ambiguous comment or one that changes acceptance behavior, **When** the Agent reads it, **Then** it defers that thread and asks for the missing decision instead of guessing.

---

### User Story 4 - Package the whole feature with explicit exclusions (Priority: P2)

As a user, I expect Taco to contain every eligible file under the feature directory. The packer automatically excludes Taco outputs and hidden paths; I can explicitly exclude additional files or directories with repeatable command parameters.

**Why this priority**: Silent content loss makes review incomplete, while generated Taco recursion and hidden tool state are predictable exceptions.

**Independent Test**: Package a fixture containing visible files, multiple Taco files, hidden files/directories, a symlink, invalid UTF-8 data, and explicit ignore matches; inspect both the bundle and structured result.

**Acceptance Scenarios**:

1. **Given** visible UTF-8 files anywhere below the feature root, **When** packaging runs without extra ignores, **Then** all of them are embedded.
2. **Given** any path with a segment beginning `.`, **When** packaging runs, **Then** that path is excluded and reported as a default hidden-path exclusion.
3. **Given** any filename ending `.taco.html`, **When** packaging runs, **Then** that file is excluded by the packer itself; Agent prompts do not need to reproduce this invariant.
4. **Given** repeated `--ignore <relative-path-or-glob>` parameters, **When** packaging runs, **Then** matching paths are excluded and the normalized patterns are preserved for later refreshes of that Taco.
5. **Given** a visible path that cannot be represented safely as Taco text, **When** it is not explicitly ignored, **Then** packaging fails with the exact path instead of silently treating it as an ignored default.

## Requirements

### Functional Requirements

- **FR-001**: The distributable extension MUST contain `extension.yml`, Agent command prompts, the Node.js CLI, and the latest production Taco shell.
- **FR-002**: Installing the extension into an initialized Spec Kit project and merging Taco's durable policy into its existing `AGENTS.md` MUST be sufficient to use Taco in that project; no npm package, hosted account, service, or second Taco install may be required.
- **FR-003**: The extension MUST provide `speckit.taco.update [feature-directory]` and `speckit.taco.review [taco-file]`.
- **FR-004**: `speckit.taco.update` MUST resolve exactly one feature directory, require its `spec.md`, and create or refresh `<feature-directory>/<feature-directory-name>.taco.html`.
- **FR-005**: The extension MUST register mandatory update hooks after core lifecycle commands that can create or change feature artifacts.
- **FR-006**: Agent command instructions MUST require update after any out-of-band canonical feature artifact change, including changes to `spec.md`, `plan.md`, `tasks.md`, research, data model, contracts, checklists, and implementation progress recorded in the feature directory.
- **FR-007**: The packer MUST recursively include every visible UTF-8 regular file under the feature directory except paths excluded by FR-008 or FR-009.
- **FR-008**: The packer MUST always exclude every `*.taco.html` file and every hidden path whose relative path contains a segment beginning `.`.
- **FR-009**: `pack` MUST accept repeatable `--ignore <relative-path-or-glob>` options, reject unsafe patterns, report their matches separately from default exclusions, and reuse the stored patterns when refreshing from an existing Taco unless new `--ignore` options replace them.
- **FR-010**: The packer MUST fail with an exact path for an unignored symlink, unsupported filesystem entry, or non-UTF-8 file; it MUST NOT silently add these to default ignores.
- **FR-011**: Updating an existing Taco MUST preserve its document identity, review threads, and stored explicit ignore patterns while replacing embedded file content and source baselines from canonical files.
- **FR-012**: Review MUST run `sync --dry-run --json` before any import write and MUST refuse the complete import when any conflict exists.
- **FR-013**: Review MUST expose every open thread's ID, status, path, anchor text, resolved position when available, stale state, and complete message history to the Agent.
- **FR-014**: The Agent MUST apply actionable feedback to canonical files, classify every open thread as handled, deferred, or stale, and invoke update afterward to refresh the same Taco.
- **FR-015**: `--force` MUST remain unavailable to normal automatic behavior and may be used only after explicit user authorization for the exact reported conflict paths.
- **FR-016**: The root README Quickstart, Chinese README, Agent guide, and extension README MUST describe the same installation—including the required project `AGENTS.md` merge—output location, commands, ignore behavior, hooks, and review loop.
- **FR-017**: Installation and round-trip verification MUST run against the currently supported Spec Kit CLI in a clean temporary project using a declared Agent integration.
- **FR-018**: Collaboration-enabled Taco files MUST continue to be treated as potentially credential-bearing and MUST NOT be sent to an external model, service, log, or ticket without user authorization.
- **FR-019**: After every successful update, the Agent MUST open and verify the exact generated Taco in the Agent GUI's internal browser or equivalent preview when available, reusing the current preview surface when practical. If unavailable or blocked, it MUST provide a clickable absolute path and explicitly state that automatic display did not occur; it MUST NOT upload the Taco, weaken browser security, or substitute another application URL.

### Key Entities

- **Canonical feature directory**: The sole source of truth for all Spec Kit feature artifacts.
- **Taco review file**: A self-contained HTML review transport stored inside its canonical feature directory and excluded from its own bundle.
- **Explicit ignore set**: User-supplied relative paths or glob patterns stored in the Taco bundle and reused on refresh.
- **Review thread**: Anchored human feedback with stable identity and complete message history.
- **Source baseline**: SHA-256 content hash used to detect independent canonical changes before import.
- **Installed Taco extension**: The complete project-local Taco runtime: manifest, Agent commands, hooks, CLI, and shell.

## Edge Cases

- Multiple Taco files inside one feature are all excluded; update targets only the canonical `<feature-name>.taco.html` unless the user supplies an exact Taco path during review.
- Hidden status is evaluated per relative path segment, so `.cache/file`, `nested/.draft.md`, and `.env` are excluded while `visible.env` is not.
- An explicit ignore matching `spec.md` is rejected because a review artifact without its specification is not a valid Taco feature.
- A refresh with no new `--ignore` flags inherits the existing Taco's explicit ignore set; supplying one or more new flags replaces that set.
- A pattern that matches nothing is retained and reported with zero matches so future artifacts can still be excluded consistently.
- Review never deletes a canonical file merely because it is absent from the Taco.
- A Taco saved without changes produces a successful no-op import and can still contain comments for the Agent to handle.

## Success Criteria

- **SC-001**: A clean initialized Spec Kit project installs Taco with one extension command and passes verification without installing another Taco artifact.
- **SC-002**: Automated fixtures prove 100% inclusion of visible UTF-8 regular files and 100% exclusion of Taco outputs, hidden paths, and explicit ignore matches.
- **SC-003**: Standard SDD stages from specify through implementation have mandatory update hooks registered in the installed project.
- **SC-004**: A review round trip imports direct edits, exposes comments, preserves threads, and refreshes the same in-directory Taco with zero unintended file writes.
- **SC-005**: Every Quickstart command can be copied into a clean test project and produces the documented files and registered Agent commands.
- **SC-006**: Installed Agent command content contains a capability-aware presentation step for both initial update and post-review refresh, with verified internal-browser display and an honest local-path fallback.

## Verification Record

- Spec Kit 0.16.2 clean-project installation registered Taco v0.2.0 with two Agent commands and eight mandatory lifecycle hooks; its project `AGENTS.md` retained a pre-existing instruction and added the durable Taco policy.
- The installed extension alone packaged four visible feature artifacts into the documented in-directory Taco, separated hidden/Taco defaults from one explicit glob exclusion, and completed a zero-conflict sync preview.
- Eight CLI tests cover full visible inclusion, both default exclusions, explicit ignore persistence and replacement, UTF-8/symlink failures, path boundaries, refresh, comment extraction, direct-edit import, and all-or-nothing conflict refusal.
- The repository check passed 103 tests, the production build, compression, and the single-file shell gate; the relay integration test remains opt-in and was skipped by the standard check.

## Out of Scope

- Publishing Taco to npm or inventing a global `taco` package.
- Automatically resolving review conflicts.
- Treating Taco as a second requirements database.
- Uploading Taco content to an external service during installation or review.
- Replacing or removing a target project's unrelated `AGENTS.md` instructions; the Taco plugin policy is merged alongside them.
