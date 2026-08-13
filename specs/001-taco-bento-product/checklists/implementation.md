---
title: "Implementation Audit: Taco File Browser"
---

## Implemented

- [x] The build reads the real feature directory, not a duplicated starter document.
- [x] The canonical bundle stores only the path, media type, and raw content.
- [x] The runtime exposes the directory tree and the file viewer.
- [x] The sidebar projects only routed files into Requirements, Technical Plan, and Task Breakdown.
- [x] The `checklists/` directory stays intact under Technical Plan; the sidebar exposes only the three default stages, with no custom or extension group.
- [x] Group titles use secondary text with right-side hover expansion and no leading icon; folders toggle open/closed icons, and the Taco mark is exactly 24×24px.
- [x] Markdown supports safe WYSIWYG editing, exact source editing, and in-file heading navigation.
- [x] YAML, JSON, and unknown text keep exact source in the generic editor; JSON highlighting introduces no structured model.
- [x] Search covers paths and content.
- [x] The sidebar collapse control lives in the left panel Header.
- [x] The Castrel-style shell composes the file/workspace/comments panels before each panel's Header and Content; the right comments sidebar starts closed.
- [x] A collapsed file sidebar can be reopened from the workspace Header; Header actions are ghost buttons.
- [x] The workspace Header shows the root-relative file path and a reusable 24px-tall WYSIWYG/Markdown text segmented control for Markdown files; the document has no duplicate filename row.
- [x] The Header offers Bento's nine built-in shell languages, Share, a Save split button with Spec Kit unpack, and a globe language control, with no help.
- [x] Outline metadata, local/file state, and the search trigger do not occupy persistent chrome.
- [x] Save serializes the canonical file bundle, not the rendered Markdown.
- [x] The public Agent API is file-oriented and read-only.
- [x] The previous entity editor, Readiness, and ChangeSet models are removed.

## Automated Evidence

- [x] The 30 bundle, security, rendering, save/unpack, and browser-component tests pass.
- [x] The final single-file production build passes after the spec rewrite.
- [x] The source directory and the embedded bundle match exactly in file count and content.
- [ ] A direct `file://` offline browser run issues zero resource requests.
- [x] The 720px responsive-drawer and horizontal-overflow browser checks pass.
- [ ] The automated WCAG audit passes on the v0.2 artifact.

## Browser Evidence

- [x] The local HTTP preview opens `README.md` under Specify with 15 files, including the self-contained HTML preview demo, and no leftover entity cards.
- [x] `tasks.md` navigation, the exact-source toggle, and full-text search work.
- [x] The browser console reports no errors.
- [ ] In-app browser automation cannot occupy a `file://` tab because of the local-file security policy; direct file reload is still a manual check.

## Intentionally Deferred

- [x] Markdown WYSIWYG/source editing with no exposed formatting toolbar
- [x] Structured YAML frontmatter property editing for Markdown; standalone YAML/JSON remain source editors
- [x] Save and Save a copy UI
- [ ] Recovery and local version history UI
- [ ] YAML/JSON/OpenAPI renderers
- [ ] Derived traceability and Readiness views
