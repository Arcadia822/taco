#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Run through verify.mjs; it supplies the owned instance and captures cleanup evidence.
export default async function ({ page, bundle, outDir, capture, step, assert }) {
  const files = bundle.files.filter((file) => file.mediaType === 'text/markdown')
  const current = await page.locator('nav.file-sidebar button.file-row.is-selected[data-path]').getAttribute('data-path')
  const target = files.find((file) => file.path !== current)
  assert(target, 'Browsing proof needs two Markdown files')
  await capture('browse-before')
  await step(`browse/sidebar: click ${target.path}`, async () => {
    // Attribute comparison disambiguates repeated filenames without interpolating paths into CSS.
    const rows = page.locator('nav.file-sidebar button.file-row[data-path]')
    let selected
    for (const candidate of await rows.all()) {
      if (await candidate.getAttribute('data-path') === target.path) { selected = candidate; break }
    }
    assert(selected, `Missing sidebar row: ${target.path}`)
    if (!await selected.isVisible()) {
      // Group expansion remains a user action; recipe readers inspect the snapshot for that group.
      throw new Error(`Target group collapsed for ${target.path}; use an expanded root file in the fixture`)
    }
    await selected.click()
    await page.waitForFunction((path) => document.querySelector('nav.file-sidebar button.file-row.is-selected')?.getAttribute('data-path') === path, target.path)
    await page.locator('main#taco-main .tiptap-editor-host .ProseMirror').waitFor({ state: 'visible' })
    const rendered = await page.locator('main#taco-main .tiptap-editor-host .ProseMirror').innerText()
    const read = await page.evaluate((path) => window.taco.readFile(path), target.path.startsWith(`${bundle.root}/`) ? target.path.slice(bundle.root.length + 1) : target.path)
    assert.equal(read.content, target.content)
    // Match actual paragraph/heading prose, not just the navigation selection.
    const plain = target.content.replace(/^---\n[\s\S]*?\n---\n/, '')
    const line = plain.split('\n').find((value) => /^#{1,6}\s+\S/.test(value))
    assert(line, 'Select a fixture Markdown file with a visible heading')
    assert(rendered.includes(line.replace(/^#{1,6}\s+/, '').replace(/[*`]/g, '').trim()), 'Selected document heading did not render')
    await writeFile(resolve(outDir, 'browse-state.json'), JSON.stringify({ feature: 'browse-search', entryPoint: 'sidebar', before: current, after: target.path, heading: line, contentMatchesBundle: true }, null, 2))
  })
  await capture('browse-after')
}
