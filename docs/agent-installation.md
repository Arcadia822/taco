# Taco — Agent installation

This is the machine-facing installation guide for an Agent adding Taco to an environment or project. Read [`README.md`](../README.md) for the product boundary. Contributor instructions live in [`AGENTS.md`](../AGENTS.md) and [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Installation model

**Installing Taco means installing the `taco` skill.** There is no package manager step, no daemon, no build, no project modification, and no CLI requirement for the core workflow:

- The skill directory (`skills/taco/`) is self-sufficient: `SKILL.md` (the agent guide), `taco-shell.html` (the complete offline browser shell), `taco-shell-lite.html` (the connected Lite shell), `references/` (loaded for the bundle contract, Checkpoints, or hosted workflows), `scripts/` (the bundled assembler and the saved-Checkpoint reader), and `templates/` (optional examples).
- Once installed, the Agent can assemble, present, open, and review `.taco.html` files in any directory. Complete needs no network; Lite loads public CDN editor dependencies and remains editable in plain-text Markdown mode if those libraries fail.
- `taco-cli` exists only for optional hosted workflows (Tacobin publishing, live review event streaming, and handoff retrieval). It is **never** part of the local installation.

### Choosing a shell for the recipient

Select by the **recipient's opening environment**, not the Agent's installation-time connectivity. Use the default self-contained `taco-shell.html` whenever the recipient might be offline; it includes the editor and diagram renderer and is larger. Use `taco-shell-lite.html` only when reliable network access is expected; it loads pinned public CDN libraries for rich editing, syntax highlighting, and Mermaid and falls back to writable Markdown source when the rich editor fails. Lite must not silently replace an existing Complete Taco during a refresh.

## Install from a GitHub repo URL

When the user gives the Taco repository URL (e.g. `https://github.com/Arcadia822/taco`), install the **`taco` skill**. Prefer the skills ecosystem CLI, because it resolves the repository, picks the skill, and reports the exact destination for the active harness; fall back to copying the directory when that CLI cannot run (no network, no npm, unknown harness).

### Preferred: `npx skills`

```bash
npx skills@latest add arcadia822/taco --skill=taco
# non-interactive (pick the harness explicitly):
npx skills@latest add arcadia822/taco --skill=taco -g -a claude-code -y
npx skills@latest list        # verify what is installed
```

This installs the whole `skills/taco/` directory — `SKILL.md`, both shells, `references/**`, `scripts/**`, `templates/**`, and `VERSION` — into the harness skill location (`./.claude/skills/taco/` for a project install, the user directory with `-g`). It records `skills-lock.json` next to a project install. It reports the destination; verify the file list below in that directory before reporting success.

If `npx`, npm, or the network is unavailable, or the installed directory is missing files it should contain, fall back to the copy flow. Do not mix the two in one install.

### Fallback: copy the skill directory

When the CLI cannot be used, fetch the raw skill directory from the repo (or a local clone):

1. Fetch these files:
   - `skills/taco/SKILL.md`
   - `skills/taco/taco-shell.html` and `skills/taco/taco-shell-lite.html`
   - `skills/taco/templates/**`
   - `skills/taco/references/**`
   - `skills/taco/scripts/**` (optional utilities; the update notice below reuses one of them)
   - `skills/taco/VERSION` (the installed-version marker the update notice reads)
2. Copy them into the harness's skill location (for example `~/.claude/skills/taco/` or the equivalent for the active agent harness), keeping the files together in one `taco/` directory.
3. Verify before reporting success — for either installation path. Every check below is required:
   - `SKILL.md`, both `taco-shell.html` and `taco-shell-lite.html`, `references/`, and `templates/` live in that one skill directory. `scripts/**` and `VERSION` are **not** required for assembly: copy them only when you also want the optional utilities (a block assembler/verifier and the Checkpoint reader) and the once-per-session update notice; without them local assembly is unaffected and the notice simply never runs. The `SKILL.md` routes the bundle contract to `references/bundle-format.md`, the destination cascade to `references/output-path.md`, Checkpoint work to `references/checkpoints.md`, and hosted publication/review to their own references; each template example keeps its `README.md`, `template.md`, `bundle.json`, and `empty.taco.html` beside one another.
   - Each shell's single `#taco-document` block is empty — exactly `<script type="application/taco+json" id="taco-document"></script>` — the `<title>` is generic, and the block carries no `docId`, `files`, `comments`, `navigation`, `access`, or `packOptions`. A block that still contains a bundled document means you copied the wrong file; replace it before use.
   - Complete and template packs are self-contained: every script, style, font, and image is inline or a `data:` URI. Lite likewise embeds its own runtime but loads only the external libraries required by bundled file types from pinned public CDNs; do not promise offline rich editing in Lite.
   - `SKILL.md` states that the data block is filled before the file is opened; only that block and the escaped HTML title may change.
   - Read `SKILL.md` once to confirm it describes the shell and routes optional references that exist in the installed directory. The bundled `spec/` SDD graph is an example, not a required Checkpoint policy; project-owned review rules take precedence, and a project may keep its Checkpoint templates and the adoption decision under `.taco/`, which the skill reads before creating a requirement Taco.
4. Done. Report the installed skill path and which path you used (`npx skills` or copy). Running the packaging flow once against a scratch directory is useful internal evidence, but it is not required, and a headless load is never user-visible presentation (see below).

### Update notice

When the skill directory carries `VERSION` and `scripts/check-update.mjs`, run `node scripts/check-update.mjs --json` from that directory once per work session, before the first Taco action, and — only when a component's `updateAvailable` is `true` — close the final reply with the single sentence from `references/update-notice.md`. A minimal install that omits `scripts/**` has no check to run: skip it silently. Never upgrade on the user's behalf; the script only reports and the user decides. `TACO_UPDATE_CHECK=off` disables the check entirely.

This mechanism needs one bootstrap step: a skill snapshot installed before this contract exists has no `check-update.mjs` and no `VERSION`, so it cannot check anything. Re-installing (preferably through `npx skills@latest add arcadia822/taco --skill=taco`, or `npx skills@latest update taco` for an existing `npx skills` install) adds it.

### Uninstalling or updating

- `npx skills@latest update taco` updates an `npx skills` install; `npx skills@latest remove taco` removes it.
- A copied install is updated by repeating the copy flow above and re-running the verification list.
- Do not hand-edit `VERSION`: it is generated from `package.json` at release time by `npm run sync:version`.

Do not install npm packages, download `taco-cli`, or run any build for the default install. Do not modify the target project. If the user's request is explicitly about hosted reviews (Tacobin), see "Install taco-cli" below.

## Use the skill

1. **Choose the destination, then write the block yourself.** `references/output-path.md` decides where the product goes (L0 user-named location, L1 an existing Taco's path, L2 repository-root packaging, L3 `tacos/` under the repository's `docs`/`doc`/`documents`/`specs` directory, L4 `<repo>/tacos/`, L5 `~/Documents/tacos/`) and how the run is reported; the product no longer defaults to the current directory. Then write the `#taco-document` block directly: read the existing Taco (if any) and the chosen shell into memory, keep every stored bundle field (identity, comments, Checkpoints, navigation, collaboration/access settings, unknown fields) and each file's id, drop `blocks` as soon as a file's content changes, serialize and escape, parse the exact string you are about to insert, and replace the file through a temporary sibling and `rename` so a failure leaves the old review intact. Never copy an empty shell over the destination. `references/bundle-format.md` is the write contract; no script, CLI, or runtime is required. An optional `scripts/pack.mjs` helper (`--dir <DOC_DIR> --title "<Title>" --out <resolved absolute destination>`, `verify <name>.taco.html`) performs the same steps and prints the structure a reviewer will see when Node is available. It does not resolve the destination: its default `--out` writes inside the packaged directory, so always pass the resolved path.

2. **Open it for the human.** Present the exact absolute path through the Agent GUI's native clickable-file surface. When the host's browser tool supports and permits local `file://` navigation, open the file yourself, in a fresh tab so an existing unsaved review survives, because the path is often hard for the reviewer to find. Report exactly one of `presented as a clickable file`, `opened`, or `opened and verified`. A headless or automation boot check is internal evidence only: it is not user-visible presentation and must never be reported as `opened` or `opened and verified`. If browser tools are unavailable or the host prohibits `file://` navigation — Codex cannot autonomously complete that transition, so the user's click is what hands the file to Browser — keep the clickable-file handoff and state the reason. Never bypass a restriction with a `data:`/Blob URL, a development server, or an external upload.

3. **Consume the review.** Either channel is sufficient; do not require both.
   - **Handoff** (no save needed): the reviewer clicks the handoff action, which copies Markdown prose containing text diffs and open comment histories. Binary and newly added files may be represented only by notices; obtain their actual contents before applying them. The review tab also exposes `window.taco.getReviewHandoff()`, with `title`, `root`, `changedFiles[]` (root-relative paths and current contents), and `comments[]` (all statuses; filter for open requests). When the clipboard is unavailable or denied, the action reports failure instead of claiming the text was copied.
   - **Saved file** (save required): the reviewer saves the `.taco.html`; read it back, parse the `#taco-document` block, and diff `files[].content` against your last assembly.
     Read every open comment in full. A deleted message is history, never an open request. If the reviewer edited without saving and did not hand off, say the edits are unavailable rather than reporting content you did not receive.

4. **Apply and refresh.** Preflight all proposed canonical writes against the reviewed baseline or applicable diff hunks; reject unsafe paths and report conflicts without overwriting unrelated edits. Apply actionable items, then refresh the same Taco while preserving every stored bundle field and review thread. If direct edits remain conflicted or unavailable, retain the original review file instead of replacing it. Never delete a canonical file because it is absent from the bundle, never mark a comment resolved on the human's behalf, and never fabricate a comment, a hash, or a verification claim.

## Use in a Spec Kit project

The skill works on any Spec Kit feature directory without project installation: locate the feature directory, assemble the bundle from the skill's shell, and follow `SKILL.md`. No `.specify/` modifications are required.

An optional deeper integration ships as a Spec Kit extension (`extensions/taco/`) that installs the two agent commands (`speckit.taco.update` / `speckit.taco.review`), lifecycle hooks, an offline CLI, and a persistent project policy into the target project. Only set this up when the user explicitly asks for project-level Spec Kit integration — see [`extensions/taco/README.md`](../extensions/taco/README.md). That document is also the home of the `prepare-policy` process-routing and migration contract.

## Install taco-cli (hosted workflows only)

`taco-cli` is required only when interacting with a Taco Host / Tacobin (publishing, streaming live review events, and retrieving handoffs). Install via **npm** or the **standalone binary**:

### Option A: npm

```bash
npm install -g @tacobin/cli
# Or invoke directly:
npx @tacobin/cli help
```

### Option B: standalone binary

Download the archive for the target platform from the latest `taco-cli-v*` release ([GitHub Releases](https://github.com/Arcadia822/taco/releases?q=taco-cli-v)):

| Platform            | Artifact                       |
| ------------------- | ------------------------------ |
| macOS Apple Silicon | `taco-cli-darwin-arm64.tar.gz` |
| macOS Intel         | `taco-cli-darwin-x64.tar.gz`   |
| Linux arm64         | `taco-cli-linux-arm64.tar.gz`  |
| Linux x64           | `taco-cli-linux-x64.tar.gz`    |

```bash
shasum -a 256 -c SHA256SUMS --ignore-missing
tar -xzf taco-cli-<platform>-<arch>.tar.gz
install -m 0755 taco-cli "$HOME/.local/bin/taco-cli"
taco-cli help
```

The canonical skill's optional hosted workflow lives in `skills/taco/references/publishing.md` and `references/reviewing.md`; read those when using a Host. `taco-cli skills read taco` currently returns the CLI's separately embedded, cloud-oriented guide, not a copy of the repository skill. Use `taco-cli help` for the installed binary's command contract; release-time embedding from the canonical skill has not yet been wired.

For hosted Tacobin reviews, the Host serves its own review shell; the installable Complete and Lite shells contain no Tacobin collaboration runtime or controls. Publishing projects the local Taco's document data into that Host shell after a local dry run (`taco-cli publish <file.taco.html> --host <origin> --dry-run`), without changing the local file or its offline Handoff. A publish fixes one immutable baseline for that Taco. Public visitors may autosave shared edits and comments under unverified, self-reported names; neither action by itself requests Agent continuation, and autosaves or comments do not wake the agent session automatically. The reviewer must click **Handoff** on the Host page, which records a durable `review.handed_off` event. The agent streams or replays events via `taco-cli subscribe` or `taco-cli events`, and fetches the immutable payload (`taco-cli handoff <tacoId> <handoffId>`) before checking baseline/conflicts and applying any changes to canonical files. A live subscriber indicator is self-reported presence only, not evidence of delivery, receipt, or processing. Offline `.taco.html` Handoff remains separate and can still carry unsaved in-memory edits.

Keep `taco-cli subscribe <tacoId> --host <origin>` running during review. It waits for `review.handed_off` and exits with code 0 after that event; use `--stream` for continuous full event streaming, and start another subscription after handling a review. The page requires an active listener for Handoff and otherwise shows skill/CLI installation and subscription commands. Clicking the overlapping human and Agent avatars opens the full listener menu; its `runtime` / `运行时` label displays the self-reported `--harness` value, while `--session` supplies a readable session name. Pending autosave must succeed before Handoff; a failed or conflicting save stops it. The Header Save button saves a local Taco copy independently of shared Host autosave. File pages show only the filename, and the Checkpoints page shows only its localized name; stored bundle titles, template names, and navigation survive refresh.

## Credential boundary

A collaboration-enabled Taco may contain relay configuration or access credentials in its embedded state. Treat the complete file as potentially credential-bearing: local inspection and local Agent reasoning are allowed, but never upload, paste, attach, log, or ticket the content to an external model or service without explicit user authorization. Revocation or key reset is an explicit user action.
