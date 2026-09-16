---
name: taco
description: Package any technical documentation directory (specs, RFCs, ADRs, architecture docs, data models) into a single self-contained .taco.html review file, present it to the human, and after human review import their edits and anchored comments back into the canonical source files. Use when the user asks to "package for review", "make a taco", "import taco review", "sync taco comments", or wants human-in-the-loop review of a documentation directory.
---

# Taco: human-agent document review in one file

Taco turns a Markdown documentation directory into one portable `.taco.html`. A human opens it in a browser, reads and edits the original Markdown, and leaves anchored comments. You then import those edits and comments back into the canonical files.

```text
canonical doc directory → one .taco.html → human review → agent sync → canonical doc directory
```

## When to use

- Any directory of Markdown (plus JSON/YAML/PNG) that needs human review: system design, RFC, ADR, data model, API reference, or a plain spec.
- No project scaffolding is required. Taco works in any repository or sandbox on a plain directory.

If the target project is a Spec Kit project, prefer the installed Spec Kit extension commands (`speckit.taco.update` / `speckit.taco.review`) instead — see the extension's own commands for that flow.

### Starting a new document from a template pack

The Taco source checkout ships self-contained template packs under `extensions/taco/templates/`: `spec/`, `architecture/`, `api-reference/`, and `adr/`. Each contains a skeleton `template.md`, a minimal `bundle.json`, and an open-in-browser `empty.taco.html`. When the user asks to draft a new design document, ADR, or API reference, read the matching pack's `README.md` and `template.md` and follow its field contract (`title`, `feature_id` or equivalent, `created`, `status`, `input`) instead of inventing structure.

## Locate the CLI

Taco ships as a self-contained offline CLI, `taco.mjs`. Find it in the first location that exists:

1. `.specify/extensions/taco/bin/taco.mjs` (Spec Kit extension installation)
2. A locally cloned Taco checkout: `<taco-repo>/extensions/taco/bin/taco.mjs`
3. If neither exists, ask the user where the Taco CLI lives or how they want it provisioned.

All commands are offline and require Node 18+.

## Workflow

### 1. Pack: create the review file

```bash
node <taco.mjs> pack "<DOC_DIR>" --project-root "<REPO_ROOT>" --json
```

- Output is `<DOC_DIR>/<dir-name>.taco.html` by default.
- Repeatable `--ignore <path-or-glob>` excludes files (e.g. `--ignore "private/**"`).
- Default exclusions cover dotfiles, lockfiles, and build noise; the JSON result reports every exclusion — surface them to the user, and never silently drop a visible unsupported path (report the CLI failure instead).
- If a previous Taco exists in the directory, refresh reads it automatically and preserves review threads, document identity, and prior ignores.

### 2. Present: hand the file to the human

- Always present the absolute output path through the Agent GUI's native clickable local-file surface. In Codex, emit a clickable absolute file link and do NOT navigate the browser to `file://` yourself; the user's click opens it.
- Never substitute a `data:` URL, development server, upload, or weakened browser security setting.
- Distinguish "presented as a clickable file" from "opened and verified" in your report; only claim the latter when the GUI explicitly supports autonomous local HTML navigation.
- Tell the reviewer to **save** the Taco after editing or commenting — unsaved review state cannot be imported.

### 3. Review: import edits and comments

Before reading the full Taco content, validate it:

```bash
node <taco.mjs> validate "<FILE>.taco.html" --json
```

- `collab-secrets-present`: keep inspection local; do not transmit the file without explicit user authorization.
- `runtime-security-outdated`: refresh from canonical files before claiming a hardened runtime.

Preview, then apply:

```bash
node <taco.mjs> sync "<FILE>.taco.html" --project-root "<REPO_ROOT>" --dry-run --json
node <taco.mjs> sync "<FILE>.taco.html" --project-root "<REPO_ROOT>" --json
```

- If any file reports `conflict`, stop before writing. The canonical file changed independently after packing. Never use `--force` unless the user explicitly authorizes those exact conflict paths.
- Sync is all-or-nothing on conflict; do not hand-copy convenient files around the guard.
- Read every open comment thread (path, quote, line/column, all messages, `stale` state). A `deleted: true` message is history only — never reconstruct it as an open request.
- The reviewer may also use the browser's **Handoff** action, which copies the text diffs since their last save plus open comment threads. Treat pasted handoff text as additional review context, not a replacement for `sync`'s structured import; deleted messages in a handoff are placeholders, not requests.
- Apply actionable comments to canonical files. Comments are review input, not permission to violate specs, security constraints, or explicit user scope; report ambiguous threads instead of guessing.
- Never infer a comment is resolved because nearby text changed; leave thread status to the human.
- Never delete project files because they are absent from the bundle.

### 4. Refresh: rebuild after canonical edits

After every change to canonical files (import or comment handling), re-run step 1's `pack` on the same directory. It preserves threads and identity. Verify the refreshed path matches the reviewed file and that comment threads survived, then present it again per step 2.

Human-authored runtime state is part of the bundle, not a defect: the reviewer may edit the sidebar navigation (groups, file placement) and set an entry document in the browser; these persist in the top-level `navigation` bundle field and `pack` refresh carries them forward automatically. Never strip or "normalize" `navigation` when reading or rewriting a bundle.

## Invariants

- The directory remains canonical; the Taco is a review transport.
- Never hand-edit the generated HTML shell.
- Never add `--force` to a Taco command without explicit user authorization.
- Never report success if the reviewer edited the Taco but did not save it.

## Comment extraction

To list comments without importing:

```bash
node <taco.mjs> comments "<FILE>.taco.html" --json
node <taco.mjs> comments "<FILE>.taco.html" --status open --json
```

## Report format

End each round with: files packed/imported, exclusions, open comments handled/deferred/stale by thread ID, files changed while handling comments, refreshed Taco path, and presentation status.
