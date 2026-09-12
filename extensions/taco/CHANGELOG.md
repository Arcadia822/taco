# Changelog

## Unreleased

- Upgrade Mermaid to 12.0.0 with ELK layout and native theme paint preserved by a scoped SVG/CSS sanitizer.
- Unify standalone Mermaid into a full-width diagram view with an editable, syntax-highlighted floating source card in normal and enlarged views.
- Focus diagram nodes and matching source without opening a composer; an anchored node toolbar and the existing source-selection action create comments explicitly.
- Store Mermaid configuration in YAML frontmatter; default to `redux` in Taco light mode and `redux-dark` in dark mode when opening unconfigured diagrams. Preserve explicit themes and migrate valid init directives without losing custom settings. Theme and outer direction controls preserve nested directions and explicit layout choices.
- Highlight diagram edges with both endpoints, preserve native theme colors, and add subtle node shadows. Ordinary wheel input scrolls; Command-wheel zooms diagrams; left-drag pans without clearing selection.
- Restore Redux Color and Redux Dark Color node fills from Mermaid's palettes, strengthen hover/selection paint, and replace rectangular focus outlines with shape-following feedback.
- Add a live-update switch and manual refresh to the source header. Pausing retains source edits, and fullscreen reuses the same editor and paused preview.
- Offer System, Light, and Dark appearance modes beside the language control, defaulting to System with live OS updates. Global appearance changes synchronize visible Mermaid diagrams: preserve Redux, Redux Color, and Neo families, otherwise use the matching Redux variant. Preserve pending source edits when previews are paused; reader copies change only their rendered appearance.
- Keep standalone Mermaid controls outside the canvas scroll area: long-source paste no longer scrolls the toolbar behind the workspace header.
- Remove the raw codeblock toggle from embedded Markdown Mermaid diagrams; retain their floating source editor and render-failure recovery.
- Fix empty standalone Mermaid enlargement, linked inline-code README migration, and recursively embedded generated Taco files in the production showcase.

## 0.4.0 - 2026-08-26

- Make every packaged UTF-8 file discoverable exactly once through the canonical stage groups or the `Other files` group.
- Render OpenAPI 3.0 and 3.1 YAML or JSON as an operation-focused overview with consistent metadata tables, API paths, tags, parameters, responses, schemas, security schemes, and servers.
- Render ordinary YAML as highlighted source and standalone Mermaid files with preview, zoom, highlighted source, diagnostics, and safe fallback behavior while preserving canonical text and editor history across view switches.
- Add principal-scoped in-place comment message editing, writable message-level tombstone deletion, deterministic ordering, edited/deleted CLI projections, and sync protocol v3 convergence.
- Prepare the core Spec Kit specification template during installation, using YAML frontmatter that distinguishes logical `feature_id` from an optional verified `git_branch` while preserving customized bodies.
- Preserve replacement-token source text literally when embedding bundle JSON.

## 0.3.1 - 2026-08-25

- Package complete Spec Kit feature directories as portable Taco review files.
- Sync conflict-free human edits and anchored comment threads back to canonical files.
- Refresh Taco files through two Agent commands and eight Spec Kit lifecycle hooks.
- Support Spec Kit 0.16.x and 1.x through the declared `>=0.16.0,<2.0.0` range.
