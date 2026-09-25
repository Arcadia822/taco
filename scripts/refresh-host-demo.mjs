import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const shellPath = resolve(root, 'dist-single/Taco_Spec.taco.html')
const demoRoot = resolve(root, 'packages/host/public/demo')
const block = /(<script type="application\/taco\+json" id="taco-document">)[\s\S]*?(<\/script>)/g
const title = /(<title>)[\s\S]*?(<\/title>)/g

const shell = await readFile(shellPath, 'utf8')
if ([...shell.matchAll(block)].length !== 1 || [...shell.matchAll(title)].length !== 1) {
  throw new Error(`Invalid Taco shell: ${shellPath}`)
}

const updates = []
for (const locale of ['en', 'zh-Hans']) {
  for (const state of ['', 'after/']) {
    const path = resolve(demoRoot, locale, state, '008-taco-host-contract.taco.html')
    const previous = await readFile(path, 'utf8')
    const matches = [...previous.matchAll(block)]
    if (matches.length !== 1) throw new Error(`Expected one Taco document: ${path}`)
    const documentJson = matches[0][0].slice(matches[0][1].length, -matches[0][2].length)
    const document = JSON.parse(documentJson)
    if (document.format !== 'taco/files' || document.version !== 1 || document.root !== 'specs/008-taco-host-contract') {
      throw new Error(`Unexpected demo document: ${path}`)
    }
    const escapedTitle = `${document.title} — Taco`.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    const html = shell
      .replace(block, (_match, open, close) => `${open}${documentJson}${close}`)
      .replace(title, (_match, open, close) => `${open}${escapedTitle}${close}`)
    updates.push({ path, html })
  }
}

await copyFile(shellPath, resolve(root, 'packages/host/assets/taco-shell.html'))
for (const { path, html } of updates) {
  await writeFile(path, html, 'utf8')
  process.stdout.write(`Refreshed ${path}\n`)
}
