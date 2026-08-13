---
title: "Specification Quality Checklist: Taco File Browser"
---

## Product Boundary

- [x] The `specs/` files are the canonical source.
- [x] No parallel Story, Requirement, Task, or Evidence schema is kept anymore.
- [x] JSON is described only as the single-file transport envelope.
- [x] v0.3 is explicitly read-only file browsing.
- [x] Leading Markdown YAML frontmatter has structured property display and editing; standalone YAML/JSON files retain source editing and JSON highlighting.

## File Behavior

- [x] Default file, directory hierarchy, and source behavior are testable.
- [x] The sidebar exposes only Specify, Plan, and Tasks, with each stage's core file first.
- [x] Other Markdown files select a stage via an exact `spec | plan | tasks` scope enum.
- [x] Physical subdirectories stay visible within their derived stage.
- [x] Files without a valid scope declaration create no custom or extension group.
- [x] Path containment and duplicate-path behavior are specified.
- [x] Markdown sanitization and relative-link behavior are specified.
- [x] Unknown formats fall back to source without fabricating semantics.
- [x] Search and responsive behavior have acceptance criteria.

## Scope Honesty

- [x] Claims support for Markdown and generic source editing; does not claim structured YAML/JSON editing, Readiness, or a ChangeSet UI.
- [x] Future persistence must operate on the file map.
- [x] Future semantic views must stay derived.
- [x] v0.3 no longer keeps any unresolved `NEEDS CLARIFICATION`.
