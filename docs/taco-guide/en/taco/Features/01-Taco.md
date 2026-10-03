---
title: Taco
status: Complete
summary: The single-file review workspace itself
---

## What it is

A Taco is a `.taco.html` file containing a set of documents, their folder structure, a reader and editor, and comment threads. Double-click it to open it in a browser, with no installation, sign-in, or network.

One Taco covers one topic. The agent packs a folder from the repository into a Taco, you review it, and the result goes back to the agent.

## Reading

- **File tree**: keeps the real folder structure. Top-level folders become categories automatically, or a navigation manifest can define custom groups.
- **Entry document**: the page shown on open, marked **Entry** in the sidebar.
- **Search**: `⌘K` / `Ctrl+K` searches file names and full text.
- **Outline**: the headings of the current document on the right, highlighted as you scroll.

## Rendering

| File type | How it is shown | Example on this site |
| --- | --- | --- |
| Markdown | WYSIWYG editing; leading YAML becomes a properties panel | The properties at the top of every `.md` |
| Mermaid (`.mmd` or code blocks in Markdown) | Diagram preview plus source; switch theme and direction, zoom full screen; syntax errors point to the line and column | [System components](../Architecture/02-System.mmd) |
| JSON / YAML | Syntax-highlighted source editor | [Bundle example](../Architecture/05-Bundle-Example.json) |
| OpenAPI (JSON / YAML) | An extra **Overview** of operations, parameters, and responses | [Tacobin API](../Architecture/06-Tacobin-API.yaml) |
| PNG and SVG images, audio, video | Embedded previews | — |
| Other text files | Shown as source, with no guessing about the format | — |

Files Taco does not understand are kept as-is; they are never dropped when packing or saving.

## Reviewing

- **Comment on selected text**: select anything and comment. Comments are anchored to the quoted text and re-anchor after small edits.
- **Finer anchors**: comment on a node of a Mermaid diagram or a single line of a code block.
- **Threads**: reply, resolve, or reopen. Edit your own messages; deleting one leaves a placeholder so later replies keep their place.
- **Edit directly**: change the text yourself instead of writing "suggest changing A to B".

## Handoff

Click **Handoff** in the top-right corner and Taco copies this round's result to the clipboard:

- A diff for every edited file;
- Every open comment, with its file path, the quoted text, and the whole discussion;
- Any Checkpoint status changes.

Paste it to your agent and it can work through each item. Alternatively, save the file and give the whole `.taco.html` to the agent.

## Saving

**Save** writes your changes back into the `.taco.html` (in place when the browser supports it, otherwise as a download). **Save a copy** and **Save & unpack** are also available; the latter restores the files to a real folder on disk. You are warned before closing the page with unsaved changes.

## Checkpoints

When a topic has several documents that move forward in stages, add Checkpoints to the Taco:

- Define stages as a dependency graph, for example "Overview → Start → Features / Guides / Architecture → Roadmap";
- Each document has one of four statuses: To do, In progress, Complete, Frozen. A stage's status is aggregated from its documents;
- Each document can carry **Requirements** written for its author, human or agent;
- A required document that has not been written yet appears as **Not created**.

This site uses Checkpoints: open **Checkpoints** at the top of the sidebar. `Roadmap/Next-Phase.md` is a document that does not exist yet but already has its requirements written. See the [Checkpoints guide](../Guides/03-Checkpoints.md).

Checkpoints are optional; a plain Taco is enough when you do not need stage tracking.

## Complete and Lite

| | Complete | Lite |
| --- | --- | --- |
| Application size | About 2.7 MB | About 180 KB |
| Network | Fully offline | Editors, highlighting, and Mermaid load from a public CDN |
| Best for | Recipients who may be offline, long-term archives | Online review, committing to a repository |

If Lite's CDN is unavailable, Markdown can still be edited as source.
