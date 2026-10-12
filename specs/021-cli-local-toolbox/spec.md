---
title: Taco CLI local toolbox
linear: TACO-69
status: Implemented, awaiting review
---

## Goal

Ship TACO-71 through TACO-77 as optional local CLI tools for Agent authoring and explicit human review. Files remain canonical. CLI installation is optional; the Skill and its bundled scripts remain usable without it.

## Authoring and review

`new` produces a valid empty `files: []` bundle for the Agent to populate. It is not a human review deliverable. `init` uses the spec, ADR, architecture, API reference, PRD and interaction templates without imposing their example Checkpoint graph. Skill trigger judgment and P0–P3 design-depth precedence decide whether a review is needed and which prose is appropriate; the CLI only automates the chosen carrier. `pack` packages existing visible text, self-contained HTML pages and validated PNG files. Complete is the default; Lite requires an explicit choice. All new artifacts use assets bundled with the installed CLI release, without downloads or a dependency on an installed Skill.

`verify` validates the inert data block, paths, PNGs and actual Mermaid syntax. Structural checks report V2; only a browser rendering check reports V1. `inspect` returns structure and bounded local diagnostics without printing capability secrets. `extract` returns credential-free selected file projections or writes to an explicitly named safe directory. These projections are not a complete Taco archive.

`diff` is read-only and supports Taco-to-Taco, canonical-directory and Handoff comparisons. It distinguishes additions, changes, removals, comments and Checkpoint changes. Canonical conflict checks require a trusted baseline; a hash does not stand in for baseline text. No command applies canonical changes or resolves comments.

## Local Handoff

`open` opens an existing artifact when the host permits it. `listen` starts a finite loopback receiver and emits a ready entry for a clickable artifact when opening is unavailable. Subscription is explicit and requires the reviewer browser and listener to be reachable on the same machine. Remote environments use the existing clipboard or saved-file channel. Existing files are not scanned or upgraded merely to acquire a newer Shell. Adding HTML during refresh of an incompatible legacy carrier uses the main Skill's targeted stock-shell replacement policy, retaining the same Complete/Lite variant and full document history.

Only the human Handoff action sends the current in-memory review. Save, editing, comments and filesystem changes do not send it. The review baseline is independent of the last Save. The receiver authenticates a short-lived session token and document binding, validates the payload, atomically stores a local receipt, acknowledges it, flushes structured output and exits. A duplicate submission has the same receipt. Cancellation, timeout and duplicate startup release resources; no daemon is installed. Connection parameters remain outside the document data and are consumed before document hash routing.

The payload includes the review-start baseline and current credential-free snapshot, comments, full Checkpoint state and sufficient file contents for new files and PNGs. Delivery means the local receiver persisted the feedback, not that an arbitrary Agent session was awakened. Clipboard delivery reports copied; failed delivery preserves edits.

`refresh` accepts a Handoff explicitly, binds its identity and baseline to the original Taco, and verifies direct editable-file changes against the canonical source before replacing the review. Pending or ambiguous edits stop the whole refresh. The new bundle retains current review comments, Checkpoint state, navigation, stable file IDs and unknown metadata. The output path is preserved; compatible Shells stay unchanged, while adding HTML to an incompatible legacy Shell requires the same-variant bundled stock carrier. HTML remains a derived, read-only artifact and cannot be applied as human direct-edit feedback. Source content is taken from the handled canonical directory. There is no automatic canonical apply; neither Handoff nor Checkpoint status authorizes a later phase.

## CLI and publication

Reuse the established `taco-cli-help/1` command discovery, single JSON results, NDJSON streams and error exit codes. Do not add `--json` or `--ndjson`. Missing installed commands use the Skill fallback. Repeated group and ignore arguments are supported. Unsafe paths, symlinks and accidental overwrite are rejected. Preview write plans with dry-run.

Generate the embedded guide from the canonical Skill. Generate templates from `extensions/taco/templates/`; never hand-edit mirrors. Generate and embed release Shell assets before npm and native binary packaging. Document the local/hosted distinction in both languages, preserve the optional Spec Kit boundary and retain the manual data-block workflow. Website changes require a running local preview and actual surface verification.

## Verification

Exercise release npm contents and the native binary without an installed Skill. Exercise empty new, all six template init paths, source pack, verification, diff, safe extraction and explicit refresh. Check special strings, read-only embedded HTML, legacy same-variant HTML carrier replacement, symlinks, corrupt PNGs, invalid Mermaid, credential projections, existing-target refusal and no canonical writes by read-only commands.

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

## Main Skill reconciliation (2026-10-12)

Baseline: main `eb2eaa0`, CLI `efcb126`. Preserve main's trigger-only bilingual description, human-review gate, light/medium/heavy depth ladder, P0–P3 precedence and optional engine integrations. Add the CLI route after those decisions; installed command discovery prevents older hosted-only binaries from breaking local fallback. Local receipts remain feedback, with explicit canonical-directory binding and a required receipt/payload for CLI refresh. Add main's PRD/interaction assets and embedded HTML compatibility semantics to CLI packaging. Preserve manual/helper assembly and the same review path/history. No new CLI flags, dependencies, remote services or background upgrade workflow.

Prepare estimate for reconciliation, relative to `efcb126`: each Shell adds 0–8,192 bytes from main's HTML renderer plus compatibility glue; CLI unpacked adds 16,384–49,152 bytes from expanded Skill/reference prose, two templates and glue; native binary adds 16,384–65,536 bytes. Skill directory adds 5,488,640–5,554,176 bytes chiefly from two generated Complete template containers. The main baseline already includes those containers; incremental CLI-specific Skill prose/helpers are estimated at 4,096–16,384 bytes. Compression is measured independently. No new dependency or network behavior; existing explicit loopback and Lite CDN behavior remain.

Develop measurements after rebuilding, compared with the same `efcb126` baseline:

| Artifact | Estimate added bytes | Measured added bytes | Final bytes |
| --- | ---: | ---: | ---: |
| Complete Skill Shell | 0–8,192 | 644 | 2,740,482 |
| Lite Skill Shell | 0–8,192 | 601 | 191,235 |
| Complete review artifact | 0–8,192 | 4,737 | 2,853,039 |
| Lite review artifact | 0–8,192 | 4,694 | 303,792 |
| Skill directory | 5,488,640–5,554,176 | 5,526,688 | 19,645,850 |
| CLI npm unpacked | 16,384–49,152 | 38,866 | 3,374,394 |
| macOS arm64 executable | 16,384–65,536 | 33,024 | 74,115,314 |
| CLI npm tarball | Compression measured independently | 13,833 | 2,331,801 |

Total measurements relative to `efcb126` remain within the estimates. Review artifacts include 4,093 additional document bytes from main; the Shell-only delta excludes them. Relative to current main `eb2eaa0`, CLI-specific Complete Shell growth is 1,780 bytes (0.0650%), Lite is 1,766 bytes (0.9321%), and Skill-directory growth is 30,142 bytes (0.1537%). The latter exceeds the 4,096–16,384 incremental estimate by 13,758–26,046 bytes because that estimate undercounted the six regenerated template Shell mirrors plus existing CLI helper changes. Both Shells remain below the 1% / 32 KiB threshold. Main's two generated Complete template containers account for most total Skill growth; no new third-party dependency or network behavior was added.

Reconciliation validation: `npm run check` passed 707 tests in 60 files, formatting, all 15 lessons, TypeScript and three Shell builds. Independent CLI TypeScript and 46 CLI contract tests passed after the final exit-code correction. The isolated npm install and macOS arm64 binary both passed two actual Chromium review rounds, all six template paths, HTML iframe rendering and retention, direct HTML-content tampering refusal, Complete/Lite legacy capability replacement, Save-independent feedback, canonical regeneration and identity/history preservation. Embedded Skill guidance matches canonical source exactly and all six template mirrors are byte-identical. `npm run test:browser` passed with seven warnings in the product-spec artifact; the feature deliverable is checked separately. Website bilingual prompt arguments were observed at `http://127.0.0.1:4319/`. Browser coverage is limited to exercised Chromium.

Additional post-review executable probes passed permitted reads from a canonical `templates/` directory, refused writes into that directory, and accepted hosted HTML additions/deletions/renames in both Handoff comparison modes while retaining `trustedBaseline: false`. These cases failed before the source/destination guard and hosted-delta corrections. Both final packaged runtimes then passed the complete two-round smoke again. The refreshed feature Taco and current-build `CLI_Main_Sync.taco.html` each passed browser rendering checks with zero warnings.
