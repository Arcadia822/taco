---
title: Architecture
status: Complete
---

## Overview

Taco has four layers: an HTML container that carries its own application, a runtime in the browser, a file protocol, and an optional host.

See the [system components](02-System.mmd) for how the pieces relate and the [review loop](03-Review-Loop.mmd) for the round trip between people and agents.

## Container: shell + data block

A `.taco.html` has two parts:

- **Shell**: the compressed, embedded application (reader, editor, comments, navigation), identical for every Taco;
- **Data block**: the JSON inside `<script type="application/taco+json" id="taco-document">`, holding every document and the review state for this topic.

To generate or refresh a Taco, the agent copies the shell and writes only the data block and the `<title>`, never the rest of the shell. Upgrading the shell and updating content therefore never interfere.

| Shell | Size | Dependencies |
| --- | --- | --- |
| Complete | About 2.7 MB | Embeds Tiptap, highlight.js/lowlight, and Mermaid; fully offline |
| Lite | About 180 KB | Loads pinned dependencies from a public CDN at startup |

## Protocol: taco/files v1

The data block uses the `taco/files` format, version 1. Main fields:

| Field | Meaning |
| --- | --- |
| `docId` | Document identity. Created on first generation and kept on every refresh |
| `root` | Relative root path of the document folder |
| `files[]` | Path, type, and content of each file, plus its `sourceHash` at packing time |
| `comments[]` | Comment threads: anchor, status, messages |
| `navigation` | Optional: entry document and groups |
| `checkpoints` | Optional: stage graph and document statuses |
| `access` | Optional: `reader` makes the Taco read-only |

See the [bundle example](05-Bundle-Example.json) for a complete sample and the [data model](04-Data-Model.mmd) for how the objects relate.

A refresh must keep `docId`, `comments`, `navigation`, `checkpoints`, and every unknown field unchanged. That is what lets the same Taco continue across rounds.

## Runtime

- **Navigation**: derives the tree and categories from file paths, or groups files per the `navigation` manifest;
- **Rendering**: Markdown is edited WYSIWYG with Tiptap; JSON, YAML, and Mermaid use the structured viewer. The tree, outline, and search index are derived and never stored separately;
- **Comments**: anchors record character positions plus surrounding context and re-anchor by context after edits; a lost anchor is marked stale rather than dropped;
- **Change tracking**: compares against the baseline at open time to produce the Handoff diff;
- **Saving**: writes back to the file in place when the browser supports it, otherwise downloads a copy.

## Round trip and conflicts

1. When packing, each file records a SHA-256 of its content (`sourceHash`) as the version the reviewer saw;
2. The handoff contains the diff of edits and the open comments;
3. Before applying, the agent compares the current repository file with `sourceHash`. If the source changed after packing, or a diff cannot be applied cleanly, it reports the conflict and stops, overwriting neither side.

## Hosts

- **Local**: open directly via `file://`, no service needed;
- **Tacobin**: implements the `taco-host/1` protocol for publishing, autosave, presence, and handoff events. See the [Tacobin API](06-Tacobin-API.yaml).

For security constraints, see [Security](07-Security.md).
