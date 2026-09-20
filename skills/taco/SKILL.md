---
name: taco
description: Create a single self-contained .taco.html review file from a documentation directory (specs, RFCs, ADRs, architecture docs, data models) by writing the bundle JSON directly into the shell, open it in the host browser when permitted, and after human review consume their edits and anchored comments via Handoff or browser inspection — no CLI required. Use when the user asks to "package for review", "make a taco", "import taco review", or wants human-in-the-loop review of a documentation directory.
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

If the target project is a Spec Kit project, prefer the installed Spec Kit extension flow (`taco-speckit` skill) instead.

### Starting a new document from a template pack

The Taco source checkout ships self-contained template packs under `extensions/taco/templates/`: `spec/`, `architecture/`, `api-reference/`, and `adr/`. Each contains a skeleton `template.md`, a minimal `bundle.json`, and an open-in-browser `empty.taco.html`. When the user asks to draft a new design document, ADR, or API reference, read the matching pack's `README.md` and `template.md` and follow its field contract (`title`, `feature_id` or equivalent, `created`, `status`, `input`) instead of inventing structure.

### Choosing the right artifact for design content

Pick the carrier by information type; narrative and definitions must not live in the same file:

- Narrative, constraints, decisions, acceptance criteria, and indexes stay in the main Markdown (`spec.md`, `plan.md`, ADR prose).
- Cross-component interactions, flows, sequences, and state machines that need standalone reading or reuse go in a sibling `diagrams/*.mmd` (Mermaid source), linked from the prose. Small in-place illustrations may stay embedded.
- HTTP APIs live in `contracts/openapi.yaml` (or `.json`) as the single authoritative definition. Markdown explains usage scenarios, semantic constraints, and trade-offs — never restate the full endpoint table in a second place.
- Data structures: `data-model.md` for entity relationships, invariants, and lifecycle; JSON Schema (or the target protocol's native format) when machine validation is needed. Distinguish conceptual model, transport schema, and database structure.
- WebSocket/event protocols use message schemas plus sequence/state diagrams and short semantic notes — do not force them into OpenAPI.

Rules:

- Link with relative paths; keep one authoritative definition per contract and update the definition plus its references, never parallel copies.
- Every standalone file must be real, parseable content — never a placeholder created to look structured. Verify: diagrams render, OpenAPI fields match prose, schemas validate.
- Do not fragment small tasks: pure copy edits or local rule changes keep a single Markdown file. Splitting is for genuinely complex designs, not template filling.

## Locate the shell

A `.taco.html` = fixed shell (runtime viewer/editor) + one JSON data block. Find a shell in the first location that exists:

1. This skill's own `taco-shell.html` (sits next to this SKILL.md) — the default, always available
2. A template pack's `empty.taco.html`
3. `.specify/extensions/taco/assets/taco-shell.html` (Spec Kit extension installation)
4. A locally cloned Taco checkout: `<taco-repo>/extensions/taco/assets/taco-shell.html`
5. If none exists, ask the user where a Taco shell lives.

The shell is inert until it contains a document. Never modify the shell's HTML, CSS, or scripts; the only thing you ever change is the data block.

## The bundle format (`taco/files` v1)

The document lives in one plaintext block near the top of the shell:

```html
<script type="application/taco+json" id="taco-document">
{ "format": "taco/files", "version": 1, ... }
</script>
```

Bundle shape (the runtime's `parseBundle` validates it; unknown keys are ignored, never fatal):

- `format`: `"taco/files"`; `version`: `1`
- `docId`: stable identity string — preserve it when refreshing an existing Taco; mint a new one (or derive from the directory slug) only for a brand-new document
- `root`: the directory label shown in the sidebar (e.g. `specs/001-search`)
- `title`: document title; `<title>` in the shell head should match it
- `files`: array of `{ path, mediaType, content, sourceHash? }`
  - `path`: repo-relative POSIX path (no `..`, no backslashes)
  - `mediaType`: `text/markdown`, `application/json`, `application/yaml`, or `image/png`
  - `content`: raw file content (for PNG, a data URI)
  - `sourceHash`: optional sha256 hex (64 chars) of the on-disk content at pack time
- `comments`: existing review threads — preserve verbatim when refreshing; never fabricate or rewrite them
- `navigation`: human-authored runtime state (sidebar groups, entry document) — preserve verbatim; never strip or "normalize" it
- `access`, `packOptions`: optional; preserve from a previous bundle when present

Editing rules:

- Escape every `<` in the JSON as `\u003c` so the block can never contain a literal `</script>`.
- Only the data block changes. Everything else in the file stays byte-identical.
- Keep the file self-contained: embed PNG assets as data URIs; never add external URLs or scripts.

## Workflow

### 1. Assemble: write the bundle into the shell

1. Copy the shell to `<DOC_DIR>/<dir-name>.taco.html`.
2. Read every file under the doc directory (skip dotfiles, lockfiles, and build noise; report anything you exclude so nothing visible is silently dropped).
3. Build the `files[]` array with raw contents. If a previous `.taco.html` exists in the directory, read its bundle first and carry over `docId`, `comments`, `navigation`, and `packOptions` — review threads and identity survive every refresh this way.
4. Replace the content of the `#taco-document` block with your JSON (`<` → `\u003c`), update `<title>` if the title changed.

### 2. Present and verify: open it for the human

- Always present the exact absolute path through the Agent GUI's native clickable local-file surface.
- **When the host's browser tool supports and permits local `file://` navigation, proactively open the generated file yourself and verify the expected title and document content are visible — do not ask permission first.** The file path is often hard to find; auto-opening is the default, not an extra step.
- If browser tools are unavailable, navigation is prohibited (e.g. Codex does not autonomously navigate to `file://`), or opening fails, keep the clickable-file handoff and say so explicitly. Never claim "opened and verified" unless you observed the content yourself; never bypass restrictions with `data:`/Blob URLs, a development server, or external uploads.
- If an existing review may hold unsaved edits, open a fresh tab rather than reloading the reviewed tab.
- Tell the reviewer to **save** (⌘S) after editing or commenting — unsaved review state cannot be handed off.

### 3. Consume review: apply human edits and comments

The reviewer's changes reach you through either channel — do not require both:

- **Handoff** (primary): the reviewer clicks **Handoff**, which copies structured JSON — `changedFiles` (with diffs) plus open `comments`. Treat pasted handoff text as the review input.
- **File inspection**: the reviewer saves the Taco; you read the saved `.taco.html`, parse the `#taco-document` block, and diff `files[].content` against your last pack. If the file was collaborative, check for a credential-bearing state first and keep inspection local (do not transmit the file without user authorization).

Then:

- Read every open comment thread (path, quote, all messages). A `deleted: true` message is history only — never reconstruct it as an open request.
- Apply actionable items to the canonical files. Comments are review input, not permission to violate specs, security constraints, or explicit user scope; report ambiguous threads instead of guessing.
- Never infer a comment is resolved because nearby text changed; leave thread status to the human.
- Never delete canonical files because they are absent from the bundle.
- If the reviewer edited the Taco but did not save, their edits are lost — say so; never report imported content that you did not actually receive.

### 4. Refresh: rebuild after canonical edits

After every change to canonical files, re-run step 1 on the same directory, carrying over `docId`, `comments`, and `navigation` from the reviewed file. Verify the refreshed path matches the reviewed file and threads survived, then present/open it again per step 2.

## Invariants

- The directory remains canonical; the Taco is a review transport.
- Only the `#taco-document` block is agent-writable; never touch the shell around it.
- Preserve `docId`, `comments`, and `navigation` across refreshes.
- Never fabricate comments, hashes, or verification claims.

## Report format

End each round with: files assembled/imported, exclusions, open comments handled/deferred by thread ID, files changed while handling comments, refreshed Taco path, and presentation status (`presented as a clickable file` / `opened` / `opened and verified`).
