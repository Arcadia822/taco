---
title: "Edit and manage Taco files"
---

Edit the packaged file content, YAML properties and document titles; create, rename or delete files while preserving canonical paths and routing behavior.

## Sub-features

- `edit/markdown`: type into the rich Markdown body and preserve edits through saving.
- `edit/properties`: edit leading YAML title/properties without renaming the file.
- `edit/source`: edit standalone JSON/YAML/plain text; inspect Mermaid source/preview.
- `files/create`: choose a file type and Category or cancel the dialog.
- `files/rename-delete`: rename/delete through Actions or the row context menu.

## How to get to it (user POV)

- Select a Markdown file, then click the document body or its title/Properties fields.
- Select a structured or plain text file; choose Source when the structured viewer offers it.
- Hover a Category and choose Add file; fill its name, choose type/Category and confirm.
- Use a file row's Actions button or right-click that row, then Rename file or Delete file.

## Driving it with Playwright

Preconditions: doctor passes; use disposable bundled content. Run `node .cursor/skills/verify-taco/scripts/verify.mjs --scenario .cursor/skills/verify-taco/scripts/edit-save.mjs` for the executed rich-edit/download/reopen recipe.

- **Rich Markdown.** Click `page.locator('main#taco-main .tiptap-editor-host .ProseMirror')`; press `ControlOrMeta+End`, Enter and type a unique marker. Use `window.taco.getReviewHandoff().changedFiles` only to observe the changed content. Save/reopen via the save map; require the marker in both rendered body and downloaded bundle.
- **Title/properties.** Fill `page.getByRole('textbox', { name: 'File title; does not rename the file or change its path', exact: true })`, then blur with Tab. For the frontmatter field use `page.getByRole('textbox', { name: 'title value', exact: true })`. Capture Properties and the title; confirm updated YAML through `readFile()` and the saved bundle, with unchanged file path. Use `.document-properties-add` for new properties; invalid YAML appears in `.document-properties-invalid-source` and `.document-properties-invalid-message` rather than being silently discarded.
- **Source.** Select `minimal-bundle.json` under contracts/examples. Fill `page.locator('textarea.source-editor-input')` with valid JSON derived from its current value and a changed field. Require exact content in `readFile()`, navigate away/back and save/reopen. OpenAPI JSON/YAML exposes `.segmented-control-option[data-segmented-value="source"]` and `"overview"`; ordinary JSON/YAML may offer source only. Mermaid uses `.standalone-mermaid-source` to toggle its source pane; edit that pane and require the preview SVG to reflect the changed diagram.
- **Create/cancel.** Scope `page.getByRole('button', { name: 'Add file', exact: true })` to the desired Category. Fill `page.locator('#taco-new-file-name')` with `verification-note`; select a type in `.new-file-type-list` and a Category in `#taco-new-file-category`; click `.new-file-confirm`. Require a new selected row, correct extension/media type and saved bundle content. Repeat with `.new-file-cancel` and assert no added path.
- **Rename/delete.** Scope `getByRole('button', { name: 'Actions', exact: true })` to the target `.file-row` (Checkpoint rows place actions in their surrounding row). Also exercise `row.click({ button: 'right' })` when changing menu handling. In `.navigation-popover` choose `Rename file`; fill `.prompt-dialog-input`, confirm through `dialog.prompt-dialog .control-button-primary`. The extension is retained. Choose `Delete file`, first cancel, then confirm through `dialog.confirmation-dialog .control-button-primary`. Check actual path additions/removals and save/reopen. Required Checkpoint paths must remain missing placeholders after rename/delete.

## Gotchas

- Complete Markdown uses rich editing. The current source fallback appears when the rich editor is unavailable; do not invent a universal Markdown source-toggle button from older docs.
- `#taco-new-file-title` labels the dialog; the filename input is `#taco-new-file-name`.
- Editing a title changes YAML metadata, not file path. Categories derive from directories or navigation manifests, never frontmatter routing keys.
- Source observation is not a persistence proof. Reopen the actual saved/downloaded output.
- Native directory writes require explicit scratch-directory handles and interactive permission; the loopback download recipe does not verify them.
