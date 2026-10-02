---
name: taco
description: Use when the user asks to create or refresh a .taco.html, make a Taco, prepare technical documents for review, or handle Taco edits and comments. Works in ordinary documentation directories and Spec Kit projects without installing a CLI.
---

# Taco: human-agent document review in one file

Taco turns a Markdown documentation directory into one portable `.taco.html`. A human opens it in a browser, reads and edits the original Markdown, and leaves anchored comments. You then consume those edits and comments and apply them to the canonical files.

```text
canonical doc directory → one .taco.html → human review (browser) → agent reads Handoff → canonical doc directory
```

Nothing to install. A `.taco.html` is plain HTML with one plaintext JSON data block, and **you write that block yourself**: `references/bundle-format.md` is the write contract (fields, escaping, atomic replace, shape rules) and `references/output-path.md` decides where the file goes. No script, CLI, or installed runtime is part of this workflow: the host's own file and JSON facilities are enough (a host that cannot parse JSON must stop with `unverifiable`). An optional `scripts/pack.mjs` helper can assemble a block, verify a file, or print the structure a reviewer will see, but nothing here depends on it, and it never chooses the destination — you resolve that and pass `--out`. `taco-cli` is the optional CLI for hosted Tacobin publishing, event streaming, and handoff retrieval, and the `taco` binary in a Taco checkout is the optional Spec Kit extension CLI.

## When to use

- Any directory of Markdown (plus JSON/YAML/PNG) that needs human review: system design, RFC, ADR, data model, API reference, or a plain spec.
- No project scaffolding is required. Taco works in any repository or sandbox on a plain directory.
- Spec Kit projects: if the project already has the Taco Spec Kit extension installed (`.specify/extensions/taco/` and the `taco-speckit` skill), use that flow. Otherwise this skill handles a Spec Kit feature directory exactly the same way — installing the extension is an optional deeper integration, never a requirement.

### Optional document and Checkpoint examples

This skill bundles optional document examples in `templates/` next to this `SKILL.md`: `spec/`, `architecture/`, `api-reference/`, and `adr/`. (A Taco source checkout carries the same packs at `extensions/taco/templates/`; an installed Spec Kit extension exposes them at `.specify/extensions/taco/templates/`.) First use the user's instructions and the project's own Checkpoint convention (see *Project Checkpoint convention* below), if present. Read a bundled pack's `README.md` and `template.md` only when it is useful as a starting reference; its fields, files, and Checkpoint graph are not required structure.

Decide whether to use Checkpoints from the review contract, not the task label or document count. Use them when the team needs named review milestones, dependencies, or explicit status tracking; follow any project-specific Checkpoint policy or reviewer request. Otherwise omit `checkpoints` and use Taco's ordinary document review. For comparison, a small copy edit or straightforward bug fix often needs no Checkpoint, while a `spec.md` → `plan.md` → `tasks.md` review can draw on the bundled `spec/` **SDD example**. Neither shape is mandatory: a small change may require client sign-off, and a complex change may use a different project-defined graph. If adapting an example, update every `checkpoints.nodes[].documents[].path` to the new root; never import sample status records as real review progress.

Never transplant a pack's `bundle.json` structure into a directory that does not contain its paths. A copied Checkpoint graph or `navigation` manifest renders empty groups and `Not created` placeholder rows — a document that looks broken instead of simple. The packs supply prose to adapt (`template.md`); their `bundle.json` is a working example of *those* files, not a layout to impose.

### Project Checkpoint convention

Before creating a new requirement Taco, find and follow the project's Checkpoint convention; read *Project Checkpoint convention* in `references/checkpoints.md` first. Precedence: the user's instruction in this request; an installed Spec Kit extension; `.taco/` (`.taco/README.md`'s first line records adoption; each `.taco/*.taco.html` is an empty Taco holding only `checkpoints`); other project conventions (`AGENTS.md`, `CONTRIBUTING`, PR template, `specs/` layout; cite file and line); then this skill's examples.

- Use the `.taco/` nearest the working directory and give its path in your reply. Use a template there only if the README's first line is exactly `Checkpoint 模板：采用（YYYY-MM-DD）` or there is no README (say it is missing), its bundle `root` is `feature`, and it passes the reference's *Validate* step (script or, without `scripts/`, every listed rule by hand). Otherwise — another first line, a missing or invalid template, another `root` — say so in your reply; never use, repair, or normalize it.
- An adopted template is an option, not an obligation: triage each request to one template or none, and state the choice and the reason; small changes usually get none. When one template's stated scope fits, use it without asking. To use one, copy only its `checkpoints.nodes`, map its `feature/` paths to this request's `root`, and start from a fresh `docId` and `documents: []`.
- With no convention and no record, suggest a template once, and only when this request's review needs call for staged review or sign-off by different roles — never because of document count. Record the answer in `.taco/README.md`; once recorded, never ask about adoption again.
- Write `.taco/` only to record the user's answer to that suggestion, or when the user asks to refine the process.

### Check for updates once per work session

Before the first Taco action of a work session (packing, refreshing, or consuming a review), check whether a newer published version exists. Run it from this skill directory (a minimal install that omits `scripts/**` or `VERSION` has no check to run — skip it silently):

```sh
node scripts/check-update.mjs --json
```

It reads the installed version from this skill directory's `VERSION`, resolves the newest published tag over `git ls-remote` (falling back to the GitHub tags API through Node's built-in `fetch` when `git` is unavailable), and reports any newer `taco` skill, `taco-cli` (only when that CLI is installed here), or Taco Spec Kit extension (only when this project has one installed, and only when a newer release actually ships a `taco-extension-*.zip`). It makes no other network request, never reads your documents, never sends local paths or credentials, and keeps at most a 15-minute version cache in your user cache directory.

Contract:

- Check once per work session, not once per command, and not in a loop.
- Report nothing unless a component's `updateAvailable` is `true` and `ok` is `true`. `ok: false` (offline, no marker, rate limit, any failure) means silence — say nothing about updates and do not retry or block.
- Never install or upgrade anything on your own: no `npm install -g`, no `npx skills update`, no re-copying files. The check only reports.
- Keep the raw output to yourself: the user sees at most one sentence, at the end of the final reply, using the wording in `references/update-notice.md`.
- The script runs `taco-cli --version` on this machine when that CLI exists (the only program it starts). Disable the whole check with `TACO_UPDATE_CHECK=off`, or just the CLI probe with `--no-cli`.

### Optional hosted review

Local assembly and Handoff never require `taco-cli` or a Host. When explicitly publishing a Taco to a Host, read `references/publishing.md` first; when consuming hosted review events, read `references/reviewing.md` first. Both references are part of this same skill, not a second CLI-only guide. A hosted publication is public by default; inspect the payload and credential boundary with `--dry-run` before sending it. Publishing establishes an immutable baseline; public visitors can edit and comment under self-reported names with real-time autosave. Comments and autosaves do not wake the agent session or signal review completion: only an explicit human **Handoff** emits `review.handed_off`. Clicking Handoff checks for active agent listeners; if none are connected, the Host blocks handoff without emitting an event and prompts with install instructions for the Taco skill and taco-cli plus `taco-cli subscribe`. The agent subscribes or replays events via `taco-cli`, retrieves the immutable handoff snapshot, verifies it against canonical files for conflicts, and applies changes.

### Choosing the right artifact for design content

Choose the smallest useful carrier for each kind of information; keep full machine-readable definitions in one authoritative file.

- Narrative, constraints, decisions, acceptance criteria, and indexes stay in the main Markdown (`spec.md`, `plan.md`, ADR prose).
- Cross-component interactions, flows, sequences, and state machines that need standalone reading or reuse go in a sibling `diagrams/*.mmd` (Mermaid source), linked from the prose. Small in-place illustrations may stay embedded.
- HTTP APIs live in `contracts/openapi.yaml` (or `.json`) as the single authoritative definition. Markdown explains usage scenarios, semantic constraints, and trade-offs — never restate the full endpoint table in a second place.
- Data structures: `data-model.md` for entity relationships, invariants, and lifecycle; JSON Schema (or the target protocol's native format) when machine validation is needed. Distinguish conceptual model, transport schema, and database structure.
- WebSocket/event protocols use message schemas plus sequence/state diagrams and short semantic notes — do not force them into OpenAPI.

Rules:

- Link with relative paths; keep one authoritative definition per contract and update the definition plus its references, never parallel copies.
- Every standalone file must be real, parseable content — never a placeholder created to look structured. Verify: diagrams render, OpenAPI fields match prose, schemas validate.
- Do not fragment small tasks: pure copy edits or local rule changes keep a single Markdown file. Splitting is for genuinely complex designs, not template filling.

Two shapes:

```text
complex feature "001-search"
  spec.md                 goals, scenarios, constraints, acceptance criteria
  diagrams/flow.mmd       Mermaid flow/sequence/state source, linked from spec.md
  contracts/openapi.yaml  the single authoritative HTTP definition
  data-model.md           entities, invariants, lifecycle

small task "fix-pagination-copy"
  spec.md                 the only file; no diagrams/, contracts/, or data-model.md
```

## Locate the shell

A `.taco.html` = fixed shell (runtime viewer/editor) + one JSON data block. Choose by the **recipient's opening environment**: the larger Complete shell is the default when the recipient may be offline; the smaller Lite shell is for reliable network access. Lite loads pinned public CDN editor/highlighter/Mermaid libraries for file types in the bundle. If its rich editor cannot load, writable Markdown remains editable in plain-text source mode, including comments, saving, and Handoff. Do not select Lite merely because the Agent currently has network access. Never silently replace an existing Complete Taco with Lite on refresh; preserve the existing shell variant unless the user explicitly chooses a different one.

Find the selected variant in the first location that exists:

1. This skill's own `taco-shell.html` (Complete) or `taco-shell-lite.html` (Lite), next to this `SKILL.md`
2. A template pack's `empty.taco.html` (Complete)
3. `.specify/extensions/taco/assets/taco-shell.html` or `taco-shell-lite.html` (Spec Kit extension installation)
4. A locally cloned Taco checkout: `<taco-repo>/extensions/taco/assets/taco-shell.html` or `taco-shell-lite.html`
5. If none exists for the selected variant, ask the user where that shell lives; never substitute a different variant unnoticed.

Both skill shells have an empty `#taco-document` block. Fill it before opening; an unfilled shell shows the runtime's empty-bundle recovery screen, not a document. Template and checkout fallbacks may contain starter data: use their runtime, not their identity or content. Only write the data block and `<title>`.

## The bundle format (`taco/files` v1)

The document lives in one plaintext block near the top of the shell:

```html
<script type="application/taco+json" id="taco-document">
  { "format": "taco/files", "version": 1, ... }
</script>
```

The runtime's `parseBundle` validates this; anything corrupt puts the file into Recovery mode, so validate before you write. Read `references/bundle-format.md` before writing or debugging the block: it is the authority for required and optional fields, the exact rejection rules, and the serialization contract. An optional `scripts/pack.mjs` helper implements that contract when you have Node and would rather use it.

Bundle fields:

- `format`: `"taco/files"`; `version`: `1`
- `docId`: stable identity. Preserve it when refreshing an existing Taco; for a brand-new document mint a **unique** id (`crypto.randomUUID()`, not the directory slug — same-named directories and copies would collide).
- `title`: document title. The runtime normalizes it to the persisted `.taco.html` filename stem, so name the file after the title.
- `root`: the directory the bundle covers, as a safe relative POSIX path (no leading `/`, no `\`, no empty, `.`, or `..` segments). Every `path` must sit under `root/`.
- `files`: `{ id?, title?, path, mediaType, content, sourceHash?, blocks? }[]`, `path` safe, unique, and starting with `root/`. Ordinary `.html` and `.htm` source entries and the legacy `sourceUrl` field are unsupported.
- `comments`, `navigation`, `checkpoints`, `access`, `collab`, `packOptions`, and any other field: carry over from the previous bundle when present.
- Sidebar groups are **derived at load**, not stored: `checkpoints` first, then `navigation`, then first-level directory names, with every file directly under `root/` landing in `Unassigned`. Omitting `navigation` and `checkpoints` does **not** produce a flat file list, so predict the groups and state them instead of letting the reviewer discover them.

### Checkpoints and document status

When creating, modifying, inspecting, or reporting a Checkpoint graph or its document statuses, read `references/checkpoints.md` before acting. The main workflow below still applies: preserve an existing graph and status table across refreshes; omit `checkpoints` when the review contract does not call for them.

**Authoring with instructions**: When a Checkpoint document defines an `instruction` string, an Agent assigned to author, expand, or review that document **MUST read and follow its instruction** as authoritative task constraints (e.g. required sections, dependencies, or formatting rules). Checkpoint instructions can be read directly from `checkpoints.nodes[].documents[].instruction`, via `window.taco.getCheckpoints()`, or in the right panel's `Instruction` tab.

### File media types

`mediaType` by carrier:

| File                 | `mediaType`        | Notes                                                             |
| -------------------- | ------------------ | ----------------------------------------------------------------- |
| `.md`                | `text/markdown`    | editable document                                                 |
| `.json`              | `application/json` | editable syntax-highlighted source                                |
| `.yaml` / `.yml`     | `application/yaml` | editable syntax-highlighted source                                |
| `diagrams/*.mmd`     | `text/plain`       | editable Mermaid source and diagram preview; routed by extension |
| `.png`               | `image/png`        | `content` is a `data:image/png;base64,…` URI                      |
| any other UTF-8 text | `text/plain`       | plain-text source; excludes `.html` and `.htm`                    |

Per-file fields:

- `id`: preserve the previous file's id — it is the stable key for comment anchors and block identity.
- `title`: optional in-file display title; if kept it must be a non-empty string and must not change the `path`.
- `sourceHash`: optional sha256 hex (64 chars) of the file bytes at pack time. Keep it when `content` is byte-identical; when `content` changes, recompute it only if the host can compute SHA-256, and otherwise drop the field — never leave a stale hash.
- `blocks`: optional runtime cache of per-block HTML. Keep it only when that file's `content` is byte-identical to the previous bundle's; drop it when the content changed and let the runtime rebuild it.

Comments:

- Preserve existing review threads and their history when refreshing; never fabricate or resolve them. Runtime normalization may change serialization, not their meaning.
- Each thread's `anchor.path` must reference a file present in `files`. If a commented source file disappeared, retain its previous bundle entry and report it; do not silently drop the file or its comments.

Writing rules:

- These rules are the write contract: follow them directly. An optional `scripts/pack.mjs` helper implements them when you have Node and would rather use it, and it doubles as the checklist when something fails to load.

- Serialize with `JSON.stringify(bundle, null, 2)`, then replace every `<` with `\u003c`. That one escape is what guarantees a literal `</script>` can never appear in the block. Escaping `>`, `&`, `\u2028`, `\u2029` is optional hardening, never a load requirement; when you do it, build the pattern with `String.fromCodePoint(0x2028)` / `(0x2029)` rather than a regex literal, which would break your script before it runs.
- Insert the JSON into the `#taco-document` block by matching it and passing a **callback** to `replace` — `html.replace(dataBlock, () => replacement)` — or by splicing at the block's index. A plain string replacement is unsafe: `$&`, `` $` ``, `$'`, and `$1` inside the JSON would be treated as replacement patterns. Update `<title>` the same way.
- `<title>` in the head must be `<bundle title> — Taco` (with `&`, `<`, `>` escaped).
- Validate before writing: `JSON.parse` the exact escaped string you will insert (it must round-trip), then check the shape rules above. Write the whole file to a temporary sibling and rename it over the destination, so a failure never truncates the existing Taco.
- Only the data block and `<title>` change. Everything else in the shell stays byte-identical.
- Keep bundled content self-contained: PNG assets as data URIs and no external document assets. Complete never fetches runtime dependencies; Lite fetches only its pinned public CDN libraries.

## Where to write `.taco.html`

Decide the destination **before** writing, and say which level applied. `references/output-path.md` is the authority; the cascade is:

- **L0** the user names the location in this request — a directory, or a `.taco.html` file whose filename stem is already the canonical form of the title (then that stem is the title);
- **L1** this run refreshes an existing `.taco.html` — keep its current path;
- **L2** the packaged directory *is the repository root* — `<repo>/tacos/`, skipping directory probing;
- **L3** the repository has `docs/`, `doc/`, `documents/`, or `specs/` — `tacos/` under the first one that exists;
- **L4** a repository without any of those — `<repo>/tacos/`;
- **L5** not inside a repository — `~/Documents/tacos/`.

Rules that come with it:

- The directory name is lowercase `tacos`; the filename stem is the normalized title (NFKC, non-alphanumerics except `_`/`-` become `_`, empty falls back to `Untitled`).
- Find the repository by walking up to a `.git` directory or a `gitdir:` `.git` file — not with the `git` command. `git` is only used for the optional ignore check.
- Refuse targets inside the skill, extension, template, `node_modules`, or `.git` directories, and refuse to write through a symlink.
- Exclude hidden paths and every `*.taco.html` from the packaged set (built-in), and carry `packOptions.ignore` over unchanged.
- Never copy the shell over an existing Taco: read the target into memory, build and check the new block, then replace the file through a temporary sibling and `rename`.
- Report the level, its basis, the absolute path, filename, title, the verification level (V1/V2), warnings, and the exclusions.
- When the Spec Kit extension is installed, the extension's own convention decides the path; report "basis: extension convention" and run no conflict check against this cascade.

## Workflow

### 0. Shape the review: decide what the human will see

Decide and state the presentation before writing anything. This is where an unexpected sidebar gets caught.

- Group from the review contract and the directory itself, never from a template's names. A directory of research notes must not grow `spec` / `plan` / `tasks`; declare Checkpoints or `navigation` groups only for documents that exist, that the user explicitly scheduled, or that a `.taco/` template chosen for this request declares.
- Work out the resulting sidebar: which file lands in which group, what falls under `Unassigned`, and which document opens first. The derivation rules live in `references/bundle-format.md`; where Node is available, the optional `scripts/pack.mjs --dry-run` prints the exact result for the real directory.
- Keep the structure proportional to the directory. One flat Markdown document stays one file; do not add folders, files, or groups to look organized.

### 1. Author the bundle and write it into the shell

You are authoring one document model — the bundle. A directory of Markdown is one input that fills `files[]`; so is a Handoff, so is an existing Taco. The shell is only the carrier, and the block is yours to write: read the shell into memory, build and escape the block, parse the exact string you are about to insert, then replace the file atomically. `references/bundle-format.md` is the authority for that contract; `references/output-path.md` decides where the file goes.

1. If a `.taco.html` already exists at the destination, **read its bundle and shell variant first** — before you copy or overwrite anything, or you will read your own fresh copy instead of the reviewed document. Preserve Complete/Lite on refresh unless the user explicitly requested conversion.
2. Build the block yourself, in this order (authority: `references/bundle-format.md`):

   - enumerate the directory: UTF-8 regular files plus validated PNGs; exclude hidden paths and every `*.taco.html`, and report the exclusions;
   - keep `docId`, `comments`, `checkpoints`, `navigation`, `packOptions`, unknown fields, and each file's `id`; keep `blocks` only while that file's content is byte-identical;
   - serialize with `JSON.stringify(bundle, null, 2)` and escape every `<` as `\u003c`;
   - `JSON.parse` the exact escaped string you will insert — it must round-trip — then check the shape: required fields, `root` consistent with every `path`, paths unique and safe;
   - insert it into `#taco-document` and set `<title>` with a callback `replace` or by splicing — never a plain string replacement, where `$&`, `` $` ``, `$'`, and `$1` in the JSON would be treated as replacement patterns;
   - write a temporary sibling, then `rename` it over the destination, so a failure leaves the previous Taco untouched.

   If you have Node and would rather not do this by hand, the optional `scripts/pack.mjs` helper performs these steps. **It does not resolve the destination** — resolve it first (see `## Where to write .taco.html`) and pass the result explicitly, because the helper's default `--out` is inside the directory being packaged: `node scripts/pack.mjs --dir <DOC_DIR> --title "<Title>" --out <resolved absolute destination> [--shell <shell.html>] [--root <relpath>] [--entry <relpath>] [--group "<Title>=<relPath,relPath>"]... [--ignore <glob>]... [--dry-run]`. `node scripts/pack.mjs verify <name.taco.html>` prints the structure a reviewer will see. Report its `excluded:` list unless you closed the loop yourself.
3. Start from the skill's shell (or, on a refresh, the existing Taco) held in memory: only the `#taco-document` block and the escaped `<title>` may change, and every other byte stays identical.
4. For a new document, set `format: "taco/files"`, `version: 1`, a fresh unique `docId`, `title`, `root` and `files`. Choose the Checkpoint definition from the user's or project's review requirements, if any; otherwise omit `checkpoints`, even if a starter pack contains one. The bundled `spec/` SDD graph is an example to adapt only if it fits; its stage names, document paths, and display template are not defaults that override project conventions. For a refresh, preserve the previous bundle wholesale—including `checkpoints.nodes`, `checkpoints.documents`, and any unknown fields—and replace only intended fields; keep `root`, format/version and identity unchanged. Stop on an unsupported format/version rather than downgrading it. Match existing file entries by path, preserve unknown fields and stable ids, and update content-dependent fields using the rules above.

### 2. Check what the reviewer will see

- Verification has two levels (`references/output-path.md` §7). **V1**: with a review tab open, run `window.taco.validate()` in its console — it checks what the renderer actually did (comment anchors, cross-document links, navigation and Checkpoint paths, unmigrated blocks) and must return `ok: true` with no error. **V2**: no browser available — parse the block you wrote and check the shape rules, then state plainly that you did not verify rendering. Never present V2 as V1, and never write at all when you cannot parse the string (report `unverifiable`). Where Node is available, the optional `scripts/pack.mjs verify <name.taco.html>` prints the structure a reviewer will see; it is a convenience, not a required step.
- Compare the reported structure with the shape you decided in step 0: entry document, each group with its files, what sits under `Unassigned`, and open/resolved comment threads.
- Fix a mismatch, or state it plainly, before handing the file over. A warning you shipped silently is a surprise the reviewer finds instead. Report the verification level you reached and every `warning`/`error` finding it produced.
- A Checkpoint document shown as `not created` is expected only when you deliberately scheduled work that does not exist yet, including documents a `.taco/` template chosen for this request declares. Otherwise the structure was transplanted from a template: remove it.
- Validate every diagram before you ship it. `node scripts/lint-mermaid.mjs <file.mmd|file.md>...` (or `--dir <docDir>`) parses each `.mmd` file and every ```` ```mermaid ```` fence with the same Mermaid build the Complete shell embeds, so a pass here means it parses in the file the reviewer opens. Exit code `0` = all parsed, `1` = diagnostics (each with kind, `line:column` and the raw parser text), `2` = the check could not run at all — `2` is never a pass. A diagram that fails here would otherwise reach the reviewer as one generic browser error.
- Confirm the artifact loads: the data block must parse and satisfy the shape rules. A Recovery-mode file is a failed hand-off, not a preview.

### 3. Present and open it for the human

- Always present the exact absolute path through the Agent GUI's native clickable local-file surface.
- **When the host's browser tool supports and permits local `file://` navigation, proactively open the generated file yourself and verify the expected title and document content are visible — do not ask permission first.** The file path is often hard to find; auto-opening is the default, not an extra step. This means the user's real browser: a headless or automation boot check is internal evidence only, **never** a user-visible presentation, and must not be reported as opened.
- If browser tools are unavailable, navigation is prohibited (e.g. Codex does not autonomously navigate to `file://`), or opening fails, keep the clickable-file handoff and say so explicitly. Never claim "opened and verified" unless you observed the content yourself; never bypass restrictions with `data:`/Blob URLs, a development server, or external uploads.
- If an existing review may hold unsaved edits, open a fresh tab rather than reloading the reviewed tab.
- For local/offline Taco, Handoff and `window.taco.getReviewHandoff()` include unsaved in-memory edits; only the saved-file channel requires saving. For a Tacobin-hosted Taco, the main Handoff button waits for pending autosave and submits only saved edits and comments; failed or conflicting autosaves must be resolved first. Keep an Agent listener subscribed: without one, Handoff displays installation and subscription commands instead of recording an event. The Save button writes a local Taco copy independently of Host autosave. Hosted comments and autosaves alone do not signal review completion or wake the agent session.

### 4. Consume review: apply human edits and comments

The reviewer's changes reach you through one of these channels — do not require more than the one that arrives:

- **Local Handoff (primary)**: clicking Handoff copies **Markdown prose** to the clipboard — an intro line, the document title, an optional local path, a modifications section with one fenced `diff` block per changed file, and a comments section listing open threads (headings follow the reviewer's UI language). Treat that pasted Markdown as the review input. The "Handoff (w/o data)" variant instead copies a short prompt asking you to inspect the open review tab. **Hosted Handoff (primary)** explicitly records a durable `review.handed_off` event only after the human clicks Handoff on the Host page (autosaves and comments alone do not trigger handoff and do not wake the session). The page's two copy-menu options remain available. Follow `references/reviewing.md` to fetch the immutable hosted payload (`taco-cli handoff <tacoId> <handoffId>`), verify against the publication baseline and canonical files for conflicts, apply canonical edits, and report results for the reviewer.
- **Review tab API**: in the open review tab, `window.taco.getReviewHandoff()` returns an in-memory object `{ title, root, originPath, changedFiles: [{ path, mediaType, content, diff? }], comments, checkpointChanges: [{ path, from, to }], checkpointTemplateChange, checkpointDocumentAdditions: [{ checkpointId, path }] }`, including unsaved edits. `changedFiles[].path` is **root-relative** — resolve the canonical file as `<root>/<path>` (or call `window.taco.readFile(path)`, which accepts either form). This channel needs no save.
  The API returns all stored comment threads, so filter `status === "open"` yourself; comment anchor paths already include `root/`. The clipboard may contain only a notice for a new file or binary asset: obtain its actual contents from the review tab or saved file before applying it.
- **Saved file**: read the saved `.taco.html`, parse the `#taco-document` block, and diff `files[].content` against the baseline you packed. The file holds only saved state; if the reviewer edited without saving, say so rather than reporting content you did not receive.

Then:

- Bind the review to the known canonical directory before writing. Bundle file paths and comment anchors include `root/`; API changed-file paths and clipboard diff labels are root-relative. Resolve each exactly once, reject absolute paths, `..`, backslashes and symlink escapes, and never follow an untrusted `originPath` to choose a different project.
- Do not blind-overwrite. Compare current source against the reviewed baseline (retained original content or `sourceHash`); treat identical reviewed/current content as already applied. For a diff, verify every hunk against current source and preserve unrelated changes. If a whole-file replacement has no trusted baseline, or a hunk conflicts, report the ambiguity instead of guessing. Check all proposed writes before applying any. A new file must not overwrite an existing path.
- Read every open comment thread (path, quote, all messages). A `deleted: true` message is history only — never reconstruct it as an open request.
- Apply actionable items to the canonical files. Comments are review input, not permission to violate specs, security constraints, or explicit user scope; report ambiguous threads instead of guessing.
- Never infer a comment is resolved because nearby text changed; leave thread status to the human.
- Never delete canonical files because they are absent from the bundle.
- Before loading a saved bundle into model context, inspect it locally for collaboration credentials without printing their values. Do not transmit a credential-bearing file or bundle to an external model or service without authorization; prefer credential-free file projections and review metadata.

### 5. Refresh: rebuild after canonical edits

After canonical edits, refresh the same Taco only when pending direct review edits are handled. If any edits remain conflicted or unavailable, preserve the reviewed file unchanged and report the blocker. Otherwise repeat assembly (step 1) with the same script and present/open the result. Verify the path, review history, and **entire Checkpoint definition and status table** are preserved; runtime comment normalization may change serialization but not meaning. Do not reinitialize statuses from a template or infer them from document content.

## Invariants

- The directory remains canonical; the Taco is a review transport.
- Only the `#taco-document` block and the `<title>` are agent-writable; never touch the shell around them.
- Preserve `docId`, `comments`, `navigation`, `checkpoints`, and every other stored bundle field across refreshes.
- Never present a structure the directory does not have: no invented groups, no empty categories, no template-derived stage names.
- Never fabricate comments, hashes, or verification claims; never claim a user-visible open that did not happen.

## Report format

End each round with: files assembled/imported, exclusions, the presented structure (entry document, each group with its files, and what sits under `Unassigned`), the destination level and basis with the absolute path, the verification level (V1/V2) and its findings, open comments handled/deferred by thread ID, files changed while handling comments, refreshed Taco path, and presentation status (`presented as a clickable file` / `opened (user-visible)` / `opened and verified (user-visible)`; report a headless boot check separately as evidence, not as opening).

If the session's update check found an available update (`updateAvailable === true`), close the final reply with exactly one sentence from `references/update-notice.md`, in the conversation's language. Say nothing when there is no update, when the check could not run, or when this skill directory has no `scripts/check-update.mjs` (a minimal install may omit `scripts/**` and `VERSION`).
