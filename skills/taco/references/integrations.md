---
title: Integrating Taco with other skills
---

# Integrating Taco with other skills

Taco owns one thing: the human review loop over canonical documents. Other skills own everything else — process (how a design is produced) and generation (how an artifact is made). This reference defines both integration families so you combine them without inventing a second workflow.

Read this before you run a design process from another skill set, or before you call a generator skill to produce a file that goes into a Taco.

## 1. Process skill sets (SDD engines)

Examples: **pstack** (`poteto-mode` + playbooks), **gstack**, **superpowers**, **spec-kit**/`speckit`. These are method layers: they decide how work is investigated, designed, planned, and verified. Taco does not reimplement their method.

### 1.1 Two layers, never mixed

| Layer | Owner | What it is |
| --- | --- | --- |
| **Container** | Taco | The Checkpoint node documents (`01-…`, `02-…`, …) inside the `.taco.html`: the only thing humans read, edit, comment, and set status on |
| **Method** | the engine | Its playbooks/stages (`how`, `architect`, `arena`, `multi-phase-plan`, `brainstorming`, `writing-plans`, `/speckit.plan`, …) |

The engine decides **how** a document is produced. The result is written **into the Taco's node files** at the paths the review contract names. Never maintain a second "presentation copy" of an engine's output: if the engine writes `<program>-plan.md` in its own store, that content lands in the Taco's plan node (or is referenced as an attachment with its path recorded), and the Taco node remains the reviewed object.

Reference engine material **by path and version** (`poteto-mode/playbooks/multi-phase-plan.md`, plugin version or upstream commit). Do not copy playbook text into Taco documents.

### 1.2 Detect once, by file signals

Detect at the moment design work starts, once per task — not per command, and never by asking the user to describe their setup.

| Engine | File signals | Design entry | Product convention |
| --- | --- | --- | --- |
| pstack | `**/poteto-mode/SKILL.md` + sibling `playbooks/*.md`; plugin manifest naming `pstack` | `/poteto-mode` internals: `how`, `architect`, `arena`, `figure-it-out`, `interrogate`, `blast-radius` | single-file plan with its fixed skeleton; verification script named by the playbook |
| gstack | skills named `design-consultation`, `design-review`, `design-shotgun`, `plan-design-review`, `plan-eng-review`, `autoplan`, `spec`, `document-generate` | `design-consultation` (direction), `design-review` (review), `plan-*-review` (plan review) | conversational/documents output; no fixed file skeleton |
| superpowers | `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `test-driven-development`, `verification-before-completion` | `brainstorming` → `writing-plans` | plan document + execution discipline |
| spec-kit / speckit | project `.specify/` (`memory/constitution.md`, `templates/`); registered `/speckit.*` commands | `/speckit.specify` → `/speckit.clarify` → `/speckit.plan` → `/speckit.tasks` | `specs/NNN-feature/{spec,plan,tasks}.md` (+ `research.md`, `contracts/`, …) |

Record the matched paths in your reply (or the task's tracking comment) so the choice is auditable.

### 1.3 Precedence: P0–P3

Apply per question ("what to design first", "which documents", "which template and whether to ask"), never as one global switch. Higher levels are not overridden by lower ones for the matters they specify.

1. **P0 — the user's explicit instruction in this request** names an engine, playbook, or order → follow it exactly, and name the full path in your reply.
2. **P1 — project guidance**: loaded project `AGENTS.md`, project skills, `.sdlc/`, `.specify/`, `docs/templates/` → follow the project.
3. **P2 — an installed engine**: defer to its design entry, write products back into the Taco node files. With several engines installed and no project `design_engine` setting, take the first of pstack → gstack → superpowers → speckit and say which you took.
4. **P3 — nothing applies**: use Taco's built-in defaults (a compact derive of the pstack design steps: understand affected subsystems → compare designs → record decisions and plan), and never require the user to install anything first.

Missing-but-requested and absent-by-default are different outcomes and must never blur:

- A missing engine is never a blocker: when nothing is installed, just skip the process integration and run Taco's normal workflow — no error, no "template missing" noise, no stop. Taco never requires an SDD skill set.
- When the user explicitly named an engine or playbook that is not available, say so in one line and continue with Taco's normal workflow. Never claim you followed a tool that did not run, and never hold the review hostage to it.

### 1.4 Where the work lands (integration points)

- **`/architect with checkpoint`** — the preferred first integration. The engine compares designs and produces a rationale; the Taco node carries the recommended design, the key alternatives, the reasons, the accepted trade-offs, and the open questions that need a human. Humans review that; they do not re-read the engine's scratch work.
- **Multi-phase plan delivery** — before implementation, pack the engine's plan (dependencies, change scope, expected behavior, verification requirements) into the plan node for scope review. Keep the engine's own format and its check script; human edits in Taco are written back to the same plan file, not to a parallel display copy.
- **Delivery evidence** (`show-me-your-work` style decision logs) — index the evidence (PRs, screenshots, test results, decision records) in a delivery node. Taco presents verification results; actual verification is still performed by the engine and its tools. A rendered document is never proof that a feature works.
- **Prototype** — keep fast, disposable exploration in the engine's own loop (and its prototype host). Bring the settled decision, the chosen variant, and its evidence into Taco. Not every sketch becomes a review document.

### 1.5 Semantics that must stay aligned

- **Handoff means "feedback came back"** — not "the next phase is authorized". Read the returned feedback and classify it: requirement correction → revise the design; "justify this trade-off" → investigate and add evidence; explicit "approved, start implementing" → enter implementation within the stated scope. Plain edits and comments alone are never an approval.
- **Taco Checkpoints are progress labels, not gates.** `freeze` is a status tag, not a lock or sign-off; `frontier` suggests the next work, it does not enforce it; `complete` never means "implementation verified". Continuing work is decided by explicit user instruction and project convention, never inferred from a status value.
- **Comment threads are resolved by humans.** Never mark a thread resolved because nearby content changed.
- **Parallel exploration converges through one owner.** Sub-agents produce candidates (code, analysis, alternatives) in their own scope; the lead agent alone edits the canonical documents, assembles/refreshes the Taco, receives feedback, and checks for conflicts before writing back (compare against the reviewed baseline; on unresolved direct edits, keep the reviewed file unchanged and report). Refreshing preserves `docId`, `comments`, `navigation`, `checkpoints`, and every stored field.

### 1.6 Recipe: the architect-with-checkpoint loop

```text
1. pstack (or another engine) investigates and designs   → candidate design + rationale
2. Lead agent writes it into the Taco's design node       → .taco.html (same file every round)
3. Human reviews in the browser                           → text edits + comments + Handoff
4. Lead agent imports, resolves conflicts, revises        → canonical docs + refreshed Taco
5. Repeat 3–4 until the human explicitly says "implement"
6. Engine implements and verifies                        → delivery evidence indexed in the Taco
```

## 2. Artifact-generating skills (generic paradigm)

Examples: `answer-me-with-html` (dense single-page HTML), Mermaid/diagram skills, infographic and image skills. These produce **files**, not process. Taco does not care which skill produced a file; it cares that the file is canonical-directory content, self-contained, and reviewable.

### 2.1 Carrier matrix

| Content | Carrier | Packed as |
| --- | --- | --- |
| Narrative, decisions, acceptance criteria | Markdown (`.md`) | `text/markdown`, editable |
| Flow/sequence/state diagrams from text | Mermaid (`.mmd`, or a fenced block) | `text/plain`, editable + preview |
| High-density one-pager: comparison cards, timeline, report page | **Single-page HTML** (`.html`) | `text/html`, read-only embedded page |
| Bitmap artwork, screenshots | PNG (`.png`) | `image/png` data URI |

### 2.2 Rules

1. **Use the local skill, not a hand-rolled imitation.** When a generator skill is installed (`answer-me-with-html`, a Mermaid/diagram skill, an image skill), invoke that skill to produce the artifact. Hand-write only when nothing suitable is installed or the user says otherwise (P0–P3 from §1.3 applies to this choice too).
2. **Products land in the canonical directory** next to the documents that reference them (`report.html`, `diagrams/flow.mmd`, `assets/…png`), then go into `files[]` through the normal assembly. Link them from prose with relative paths — the same links that work in the repository. Never keep the only copy in a scratch directory.
3. **Artifacts are derived; Markdown stays canonical.** State what generated each artifact and from what. When the source changes, regenerate the artifact and refresh the same Taco (preserving review state); never hand-edit a generated file to fake an update.
4. **Self-contained or nothing.** Embedded HTML pages render inside a sandbox whose CSP blocks all external network access: inline scripts and styles run, `data:`/`blob:` images and media load, external scripts, fonts, images, and requests do not. Generate self-contained pages (inlined CSS/JS/assets). A page that depends on a CDN renders without those resources — regenerate it self-contained instead of relaxing the sandbox.
5. **No escape from the document folder.** Image references and links must resolve inside `root/`; a page or Markdown document pointing outside the bundle is a validation finding, not a feature.

### 2.3 What Taco guarantees for an embedded HTML page

- The page renders inline as a single document — no jump to a local file, no second window needed to read it.
- `sandbox` without `allow-same-origin`: scripts run in an isolated origin that cannot read the Taco document, comments, storage, or cookies. No top-level navigation; links the reader clicks open as new tabs.
- Read-only: the page is not editable, carries no text-selection comment anchors, and never appears in Handoff diffs. Review comments about the page live in the Markdown that references it (or in a comment thread on that Markdown), and the page is regenerated from its source when content changes.
- Search and validation treat it as text. Container files (`*.taco.html`) are still rejected as bundle entries.

## 3. Conflict rules (both families)

- If the user names an engine or generator skill and it is missing: say so in one line and continue without that integration. The review never stops for a missing optional skill, and the named tool is never pretended to have run.
- If project guidance and an installed engine disagree: project guidance (P1) wins; say so and cite the file.
- If a generated artifact conflicts with canonical content (prose says A, page shows B): fix the source and regenerate; never edit the artifact to match the prose by hand, and never present contradictory facts to the reviewer.
