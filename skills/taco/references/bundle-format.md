# The `taco/files` v1 bundle contract

Read this reference to author a bundle from scratch, to debug a `#taco-document` block, or whenever a Taco opens in Recovery mode. It is the authority for the model itself, for the safe-write contract, and for explaining why a file will not load. **You write the block yourself** — escaping, insertion, and atomic write are described here so you can do it directly. Where `references/output-path.md` says where the file goes and when, this document says what the file contains and how to write it safely. An optional `scripts/pack.mjs` helper performs the same steps if you have Node and would rather use it; nothing in this workflow requires it.

## You are authoring a document model

The bundle *is* the document. A `.taco.html` is only that JSON wearing a self-contained viewer as a disguise, and a directory of Markdown is only one input that fills `files[]` — a review can also arrive from Handoff, from a saved file, or from nothing at all. So author the model; never treat "pack the directory" as the job.

The shell is always provided empty (`SKILL.md` → Locate the shell), so you never invent a `.taco.html` — you fill the `#taco-document` block of one that already exists. This skeleton is the shape that goes in that block:

```json
{
  "format": "taco/files",
  "version": 1,
  "docId": "b6a1f0c2-2f0e-4d2f-9a4c-2f0c1a7e5b90",
  "title": "Roguelike Tactics Research",
  "root": "roguelike-tactics-game",
  "files": [
    {
      "path": "roguelike-tactics-game/research.md",
      "mediaType": "text/markdown",
      "content": "# Roguelike Tactics Research\n\nGoal: pick a combat model.\n"
    }
  ]
}
```

Mint a fresh unique `docId` for a new document and keep it forever after. Optional next: `navigation` for grouping, `checkpoints` for a review graph, `comments` for threads. The shell is a carrier, not a schema: escaping and atomically writing the block are your job here, and the rules are below. The optional `scripts/pack.mjs` helper implements them if you would rather not do it by hand.

## Derived at render time, not stored

The runtime never writes bundle fields. Everything inside `#taco-document` came from you or from a previous pack. It only *derives* presentation on load:

| Presentation        | Derived from                                                             |
| ------------------- | ------------------------------------------------------------------------ |
| Sidebar groups      | `checkpoints`, then `navigation`, then first-level directory names        |
| Entry document      | `navigation.entry`, else the first Markdown, else the first file          |
| File display title  | the document's YAML frontmatter `title:`, else the filename               |
| File id             | `files[].id` when present, else a stable id derived from the path         |
| Block HTML          | `files[].blocks` when present and current, else rebuilt from `content`    |

Consequence: **omitting `navigation` and `checkpoints` does not give you a flat file list.** The sidebar still groups files by their first-level directory and puts every file directly under `root/` into `Unassigned`. Compute that shape and state it before you hand the Taco over.

## Required fields

| Field     | Rule                                                                                   |
| --------- | -------------------------------------------------------------------------------------- |
| `format`  | exactly `"taco/files"`                                                                 |
| `version` | integer `>= 1`; higher values load as frozen (do not downgrade)                        |
| `docId`   | non-empty string; stable identity, preserved on refresh; mint a new unique one per document |
| `title`   | non-empty string; drives the persisted filename stem and `<title>`                      |
| `root`    | safe relative POSIX path: no leading `/`, no `\`, no NUL, no empty/`.`/`..` segment     |
| `files`   | array (may be empty); every entry needs `path`, `mediaType`, `content` as strings       |

Every `files[].path` must be safe and start with `${root}/`. A path equal to `root` is rejected. Paths must be unique.

## Per-file fields

| Field         | Rule                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------- |
| `id`          | optional non-empty string; the stable key for comment anchors — preserve it on refresh    |
| `title`       | optional non-whitespace string; the runtime overwrites it from frontmatter `title:`       |
| `mediaType`   | required string (see the table below)                                                    |
| `content`     | required string; PNG entries hold a `data:image/png;base64,…` URI                        |
| `sourceHash`  | optional 64-char lowercase hex sha256 of the file bytes at pack time                      |
| `blocks`      | optional runtime render cache; keep only while `content` is byte-identical to the previous bundle |

`sourceUrl` is no longer supported. Ordinary `.html` and `.htm` source entries are rejected: exclude them explicitly.

## Fields preserved across a refresh

Carry over `comments`, `navigation`, `checkpoints`, `access`, `collab`, `packOptions`, and **every unknown field** unchanged unless the reviewer's input changes them. Never fabricate a comment, never resolve one on the human's behalf, and never drop a field because you do not recognize it.

`comments[]` threads must satisfy the comment shape (anchor with `path`/`position`/`quote`, `status` `open|resolved`, timestamps, non-empty `messages[]`), and each `anchor.path` must reference a file present in `files[]`. If a commented file disappears from the directory, keep its previous bundle entry and report the loss instead of deleting it.

`navigation` is a v1 manifest: `{ version: 1, entry?: string, groups: [{ id, title, paths: string[] }] }`. `paths` entries may be root-relative (`spec.md`) or bundle-prefixed (`specs/001/spec.md`); the runtime stores root-relative. A malformed `navigation` is **silently deleted** on load and the sidebar falls back to directory grouping — so validate it yourself and fail loudly instead.

## Sidebar derivation (exact precedence)

1. **Checkpoint groups** — when `checkpoints` is present and valid, one group per graph node, in topological `after` order. A referenced document that is not in `files[]` renders as a `Not created` placeholder row.
2. **Manifest groups** — when `navigation` is valid, its `groups` in declared order. Every file *not* listed becomes `Unassigned`, even inside a directory. A dangling path is skipped; a path claimed twice is kept by the first group.
3. **Directory categories** — otherwise one group per distinct first-level directory (`docs/…` → `docs`), in first-appearance order.
4. **Unassigned** — remaining files (all of `root/`'s own files when there is no manifest).

Document content never decides classification: frontmatter keys do not route a file.

**Template hazard.** A starter pack's `bundle.json` describes *that pack's* directory. Copying its `checkpoints` or `navigation` into a directory that lacks those paths produces empty groups and `Not created` placeholder rows — the same surprise as a stage list with nothing under it. Templates supply prose to adapt (`template.md`); transplant their structure only for paths that actually exist.

## Media types

| File                 | `mediaType`        | `content`                          |
| -------------------- | ------------------ | ---------------------------------- |
| `.md`                | `text/markdown`    | UTF-8 text                         |
| `.json`              | `application/json` | UTF-8 text                         |
| `.yaml` / `.yml`     | `application/yaml` | UTF-8 text                         |
| `.mmd`               | `text/plain`       | UTF-8 Mermaid source               |
| `.png`               | `image/png`        | `data:image/png;base64,…` ≤ 10 MiB |
| other UTF-8 text     | `text/plain`       | UTF-8 text                         |

Non-UTF-8 bytes, symbolic links, and non-regular files are not silently skipped: stop, or exclude them explicitly.

`.mmd` content is carried as opaque text: the bundle rules below validate its path and media type, never its diagram syntax. Run `node scripts/lint-mermaid.mjs` (see `SKILL.md` step 2) before handing the file over — otherwise the reviewer's browser is the first thing to parse the diagram, and it reports a failure as one generic sentence.


## Writing the data block

```html
<script type="application/taco+json" id="taco-document">
  { "format": "taco/files", "version": 1, ... }
</script>
```

1. Serialize with `JSON.stringify(bundle, null, 2)`, then replace every `<` with `\u003c`. **That one escape is the whole safety rule**: with no literal `<` in the block, a `</script>` can never close it. Escaping `>`, `&`, `\u2028`, `\u2029` is optional hardening, not a load requirement — the block is HTML-parsed and `JSON.parse` accepts those characters raw. If you do harden, build the pattern with `String.fromCodePoint(0x2028)` / `(0x2029)`: a **literal** U+2028/U+2029 inside a regex literal is itself a line break in JavaScript source and will break your script before it runs.
2. Insert by matching the block and passing a **callback** to `replace` (`html.replace(block, () => replacement)`) or by splicing at the block's index. A plain string replacement treats `$&`, `` $` ``, `$'`, `$1` inside your JSON as replacement patterns and silently corrupts it.
3. `JSON.parse` the exact escaped string you are about to insert — it must round-trip — then check the shape rules above.
4. Write the whole file to a temporary sibling and `rename` it over the destination. A direct `writeFile` truncates the previous Taco first and loses it on failure.
5. `<title>` becomes `<bundle title> — Taco`, with `&`, `<`, `>` escaped as HTML entities.
6. Nothing outside the data block and `<title>` changes; the shell stays byte-identical.

## Rejecting input

A bundle fails to load when: `format` is not `taco/files`; `version`/`docId`/`title`/`root`/`files` are missing or malformed; a file path escapes `root`, duplicates another, or is an `.html`/`.htm` source; `sourceUrl` is present; a `sourceHash` is not 64 lowercase hex; `blocks` contain an unsupported type or HTML over 512 KiB; a comment thread is malformed or anchors a missing file; `access` is anything but `reader`; `collab` holds invalid sharing credentials. `packOptions.ignore` must be an array of strings with no absolute, empty, `.` or `..` segments.

## Verifying before you hand over

With a review tab open, the runtime is the authority — it can measure what the renderer actually did:

```js
const { ok, issues, findings, counts } = window.taco.validate()
findings.filter((finding) => finding.severity !== 'info')
```

`issues` reports collaboration credentials and runtime security; `findings` reports the document itself. Each finding is `{ code, severity, message, path? }` and covers duplicate file ids, comment anchors whose quote no longer resolves against the file, relative links that point outside the bundle or at nothing, navigation and Checkpoint paths that reference no file, and blocks the editor could not migrate. `ok` is false when there is a security issue or an `error`-severity finding. `severity: 'info'` is deliberately quiet — an unknown bundle field is preserved unchanged, not a defect.

With no browser available, parse the block you wrote and check the shape rules below — required fields, `root` consistent with every `path`, paths unique and safe — then report the result as **V2** and say plainly that rendering was not verified. Never present that as a `validate()` run. `references/output-path.md` §7 defines the two levels; a parse the host cannot perform means you do not write the file at all (`unverifiable`).

Where Node is available, the optional checker prints what the human will see:

```sh
node scripts/pack.mjs verify <name.taco.html>   # relative to the installed skill
node skills/taco/scripts/pack.mjs verify <name.taco.html>   # in a Taco checkout
```

It parses and validates the artifact and prints: entry, checkpoint groups with `Not created` documents, manifest or directory groups, `Unassigned` files, and open/resolved comment threads. Exit code `2` means the file loads but carries warnings — report those before asking for review. It is a convenience, not a required step, and its absence never blocks a hand-off.

## Writing a document back through the runtime

When you have a review tab but no file access — a chat session, a locked-down host — the runtime accepts a whole document and keeps the previous one:

```js
window.taco.loadBundle(json) // → { ok: true, files, undoable } | { ok: false, error }
window.taco.undoLoad() // → true, restores the document the load replaced
```

`loadBundle` validates before it touches anything: an invalid document returns `{ ok: false, error }` and the open review is left exactly as it was. The applied document is the whole bundle, so preserve `docId`, `comments`, `checkpoints` and unknown fields exactly as a refresh would. A load that turns out wrong is undone in one call, not by re-deriving the document.

Persisting from the tab is the runtime's job too — it serializes against the pristine shell, escapes `<`, and writes through the File System Access API:

```js
window.taco.canSave() // → true when in-place save is available
await window.taco.save() // → 'saved' | 'saved-as' | 'downloaded' | 'cancelled' | …
```

`save()` needs the browser's user activation and a file grant, so trigger it from a real gesture; when it reports `cancelled` or `downloaded`, say which happened rather than claiming the file was written.
