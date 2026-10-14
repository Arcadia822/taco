---
title: 'Track required documents with Checkpoints'
---

Review a document dependency graph, update readiness statuses, read required-document instructions and retain missing requirements after file changes.

## Sub-features

- `checkpoints/dashboard`: show graph cards, dependency state and required filenames.
- `checkpoints/status`: change a document through sidebar or dashboard status menus.
- `checkpoints/files`: open an existing requirement or create a missing one.
- `checkpoints/instructions`: show instructions for a tracked file when supplied.
- `checkpoints/missing`: preserve the original requirement path after rename/delete.

## How to get to it (user POV)

- Click Checkpoints pinned below the Files header in a Taco that includes a graph.
- Click the status icon beside a required file, or the document status in its dashboard card; the status menu also offers the Checkpoints view.
- Choose a required filename from sidebar or dashboard; missing files show a placeholder with Create file.
- Select a tracked file with instructions, then choose Instructions in the right panel.
- Rename/delete a required file using Actions and return to its old requirement.

## Driving it with Playwright

Run `npm run test:verify -- --feature checkpoints`. `scripts/fixture.mjs` generates the valid graph, instructions and deliberately missing required path in a current shell by changing only its data block. `scripts/checkpoints.mjs` owns dashboard/status/file/instruction/missing cases. The default production Taco has no graph; never inject one through `window.taco.loadBundle()` as the user proof.

- **Dashboard.** Click `page.locator('button.checkpoint-nav-item')`; require `section.checkpoint-view .checkpoint-graph`, cards named Specification/Plan/Tasks and visible document filenames. Capture graph state and `window.taco.getCheckpoints()`; compare waiting/frontier presentation with resolved dependencies.
- **Sidebar status.** Open a tracked file, click its `.checkpoint-status-button` scoped by its actual accessible name, then choose `.checkpoint-status-menu`'s `getByRole('menuitemradio', { name: 'In progress', exact: true })`. Require the matching document status `in_progress` in `getCheckpoints()` and `getReviewHandoff().checkpointChanges`. Reopen the menu and require `aria-checked="true"` on `getByRole('menuitemradio', { name: /^In progress(?: ✓)?$/ })`; the selected label includes a check mark. Repeat Complete/Freeze/To do using the actual English snapshot labels.
- **Dashboard status.** Click the Checkpoints nav item; scope a `.checkpoint-document` by filename and click `.checkpoint-document-status`. Choose a different status by accessible name, then require sidebar/dashboard/API agreement and saved/reopened status persistence. Also choose the status menu's open-view action from a file page; require the same dashboard.
- **Existing/missing file.** Click `button.checkpoint-document-name` from the graph and separately its sidebar `button.checkpoint-file-select[data-path]`. Require the actual document or `section.checkpoint-placeholder`. For the latter click `button.checkpoint-create-button`; require the missing requirement's original path to become an editable file, and observe saved bundle content.
- **Instructions.** On a fixture containing a document instruction, open the right panel if needed, choose its `Instruction` tab and inspect `#taco-instruction-panel .instruction-body`. Compare the visible instructions with the seeded graph; the example without instructions cannot prove this path.
- **Rename/delete.** From the edit map, rename/delete a tracked file. Return to the original path via sidebar/dashboard; require `data-placeholder="true"` and a missing-file view. Confirm the Checkpoint's required path is unchanged in the downloaded bundle, while the actual renamed/deleted file path changes.

## Gotchas

- Checkpoints are optional. Their absence in the default Taco is expected, not a broken boot; never claim dashboard coverage from the default browse proof.
- File status and aggregate dependency readiness differ. Verify both when changing dependencies.
- Completing or freezing a Checkpoint records review progress; it does not authorize implementation.
- A status menu's `nth()` position is fragile. Use its label/role and checked state.
- Renaming/deleting a file must not rewrite its required Checkpoint path. Use a disposable fixture; never delete canonical files for proof.
