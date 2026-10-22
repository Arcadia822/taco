// SPDX-License-Identifier: MIT
// Real user interactions shared by the Taco verification cases.
//
// Every helper drives the shipped UI: clicks, typing and the documented
// download fallback. window.taco stays read-only for assertions.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Names match the ids used by the case modules and the capture evidence. */
export const AUTHOR_NAME = 'Verification Reviewer'

const elementHandle = (page, predicate, ...args) => page.evaluateHandle(predicate, ...args)

const selectedRow = (page) => page.locator('nav.file-sidebar button.file-row.is-selected').first()

/**
 * Resolve the caller's path to the one sidebar element it names: either a
 * collapsed ancestor summary to click, or the target row itself. Both
 * documented forms are accepted: the full bundle data-path
 * (`verify/guides/guide.md`) and the root-relative manifest path
 * (`guides/guide.md`). A relative path matching several rows (the fixture ships
 * two readme.md files) fails loudly instead of guessing.
 */
const resolveStep = (page, path) =>
  page.evaluateHandle((wanted) => {
    const rows = Array.from(document.querySelectorAll('button.file-row[data-path]'))
    const full = rows.filter((row) => row.dataset.path === wanted)
    const named = full.length ? full : rows.filter((row) => row.dataset.path.endsWith(`/${wanted}`))
    if (!named.length) return 'missing'
    if (named.length > 1) return `ambiguous:${named.length}`
    const row = named[0]
    for (let node = row.parentElement; node; node = node.parentElement) {
      if (node instanceof HTMLDetailsElement && !node.open) {
        return node.querySelector(':scope > summary') ?? 'missing'
      }
    }
    return row
  }, path)

/**
 * Select a file in the sidebar. Collapsed ancestors (navigation groups and
 * folders) are expanded with real summary clicks before the target row is
 * clicked, so repeated basenames stay unambiguous. Returns the selected row.
 */
export async function selectFile(page, path) {
  assert(
    typeof path === 'string' && path,
    'selectFile requires a bundle data-path or a root-relative path',
  )
  let resolved
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const handle = await resolveStep(page, path)
    const element = handle.asElement()
    if (!element) {
      const state = await handle.jsonValue()
      assert(
        state !== 'missing',
        `Sidebar row not found: ${path}; pass a bundle data-path ("verify/${path}") or a root-relative path`,
      )
      const matches = Number(String(state).split(':')[1])
      assert(
        false,
        `Sidebar path is ambiguous: ${path} names ${matches} rows; pass the full bundle data-path`,
      )
    }
    const isRow = await element.evaluate((node) => node.classList.contains('file-row'))
    await element.click()
    if (isRow) {
      resolved = element
      break
    }
    assert(attempt < 39, `Sidebar ancestors did not expand for ${path}`)
  }
  assert(resolved, `Sidebar row not found: ${path}`)
  const selected = await resolved.evaluate((node) => node.dataset.path)
  await page.waitForFunction(
    (wanted) =>
      document.querySelector('nav.file-sidebar button.file-row.is-selected')?.dataset.path ===
      wanted,
    selected,
    { timeout: 15000 },
  )
  return selectedRow(page)
}

const RICH_EDITOR = 'main#taco-main .tiptap-editor-host .ProseMirror'
const SOURCE_EDITOR = 'main#taco-main .source-editor textarea.source-editor-input'

/** Platform end-of-document keys; both move the caret, they never edit text. */
const documentStartKey = () => (process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')
const documentEndKey = () => (process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')

/**
 * Wait until the caret has held still. The rich editor adopts a native caret
 * move on its own selection event, which lands one task after the key press:
 * measured at 20-60ms after the end-of-document key on this editor. Returning
 * before that lets the caller's very next key press reach the editor while it
 * still holds the previous selection.
 */
const settleSelection = async (page) => {
  const polls = 5
  const interval = 20
  const timeout = 800
  const bookmark = () =>
    page.evaluate(() => {
      const selection = document.getSelection()
      const node = selection?.anchorNode
      if (!node) return 'none'
      const name = node.nodeType === 3 ? (node.parentElement?.tagName ?? '#') : node.nodeName
      return `${name}:${selection.anchorOffset}/${selection.focusOffset}`
    })
  const deadline = Date.now() + timeout
  let previous = null
  let stable = 0
  while (Date.now() < deadline && stable < polls) {
    const current = await bookmark()
    stable = current === previous ? stable + 1 : 1
    previous = current
    if (stable < polls) await page.waitForTimeout(interval)
  }
}

/**
 * Read-only proof that the active editor owns a collapsed caret at the end of
 * its own content. The rich branch builds a suffix Range from the live caret to
 * the end of the editor and requires it to hold no text, so a caret left behind
 * by a clipped click or a lost focus is reported instead of typed into.
 */
const caretAtEditorEnd = (page, editor) =>
  page.evaluate((selector) => {
    const root = document.querySelector(selector)
    if (!root) return { ok: false, reason: 'the active editor is not in the document' }
    const active = document.activeElement
    if (active !== root && !root.contains(active)) {
      return {
        ok: false,
        reason: `the editor does not own focus (active element ${active?.tagName ?? 'none'})`,
      }
    }
    const selection = document.getSelection()
    if (!selection?.anchorNode) return { ok: false, reason: 'the document exposes no selection' }
    if (!selection.isCollapsed)
      return { ok: false, reason: 'the caret is a non-collapsed selection' }
    if (!root.contains(selection.anchorNode))
      return { ok: false, reason: 'the caret sits outside the editor' }
    const suffix = document.createRange()
    suffix.selectNodeContents(root)
    suffix.setStart(selection.anchorNode, selection.anchorOffset)
    const trailing = suffix.toString()
    return trailing.trim()
      ? {
          ok: false,
          reason: `text still follows the caret (${JSON.stringify(trailing.slice(0, 40))})`,
        }
      : { ok: true, reason: 'collapsed caret with no following text' }
  }, editor)

/**
 * Focus the active editor at its actual document end through native input.
 *
 * One click is not enough. ProseMirror only adopts a DOM selection change while
 * the editor already owns focus, so the selection its own focus handling
 * produces can be dropped and the editor keeps the selection it had before
 * (the document start). The following Enter then runs at the document start and
 * the typed paragraph lands in the first block, which is exactly the regression
 * the callers assert against. Moving to the document start and back to the
 * document end with the platform end-of-document keys forces two real caret
 * moves - and therefore two adoptable selection changes - before any caller
 * types. The editor reads that change one task later, so the caret is allowed to
 * hold still first and the result is verified read-only before returning.
 */
export async function focusAtDocumentEnd(page) {
  const rich = page.locator(RICH_EDITOR).first()
  if (await rich.count()) {
    await rich.waitFor({ state: 'visible', timeout: 15000 })
    const blocks = rich.locator(':scope > *')
    const total = await blocks.count()
    assert(total > 0, 'The rich editor has no block to type into')
    const last = blocks.nth(total - 1)
    const box = await last.boundingBox()
    assert(box, 'The last editor block is not visible')
    await last.click({
      position: { x: Math.max(box.width - 2, 1), y: Math.max(box.height / 2, 1) },
    })
    await page.keyboard.press(documentStartKey())
    // Let the editor adopt the start selection before the next native move.
    await settleSelection(page)
    await page.keyboard.press(documentEndKey())
    await settleSelection(page)
    const state = await caretAtEditorEnd(page, RICH_EDITOR)
    assert.ok(state.ok, `The rich editor caret must reach the document end: ${state.reason}`)
    return
  }
  const source = page.locator(SOURCE_EDITOR).first()
  await source.waitFor({ state: 'visible', timeout: 15000 })
  const box = await source.boundingBox()
  assert(box, 'The source editor is not visible')
  await source.click({
    position: { x: Math.max(box.width - 8, 1), y: Math.max(box.height - 8, 1) },
  })
  await page.keyboard.press(documentStartKey())
  await page.keyboard.press(documentEndKey())
  const atEnd = await page.evaluate((selector) => {
    const area = document.querySelector(selector)
    return (
      Boolean(area) && document.activeElement === area && area.selectionStart === area.value.length
    )
  }, SOURCE_EDITOR)
  assert.ok(atEnd, 'The source editor caret must reach the end of its text')
}

/** Type into the end of the active document through the real editor input. */
export async function typeAtEnd(page, text) {
  assert(typeof text === 'string' && text.length > 0, 'typeAtEnd requires text')
  await focusAtDocumentEnd(page)
  await page.keyboard.type(text)
  const needle = text
    .replace(/[^A-Za-z0-9]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
  if (!needle) return
  await page.waitForFunction(
    (value) => {
      const host = document.querySelector('main#taco-main .tiptap-editor-host .ProseMirror')
      const source = document.querySelector(
        'main#taco-main .source-editor textarea.source-editor-input',
      )
      const raw = host?.textContent ?? source?.value ?? ''
      const normalized = raw
        .replace(/[^A-Za-z0-9]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .join(' ')
      return normalized.includes(value)
    },
    needle,
    { timeout: 10000 },
  )
}

const threadIds = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('article.comment-thread[data-thread-id]')).map(
      (card) => card.dataset.threadId,
    ),
  )

/**
 * Submit an already-open comment composer and answer the real author dialog.
 * The caller selects text and clicks the selection comment button first.
 * Returns the id of the thread the UI created.
 */
export async function submitComment(page, body, { author = AUTHOR_NAME } = {}) {
  assert(typeof body === 'string' && body.trim(), 'submitComment requires a body')
  const composer = page.locator('.comment-composer textarea.comment-input').first()
  await composer.waitFor({ state: 'visible', timeout: 15000 })
  const before = await threadIds(page)
  await composer.fill(body)
  const needsAuthor = await page.evaluate(
    () =>
      !(
        sessionStorage.getItem('taco-session-author') ??
        localStorage.getItem('taco-author') ??
        ''
      ).trim(),
  )
  const dialog = page.locator('dialog.author-name-dialog')
  const answering = (async () => {
    try {
      await dialog.waitFor({ state: 'visible', timeout: needsAuthor ? 10000 : 1500 })
    } catch {
      return
    }
    await dialog.locator('input.author-name-input').fill(author)
    await dialog.locator('.author-name-actions .control-button-primary').click()
  })()
  answering.catch(() => {})
  try {
    await page.locator('.comment-composer button.comment-submit').first().click()
    const handle = await page.waitForFunction(
      (known) => {
        const ids = Array.from(
          document.querySelectorAll('article.comment-thread[data-thread-id]'),
        ).map((card) => card.dataset.threadId)
        return ids.find((id) => id && !known.includes(id)) ?? null
      },
      before,
      { timeout: 20000 },
    )
    const threadId = await handle.jsonValue()
    await answering
    assert(typeof threadId === 'string' && threadId, 'The composer did not create a comment thread')
    return threadId
  } finally {
    await answering.catch(() => {})
  }
}

/**
 * Save through the product's save entry point and keep the downloaded file.
 * The File System Access API is replaced by the documented download fallback,
 * which is a recorded human/external boundary.
 */
export async function saveDownload(h, name, { page = h?.page, trigger } = {}) {
  assert(page, 'saveDownload needs a page; pass the harness or { page }')
  assert(typeof name === 'string' && name, 'saveDownload requires an evidence file name')
  const outDir = h?.outDir
  assert(typeof outDir === 'string' && outDir, 'saveDownload needs h.outDir')
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true })
  })
  h?.boundary?.('Native file picker replaced by the documented download fallback')
  const abortController = new AbortController()
  const waiter = page.waitForEvent('download', { timeout: 30000, signal: abortController.signal })
  waiter.catch(() => {})
  try {
    const dialog = page.locator('dialog.confirmation-dialog .control-button-primary')
    // Locator.waitFor resolves to undefined, so the branch needs an explicit boolean.
    const confirmNeeded = dialog
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false)
    if (trigger) await trigger()
    else await page.locator('button.save-button').first().click()
    if (await confirmNeeded) await dialog.click()
    const download = await waiter
    const file = resolve(outDir, name)
    await download.saveAs(file)
    assert((await readFile(file)).length > 0, `Saved download is empty: ${file}`)
    return file
  } catch (error) {
    abortController.abort()
    throw error
  }
}

/** Open the right panel and one of its tabs (outline, comments, instruction). */
export async function openPanelTab(page, name) {
  assert(['outline', 'comments', 'instruction'].includes(name), `Unknown panel tab: ${name}`)
  const toggle = page.locator('button.comment-toggle').first()
  await toggle.waitFor({ state: 'visible', timeout: 15000 })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  const tab = page
    .locator(`.right-panel-tabs button.segmented-control-option[data-segmented-value="${name}"]`)
    .first()
  assert(await tab.count(), `The ${name} panel tab is not available for the selected file`)
  await tab.click()
  await page.waitForFunction(
    (wanted) =>
      document
        .querySelector(
          `.right-panel-tabs button.segmented-control-option[data-segmented-value="${wanted}"]`,
        )
        ?.getAttribute('aria-selected') === 'true',
    name,
    { timeout: 10000 },
  )
}
