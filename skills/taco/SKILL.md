---
name: taco
description: Use when the user asks to create or refresh a .taco.html, make a Taco, prepare technical documents for review, or handle Taco edits and comments. Works in ordinary documentation directories and Spec Kit projects without installing a CLI.
---

# Taco: human-agent document review in one file

Taco turns a Markdown documentation directory into one portable `.taco.html`. A human opens it in a browser, reads and edits the original Markdown, and leaves anchored comments. You then consume those edits and comments and apply them to the canonical files.

```text
canonical doc directory → one .taco.html → human review (browser) → agent reads Handoff → canonical doc directory
```

No CLI is required. A `.taco.html` is plain HTML with one plaintext JSON data block; you assemble it with file read/write tools.

## When to use

- Any directory of Markdown (plus JSON/YAML/PNG) that needs human review: system design, RFC, ADR, data model, API reference, or a plain spec.
- No project scaffolding is required. Taco works in any repository or sandbox on a plain directory.
- Spec Kit projects: if the project already has the Taco Spec Kit extension installed (`.specify/extensions/taco/` and the `taco-speckit` skill), use that flow. Otherwise this skill handles a Spec Kit feature directory exactly the same way — installing the extension is an optional deeper integration, never a requirement.

### Starting a new document from a template pack

This skill bundles self-contained template packs in `templates/` next to this `SKILL.md`: `spec/`, `architecture/`, `api-reference/`, and `adr/`. (A Taco source checkout carries the same packs at `extensions/taco/templates/`; an installed Spec Kit extension exposes them at `.specify/extensions/taco/templates/`.) Each pack contains a skeleton `template.md`, a minimal `bundle.json`, and an open-in-browser `empty.taco.html`. When the user asks to draft a new design document, ADR, or API reference, read the matching pack's `README.md` and `template.md` and follow its field contract (`title`, `feature_id` or equivalent, `created`, `status`, `input`) instead of inventing structure.

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

A `.taco.html` = fixed shell (runtime viewer/editor) + one JSON data block. Find a shell in the first location that exists:

1. This skill's own `taco-shell.html` (sits next to this `SKILL.md`) — the default, always available
2. A template pack's `empty.taco.html`
3. `.specify/extensions/taco/assets/taco-shell.html` (Spec Kit extension installation)
4. A locally cloned Taco checkout: `<taco-repo>/extensions/taco/assets/taco-shell.html`
5. If none exists, ask the user where a Taco shell lives.

The bundled `taco-shell.html` has an empty `#taco-document` block. Fill it before opening; an unfilled shell shows the runtime's empty-bundle recovery screen, not a document. Template and checkout fallbacks may contain starter data: use their runtime, not their identity or content. Only write the data block and `<title>`.

## The bundle format (`taco/files` v1)

The document lives in one plaintext block near the top of the shell:

```html
<script type="application/taco+json" id="taco-document">
{ "format": "taco/files", "version": 1, ... }
</script>
```

The runtime's `parseBundle` validates this; anything corrupt puts the file into Recovery mode, so validate before you write.

Bundle fields:

- `format`: `"taco/files"`; `version`: `1`
- `docId`: stable identity. Preserve it when refreshing an existing Taco; for a brand-new document mint a **unique** id (`crypto.randomUUID()`, not the directory slug — same-named directories and copies would collide).
- `title`: document title. The runtime normalizes it to the persisted `.taco.html` filename stem, so name the file after the title.
- `root`: the directory the bundle covers, as a safe relative POSIX path (no leading `/`, no `\`, no empty, `.`, or `..` segments). Every `path` must sit under `root/`.
- `files`: `{ id?, title?, path, mediaType, content, sourceUrl?, sourceHash?, blocks? }[]`, `path` safe, unique, and starting with `root/`.
- `comments`, `navigation`, `access`, `collab`, `packOptions`, and any other field: carry over from the previous bundle when present.

`mediaType` by carrier:

| File | `mediaType` | Notes |
| --- | --- | --- |
| `.md` | `text/markdown` | editable document |
| `.json` | `application/json` | source view |
| `.yaml` / `.yml` | `application/yaml` | source view |
| `diagrams/*.mmd` | `text/plain` | Mermaid source; the runtime routes it by extension, not by media type |
| `.png` | `image/png` | `content` is a `data:image/png;base64,…` URI |
| `.html` / `.htm` | `text/html` | requires `sourceUrl` |
| any other text | `text/plain` | plain-text source |

Per-file fields:

- `id`: preserve the previous file's id — it is the stable key for comment anchors and block identity.
- `title`: optional in-file display title; if kept it must be a non-empty string and must not change the `path`.
- `sourceUrl`: HTML/HTM only. Derive it from the existing source file's canonical absolute path using a file-URL API, not string concatenation. Require a `file:` URL with no host, credentials, query, or fragment whose decoded pathname ends with the file's `path`. Never set it on non-HTML files.
- `sourceHash`: optional sha256 hex (64 chars) of the file bytes at pack time; recompute it whenever `content` changes.
- `blocks`: optional runtime cache of per-block HTML. Keep it only when that file's `content` is byte-identical to the previous bundle's; drop it when the content changed and let the runtime rebuild it.

Comments:

- Preserve existing review threads and their history when refreshing; never fabricate or resolve them. Runtime normalization may change serialization, not their meaning.
- Each thread's `anchor.path` must reference a file present in `files`. If a commented source file disappeared, retain its previous bundle entry and report it; do not silently drop the file or its comments.

Writing rules:

- Serialize with `JSON.stringify(bundle, null, 2)`, then replace every `<`, `>`, `&`, `\u2028`, `\u2029` with its `\uXXXX` escape. Escaping `<` is what guarantees a literal `</script>` can never appear in the block.
- Insert the JSON into the `#taco-document` block by matching it and passing a **callback** to `replace` — `html.replace(dataBlock, () => replacement)` — or by splicing at the block's index. A plain string replacement is unsafe: `$&`, `` $` ``, `$'`, and `$1` inside the JSON would be treated as replacement patterns. Update `<title>` the same way.
- `<title>` in the head must be `<bundle title> — Taco` (with `&`, `<`, `>` escaped).
- Validate before writing: `JSON.parse` the exact escaped string you will insert (it must round-trip), then check the shape rules above. Write the whole file to a temporary sibling and rename it over the destination, so a failure never truncates the existing Taco.
- Only the data block and `<title>` change. Everything else in the shell stays byte-identical.
- Keep the file self-contained: PNG assets as data URIs; no external URLs or scripts.

## Workflow

### 1. Assemble: write the bundle into the shell

1. If a `.taco.html` already exists at the destination, **read its bundle first** — before you copy or overwrite anything, or you will read your own fresh copy instead of the reviewed document.
2. Read the shell into memory; do not copy it over the destination. For a refresh, retain the old bundle in memory separately.
3. Enumerate the document directory and build `files[]` from regular source files. Exclude dotfiles and every `*.taco.html`. Preserve the existing `packOptions.ignore` rules unless new exclusions were requested. Report exclusions; stop on unhandled symlinks, non-UTF-8 files, invalid PNGs or unsupported entries instead of following or silently skipping them.
4. For a new document, set `format: "taco/files"`, `version: 1`, a fresh unique `docId`, `title`, `root` and `files`. For a refresh, preserve the previous bundle wholesale and replace only intended fields; keep `root`, format/version and identity unchanged. Stop on an unsupported format/version rather than downgrading it. Match existing file entries by path, preserve unknown fields and stable ids, and update content-dependent fields using the rules above.
5. Serialize into the in-memory shell, validate the exact result, then write a temporary sibling and rename it to `<DOC_DIR>/<name>.taco.html`. Until this succeeds, leave the previous destination untouched.

### 2. Present and verify: open it for the human

- Always present the exact absolute path through the Agent GUI's native clickable local-file surface.
- **When the host's browser tool supports and permits local `file://` navigation, proactively open the generated file yourself and verify the expected title and document content are visible — do not ask permission first.** The file path is often hard to find; auto-opening is the default, not an extra step. This means the user's real browser: a headless or automation boot check is internal evidence only, **never** a user-visible presentation, and must not be reported as opened.
- If browser tools are unavailable, navigation is prohibited (e.g. Codex does not autonomously navigate to `file://`), or opening fails, keep the clickable-file handoff and say so explicitly. Never claim "opened and verified" unless you observed the content yourself; never bypass restrictions with `data:`/Blob URLs, a development server, or external uploads.
- If an existing review may hold unsaved edits, open a fresh tab rather than reloading the reviewed tab.
- Do not require the reviewer to save before Handoff — Handoff and `window.taco.getReviewHandoff()` carry unsaved in-memory edits. Only the saved-file channel needs ⌘S, so say that when you rely on it.

### 3. Consume review: apply human edits and comments

The reviewer's changes reach you through one of these channels — do not require more than the one that arrives:

- **Handoff (primary)**: clicking Handoff copies **Markdown prose** to the clipboard — an intro line, the document title, an optional local path, a modifications section with one fenced `diff` block per changed file, and a comments section listing open threads (headings follow the reviewer's UI language). Treat that pasted Markdown as the review input. The "Handoff (w/o data)" variant instead copies a short prompt asking you to inspect the open review tab.
- **Review tab API**: in the open review tab, `window.taco.getReviewHandoff()` returns an in-memory object `{ title, root, originPath, changedFiles: [{ path, mediaType, content, diff? }], comments }`, including unsaved edits. `changedFiles[].path` is **root-relative** — resolve the canonical file as `<root>/<path>` (or call `window.taco.readFile(path)`, which accepts either form). This channel needs no save.
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

### 4. Refresh: rebuild after canonical edits

After canonical edits, refresh the same Taco only when pending direct review edits are handled. If any edits remain conflicted or unavailable, preserve the reviewed file unchanged and report the blocker. Otherwise repeat assembly using the full previous bundle and present/open the result. Verify the path and review history are preserved; runtime comment normalization may change serialization but not meaning.

## Invariants

- The directory remains canonical; the Taco is a review transport.
- Only the `#taco-document` block and the `<title>` are agent-writable; never touch the shell around them.
- Preserve `docId`, `comments`, `navigation`, and every other stored bundle field across refreshes.
- Never fabricate comments, hashes, or verification claims; never claim a user-visible open that did not happen.

## Report format

End each round with: files assembled/imported, exclusions, open comments handled/deferred by thread ID, files changed while handling comments, refreshed Taco path, and presentation status (`presented as a clickable file` / `opened (user-visible)` / `opened and verified (user-visible)`; report a headless boot check separately as evidence, not as opening).
