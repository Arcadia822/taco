# @tacobin/cli

Official CLI client for Taco / TacoHub review publication, local authoring and inspection, and event subscription.

## Purpose & Boundaries

- **Local use**: `taco-cli` provides an optional local toolbox (`new`, `init`, `pack`, `verify`, `refresh`, `diff`, `inspect`, `extract`, `open`, `listen`). The core `taco` skill remains self-sufficient and works fully offline without requiring this CLI.
- **Hosted use**: `taco-cli` publishes a local Taco to a Host (`publish`, `update`) and reads hosted review events (`subscribe`, `events`, `handoff`).

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

# Publish to the official Host (defaults to https://taco.arcadia-han.com; --host > TACO_HOST_URL > default)
taco-cli publish specs/feature.taco.html

# Publish to a local development Host explicitly
taco-cli publish specs/feature.taco.html --host http://localhost:32167

# Update an existing hosted Taco in-place to the same URL (preserves comments and checkpoints)
taco-cli update <tacoId> specs/feature.taco.html --host https://taco.arcadia-han.com
# Wait for Handoff, then exit with code 0 (metadata is self-reported)
taco-cli subscribe <tacoId> \
  --host https://taco.arcadia-han.com \
  --harness codex \
  --model gpt \
  --model-id gpt-5 \
  --name "Review Assistant"

# Continuously stream all events instead of exiting after Handoff
taco-cli subscribe <tacoId> --host https://taco.arcadia-han.com --stream

# Page persistent event history (exits with code 6 if cursor expired)
taco-cli events <tacoId> --after 42 --host https://taco.arcadia-han.com

# Fetch full immutable handoff content when a review.handed_off event is received
taco-cli handoff <tacoId> <handoffId> --host https://taco.arcadia-han.com

# Inspect the guide embedded from the canonical repository Skill
taco-cli skills read taco
```

## Local Toolbox Commands

### `taco-cli new <file.taco.html>`

Creates a new blank `.taco.html` specification review container with an empty `files: []` bundle for agent authoring using the CLI's bundled Shell assets.

- `--lite`: Use the connected Lite shell instead of the default offline Complete shell.
- `--title <title>`: Document title (defaults to filename stem).

### `taco-cli init [target] --template <name>`

Initializes a new specification from bundled templates (`spec`, `adr`, `architecture`, `api-reference`, `prd`, `interaction`). A directory target creates canonical Markdown and a Taco; a `.taco.html` target creates only the container.

- `--title <title>`: Custom document title.
- `--lite`: Use the Lite shell variant.
- `--list-templates`: List the bundled template names.

### `taco-cli pack <dir>`

Packs a local documentation directory into a standalone `.taco.html` review artifact. Supports Markdown, code, diagrams, images, and single-page HTML (`text/html`, rendered read-only in a sandbox).

- `--title <title>`: Document title (defaults to directory name).
- `--out <path>`: Explicit output path.
- `--lite`: Use the Lite shell variant.
- `--entry <relpath>`: Explicit entry file path.
- `--group "<Title>=<relPath,relPath>"`: Explicit sidebar category grouping (repeatable).
- `--ignore <glob>`: Exclude relative paths or glob patterns (repeatable).
- `--dry-run`: Preflight print of structure, entry, groups, exclusions, and output path without writing.

### `taco-cli verify <file.taco.html>`

Performs read-only validation of the `#taco-document` data block, path security, PNG assets, and Mermaid syntax diagnostics.

- Returns V2 structural verification as JSON. Exit code 0 means no validation findings; exit code 2 reports errors or warnings. Browser rendering must be checked separately.

### `taco-cli refresh <file.taco.html>`

Refreshes an existing `.taco.html` in place after canonical source edits, preserving stable `docId`, comments, checkpoints, navigation, and unknown metadata fields. When refreshed with embedded HTML sources, legacy shells lacking `embedded-html` capability are compatibly upgraded to the current stock shell while preserving Complete/Lite variant.

- `--dir <path>`: Canonical source directory (defaults to the bundle root relative to the Taco).
- `--handoff <path|->`: Required local handoff receipt or payload, or `-` for stdin. Rejects remote URLs.
- `--dry-run`: Preview refresh plan without modifying the file.

### `taco-cli diff <targetA> [targetB]`

Performs read-only structural diff between two Tacos, between a Taco and its canonical directory, or from a local Handoff payload.

- `--handoff <path|->`: Diff using a local handoff payload or stdin receipt. With `--dir`, pass the reviewed Taco as the first argument to bind the receipt to it; only then is `trustedBaseline` reported as `true`.
- Does not modify files on disk or resolve comments.

### `taco-cli inspect <file.taco.html>`

Outputs lightweight document structure, entry document, groups, comment threads, Checkpoints, and credential presence diagnostics without printing sensitive credential values.

### `taco-cli extract <file.taco.html>`

Extracts credential-free file projections from a Taco to stdout or writes them to a safe directory.

- `--out-dir <dir>`: Safe target extraction directory. Existing files cause a conflict; no overwrite option is provided.
- `--files <relpath,relpath>`: Select exact root-relative or bundle paths.
- `--dry-run`: Preview extraction without writing.

### `taco-cli listen <file.taco.html>`

Starts a finite loopback HTTP listener (`127.0.0.1`) with a short-lived token and returns a ready fragment URL for the browser.

- When the reviewer clicks **Handoff** in the browser, the listener receives the unsaved review snapshot, atomically writes a local receipt, emits JSON to stdout, and exits with code 0.
- Receipts are stored in a per-user `taco-receipts-<uid>` directory under the system temporary directory. The listener refuses to start when that directory is a symbolic link, belongs to another user, or grants group/other permissions.
- `--port <number>`: Preferred loopback port.
- `--timeout <seconds>`: Idle timeout (default 300s).

### `taco-cli open <file.taco.html>`

Opens the review container in the default browser when the host permits. Add `--listen` to receive explicit Handoff through a finite local listener. `--no-open` returns the artifact path without launching a browser.

## Hosted Workflow Commands

### `taco-cli publish <file.taco.html>`

Publishes a new Taco to a Host, returning its reviewer `url` and `tacoId`. Always represents initial creation.

- `--host <origin>`: Target Host origin (default `https://taco.arcadia-han.com`).
- `--dry-run`: Preflights payload projection and credential boundaries without network calls.

### `taco-cli update <tacoId> <file.taco.html> [--base <revisionId>]`

Pushes a replacement revision to an existing hosted Taco under the same URL, preserving comments and Checkpoints.

- `--base <revisionId>`: Expected current revision ID; automatically retrieved if omitted.
- `--host <origin>`: Target Host origin.
- `--dry-run`: Validates payload locally.

### `taco-cli subscribe <tacoId>`

Subscribes to live review events over SSE. Default exits on `review.handed_off` with code 0.

- `--host <origin>`: Target Host origin.
- `--stream`: Continuously stream all events instead of exiting on handoff.
- `--after <seq>`: Resume cursor.
- `--harness <name>`, `--session <title>`, `--name <name>`: Self-reported metadata.

### `taco-cli events <tacoId>`

Pages persistent event history from the Host. Exits with code 6 (`CURSOR_EXPIRED`) if the cursor has expired.

### `taco-cli handoff <tacoId> <handoffId>`

Fetches the full immutable hosted `HandoffRecord` JSON for a completed review round.

### `taco-cli skills [list|read]`

Lists or displays embedded skill guide documents.
