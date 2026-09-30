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

You can also download precompiled standalone binaries directly from [GitHub Releases (`taco-cli-v*`)](https://github.com/Arcadia822/taco/releases?q=taco-cli-v) (macOS Apple Silicon/Intel, Linux arm64/x64).

## Quick Start

```bash
# View offline help
taco-cli help

# Preview upload bundle locally without sending to network
taco-cli publish specs/feature.taco.html --dry-run

# Publish to a remote Host by supplying its origin (the default Host is localhost)
taco-cli publish specs/feature.taco.html --host https://tacobin.arcadia-han.com

# Wait for Handoff, then exit with code 0 (metadata is self-reported)
taco-cli subscribe <tacoId> \
  --host https://tacobin.arcadia-han.com \
  --harness codex \
  --model gpt \
  --model-id gpt-5 \
  --name "Review Assistant"

# Continuously stream all events instead of exiting after Handoff
taco-cli subscribe <tacoId> --host https://tacobin.arcadia-han.com --stream

# Page persistent event history (exits with code 6 if cursor expired)
taco-cli events <tacoId> --after 42 --host https://tacobin.arcadia-han.com

# Fetch full immutable handoff content when a review.handed_off event is received
taco-cli handoff <tacoId> <handoffId> --host https://tacobin.arcadia-han.com

# Inspect the CLI-embedded guide (currently separate from the repository skill)
taco-cli skills read taco
```

## Commands & Options

### `taco-cli subscribe <tacoId>`
Waits for `review.handed_off` over SSE, emits NDJSON, and exits with code 0 after Handoff. Comments and autosaves keep the listener online but do not finish the review. The Host page requires an active listener to hand off; otherwise it shows installation and subscription commands. Use `--stream` (or `--follow`) to keep receiving all `ready`, `event`, and `checkpoint` frames.

- `--host <origin>`: Target Host origin (default: `http://localhost:32167` or `TACO_HOST_URL`).
- `--after <seq>`: Exclusive sequence string cursor to resume or replay from.
- `--harness <name>`: Optional self-reported runtime (`codex`, `claude-code`, `github-copilot`, `cursor`, `agy`, `pi`, `omp`, `openclaw`, `hermes`, `opencode`, `gemini-cli`, `other`). The UI labels it `runtime` / `运行时`; the flag remains `--harness`. Strictly validated.
- `--model <family>`: Optional self-reported model family (`gpt`, `claude`, `gemini`, `other`). Strictly validated.
- `--model-id <id>`: Optional detailed model identifier string (1–128 characters).
- `--name <name>`: Optional self-reported presence display name (1–64 characters).
- `--listener-id <uuid>`: Optional listener UUID; generated once per subscribe process and kept stable across reconnects.
- `--session <title>`: Optional readable session name (1–256 characters), shown in listener details.
- `--stream` / `--follow`: Continuously emit all events without exiting after Handoff.

Fetch each immutable Handoff before applying feedback, then subscribe again with `--after <confirmed sequence>` for the next review round. Clicking the Header avatar stack opens the complete listener menu; online presence does not prove receipt or processing. Header Save writes a local Taco copy independently of Host autosave.

### `taco-cli events <tacoId>`
Pages persistent event history from the Host.

- `--host <origin>`: Target Host origin.
- `--after <seq>`: Exclusive sequence cursor string. If the cursor is expired or Taco is gone (HTTP 410), exits with exit code 6 (`CURSOR_EXPIRED`) for explicit gap reporting.

### `taco-cli handoff <tacoId> <handoffId>`
Fetches the full immutable `HandoffRecord` JSON containing cumulative diffs, incremental diffs, checkpoints state, and review comments.

- `--host <origin>`: Target Host origin.

The CLI's embedded guide is currently cloud-oriented and is not yet generated from `skills/taco/`. It does not replace installation of that complete directory for offline review. Do not treat the two copies as synchronized until the release build actually embeds the canonical skill.
