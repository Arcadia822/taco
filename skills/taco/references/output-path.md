---
title: Where to write the .taco.html
---

# Where to write the `.taco.html`

This reference is the authority for **where an Agent writes a Taco, what it is called, in what order the write happens, and how the result is reported**. Read it before creating or refreshing a `.taco.html`.

It does not cover the data block itself. The field list, serialization, escaping, form rules, and safe-write contract live in `bundle-format.md`; this reference only requires that the new bundle is parsed and shape-checked **before** anything is written.

Nothing here requires a script, a CLI, or a runtime. The Agent writes the `#taco-document` data block directly.

## 1. Where the product goes

Take the first level that applies.

| Level | Condition | Target |
| --- | --- | --- |
| L0 | The user names the output location in this request | §2 |
| L1 | This run refreshes an existing `.taco.html` | that file's current path |
| L2 | The directory being packaged **is the repository root** (and L0/L1 did not apply) | `<repo>/tacos/` |
| L3 | The repository contains `docs/`, `doc/`, `documents/`, or `specs/` | `tacos/` under the first one that exists |
| L4 | It is a repository without any of those directories | `<repo>/tacos/` |
| L5 | It is not inside any repository | `~/Documents/tacos/` |

Order is fixed; the directory name is lowercase `tacos` everywhere (on Windows the personal archive is `%USERPROFILE%\Documents\tacos`).

**L2 is its own level and skips L3.** When the directory being packaged is the repository root, "the repository contains `docs/`/`specs/`" says nothing about this run, so directory probing does not apply and the target is `<repo>/tacos/` (the same directory L4 would give). This keeps one input to one result even when the repository has a `docs/` directory. L0 and L1 still win over it.

## 2. L0: the user names the location

Two shapes are accepted:

1. **A directory** → the product is `<that directory>/<the title's normalized filename>`.
2. **A path ending in `.taco.html` whose filename stem is already canonical** (equal to normalizing that stem as a title) → the product is that file, and **that stem is the bundle title** (the filename decides the title).

Anything else is `malformed`:

- a file path that does not end in `.taco.html`;
- a `.taco.html` filename whose stem is **not** canonical — for example `My Design.taco.html`: the normalized stem is `My_Design`, and a title of `My Design` is saved back as `My_Design.taco.html`, so the name the user typed and the name the browser saves would disagree. Report the canonical name instead of silently rewriting the requested path.

Absolute paths are allowed.

**Filename and title are one value.** The filename stem is the normalized title: NFKC → replace every non-alphanumeric except `_` and `-` with `_` → collapse and trim `_`/`-` → fall back to `Untitled` when empty. The renderer and the save path both rely on this correspondence; there is no legal state where the two disagree.

**Forbidden targets win over L0.** A target inside the skill directory, the extension directory, a template directory, `node_modules/`, or `.git/` is refused (`forbidden`) no matter who asked for it.

## 3. Finding the repository (no `git` command)

Walk up from the directory being packaged (default: the current directory):

1. a `.git/` **directory** → the repository root is its parent;
2. a `.git` **file** whose content looks like `gitdir: <path>` (worktree or submodule) → the repository root is the appropriate ancestor of that git directory;
3. no `.git` before the filesystem root → outside any repository → L5.

The `git` command is used only for the optional ignore check (§6). If it is missing, report `gitignore-unavailable`: the repository decision does not change, and "the command is unavailable" is never reported as "outside a repository". If the decision is L5 while the directory carries a project marker (`package.json`, `pyproject.toml`, …), add the `workspaceRoot-not-git` warning.

The personal archive is `Documents/tacos` under `HOME ?? USERPROFILE`. When both are missing, stop with `needs_home` and report it; never fall back to the current directory.

## 4. Path safety

- Judge the target through the `realpath` of its **existing prefix**: it must not land inside a forbidden location (§2), including through a symlink swapped in partway.
- Refuse when the target file already exists and is a symlink.
- Exclude the product from the packaged set: **built-in exclusions** are hidden paths (anything starting with `.`, such as `.env`) and every `*.taco.html`. `packOptions.ignore` is separate: it carries explicit ignore patterns only — carry an existing bundle's value over unchanged, and leave it unchanged when this run adds nothing.
- When the target directory **equals** the directory being packaged, report the `output-in-input` warning after writing.

## 5. Writing, refreshing, migrating

### 5.1 The write sequence (fixed order)

1. **Choose the target**: resolve the directory, filename, and title per §1–§2, and prepare the report line `L? → <absolute path> (basis: …)`.
2. **Read into memory**: read the `#taco-document` block of the target file when it exists, and the chosen shell when it does not. **Never copy the shell over the target path first.** An existing data block that does not parse stops the run (`malformed`).
3. **Occupancy check** (§5.4): stop when it does not pass.
4. **Build the new bundle** with the retention rules in §5.2.
5. **Escape and self-check** (a precondition for writing, not skippable): serialize and escape per `bundle-format.md`, then parse and shape-check **the exact string you are about to write** — required fields, `root` consistent with every `path`, paths unique and safe, plus the exclusion rules from §4. Without a parser in the host, stop with `unverifiable` and write nothing.
6. **Prepare the directory**: create the target's parent directory when missing (the temporary file must be a sibling of the target).
7. **Atomic replace**: write the complete HTML to a temporary sibling, then `rename` it over the target. On failure the previous file is untouched.
8. **Verify and report**: state the verification level per §7 and report per §6.

### 5.2 Retention on refresh (L1)

| Field | Rule |
| --- | --- |
| `docId`, `comments`, `navigation`, `checkpoints`, `access`, `collab`, unknown top-level fields | carry over untouched |
| title | keep the existing bundle's title; if the target filename stem does not equal its normalized form, report the conflict and stop (never rename silently, never rewrite the title) |
| each file's `id` | carry over (comment anchors and block identity depend on it) |
| `blocks` | keep **only** while that file's new content is byte-identical to the previous content; drop it as soon as the content changes and let the runtime rebuild it |
| `sourceHash` | recompute when the content changed, keep it when it did not |
| packaged set | built-in exclusions and `packOptions.ignore` per §4 |

### 5.3 Migration (only when the user asks for it)

The occupancy check comes **before any write**:

1. read the old file's data block and check `docId`, `comments`, `checkpoints`, unknown fields;
2. when the target already exists — **even with the same `docId`** — stop by default: the target may be another copy of the same review that has since advanced its review state, and overwriting would discard that state silently. Continue only after the user explicitly authorizes the overwrite **and** the report lists the differences between the target and the source (comment counts, Checkpoint statuses, field differences);
3. create the target's parent directory;
4. run the sequence in §5.1;
5. check that the new file's `docId` and its `comments`/`checkpoints`/`navigation` match the old file field by field;
6. report "old path → new path". Do **not** delete the old file unless the user explicitly asks.

### 5.4 Occupancy rules

| Situation | Result |
| --- | --- |
| Target does not exist | create a new Taco |
| Target is the file being refreshed (resolves to the same path) | refresh it |
| Target exists with a different `docId` | `conflict`, stop |
| Target exists with the same `docId` (migration) | stop by default; overwrite only with explicit authorization after reporting the differences |

### 5.5 Shell variant

- Creating: default Complete (`taco-shell.html`); use `taco-shell-lite.html` when the user asks for Lite or the recipient has reliable network access.
- Refreshing: keep the variant recorded in the existing file's `<meta name="taco-shell-variant">` (absent means Complete). Never switch variants silently.
- When the required shell is not present in the installation, stop and name that path; do not substitute the other variant.

### 5.6 Idempotence

The same inputs (repository root, packaged directory, operation, existing file, user instruction) yield the same target directory, filename, and title.

## 6. Reporting

State a checkable conclusion before writing, and include in the hand-off report:

- the level that applied and its basis (user instruction / existing file / repository-root packaging / the directory that was probed);
- the product's **absolute path**, **filename**, and **title**;
- the verification level (V1/V2) and its result;
- warnings: `gitignored` (the product is ignored → still write it, **never** edit `.gitignore`), `gitignore-unavailable`, `workspaceRoot-not-git`, `output-in-input`;
- the exclusions list (hidden paths, `*.taco.html`, and any `packOptions.ignore` patterns), reported the same way `bundle-format.md` describes.

Failure types (none of them writes anything): `malformed`, `conflict`, `needs_home`, `unverifiable`, `forbidden`. Never pick the "most reasonable" target instead.

## 7. Verification levels

A parse of the exact string being written is a precondition for writing (§5.1 step 5). After writing, declare the result with the highest level available:

| Level | Means | Claim |
| --- | --- | --- |
| V1 | A tab is open on the Taco and `window.taco.validate()` ran | `{ok, issues, findings, counts}`; requires `ok: true` and no `error` |
| V2 | The host can parse but has no browser | "parsed and shape-checked; no runtime verification" — never presented as V1 |

`validate()` covers rendering and references; a successful parse is not proof that the interface is correct, so V2 must state that limit explicitly. **The levels govern what you may claim**, not whether you may write: without a parser the run stops with `unverifiable` and no file is produced.

## 8. Relationship to the Spec Kit extension

When the Taco Spec Kit extension is installed, the product's location is decided by **the extension's own convention** (`<FEATURE_DIR>/<feature-name>.taco.html`, see `extensions/taco/commands/update.md`). This reference:

- does not treat an installed extension as a rule source, and runs no conflict check against it;
- does not require the extension to read this reference or any skill file (the extension installs independently and is self-contained);
- expects the Agent to report "basis: extension convention" when it follows that convention inside an extension project.

So there is exactly one rule source per project: extension projects follow the extension, everything else follows the cascade above, and a custom location comes from the user (L0).

## 9. Examples

| Packaged directory | Present in the repository | Product |
| --- | --- | --- |
| `specs/014-agent-taco-output-path` | `docs/` and `specs/` | `docs/tacos/014-agent-taco-output-path.taco.html` |
| user names `specs/014-agent-taco-output-path/014-agent-taco-output-path.taco.html` | — | that file once the stem check passes (L0) |
| the repository root | `docs/` exists | `<repo>/tacos/<repo name>.taco.html` (L2, probing skipped) |
| `notes/` | none of `docs`/`doc`/`documents`/`specs` | `<repo>/tacos/…` (L4) |
| `/tmp/research` (not a repository) | — | `~/Documents/tacos/…` (L5) |

Rejections:

| Input | Result | Why |
| --- | --- | --- |
| a file path not ending in `.taco.html` | malformed | L0 accepts a directory or a `.taco.html` file |
| `My Design.taco.html` | malformed | the stem is not canonical; suggest `My_Design.taco.html` |
| a target inside `node_modules/`, `.git/`, the skill/extension/template directories | forbidden | forbidden targets outrank L0 |
| a data block in the existing file that does not parse | malformed | never write without understanding the current bundle |
| no parser in the host | unverifiable | escaping and shape cannot be guaranteed |
| an existing migration target, including a copy with the same `docId` | conflict (default) | overwriting discards review state the target may have advanced |
| L5 with `HOME`/`USERPROFILE` missing | needs_home | never fall back to the current directory |

## 10. Compatibility

- No project-level configuration file is introduced, so a repository that has not installed the skill needs no new file and no migration.
- The behaviour change is on the Agent's side: the product no longer defaults to the current directory but follows §1. Say so plainly when reporting against an older expectation.
- No bundle schema change: existing `.taco.html` files are unaffected, and a refresh keeps their path, title, and `root`.
- An older skill that does not ship this reference behaves as before.

## 11. Changing this contract

Level order, level names, failure semantics, the write sequence, and the verification levels must be changed together in: this file, the summary in `SKILL.md`, `docs/agent-installation.md`, and the extension's three mentions.
