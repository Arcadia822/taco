# @taco/cli

Official CLI client for Taco / TacoHub review publication, event subscription, and local inspection.

## Purpose & Boundaries

- **Single Skill for Offline / Local Use**: Taco is designed local-first. The core `taco` skill operates standalone using offline `.taco.html` files and local sync workflows without requiring `taco-cli`, cloud accounts, or remote services.
- **taco-cli for Cloud Services**: `taco-cli` primarily serves the cloud / remote workflow: publishing specs to remote Taco hosts (such as TacoHub / Tacobin), streaming real-time reviewer comments and events over WebSockets, and managing remote review lifecycles.

## Installation

### Via npm (Global)

```bash
npm install -g @taco/cli
# Or run on demand without global install:
npx @taco/cli help
```

### Via Standalone Binary

You can also download precompiled standalone binaries directly from [GitHub Releases](https://github.com/Arcadia822/taco/releases) (macOS Apple Silicon/Intel, Linux arm64/x64).

## Quick Start

```bash
# View offline help
taco-cli help

# Preview upload bundle locally without sending to network
taco-cli publish specs/feature.taco.html --dry-run

# Publish Taco to remote host
taco-cli publish specs/feature.taco.html

# Stream review events in real time
taco-cli subscribe <tacoId>

# Read embedded Agent guidance
taco-cli skills read taco
```
