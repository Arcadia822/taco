---
title: Roadmap
status: In progress
updated: 2026-10-03
---

## Done

- **Single-file container**: documents, reader, editor, and comments in one offline-capable `.taco.html`;
- **Review and handoff**: comments on selected text, Mermaid nodes, and code lines; Handoff;
- **Structured rendering**: YAML properties panel, JSON/YAML source editing, OpenAPI overview, Mermaid preview and syntax checks;
- **Checkpoints**: stage graph, four statuses, document requirements, not-created placeholders, project templates;
- **Lite shell**: an online edition of about 180 KB;
- **Tacobin online review**: share links, autosave, explicit handoff, `taco-cli` subscriptions.

## In progress

### The second review round

After a person hands feedback to the agent, round two needs a faster way to confirm what changed and whether it changed correctly:

- **Global discussions list**: every comment thread on one page, filterable by status and file;
- **This round's changes**: only the real changes from this round's baseline to the current content, with one click to the exact spot;
- **Human confirmation**: the agent can explain how it handled a comment, but only a person can confirm and close the discussion.

## Planned

- **Document templates and writing guidance**: built-in templates for requirements, architecture, and interaction design, so agents write clearly structured documents;
- **Real two-round regression**: run "generate → review → hand off → revise → round two" end to end with common agent hosts, covering stale copies and concurrent edits.

## Open

How to split the next phase is still under discussion; see `Roadmap/Next-Phase.md` (not created yet).
