---
title: 'Browse and search Taco files'
---

Browse the packaged directory, find files by path or content, follow document headings and open read-only HTML previews.

## Sub-features

- `browse/sidebar`: switch selected files and expand directory groups.
- `browse/outline`: move to a heading in the selected document.
- `search/keyboard`: query paths/content, select results, clear or close the dialog.
- `browse/html`: display an ordinary HTML source page in its sandboxed frame.

## How to get to it (user POV)

- Choose a filename in Files; expand its directory if needed.
- Open the right panel and choose Outline, then a heading.
- Press Cmd+K on macOS or Ctrl+K elsewhere; enter a filename or prose from the file.
- Choose `taco-preview.html` under prototypes to view the packaged HTML page.

## Driving it with Playwright

Run `npm run test:verify -- --feature browse-search` for the fixture-based domain. The default arbitrary-bundle browsing scenario covers only the sidebar entry. Read `scripts/browse.mjs` for exact registered case IDs and assertions.

- **Sidebar.** Run `node .agents/skills/verify-taco/scripts/verify.mjs` against an arbitrary Complete build. It clicks a different Markdown row and compares selected full path, rendered heading and read-only file content. The suite additionally drives collapsed groups and duplicate basenames through real clicks.
- **Expanded group.** In a scenario, find `page.locator('nav.file-sidebar details', { has: page.locator('button.file-row').filter({ hasText: 'requirements.md' }) })`; for each closed ancestor group click its `:scope > summary`. Select the matching `button.file-row[data-path]`. Compare the actual attribute to the bundle's full path when names repeat.
- **Outline.** Click `page.locator('.comment-toggle')` only when its `aria-expanded` is `false`; choose `page.getByRole('tab', { name: 'Outline', exact: true })`, then `page.locator('#taco-outline').getByRole('button', { name: 'Product Boundary', exact: true })` after selecting `requirements.md`. Capture before/after viewport screenshots and check that the actual heading is visible in the reader; a selected outline button alone is insufficient.
- **Search.** Use `page.keyboard.press('ControlOrMeta+k')`, then `page.locator('dialog.search-dialog input.search-input').fill('requirements.md')`. Click `page.locator('dialog.search-dialog button.search-result').filter({ hasText: 'checklists/requirements.md' })`. Require the dialog to close and the matching file/heading to render. Repeat using unique body text, then a guaranteed absent query; check `.search-dialog .empty-state`, clear the input and require zero result buttons, then press Escape.
- **HTML preview.** Click `page.locator('nav.file-sidebar button.file-row').filter({ hasText: 'taco-preview.html' })`. Require the iframe to become visible and inspect rendered content through `page.frameLocator('iframe')`; compare it with that bundled page's title. Capture the frame and inspect network evidence for blocked outbound activity. Do not fill a Markdown editor on this read-only page.

## Gotchas

- File paths in the sidebar are bundle-full paths; the public API also accepts root-relative paths. Compare the actual `data-path` rather than assuming the selected file by row position.
- The HTTP verification instance remembers selection in its URL hash. A fresh context does not make an explicit old hash disappear.
- Root filenames have no routing privileges. Expand Unassigned files when a required row is not visible.
- Search caps results at 50; a broad query cannot prove an omitted result is missing from the bundle.
- The default scenario requires a second Markdown file with a visible heading; custom fixtures without one need their own scenario.
