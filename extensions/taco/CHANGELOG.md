# Changelog

## Unreleased

### Bug Fixes

* **ui**: Show only filenames or localized Checkpoints in the shared Taco and Tacobin header; remove header title, template and Category editing. Keep narrow-screen save and handoff controls accessible.
* **host**: Restore local Taco saving and label listener details `runtime` / `运行时`.
* **ui**: Use the default button variant for the handoff dropdown arrow so its gray background does not turn primary green on hover.

### Documentation

* **review**: Align the skill, embedded CLI guide, bilingual README, installation guides, website and current specifications with the simplified header, local Save, active-listener Handoff and default subscription exit behavior.

## [0.12.0](https://github.com/Arcadia822/taco/compare/v0.11.0...v0.12.0) (2026-09-29)

### Features

* **release**: package the Spec Kit extension archive and harden the release pipeline (#83) ([16c8639](https://github.com/Arcadia822/taco/commit/16c86391f085bbd6741e9b6aa7920bb3ad6f8468))
* **skill**: lint Mermaid diagrams before delivery ([8f3de5c](https://github.com/Arcadia822/taco/commit/8f3de5cd736d00af48734403215cbb67a1c14889))
* **skill**: check for taco, taco-cli and extension updates per work session ([d13a7db](https://github.com/Arcadia822/taco/commit/d13a7db1c8d91b4504111bdd222055a071e14994))
* **skill**: write the Taco block directly and place it by a cascade (TACO-9) ([d60f5dc](https://github.com/Arcadia822/taco/commit/d60f5dce7c750dc97b1fb2694857d0b20e02f7fd))
* **security**: support markdown multimedia rendering (close #38) (#74) ([f259af6](https://github.com/Arcadia822/taco/commit/f259af6293e62145c84dc8e948674cba75972c4a))
* **checkpoint**: support optional instruction for checkpoint document and right panel instruction tab (#73) ([f74a8cc](https://github.com/Arcadia822/taco/commit/f74a8cc15c5238ab9d15e1f991bf61df4fdc1bc1))
* take bundle serialization and validation off the agent ([80a4899](https://github.com/Arcadia822/taco/commit/80a48992d61f6ad89abc78b169cd081e474fbeba))

### Bug Fixes

* **mermaid**: restore label text paint and close review findings ([a46ae7b](https://github.com/Arcadia822/taco/commit/a46ae7b2e0c0ac5542425c4456f8ae5b46863d4b))
* **editor**: keep emphasis that wraps a code span from breaking the document (#81) ([ad751a1](https://github.com/Arcadia822/taco/commit/ad751a18c5fdbd8506b05ecd5f19535591bfb16e))
* **cli**: sync binaryVersion with package.json automatically (#70) ([881ac7e](https://github.com/Arcadia822/taco/commit/881ac7e84c982fafa94873af8f7ff84ae569c34b))

### Chores & Maintenance

* chore: **release**: tacobin-v0.5.0 ([4229cfe](https://github.com/Arcadia822/taco/commit/4229cfe011c7a3a80b2414759651856f5993f80a))
* chore: **release**: taco-cli v0.3.0 ([861099a](https://github.com/Arcadia822/taco/commit/861099a1125886276e45fd82124f43f21ad25722))
* chore: **release**: tacobin-v0.4.0 ([b19bcb2](https://github.com/Arcadia822/taco/commit/b19bcb28a0d87579b2c46d88f8e1d111ae736081))
* build: **shells**: regenerate shells and template mirrors after the rebase ([0fe4cf7](https://github.com/Arcadia822/taco/commit/0fe4cf72337f7e0089e3f8b9e00b89f9ff5cb8e6))
* docs: **specs**: refresh TACO-19 taco with the final measured sizes ([2797f79](https://github.com/Arcadia822/taco/commit/2797f790cdb15fad868f9dd377af406d7275475b))
* test: **mermaid**: make the theme-position and fence edge cases catch their defects ([0bdfe14](https://github.com/Arcadia822/taco/commit/0bdfe14ce09a2235e803662d99b8dbf1f5b1157b))
* docs: **specs**: refresh TACO-19 taco with measured sizes and the label-paint fix ([cea308d](https://github.com/Arcadia822/taco/commit/cea308df5342f9e72f932792653bf046b059ff2b))
* docs: **specs**: freeze TACO-19 design and make mermaid lint zero-dependency ([251c7b5](https://github.com/Arcadia822/taco/commit/251c7b57a1937ba44b012d491547381173dd6365))
* docs: **specs**: refresh TACO-19 taco with size budget ([a555242](https://github.com/Arcadia822/taco/commit/a5552429130d2ad0f2adb5148ca57483e47a1666))
* docs: **agents**: require size estimates in prepare and measurements in develop ([faa9e25](https://github.com/Arcadia822/taco/commit/faa9e2537f2cae044a14766afc1f4cef00e0e038))
* docs: **specs**: generate re-aimed TACO-19 review taco ([c0612c6](https://github.com/Arcadia822/taco/commit/c0612c6d55df3352f4284e95fd4c785d3953af51))
* docs: **specs**: align verification section with 22-case matrix and A8 checklist ([827290d](https://github.com/Arcadia822/taco/commit/827290d30c3f1e7ecad078db98ebf7563bdbc94b))
* docs: **specs**: resolve first re-aim review findings for TACO-19 ([7908bd5](https://github.com/Arcadia822/taco/commit/7908bd5d0e3827d2c41e98a4dc6e24d44ddf444a))
* docs: **specs**: re-aim TACO-19 design at agent-side mermaid lint as 013 ([7f30eb6](https://github.com/Arcadia822/taco/commit/7f30eb64d953158cbb2d3c0aa7b38471f9cb4a66))
* docs: **specs**: retract incorrect mermaid parse conclusion and re-aim TACO-19 target ([07dd2cc](https://github.com/Arcadia822/taco/commit/07dd2ccbe8a3501424f344333bcbb7bd20de8080))
* docs: **specs**: generate TACO-19 review taco ([6ef5642](https://github.com/Arcadia822/taco/commit/6ef5642300cc01b3d6d95285db6d3dbd345dec79))
* docs: **specs**: resolve second-review findings for TACO-19 design ([3763b5b](https://github.com/Arcadia822/taco/commit/3763b5b0503c00158d776b4b1c7d1f932eaaf93c))
* docs: **specs**: apply independent review fixes to TACO-19 design ([98ec1e0](https://github.com/Arcadia822/taco/commit/98ec1e000e1149bc2cb5e3d7f87e310958ed196f))
* docs: **specs**: resolve TACO-19 design decisions D1/D2 ([85a87a2](https://github.com/Arcadia822/taco/commit/85a87a2e0f3227777317b1d933688b5eaf101c5c))
* docs: **specs**: add TACO-19 mermaid editing lint design draft ([ed60f72](https://github.com/Arcadia822/taco/commit/ed60f724daf5db5aab7666e1f3395fc91b25e1e6))
* chore: **release**: tacobin-v0.3.1 ([4c5b677](https://github.com/Arcadia822/taco/commit/4c5b677123e89b7ad68e6daeb18ee0a87268f893))
* chore: **release**: taco-cli v0.2.1 ([ffcb4c6](https://github.com/Arcadia822/taco/commit/ffcb4c6f4d0ebaf0100f19b2c75a6ac16b36d20a))
* chore: **host**: optimize website SEO and meta for Taco and Taco Page (#57) (#71) ([6e2766a](https://github.com/Arcadia822/taco/commit/6e2766aec9bd3727364266d4fd1526bedd412694))

## [0.11.0](https://github.com/Arcadia822/taco/compare/v0.10.0...v0.11.0) (2026-09-26)

### Features

* ship Taco Complete and Lite review shells (#54) ([1f63c7a](https://github.com/Arcadia822/taco/commit/1f63c7aa62cad549fd93aa107fa7770948ba1f41))

### Bug Fixes

* **ui**: remove redundant OpenAPI option from new file dialog (close #48) ([4846799](https://github.com/Arcadia822/taco/commit/48467993439e94ed4d8cd81458fce7710d8405ab))

### Chores & Maintenance

* chore: **release**: tacobin-v0.3.0 ([c027c3d](https://github.com/Arcadia822/taco/commit/c027c3da4d0665eb98d3e644083f44521aedd28d))

## [0.10.0](https://github.com/Arcadia822/taco/compare/v0.9.1...v0.10.0) (2026-09-25)

### Features

* virtual category assignment, remove stage routing and HTML sources (close #52) (#55) ([108d46c](https://github.com/Arcadia822/taco/commit/108d46cfc273933f5f24250139d7a4c6846ff2b6))

### Chores & Maintenance

* chore: **release**: tacobin-v0.2.0 ([d3eb122](https://github.com/Arcadia822/taco/commit/d3eb122344426a8666a99396b10ea81a379992e1))
* chore: **release**: taco-cli v0.2.0 ([f5c15d9](https://github.com/Arcadia822/taco/commit/f5c15d92bdbde88c3f1cdf31effc33248007a2de))

## [0.9.1](https://github.com/Arcadia822/taco/compare/v0.9.0...v0.9.1) (2026-09-24)

### Chores & Maintenance

* chore: **release**: taco-cli v0.1.5 ([c8c4acd](https://github.com/Arcadia822/taco/commit/c8c4acdf1cc25c33e2a20021b9d5e9595770c5ac))
* ci: align actions/setup-node to v7 across release workflows (#67) ([0b476bc](https://github.com/Arcadia822/taco/commit/0b476bc3ddde9bcbe35c76366829f37324cb1683))
* ci: add nightly auto-release workflow and taco-release skill (#58) ([6a12fdc](https://github.com/Arcadia822/taco/commit/6a12fdc4b083d86efebea6003702d49c7b4d8602))
* chore: ignore .omp directory ([a43cbef](https://github.com/Arcadia822/taco/commit/a43cbefcacf741ea732c1d64d23fcacb96070251))

## 0.8.0 - 2026-09-20

- Classify documents only through Taco's built-in Category — the sidebar group control, first-level directory declarations, and the navigation manifest — and stop reading the deprecated `taco_scope` key and the legacy `**Taco scope**:` form entirely; templates, policy, and Agent guidance no longer emit either, and the document property table carries no classification-specific UI (#32).
- Render GitHub repository and issue links in the property table with the GitHub mark, owner/repo label, and public metadata titles; fall back gracefully to the original link offline or when rate-limited, without altering canonical source (#32).
- Order comment threads in the right-hand panel by their anchored position in the active document rather than creation recency; place unresolvable stale threads into an explicit separated group (#34).
- Align comment cards and new-comment composers with their live document anchors, follow document scrolling, and push colliding cards downward with a 12px gap; recalculate after document reflow or card resizing.
- Dismiss the floating selection-comment action when opening its composer, changing selection, clicking or focusing elsewhere, pressing Escape, scrolling, resizing, or leaving the window. Keep selection actions separate from pending comment drafts.
- Keep unsubmitted text in an open comment composer, reply form, or in-place message editor when a document edit rebuilds the panel, restoring focus and caret to the form the reviewer was typing in while closing forms whose content was just committed.
- Resolve Handoff line references through Markdown's rendered text: a comment captured from a reading surface that hides emphasis markers or joins blocks now reports its canonical source line instead of position lost.
- Restate the bundled example specification in terms of Taco's built-in Category and navigation manifest, matching the shipped runtime that no longer routes files by `taco_scope`.
- Replace large-area green background comment highlights with a precise underline over the anchored text, preserving readability across multiline and overlapping ranges (#34).
- Include live 1-based line number ranges (`spec.md:42–46`) computed from current document body text in copied review handoffs; mark unresolvable quotes explicitly as position-lost rather than printing guessed lines (#35).

## 0.7.0 - 2026-09-18
- Back the standalone `taco-cli` client with npm publication as `@tacobin/cli`, alongside the existing GitHub Release standalone binaries.
- Publish the review workflow only when a Taco host is actually needed: the `taco` skill stays fully offline, and `taco-cli` is the cloud publication, subscription, and remote review client.
- Make installing the `taco` skill the default installation: the skill ships its own production shell, whose `#taco-document` block is empty until a document is written into it, plus the `spec`, `architecture`, `api-reference`, and `adr` template packs. Assembly and review then need no CLI, npm package, build, or project modification, and the Spec Kit extension becomes optional project-level wiring taken only on explicit request.
- Assemble and refresh a Taco by writing the `taco/files` bundle into the `#taco-document` block, preserving `docId`, comments, navigation, and per-file identity, and consume the review through the browser Handoff (which does not require saving) or the saved file. The existing `pack`/`sync`/`comments`/`validate` utilities remain available as optional CLI utilities off the required path.
- Proactively open generated or refreshed Taco files in the browser when the host supports and permits local HTML navigation; preserve unsaved reviews, report observed verification separately, and retain clickable-file fallback and Codex's user-click boundary (#31).
- Add runtime-editable sidebar navigation and declarative grouping: create, rename, delete groups, drag files between groups, and declare entry documents.
- Persist navigation declarations to the top-level `navigation` bundle field on save without modifying `files[]` or source hashes.
- Preserve backward compatibility with standard Spec Kit three-stage derivers and default README entry precedence when `navigation` is omitted.
- Sync navigation structure across same-machine collaborative windows via document-level CRDT propagation without protocol migration.

## 0.6.0 - 2026-09-15

- Allow independent desktop outline/comment-panel collapse, restoring each document's desktop preference within the browser session without letting narrow-screen drawers overwrite it. Preserve tabs and comment drafts across toggles, restore focus on close, and leave Escape to active dialogs, menus, and editor handlers.
- Animate desktop right-panel pointer toggles while respecting reduced motion and immediate keyboard interaction. Use one arrowless header icon with a persistent selected state, and remove the redundant in-panel close button.
- Use the same fixed, arrowless left-sidebar icon in its header and collapsed-header controls, without a selected background.
- Open the comments panel and focus the matching thread when an existing inline highlight is clicked, including in read-only copies.
- Preserve reference definitions when adjacent Markdown blocks are deleted, and retain paragraph boundaries when changing block types.
- Include only open requests in copied handoffs, retaining deleted-message placeholders as history. Report unavailable or denied clipboard writes as failures.
- Preserve untouched Markdown blocks, original line endings, and source spacing during review edits and undo; persist edits inside centered HTML rather than restoring stale source.
- Generate applicable unified diffs for empty files, missing final newlines, and large documents without a quadratic-memory matrix. Saving resets the handoff diff baseline.
- Keep enlarged Mermaid source-panel visibility and theme controls synchronized; opening or closing the panel does not edit source. Restore language badge styles outside animation-only rules.
- Scope handoff comment quotes to the selected Mermaid node, source line, or diagram label without altering stored anchors. Direction-only edits preserve raw source and do not persist renderer-default configuration.
- Upgrade Mermaid to 12.0.0 with ELK layout and native theme paint preserved by a scoped SVG/CSS sanitizer.
- Unify standalone Mermaid into a full-width diagram view with an editable, syntax-highlighted floating source card in normal and enlarged views.
- Focus diagram nodes and matching source without opening a composer; an anchored node toolbar and the existing source-selection action create comments explicitly.
- Render unconfigured Mermaid diagrams with `redux` in Taco light mode and `redux-dark` in dark mode without rewriting source merely by opening them. Explicit theme and direction changes preserve custom settings, nested directions, and layout choices.
- Highlight diagram edges with both endpoints, preserve native theme colors, and add subtle node shadows. Ordinary wheel input scrolls; Command-wheel zooms diagrams; left-drag pans without clearing selection.
- Restore Redux Color and Redux Dark Color node fills from Mermaid's palettes, strengthen hover/selection paint, and replace rectangular focus outlines with shape-following feedback.
- Add a live-update switch and manual refresh to the source header. Pausing retains source edits, and fullscreen reuses the same editor and paused preview.
- Offer System, Light, and Dark appearance modes beside the language control, defaulting to System with live OS updates. Global appearance changes synchronize visible Mermaid diagrams: preserve Redux, Redux Color, and Neo families, otherwise use the matching Redux variant. Preserve pending source edits when previews are paused; reader copies change only their rendered appearance.
- Keep standalone Mermaid controls outside the canvas scroll area: long-source paste no longer scrolls the toolbar behind the workspace header.
- Remove the raw codeblock toggle from embedded Markdown Mermaid diagrams; retain their floating source editor and render-failure recovery.
- Fix empty standalone Mermaid enlargement, linked inline-code README migration, and recursively embedded generated Taco files in the production showcase.

## 0.5.0 - 2026-09-09

- Route Taco workflow policy through project process documentation while preserving one durable `AGENTS.md` reference.
- Prevent linked badges and inline Markdown images from crashing editor startup.
- Package validated local PNG assets into self-contained reviews, resolve nested relative Markdown image paths offline, and preserve exact binary bytes during save and sync.

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
