---
title: Architecture
status: Complete
---

## Overview

Taco has four parts: an HTML file that carries its own application, a runtime in the browser, a file protocol, and an optional host. See the [system components](02-System.mmd) for how they relate.

## One file = shell + data block

- **Shell**: the compressed, embedded application (reader, editor, comments, navigation), identical for every Taco;
- **Data block**: the JSON inside `<script type="application/taco+json" id="taco-document">`, holding every document and the review state for this topic.

Agents write only the data block and never touch the shell, so upgrading the application and updating content never interfere.

| Shell | Size | Dependencies |
| --- | --- | --- |
| Complete | About 2.7 MB | Everything embedded, fully offline |
| Lite | About 180 KB | Loads editors from a public CDN at startup |

## Data block: taco/files v1

| Field | Meaning |
| --- | --- |
| `docId` | Document identity, kept on every refresh after it is first created |
| `files[]` | Path, type, and content of each file, plus its `sourceHash` at packing time |
| `comments[]` | Comment threads: anchor, status, messages |
| `navigation` | Optional: entry document and groups |
| `checkpoints` | Optional: stage graph and document statuses |

Refreshes keep `docId`, comments, navigation, and Checkpoints, which is what lets the same Taco continue across rounds.

## Round trip and conflicts

1. When packing, each file records a content hash (`sourceHash`): the version the reviewer saw;
2. **Handoff** outputs the diff of edits and the open comments;
3. Before applying, the agent checks the source files against those hashes. If a file changed after packing, or a diff cannot be applied cleanly, it reports the conflict and stops, overwriting neither side.

## Security

- File paths must stay inside the document folder; anything that escapes is rejected;
- Plain `.html` source files cannot be packed into a Taco;
- A Taco with online collaboration enabled may carry access credentials; do not pass it around.

## Hosts

- **Local**: open directly via `file://`, no service needed;
- **Tacobin**: handles publishing, autosave, presence, and handoff events. See the [Tacobin API](03-Tacobin-API.yaml) for the main endpoints.
