# Taco — Agent installation

This is the machine-facing installation guide for an Agent adding Taco to an environment or project. Read [`README.md`](../README.md) for the product boundary. Contributor instructions live in [`AGENTS.md`](../AGENTS.md) and [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Installation model

**Installing Taco means installing the `taco` skill.** There is no package manager step, no daemon, no build, and no CLI requirement for the core workflow:

- The skill directory (`skills/taco/`) is self-sufficient: `SKILL.md` (the agent guide), `taco-shell.html` (the production browser shell, inert until a document is written into it), and `templates/` (starter packs).
- Once the skill is installed, the Agent can assemble, present, open, and review `.taco.html` files in any directory, forever, fully offline.
- `taco-cli` exists only for optional cloud workflows (TacoHub / Tacobin publishing and live review). It is **never** part of the local installation.

## Install from a GitHub repo URL

When the user gives the Taco repository URL (e.g. `https://github.com/Arcadia822/taco`), the default action is the **CLI-free skill installation**:

1. Fetch the raw skill directory from the repo (or a local clone):
   - `skills/taco/SKILL.md`
   - `skills/taco/taco-shell.html`
   - `skills/taco/templates/**`
2. Copy them into the harness's skill location (for example `~/.claude/skills/taco/` or the equivalent for the active agent harness), keeping the files together in one `taco/` directory.
3. Verify: the skill directory contains `SKILL.md`, `taco-shell.html`, and `templates/`. Read `SKILL.md` once to confirm it matches the installed shell.
4. Done. Report the installed skill path. A test run — assemble a shell into a demo `.taco.html` and open it — is optional evidence, not a requirement.

Do not install npm packages, download `taco-cli`, or run any build for the default install. If the user's request is explicitly about cloud publishing (TacoHub/Tacobin), see "Install taco-cli" below.

## Use in a Spec Kit project

The skill works on any Spec Kit feature directory without project installation: locate the feature directory, assemble the bundle from the skill's shell, and follow `SKILL.md`. No `.specify/` modifications are required.

An optional deeper integration ships as a Spec Kit extension (`extensions/taco/`) that installs the two agent commands (`speckit.taco.update` / `speckit.taco.review`), lifecycle hooks, and a persistent project policy into the target project. Only set this up when the user explicitly asks for project-level Spec Kit integration — see [`extensions/taco/README.md`](../extensions/taco/README.md).

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

The JSON returned by `taco-cli skills read taco` is the cloud usage contract (`references/publishing.md`, `references/reviewing.md`).

## Credential boundary

A collaboration-enabled Taco may contain relay configuration or access credentials in its embedded state. Treat the complete file as potentially credential-bearing: local inspection and local Agent reasoning are allowed, but never upload, paste, attach, log, or ticket the content to an external model or service without explicit user authorization. Revocation or key reset is an explicit user action.
