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

## Scenario A — Stage Projection and Directory Fidelity

1. Count the number of files under `specs/001-taco-bento-product/`.
2. Compare it with `window.taco.listFiles()`.
3. Confirm the sidebar exposes only Specify, Plan, and Tasks, with each stage's core file first.
4. Open `contracts/` and other physical subdirectories in the left navigation.
5. In a temporary copy, change a document's YAML `taco_scope` between `spec`, `plan`, `tasks`, and an invalid text value; verify routing and validation update without losing the invalid text.

Expected: the file count and relative paths match exactly; real directories stay nested; the modified document moves directly to the selected stage without creating an extension group. A missing or invalid scope value does not create a fourth group.

## Scenario B — Markdown Reading

1. Open `README.md` and confirm it appears under Specify; if the feature has no README, confirm Taco opens `spec.md` instead.
2. Use `On this page` to jump to Requirements.
3. Switch between WYSIWYG and Markdown, and edit in both modes.

Expected: heading navigation is correct, and the source is raw Markdown.

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
