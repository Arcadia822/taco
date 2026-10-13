#!/usr/bin/env node

import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'

// Invoke through verify.mjs --scenario .cursor/skills/verify-taco/scripts/edit-save.mjs.
export default async function ({ page, outDir, bundle, capture, step, reopen, assert }) {
  const path = await page.locator('nav.file-sidebar button.file-row.is-selected[data-path]').getAttribute('data-path')
  const file = bundle.files.find((entry) => entry.path === path)
  assert.equal(file?.mediaType, 'text/markdown', 'Edit/save proof requires a selected Markdown file')
  const marker = 'Verification evidence: edited through the real Taco document body.'
  await capture('edit-before')
  await step(`edit/markdown: append paragraph to ${path}`, async () => {
    await page.locator('main#taco-main .tiptap-editor-host .ProseMirror').click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type(marker)
    await page.waitForFunction((text) => window.taco.getReviewHandoff().changedFiles.some((entry) => entry.content.includes(text)), marker)
    assert((await page.locator('main#taco-main .tiptap-editor-host .ProseMirror').innerText()).includes(marker))
  })
  await capture('edit-after')
  let downloaded
  await step('save/main: confirm supported download fallback and retain actual file', async () => {
    // Production file-access boundary only. This proves the download fallback, not native picker writes.
    await page.evaluate(() => { window.showSaveFilePicker = undefined })
    const pending = page.waitForEvent('download')
    await page.locator('button.save-button').click()
    await page.locator('dialog.confirmation-dialog[open] .control-button-primary').click()
    const download = await pending
    downloaded = resolve(outDir, 'edited.taco.html')
    await download.saveAs(downloaded)
    assert.equal(await download.failure(), null)
    await writeFile(resolve(outDir, 'download.json'), JSON.stringify({ suggestedFilename: download.suggestedFilename(), file: 'edited.taco.html', feature: 'save-handoff', entryPoint: 'save/main' }, null, 2))
  })
  await step('save/reopen: verify persisted paragraph and original document identity', async () => {
    const reopened = await reopen(downloaded)
    assert.equal(reopened.bundle.docId, bundle.docId)
    const savedFile = reopened.bundle.files.find((entry) => entry.path === path)
    assert(savedFile?.content.includes(marker), 'Downloaded bundle did not persist the edit')
    const rows = reopened.page.locator('nav.file-sidebar button.file-row[data-path]')
    for (const row of await rows.all()) {
      if (await row.getAttribute('data-path') === path) { await row.click(); break }
    }
    await reopened.page.waitForFunction((text) => document.querySelector('main#taco-main .ProseMirror')?.textContent.includes(text), marker)
    await capture('saved-reopened', reopened.page)
    await writeFile(resolve(outDir, 'persisted-state.json'), JSON.stringify({ path, docId: bundle.docId, marker, persistedInBundle: true, visibleAfterReopen: true }, null, 2))
  })
}
