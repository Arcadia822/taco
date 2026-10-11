---
title: Taco CLI local toolbox
linear: TACO-69
status: Implemented, awaiting review
---

## Goal

Ship TACO-71 through TACO-77 as optional local CLI tools for Agent authoring and explicit human review. Files remain canonical. CLI installation is optional; the Skill and its bundled scripts remain usable without it.

## Authoring and review

`new` produces a valid empty `files: []` bundle for the Agent to populate. It is not a human review deliverable. `init` uses the spec, ADR, architecture and API reference templates without imposing their example Checkpoint graph. `pack` packages existing visible text and validated PNG files. Complete is the default; Lite requires an explicit choice. All new artifacts use assets bundled with the installed CLI release, without downloads or a dependency on an installed Skill.

`verify` validates the inert data block, paths, PNGs and actual Mermaid syntax. Structural checks report V2; only a browser rendering check reports V1. `inspect` returns structure and bounded local diagnostics without printing capability secrets. `extract` returns credential-free selected file projections or writes to an explicitly named safe directory. These projections are not a complete Taco archive.

`diff` is read-only and supports Taco-to-Taco, canonical-directory and Handoff comparisons. It distinguishes additions, changes, removals, comments and Checkpoint changes. Canonical conflict checks require a trusted baseline; a hash does not stand in for baseline text. No command applies canonical changes or resolves comments.

## Local Handoff

`open` opens an existing artifact when the host permits it. `listen` starts a finite loopback receiver and emits a ready entry for a clickable artifact when opening is unavailable. Subscription is explicit and requires the reviewer browser and listener to be reachable on the same machine. Remote environments use the existing clipboard or saved-file channel. Existing files are not scanned, upgraded or rewritten to acquire a new Shell.

Only the human Handoff action sends the current in-memory review. Save, editing, comments and filesystem changes do not send it. The review baseline is independent of the last Save. The receiver authenticates a short-lived session token and document binding, validates the payload, atomically stores a local receipt, acknowledges it, flushes structured output and exits. A duplicate submission has the same receipt. Cancellation, timeout and duplicate startup release resources; no daemon is installed. Connection parameters remain outside the document data and are consumed before document hash routing.

The payload includes the review-start baseline and current credential-free snapshot, comments, full Checkpoint state and sufficient file contents for new files and PNGs. Delivery means the local receiver persisted the feedback, not that an arbitrary Agent session was awakened. Clipboard delivery reports copied; failed delivery preserves edits.

`refresh` accepts a Handoff explicitly, binds its identity and baseline to the original Taco, and verifies direct file edits against the canonical source before replacing the review. Pending or ambiguous edits stop the whole refresh. The new bundle retains current review comments, Checkpoint state, navigation, stable file IDs and unknown metadata. The output path and original Shell are preserved. Source content is taken from the handled canonical directory. There is no automatic canonical apply.

## CLI and publication

Reuse the established `taco-cli-help/1` command discovery, single JSON results, NDJSON streams and error exit codes. Do not add `--json` or `--ndjson`. Missing installed commands use the Skill fallback. Repeated group and ignore arguments are supported. Unsafe paths, symlinks and accidental overwrite are rejected. Preview write plans with dry-run.

Generate the embedded guide from the canonical Skill. Generate templates from `extensions/taco/templates/`; never hand-edit mirrors. Generate and embed release Shell assets before npm and native binary packaging. Document the local/hosted distinction in both languages, preserve the optional Spec Kit boundary and retain the manual data-block workflow. Website changes require a running local preview and actual surface verification.

## Verification

Exercise release npm contents and the native binary without an installed Skill. Exercise empty new, all template init paths, source pack, verification, diff, safe extraction and explicit refresh. Check special strings, unsupported HTML, symlinks, corrupt PNGs, invalid Mermaid, credential projections, existing-target refusal and no canonical writes by read-only commands.

Exercise two real browser rounds with unsaved正文 edits, comments and Checkpoints. Also exercise Save before Handoff, rejected tokens, wrong document, duplicate submission/start, cancellation, timeout and failed delivery. Retain review identity/history across refresh. Existing hosted tests must continue passing. Browser support beyond the exercised environment is reported explicitly.

## Size and dependency budget

Current baseline was captured before implementation.

| Artifact | Baseline bytes | Estimated added bytes | Measured added bytes |
| --- | ---: | ---: | ---: |
| Complete Skill Shell | 2,738,186 | 1,536–4,096 | 1,652 (0.0603%) |
| Lite Skill Shell | 188,847 | 1,536–4,096 | 1,787 (0.9463%) |
| Complete review artifact | 2,846,650 | 1,536–4,096 | 1,652 (0.0580%) |
| Lite review artifact | 297,311 | 1,536–4,096 | 1,787 (0.6011%) |
| Skill directory | 14,098,738 | 6,144–12,288 prose plus shared helper code and generated mirrors | 20,424 (0.1449%) |
| CLI npm tarball | 14,011 | Release compression must be measured; raw assets add 2,927,033 plus 80,000–160,000 code/templates | 2,303,957; final 2,317,968 |
| CLI npm unpacked | 50,302 | 3,007,033–3,087,033 plus generated guide | 3,285,226; final 3,335,528 |
| Native macOS arm64 binary | 70,911,986 | 3,007,033–3,087,033 plus generated guide | 3,170,304; final 74,082,290 |

No new third-party dependency was added. Explicit subscription adds loopback HTTP only. Complete retains offline runtime dependencies; Lite retains existing pinned CDN behavior. Neither Shell reaches the 1% or 32 KiB disclosure threshold. Shell increments fall within the estimate. The Skill increment includes generated template mirrors, shared validators and declarations. CLI unpacked growth exceeds the raw estimate by 198,193–278,193 bytes before the separately budgeted guide because it also embeds canonical guides, validators and complete template prose. Native growth exceeds the raw estimate by 83,271–163,271 bytes before the separately budgeted guide. Tarball compression was measured independently rather than estimated from raw asset size.

## Implementation evidence

`npx tsc --noEmit -p packages/cli/tsconfig.json` passed. `npm run check` passed formatting, the 13-lesson register, all 685 tests in 59 files, TypeScript and all Shell builds.

The installed npm tarball and macOS arm64 executable each passed `scripts/smoke-local-toolbox.mjs` with two actual browser rounds. Both covered all four templates, empty authoring, pack/verify/inspect/extract/diff, unsaved text/comment/Checkpoint feedback, Save-independent baseline, pending/stale refresh refusal and identity/history retention. Failed browser delivery preserved edits and an unchanged retry carried the exact same payload and timestamp. Additional executable probes passed three-way canonical conflicts, hosted definition deltas with an unverified baseline, unsupported HTML, invalid Mermaid/PNG, ancestor/dangling symlinks, existing-target refusal, null JSON rejection, token/doc/root/origin binding, concurrent duplicate delivery, cancellation and timeout. Browser coverage is Chromium 150 on the tested machine; other browser families were not exercised.

The website preview is `http://127.0.0.1:4318/`. English and Chinese local-workflow copy was checked in the running page. The default install remains Skill-only and the optional Spec Kit integration retains its project boundary.
