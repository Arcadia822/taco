---
name: taco
description: Use when the user asks to create or refresh a .taco.html, make a Taco, prepare technical documents for review, or handle Taco edits and comments. Works in ordinary documentation directories and Spec Kit projects without installing a CLI.
---

# Taco: human-agent document review in one file

Taco turns a Markdown documentation directory into one portable `.taco.html`. A human opens it in a browser, reads and edits the original Markdown, and leaves anchored comments. You then consume those edits and comments and apply them to the canonical files.

```text
canonical doc directory → one .taco.html → human review (browser) → agent reads Handoff → canonical doc directory
```

Nothing to install. A `.taco.html` is plain HTML with one plaintext JSON data block, and this skill ships the assembler so you never hand-write the serialization: `scripts/pack.mjs` builds, validates, escapes, and writes the block, and `scripts/pack.mjs verify` shows the structure a reviewer will see. No CLI is part of this local workflow — `taco-cli` is the optional cloud binary for publishing and hosted events, and the `taco` binary in a Taco checkout is the optional Spec Kit extension CLI. If Node is unavailable, fall back to the manual write contract in `references/bundle-format.md`.

## When to use

- Any directory of Markdown (plus JSON/YAML/PNG) that needs human review: system design, RFC, ADR, data model, API reference, or a plain spec.
- No project scaffolding is required. Taco works in any repository or sandbox on a plain directory.
- Spec Kit projects: if the project already has the Taco Spec Kit extension installed (`.specify/extensions/taco/` and the `taco-speckit` skill), use that flow. Otherwise this skill handles a Spec Kit feature directory exactly the same way — installing the extension is an optional deeper integration, never a requirement.

### Optional document and Checkpoint examples

This skill bundles optional document examples in `templates/` next to this `SKILL.md`: `spec/`, `architecture/`, `api-reference/`, and `adr/`. (A Taco source checkout carries the same packs at `extensions/taco/templates/`; an installed Spec Kit extension exposes them at `.specify/extensions/taco/templates/`.) First use the user's instructions and project-owned templates or review policy, if present. Read a bundled pack's `README.md` and `template.md` only when it is useful as a starting reference; its fields, files, and Checkpoint graph are not required structure.

Decide whether to use Checkpoints from the review contract, not the task label or document count. Use them when the team needs named review milestones, dependencies, or explicit status tracking; follow any project-specific Checkpoint policy or reviewer request. Otherwise omit `checkpoints` and use Taco's ordinary document review. For comparison, a small copy edit or straightforward bug fix often needs no Checkpoint, while a `spec.md` → `plan.md` → `tasks.md` review can draw on the bundled `spec/` **SDD example**. Neither shape is mandatory: a small change may require client sign-off, and a complex change may use a different project-defined graph. If adapting an example, update every `checkpoints.nodes[].documents[].path` to the new root; never import sample status records as real review progress.

Never transplant a pack's `bundle.json` structure into a directory that does not contain its paths. A copied Checkpoint graph or `navigation` manifest renders empty groups and `Not created` placeholder rows — a document that looks broken instead of simple. The packs supply prose to adapt (`template.md`); their `bundle.json` is a working example of *those* files, not a layout to impose.

### Optional hosted review

Local assembly and Handoff never require `taco-cli` or a Host. When explicitly publishing a Taco to a remote Host, read `references/publishing.md` first; when consuming hosted review events, read `references/reviewing.md` first. Both references are part of this same skill, not a second CLI-only guide. A hosted publication is public by default; inspect the payload and credential boundary before sending it.

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

The runtime's `parseBundle` validates this; anything corrupt puts the file into Recovery mode, so validate before you write. Read `references/bundle-format.md` before hand-writing or debugging the block: it is the authority for required and optional fields, the exact rejection rules, and the serialization contract. `scripts/pack.mjs` implements that contract; prefer it to a hand-built block.

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
- `sourceHash`: optional sha256 hex (64 chars) of the file bytes at pack time; recompute it whenever `content` changes.
- `blocks`: optional runtime cache of per-block HTML. Keep it only when that file's `content` is byte-identical to the previous bundle's; drop it when the content changed and let the runtime rebuild it.

Comments:

- Preserve existing review threads and their history when refreshing; never fabricate or resolve them. Runtime normalization may change serialization, not their meaning.
- Each thread's `anchor.path` must reference a file present in `files`. If a commented source file disappeared, retain its previous bundle entry and report it; do not silently drop the file or its comments.

Writing rules:

- Prefer `scripts/pack.mjs`; it performs every rule in this list. These rules are the fallback when Node is unavailable and the checklist when something fails to load.

- Serialize with `JSON.stringify(bundle, null, 2)`, then replace every `<` with `\u003c`. That one escape is what guarantees a literal `</script>` can never appear in the block. Escaping `>`, `&`, `\u2028`, `\u2029` is optional hardening, never a load requirement; when you do it, build the pattern with `String.fromCodePoint(0x2028)` / `(0x2029)` rather than a regex literal, which would break your script before it runs.
- Insert the JSON into the `#taco-document` block by matching it and passing a **callback** to `replace` — `html.replace(dataBlock, () => replacement)` — or by splicing at the block's index. A plain string replacement is unsafe: `$&`, `` $` ``, `$'`, and `$1` inside the JSON would be treated as replacement patterns. Update `<title>` the same way.
- `<title>` in the head must be `<bundle title> — Taco` (with `&`, `<`, `>` escaped).
- Validate before writing: `JSON.parse` the exact escaped string you will insert (it must round-trip), then check the shape rules above. Write the whole file to a temporary sibling and rename it over the destination, so a failure never truncates the existing Taco.
- Only the data block and `<title>` change. Everything else in the shell stays byte-identical.
- Keep bundled content self-contained: PNG assets as data URIs and no external document assets. Complete never fetches runtime dependencies; Lite fetches only its pinned public CDN libraries.

## Workflow

### 0. Shape the review: decide what the human will see

Decide and state the presentation before writing anything. This is where an unexpected sidebar gets caught.

- Group from the review contract and the directory itself, never from a template's names. A directory of research notes must not grow `spec` / `plan` / `tasks`; declare Checkpoints or `navigation` groups only for documents that exist or that the user explicitly scheduled.
- Work out the resulting sidebar: which file lands in which group, what falls under `Unassigned`, and which document opens first. The derivation rules live in `references/bundle-format.md`; `scripts/pack.mjs --dry-run` prints the exact result for the real directory.
- Keep the structure proportional to the directory. One flat Markdown document stays one file; do not add folders, files, or groups to look organized.

### 1. Author the bundle and write it into the shell

You are authoring one document model — the bundle. A directory of Markdown is one input that fills `files[]`; so is a Handoff, so is an existing Taco. The shell is only the carrier: escaping, inserting, and writing it atomically belong to `scripts/pack.mjs`, never to you.

1. If a `.taco.html` already exists at the destination, **read its bundle and shell variant first** — before you copy or overwrite anything, or you will read your own fresh copy instead of the reviewed document. Preserve Complete/Lite on refresh unless the user explicitly requested conversion.
2. Run the bundled assembler from the skill directory (it implements the contract in `references/bundle-format.md`):

   ```sh
   node scripts/pack.mjs --dir <DOC_DIR> --title "<Title>" \
     [--out <name.taco.html>] [--shell <shell.html>] [--root <relpath>] \
     [--entry <relpath>] [--group "<Title>=<relPath,relPath>"]... [--ignore <glob>]... [--dry-run]
   ```

   It enumerates the directory, preserves `docId`, `comments`, `checkpoints`, `navigation`, `packOptions` and every unknown field from an existing Taco, keeps each file's `id` and any still-valid `blocks`, rejects symlinks, non-UTF-8 bytes, invalid PNGs and `.html`/`.htm` sources instead of silently dropping them, escapes and validates the data block, and writes it atomically over `<name>.taco.html`. Report the `excluded:` list it prints; pass `--ignore` explicitly when an unsupported path is meant to be omitted.
3. Hand-build the block only when Node is unavailable: start from the minimal bundle skeleton in `references/bundle-format.md` and edit that model — do not reverse-engineer the field list from this page. Then follow the carrier rules there: read the shell into memory rather than copying it over the destination, serialize and escape, insert with a callback `replace`, `JSON.parse` the exact string you are about to insert, and write a temporary sibling then `rename` it over the destination. Until that rename succeeds, leave the previous destination untouched.
4. For a new document, set `format: "taco/files"`, `version: 1`, a fresh unique `docId`, `title`, `root` and `files`. Choose the Checkpoint definition from the user's or project's review requirements, if any; otherwise omit `checkpoints`, even if a starter pack contains one. The bundled `spec/` SDD graph is an example to adapt only if it fits; its stage names, document paths, and display template are not defaults that override project conventions. For a refresh, preserve the previous bundle wholesale—including `checkpoints.nodes`, `checkpoints.documents`, and any unknown fields—and replace only intended fields; keep `root`, format/version and identity unchanged. Stop on an unsupported format/version rather than downgrading it. Match existing file entries by path, preserve unknown fields and stable ids, and update content-dependent fields using the rules above.

### 2. Check what the reviewer will see

- With a review tab open, run `window.taco.validate()` in its console — it checks what the renderer actually did (comment anchors, cross-document links, navigation and Checkpoint paths, unmigrated blocks). Offline, run `node scripts/pack.mjs verify <name>.taco.html` instead. Both are described in `references/bundle-format.md`.
- Compare the reported structure with the shape you decided in step 0: entry document, each group with its files, what sits under `Unassigned`, and open/resolved comment threads.
- Fix a mismatch, or state it plainly, before handing the file over. A warning you shipped silently is a surprise the reviewer finds instead. Exit code `2` from `pack.mjs verify`, or any `warning`/`error` finding from `validate()`, goes in the report.
- A Checkpoint document shown as `not created` is expected only when you deliberately scheduled work that does not exist yet. Otherwise the structure was transplanted from a template: remove it.
- Confirm the artifact loads: the data block must parse and satisfy the shape rules. A Recovery-mode file is a failed hand-off, not a preview.

### 3. Present and open it for the human

- Always present the exact absolute path through the Agent GUI's native clickable local-file surface.
- **When the host's browser tool supports and permits local `file://` navigation, proactively open the generated file yourself and verify the expected title and document content are visible — do not ask permission first.** The file path is often hard to find; auto-opening is the default, not an extra step. This means the user's real browser: a headless or automation boot check is internal evidence only, **never** a user-visible presentation, and must not be reported as opened.
- If browser tools are unavailable, navigation is prohibited (e.g. Codex does not autonomously navigate to `file://`), or opening fails, keep the clickable-file handoff and say so explicitly. Never claim "opened and verified" unless you observed the content yourself; never bypass restrictions with `data:`/Blob URLs, a development server, or external uploads.
- If an existing review may hold unsaved edits, open a fresh tab rather than reloading the reviewed tab.
- Do not require the reviewer to save before Handoff — Handoff and `window.taco.getReviewHandoff()` carry unsaved in-memory edits. Only the saved-file channel needs ⌘S, so say that when you rely on it.

### 4. Consume review: apply human edits and comments

The reviewer's changes reach you through one of these channels — do not require more than the one that arrives:

- **Handoff (primary)**: clicking Handoff copies **Markdown prose** to the clipboard — an intro line, the document title, an optional local path, a modifications section with one fenced `diff` block per changed file, and a comments section listing open threads (headings follow the reviewer's UI language). Treat that pasted Markdown as the review input. The "Handoff (w/o data)" variant instead copies a short prompt asking you to inspect the open review tab.
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

End each round with: files assembled/imported, exclusions, the presented structure (entry document, each group with its files, and what sits under `Unassigned`), warnings from `scripts/pack.mjs verify`, open comments handled/deferred by thread ID, files changed while handling comments, refreshed Taco path, and presentation status (`presented as a clickable file` / `opened (user-visible)` / `opened and verified (user-visible)`; report a headless boot check separately as evidence, not as opening).
