# @tacobin/cli

Official CLI client for Taco / TacoHub review publication, event subscription, and local inspection.

## Purpose & Boundaries

- **Local use**: Install the complete repository `skills/taco/` directory (including its shell, `references/`, `scripts/`, and optional examples). The local review workflow does not require this CLI or a cloud account.
- **Hosted use**: `taco-cli` publishes a local Taco to a Host and reads hosted review events. Use the installed skill's `references/publishing.md` and `references/reviewing.md` for the optional hosted workflow, and `taco-cli help` for the binary's current command contract.

## Installation

### Via npm (Global)

```bash
npm install -g @tacobin/cli
# Or run on demand without global install:
npx @tacobin/cli help
```

### Via Standalone Binary

You can also download precompiled standalone binaries directly from [GitHub Releases](https://github.com/Arcadia822/taco/releases) (macOS Apple Silicon/Intel, Linux arm64/x64).

## Quick Start

```bash
# View offline help
taco-cli help

# Preview upload bundle locally without sending to network
taco-cli publish specs/feature.taco.html --dry-run

# Publish to a remote Host by supplying its origin (the default Host is localhost)
taco-cli publish specs/feature.taco.html --host https://tacobin.arcadia-han.com

# Stream review events from that Host
taco-cli subscribe <tacoId> --host https://tacobin.arcadia-han.com

# Inspect the CLI-embedded guide (currently separate from the repository skill)
taco-cli skills read taco
```

The CLI's embedded guide is currently cloud-oriented and is not yet generated from `skills/taco/`. It does not replace installation of that complete directory for offline review. Do not treat the two copies as synchronized until the release build actually embeds the canonical skill.
