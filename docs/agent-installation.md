# Taco — Agent installation

This is the machine-facing installation guide for an Agent adding Taco to an environment or project. Read [`README.md`](../README.md) for the product boundary. Contributor instructions live in [`AGENTS.md`](../AGENTS.md) and [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Installation model

**Installing Taco means installing the `taco` skill.** There is no package manager step, no daemon, no build, no project modification, and no CLI requirement for the core workflow:

- The skill directory (`skills/taco/`) is self-sufficient: `SKILL.md` (the agent guide), `taco-shell.html` (the complete offline browser shell), `taco-shell-lite.html` (the connected Lite shell), `references/` (loaded only for the relevant Checkpoint or hosted workflow), `scripts/` (the optional saved-Checkpoint reader), and `templates/` (optional examples).
- Once installed, the Agent can assemble, present, open, and review `.taco.html` files in any directory. Complete needs no network; Lite loads public CDN editor dependencies and remains editable in plain-text Markdown mode if those libraries fail.
- `taco-cli` exists only for optional cloud workflows (TacoHub / Tacobin publishing and live review). It is **never** part of the local installation.

### Choosing a shell for the recipient

Select by the **recipient's opening environment**, not the Agent's installation-time connectivity. Use the default self-contained `taco-shell.html` whenever the recipient might be offline; it includes the editor and diagram renderer and is larger. Use `taco-shell-lite.html` only when reliable network access is expected; it loads pinned public CDN libraries for rich editing, syntax highlighting, and Mermaid and falls back to writable Markdown source when the rich editor fails. Lite must not silently replace an existing Complete Taco during a refresh.

## Install from a GitHub repo URL

When the user gives the Taco repository URL (e.g. `https://github.com/Arcadia822/taco`), the default action is the **CLI-free skill installation**:

1. Fetch the raw skill directory from the repo (or a local clone):
   - `skills/taco/SKILL.md`
   - `skills/taco/taco-shell.html` and `skills/taco/taco-shell-lite.html`
   - `skills/taco/templates/**`
   - `skills/taco/references/**`
   - `skills/taco/scripts/**`
2. Copy them into the harness's skill location (for example `~/.claude/skills/taco/` or the equivalent for the active agent harness), keeping the files together in one `taco/` directory.
3. Verify before reporting success. Every check below is required:
   - `SKILL.md`, both `taco-shell.html` and `taco-shell-lite.html`, `references/`, `scripts/`, and `templates/` live in that one skill directory. The `SKILL.md` routes Checkpoint work to `references/checkpoints.md` and hosted publication/review to their own references; each template example keeps its `README.md`, `template.md`, `bundle.json`, and `empty.taco.html` beside one another.
   - Each shell's single `#taco-document` block is empty — exactly `<script type="application/taco+json" id="taco-document"></script>` — the `<title>` is generic, and the block carries no `docId`, `files`, `comments`, `navigation`, `access`, or `packOptions`. A block that still contains a bundled document means you copied the wrong file; replace it before use.
   - Complete and template packs are self-contained: every script, style, font, and image is inline or a `data:` URI. Lite likewise embeds its own runtime but loads only the external libraries required by bundled file types from pinned public CDNs; do not promise offline rich editing in Lite.
   - `SKILL.md` states that the data block is filled before the file is opened; only that block and the escaped HTML title may change.
   - Read `SKILL.md` once to confirm it describes the shell and routes optional references that exist in the installed directory. The bundled `spec/` SDD graph is an example, not a required Checkpoint policy; project-owned review rules take precedence.
4. Done. Report the installed skill path. Running the packaging flow once against a scratch directory is useful internal evidence, but it is not required, and a headless load is never user-visible presentation (see below).

Do not install npm packages, download `taco-cli`, or run any build for the default install. Do not modify the target project. If the user's request is explicitly about cloud publishing (TacoHub/Tacobin), see "Install taco-cli" below.

## Use the skill

1. **Assemble.** Read the existing review bundle first, then read the skill shell into memory; never copy an empty shell over the destination. Follow `SKILL.md` for the common bundle and file-type contract. Read `references/checkpoints.md` only when creating, modifying, inspecting, or reporting Checkpoint data. Follow the user's and project's review requirements; a bundled SDD example does not determine whether a Checkpoint is needed or where the Taco is saved. Exclude every `*.taco.html` from source enumeration. Preserve all existing bundle fields, stable file identities, and review state, including collaboration/access settings and unknown fields. Serialize JSON with `<`, `>`, `&`, and line separators escaped as `\uXXXX`, and insert it using a callback or index splice, never replacement-string interpolation. Only the single `#taco-document` block and escaped HTML title may change. Validate a temporary sibling file before atomically replacing the destination; failures leave the old review intact.

2. **Open it for the human.** Present the exact absolute path through the Agent GUI's native clickable-file surface. When the host's browser tool supports and permits local `file://` navigation, open the file yourself, in a fresh tab so an existing unsaved review survives, because the path is often hard for the reviewer to find. Report exactly one of `presented as a clickable file`, `opened`, or `opened and verified`. A headless or automation boot check is internal evidence only: it is not user-visible presentation and must never be reported as `opened` or `opened and verified`. If browser tools are unavailable or the host prohibits `file://` navigation — Codex cannot autonomously complete that transition, so the user's click is what hands the file to Browser — keep the clickable-file handoff and state the reason. Never bypass a restriction with a `data:`/Blob URL, a development server, or an external upload.

3. **Consume the review.** Either channel is sufficient; do not require both.
   - **Handoff** (no save needed): the reviewer clicks the handoff action, which copies Markdown prose containing text diffs and open comment histories. Binary and newly added files may be represented only by notices; obtain their actual contents before applying them. The review tab also exposes `window.taco.getReviewHandoff()`, with `title`, `root`, `changedFiles[]` (root-relative paths and current contents), and `comments[]` (all statuses; filter for open requests). When the clipboard is unavailable or denied, the action reports failure instead of claiming the text was copied.
   - **Saved file** (save required): the reviewer saves the `.taco.html`; read it back, parse the `#taco-document` block, and diff `files[].content` against your last assembly.
     Read every open comment in full. A deleted message is history, never an open request. If the reviewer edited without saving and did not hand off, say the edits are unavailable rather than reporting content you did not receive.

4. **Apply and refresh.** Preflight all proposed canonical writes against the reviewed baseline or applicable diff hunks; reject unsafe paths and report conflicts without overwriting unrelated edits. Apply actionable items, then refresh the same Taco while preserving every stored bundle field and review thread. If direct edits remain conflicted or unavailable, retain the original review file instead of replacing it. Never delete a canonical file because it is absent from the bundle, never mark a comment resolved on the human's behalf, and never fabricate a comment, a hash, or a verification claim.

## Use in a Spec Kit project

The skill works on any Spec Kit feature directory without project installation: locate the feature directory, assemble the bundle from the skill's shell, and follow `SKILL.md`. No `.specify/` modifications are required.

An optional deeper integration ships as a Spec Kit extension (`extensions/taco/`) that installs the two agent commands (`speckit.taco.update` / `speckit.taco.review`), lifecycle hooks, an offline CLI, and a persistent project policy into the target project. Only set this up when the user explicitly asks for project-level Spec Kit integration — see [`extensions/taco/README.md`](../extensions/taco/README.md). That document is also the home of the `prepare-policy` process-routing and migration contract.

## Install taco-cli (cloud workflows only)

`taco-cli` is required only when interacting with cloud Taco hosts (publishing, streaming live events). Install via **npm** or the **standalone binary**:

### Option A: npm

```bash
npm install -g @tacobin/cli
# Or invoke directly:
npx @tacobin/cli help
```

### Option B: standalone binary

Download the archive for the target platform from the latest GitHub Release (`https://github.com/Arcadia822/taco/releases/latest`):

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

The canonical skill's optional cloud workflow lives in `skills/taco/references/publishing.md` and `references/reviewing.md`; read those when using a Host. `taco-cli skills read taco` currently returns the CLI's separately embedded, cloud-oriented guide, not a copy of the repository skill. Use `taco-cli help` for the installed binary's command contract; release-time embedding from the canonical skill has not yet been wired.

## Credential boundary

A collaboration-enabled Taco may contain relay configuration or access credentials in its embedded state. Treat the complete file as potentially credential-bearing: local inspection and local Agent reasoning are allowed, but never upload, paste, attach, log, or ticket the content to an external model or service without explicit user authorization. Revocation or key reset is an explicit user action.
