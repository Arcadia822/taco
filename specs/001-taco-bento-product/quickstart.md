---
title: "Quickstart: Taco File Browser"
---

## Build

```bash
npm install
npm test
npm run build
```

Open `dist-single/Taco_Spec.taco.html` directly from the file system.

## Scenario A — Category Navigation and Directory Fidelity

1. Count supported files under `specs/001-taco-bento-product/`, excluding the explicitly ignored HTML prototype and the `.taco.html` container.
2. Compare the paths with `window.taco.listFiles()`.
3. Confirm first-level directories such as `contracts/` and `checklists/` form Categories; root files, including `README.md`, `spec.md`, `plan.md`, and `tasks.md`, appear under Unassigned.
4. In a temporary copy, assign a root document to another Category in the document header, then clear the assignment. Confirm its virtual path and comment anchors stay unchanged while the manifest membership changes.

Expected: each supported file appears exactly once; nested directories remain navigable, and filename and frontmatter conventions do not determine a group. No drag-and-drop file movement is available.

## Scenario B — Markdown Reading

1. Open `README.md` from Unassigned; its filename does not give it opening priority over the first Markdown file unless `navigation.entry` explicitly names it.
2. Use the outline to jump to a heading.
3. Edit in the WYSIWYG surface and save.

Expected: heading navigation is correct and the saved content remains canonical Markdown.

## Scenario C — Editable YAML/JSON Source

Add a temporary YAML or JSON file to the source feature directory and rebuild.

Expected: the file appears in the tree, in an undecorated source editor with no separate header, no large padding, no border, and no background. Editing updates the unsaved state and the saved canonical content; JSON has live syntax highlighting. No structured form appears.

## Scenario D — Search

1. Press `⌘/Ctrl+K`.
2. Search for a filename.
3. Search for a phrase that appears only in file content.

Expected: both queries locate the correct file.

## Scenario E — Offline Single File

1. Open the generated file with `file://`.
2. Disable network access and reload.
3. Browse several Markdown files.

Expected: content stays available, and the resource-request list is empty.

## Scenario F — Narrow Viewport

Reload the file at 720px width.

Expected: the file drawer starts closed, can be opened from the top bar, and the page has no horizontal overflow.

## Scenario G — Security

Run the Markdown sanitizer test fixtures that contain `<script>` and event attributes.

Expected: no executable element or event attribute reaches the rendered DOM.
