#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { marked } from 'marked'

const WAIT_MS = 15000
const defaultArtifact = resolve(process.cwd(), 'dist-single/Taco_Spec.taco.html')
const targetPath = resolve(process.cwd(), process.argv[2] ?? defaultArtifact)

if (!existsSync(targetPath)) {
  throw new Error(`Built shell not found: ${targetPath}. Run npm run check before the smoke test.`)
}

const html = readFileSync(targetPath, 'utf8')
const documentMatch = html.match(/<script\b[^>]*\bid=["']taco-document["'][^>]*>([\s\S]*?)<\/script>/i)
assert(documentMatch, `Target file must contain <script id="taco-document">: ${targetPath}`)

let embeddedDoc
try {
  embeddedDoc = JSON.parse(documentMatch[1].trim())
} catch (error) {
  assert.fail(`Embedded #taco-document JSON is not parseable: ${error.message}`)
}
assert.equal(embeddedDoc.format, 'taco/files', `Embedded format must be 'taco/files', found: ${embeddedDoc.format}`)
assert.equal(embeddedDoc.version, 1, `Embedded bundle version must be 1, found: ${embeddedDoc.version}`)
assert(Array.isArray(embeddedDoc.files) && embeddedDoc.files.length > 0, 'Embedded document must contain a non-empty files array')

const relative = (path) => (path.startsWith(`${embeddedDoc.root}/`) ? path.slice(embeddedDoc.root.length + 1) : path)
const expectedPaths = embeddedDoc.files
  .filter((file) => !file.path.endsWith('/.DS_Store'))
  .map((file) => relative(file.path))
  .sort()

const pageErrors = []
const browser = await chromium.launch({ headless: true })

try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => pageErrors.push(error.message || String(error)))

  await page.goto(pathToFileURL(targetPath).href, { waitUntil: 'load', timeout: WAIT_MS })
  assert.equal(pageErrors.length, 0, `Uncaught pageerror during navigation:\n${pageErrors.join('\n')}`)

  await page.waitForFunction(() => typeof window.taco === 'object' && window.taco !== null, undefined, { timeout: WAIT_MS })

  const snapshot = await page.evaluate(() => {
    const api = window.taco
    const source = JSON.parse(document.getElementById('taco-document').textContent)
    const relative = (path) => (path.startsWith(`${source.root}/`) ? path.slice(source.root.length + 1) : path)
    const mismatches = []
    for (const file of source.files) {
      if (file.path.endsWith('/.DS_Store')) continue
      const read = api.readFile(relative(file.path))
      if (!read) mismatches.push(`${file.path}: readFile returned null`)
      else if (read.path !== file.path) mismatches.push(`${file.path}: path ${read.path}`)
      else if (read.mediaType !== file.mediaType) mismatches.push(`${file.path}: mediaType ${read.mediaType}`)
      else if (read.content !== file.content) mismatches.push(`${file.path}: content differs`)
    }
    return {
      format: api.format,
      files: api.listFiles().map((file) => file.path),
      validation: api.validate(),
      readFileMismatches: mismatches,
    }
  })

  assert.equal(snapshot.format, 'taco/files', `window.taco.format must be 'taco/files', found: ${snapshot.format}`)
  assert.deepEqual([...snapshot.files].sort(), expectedPaths, 'window.taco.listFiles() must match the embedded #taco-document files')
  assert.deepEqual(snapshot.readFileMismatches, [], `window.taco.readFile() must return each embedded file:\n${snapshot.readFileMismatches.join('\n')}`)
  assert.equal(snapshot.validation.ok, true, `window.taco.validate() must pass: ${JSON.stringify(snapshot.validation)}`)
  assert.equal(snapshot.validation.counts.error, 0, `window.taco.validate() must report no errors: ${JSON.stringify(snapshot.validation)}`)

  await page.waitForSelector('#taco-splash', { state: 'detached', timeout: WAIT_MS })

  const selectedRow = page.locator('nav.file-sidebar button.file-row.is-selected[data-path]')
  await selectedRow.waitFor({ state: 'visible', timeout: WAIT_MS })
  const selectedPath = await selectedRow.first().getAttribute('data-path')
  const selectedFile = embeddedDoc.files.find((file) => file.path === selectedPath)
  assert(selectedFile, `Selected sidebar row must map to an embedded file: ${selectedPath}`)
  assert.equal(selectedFile.mediaType, 'text/markdown', `Selected file must be Markdown: ${selectedPath} (${selectedFile.mediaType})`)

  await page.waitForSelector('main#taco-main section.markdown-document-shell .tiptap-editor-host .ProseMirror', {
    state: 'visible',
    timeout: WAIT_MS,
  })

  const renderedMarkdown = marked.parse(selectedFile.content)
  const renderedBlocks = await page.evaluate((html) => {
    const selector = 'h1, h2, h3, h4, h5, h6, p, li, pre'
    const text = (root) => [...root.querySelectorAll(selector)]
      .map((node) => node.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    const expected = text(new DOMParser().parseFromString(html, 'text/html'))
    const actual = text(document.querySelector('main#taco-main .tiptap-editor-host .ProseMirror'))
    return actual.filter((block) => expected.includes(block))
  }, renderedMarkdown)
  assert(renderedBlocks.length > 0, `Reader must render Markdown content from ${selectedPath}`)

  const finalValidation = await page.evaluate(() => window.taco.validate())
  assert.equal(finalValidation.ok, true, `window.taco.validate() must still pass after the reader mounted: ${JSON.stringify(finalValidation)}`)
  assert.equal(pageErrors.length, 0, `Deferred pageerror after the reader mounted:\n${pageErrors.join('\n')}`)

  console.log(`browser smoke passed: ${embeddedDoc.files.length} files, selected ${selectedPath}, rendered "${renderedBlocks[0]}", ${snapshot.validation.counts.warning} warning(s)`)
} finally {
  await browser.close()
}
