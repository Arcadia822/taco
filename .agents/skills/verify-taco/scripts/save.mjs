#!/usr/bin/env node
// Feature recipe: features/save-handoff.md — real Save entry points, copy/unpack picker
// boundaries and Handoff. Cases mutate only through the real UI, prove persistence by
// downloading the reviewed Taco and reopening it, and assert observed effects, content and
// state. The constants below are only the roles/names needed to drive real clicks; no case
// pins UI prose or menu wording. Copy failure feedback must differ from observed success.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  AUTHOR_NAME,
  focusAtDocumentEnd,
  openPanelTab,
  saveDownload,
  selectFile,
  submitComment,
  typeAtEnd,
} from './ui.mjs'

const AUTHOR = AUTHOR_NAME
const EDITOR = 'main#taco-main .tiptap-editor-host .ProseMirror'
const SAVE_MENU = '.topbar-popover.save-menu'
const COPY_MENU = '.topbar-popover.copy-review-menu'
const CONFIRM = 'dialog.confirmation-dialog'
// Entry-point locators: the rendered names used to drive real clicks.
const SAVE_ENTRY = 'Save'
const SAVE_COPY_ENTRY = 'Save a copy…'
const SAVE_UNPACK_ENTRY = 'Save & unpack…'
const HANDOFF_NO_DATA_ENTRY = 'Handoff (w/o data)'

const evidence = async (h, id, data) => {
  const path = resolve(h.outDir, `${id.replaceAll('/', '-')}.json`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify({ case: id, feature: 'save-handoff', ...data }, null, 2))
  return path
}

const reviewHandoff = (page) => page.evaluate(() => window.taco.getReviewHandoff())
const openDialog = (page, selector) =>
  page.evaluate((value) => {
    const dialog = document.querySelector(value)
    return dialog instanceof HTMLDialogElement ? dialog.open : false
  }, selector)
const writeClipboard = (page, value) =>
  page.evaluate((text) => navigator.clipboard.writeText(text), value)
const readClipboard = (page) => page.evaluate(() => navigator.clipboard.readText())

/**
 * Replace one File System Access entry point. Native pickers cannot be driven by Playwright, so
 * each substitution is recorded as an external boundary and applied as an own window property
 * (a plain assignment would not shadow the built-in accessor).
 */
const disablePicker = (page, name) =>
  page.evaluate((key) => {
    Object.defineProperty(window, key, { value: undefined, configurable: true, writable: true })
  }, name)

/** The picker's own cancel path: the substituted picker records that the product really called it. */
const abortingPicker = (page, name) =>
  page.evaluate((key) => {
    window.__tacoVerifyPickerCalls = 0
    Object.defineProperty(window, key, {
      configurable: true,
      writable: true,
      value: () => {
        window.__tacoVerifyPickerCalls += 1
        return Promise.reject(Object.assign(new Error('picker cancelled'), { name: 'AbortError' }))
      },
    })
  }, name)

const pickerCalls = (page) => page.evaluate(() => window.__tacoVerifyPickerCalls ?? 0)
const pickerAvailable = (page, name) =>
  page.evaluate((key) => typeof window[key] === 'function', name)

/** Feedback the product surfaced to the user (toasts carry role="status"); its wording is not asserted. */
const waitForStatusFeedback = (page) =>
  page.waitForFunction(
    () => document.querySelector('.taco-toast[role="status"]') !== null,
    undefined,
    { timeout: 5000 },
  )

/**
 * Bounded absence window for a negative event. Nothing in the UI reports "no download", so the
 * caller first awaits an observable completion (dialog detached, feedback surfaced) and this
 * then waits for the download event that must not arrive.
 */
const expectNoDownload = async (page, timeout = 750) => {
  const arrived = await page
    .waitForEvent('download', { timeout })
    .then(() => true)
    .catch(() => false)
  return arrived
}

const countDownloads = (page) => {
  const seen = []
  page.on('download', (download) => seen.push(download.suggestedFilename()))
  return seen
}

const markdownPath = (h) => {
  const prefix = `${h.bundle.root}/`
  const file = h.bundle.files.find(
    (entry) => entry.mediaType === 'text/markdown' && entry.path.startsWith(prefix),
  )
  assert(file, 'The fixture must provide a Markdown file for the save-handoff recipe')
  return file.path
}

/** The public review handoff reports file paths relative to the bundle root. */
const reviewPath = (h, path) =>
  path.startsWith(`${h.bundle.root}/`) ? path.slice(h.bundle.root.length + 1) : path

/** Type a real review edit into the document body and wait for the bundle to change. */
const applyEdit = async (h, path, marker) => {
  await selectFile(h.page, path)
  await typeAtEnd(h.page, marker)
  await h.page.waitForFunction(
    (text) =>
      window.taco.getReviewHandoff().changedFiles.some((entry) => entry.content.includes(text)),
    marker,
  )
  const handoff = await reviewHandoff(h.page)
  const changed = handoff.changedFiles.find((entry) => entry.content.includes(marker))
  assert(changed, 'The typed edit must appear in the public review handoff')
  assert.equal(changed.path, reviewPath(h, path))
  assert(changed.diff?.includes(marker), 'The review handoff must carry the edit as a diff')
  return changed
}

/** Select real rich text, open the composer and submit through the shared comment helper. */
const addComment = async (h, path, token, body) => {
  await selectFile(h.page, path)
  const editor = h.page.locator(EDITOR)
  await editor.waitFor({ state: 'visible' })
  await focusAtDocumentEnd(h.page)
  await h.page.keyboard.press('Enter')
  await h.page.keyboard.type(token)
  assert.equal(
    await editor.locator(':scope > :last-child').innerText(),
    token,
    'The comment token must occupy a new final paragraph',
  )
  await h.page.keyboard.press('ControlOrMeta+Shift+ArrowLeft')
  assert.equal(
    await h.page.evaluate(() => window.getSelection()?.toString() ?? ''),
    token,
    'The keyboard selection must cover the typed comment token',
  )
  const selectionButton = h.page.locator('button.selection-comment-button')
  await selectionButton.waitFor({ state: 'visible' })
  await selectionButton.click()
  await h.page.locator('.comment-composer textarea.comment-input').waitFor({ state: 'visible' })
  const threadId = await submitComment(h.page, body)
  assert(threadId, 'submitComment must return the created thread id')
  const thread = (await reviewHandoff(h.page)).comments.find((entry) => entry.id === threadId)
  assert(thread, `Comment thread ${threadId} must be in the public review handoff`)
  assert.equal(thread.anchor?.quote.exact, token)
  return { threadId, thread }
}

/** Assert a persisted review: identity, untouched files and the reviewed file's own content. */
const assertPersistedBundle = (h, reopened, expected) => {
  assert.equal(
    reopened.bundle.docId,
    h.bundle.docId,
    'Document identity (docId) must survive save and reopen',
  )
  assert.equal(reopened.bundle.root, h.bundle.root, 'Bundle root must survive save and reopen')
  for (const file of h.bundle.files) {
    const saved = reopened.bundle.files.find((entry) => entry.path === file.path)
    assert(saved, `Saved Taco is missing ${file.path}`)
    if (file.path === expected.path) {
      assert(
        saved.content.includes(expected.marker),
        `Saved ${file.path} did not keep the review edit`,
      )
    } else {
      assert.equal(saved.content, file.content, `Save must not change unreviewed file ${file.path}`)
      assert.equal(saved.mediaType, file.mediaType)
    }
  }
  assert.equal(reopened.bundle.files.length, h.bundle.files.length)
}

const assertCommentPersisted = (reopened, threadId, body) => {
  const thread = reopened.bundle.comments?.find((entry) => entry.id === threadId)
  assert(thread, `Reopened Taco is missing comment thread ${threadId}`)
  assert(
    thread.messages.some((message) => message.body === body),
    'The reopened comment thread is missing its reviewed message',
  )
  return thread
}

export const cases = [
  {
    id: 'save/main-button-download-reopen',
    feature: 'save-handoff',
    async run(h) {
      await h.doctor()
      const path = markdownPath(h)
      const marker = 'SaveMainMarkerAlpha'
      const token = 'SaveMainTokenAlpha'
      const body = 'Save must not reset review baseline'
      await h.capture('save-main-before')
      await h.step('save/main: review with a real body edit and comment', async () => {
        await applyEdit(h, path, marker)
        await addComment(h, path, token, body)
      })
      const handoffBefore = await reviewHandoff(h.page)
      assert(
        handoffBefore.changedFiles.length > 0,
        'Review handoff must have changed files before save',
      )
      assert(handoffBefore.comments.length > 0, 'Review handoff must have comments before save')
      await h.capture('save-main-edited')
      const file = await h.step(
        'save/main: click the header Save control and keep the download fallback',
        () => saveDownload(h, 'save-main.taco.html'),
      )
      const html = await readFile(file, 'utf8')
      assert(html.includes('id="taco-document"'), 'Saved artifact must be a real Taco document')
      await h.step(
        'save/main: saving does not reset the review baseline on the active page',
        async () => {
          const handoffAfter = await reviewHandoff(h.page)
          assert.equal(
            handoffAfter.changedFiles.length,
            handoffBefore.changedFiles.length,
            'Saving must not clear modified review files from the active page',
          )
          assert.equal(handoffAfter.changedFiles[0].path, handoffBefore.changedFiles[0].path)
          assert.equal(handoffAfter.changedFiles[0].diff, handoffBefore.changedFiles[0].diff)
          assert.equal(
            handoffAfter.comments.length,
            handoffBefore.comments.length,
            'Saving must not clear review comments from the active page',
          )
        },
      )
      await h.step('save/main: reopen the downloaded Taco in an independent page', async () => {
        const reopened = await h.reopen(file)
        assertPersistedBundle(h, reopened, { path, marker })
        const savedComment = reopened.bundle.comments.find(
          (thread) => thread.anchor?.quote.exact === token,
        )
        assert(savedComment, 'The comment must survive save and reopen')
        assert(savedComment.messages.some((message) => message.body === body))
        await selectFile(reopened.page, path)
        await reopened.page.waitForFunction(
          (text) =>
            document.querySelector('main#taco-main .ProseMirror')?.textContent.includes(text),
          marker,
        )
        await h.capture('save-main-reopened', reopened.page)
        await evidence(h, 'save/main-button-download-reopen', {
          entryPoint: 'save/main',
          trigger: 'button.save-button',
          boundary: 'native picker replaced by the documented download fallback',
          file,
          marker,
          commentPreserved: true,
          baselinePreservedAfterSave: true,
          docIdPreserved: true,
          unreviewedFilesUnchanged: true,
        })
      })
    },
  },
  {
    id: 'save/keyboard-shortcut-download-reopen',
    feature: 'save-handoff',
    async run(h) {
      await h.doctor()
      const path = markdownPath(h)
      const marker = 'SaveShortcutMarkerBeta'
      await h.step('save/keyboard: type a real review edit', () => applyEdit(h, path, marker))
      await h.capture('save-keyboard-edited')
      const file = await h.step('save/keyboard: press ControlOrMeta+s as the trigger', () =>
        saveDownload(h, 'save-keyboard.taco.html', {
          trigger: async () => {
            await h.page.locator(EDITOR).click()
            await h.page.keyboard.press('ControlOrMeta+s')
          },
        }),
      )
      await h.step('save/keyboard: reopen and compare the persisted review', async () => {
        const reopened = await h.reopen(file)
        assertPersistedBundle(h, reopened, { path, marker })
        await evidence(h, 'save/keyboard-shortcut-download-reopen', {
          entryPoint: 'save/keyboard',
          trigger: 'ControlOrMeta+s',
          file,
          marker,
          docIdPreserved: true,
        })
      })
    },
  },
  {
    id: 'save/menu-entry-download-reopen',
    feature: 'save-handoff',
    async run(h) {
      await h.doctor()
      const path = markdownPath(h)
      const marker = 'SaveMenuMarkerGamma'
      await h.step('save/menu: type a real review edit', () => applyEdit(h, path, marker))
      const file = await h.step('save/menu: choose Save from the adjacent actions menu', () =>
        saveDownload(h, 'save-menu.taco.html', {
          trigger: async () => {
            await h.page.locator('button.save-more').click()
            const menu = h.page.locator(SAVE_MENU)
            await menu.waitFor({ state: 'visible' })
            await menu.getByRole('menuitem', { name: SAVE_ENTRY, exact: true }).click()
          },
        }),
      )
      await h.step('save/menu: reopen and compare the persisted review', async () => {
        const reopened = await h.reopen(file)
        assertPersistedBundle(h, reopened, { path, marker })
        await evidence(h, 'save/menu-entry-download-reopen', {
          entryPoint: 'save/menu',
          trigger: 'button.save-more → the Save action',
          file,
          marker,
          docIdPreserved: true,
        })
      })
    },
  },
  {
    id: 'save/copy-cancel-abort-confirm-preservation',
    feature: 'save-handoff',
    async run(h) {
      await h.doctor()
      const path = markdownPath(h)
      const marker = 'SaveCopyMarkerDelta'
      const token = 'CopyReviewTokenDelta'
      const body = 'Copy path keeps this review note'
      const edit = await h.step(
        'save/copy: create an unsaved edit and comment to preserve',
        async () => {
          const changed = await applyEdit(h, path, marker)
          const comment = await addComment(h, path, token, body)
          return { changed, ...comment }
        },
      )
      const downloads = countDownloads(h.page)

      await h.step('save/copy: cancel the download confirmation and produce no file', async () => {
        await h.boundary(
          'window.showSaveFilePicker removed to select the documented download fallback',
        )
        await disablePicker(h.page, 'showSaveFilePicker')
        assert.equal(
          await pickerAvailable(h.page, 'showSaveFilePicker'),
          false,
          'The fallback branch needs no file handle',
        )
        await h.page.locator('button.save-more').click()
        await h.page
          .locator(SAVE_MENU)
          .getByRole('menuitem', { name: SAVE_COPY_ENTRY, exact: true })
          .click()
        const dialog = h.page.locator(CONFIRM)
        await dialog.waitFor({ state: 'visible' })
        assert.equal(
          await dialog.locator('.control-button-primary').count(),
          1,
          'The confirmation must offer a confirm control',
        )
        const cancel = dialog.locator(
          '.confirmation-dialog-actions button:not(.control-button-primary)',
        )
        assert.equal(await cancel.count(), 1, 'The confirmation must offer a cancel control')
        await cancel.click()
        await dialog.waitFor({ state: 'detached' })
        assert.equal(
          await openDialog(h.page, CONFIRM),
          false,
          'Cancelling must close the confirmation',
        )
        assert.equal(
          await expectNoDownload(h.page),
          false,
          'Cancelling the confirmation must not download a file',
        )
        assert.deepEqual(downloads, [], 'Cancelling the confirmation must not download a file')
        const handoff = await reviewHandoff(h.page)
        assert.equal(handoff.changedFiles.length, 1, 'Cancelling must not touch the pending review')
        assert(handoff.changedFiles[0].content.includes(marker))
        await h.capture('save-copy-cancelled')
      })

      await h.step('save/copy: cancel the native picker and require user feedback', async () => {
        await h.boundary(
          'native showSaveFilePicker cannot be driven by Playwright; substituted a picker that records the call and rejects with AbortError',
        )
        await abortingPicker(h.page, 'showSaveFilePicker')
        await h.page.locator('button.save-more').click()
        await h.page
          .locator(SAVE_MENU)
          .getByRole('menuitem', { name: SAVE_COPY_ENTRY, exact: true })
          .click()
        assert.equal(
          await pickerCalls(h.page),
          1,
          'The product must take the picker path when a file handle is available',
        )
        await waitForStatusFeedback(h.page)
        assert.equal(
          await expectNoDownload(h.page),
          false,
          'A cancelled picker must not download a file',
        )
        assert.deepEqual(downloads, [], 'A cancelled picker must not download a file')
        const handoff = await reviewHandoff(h.page)
        assert.equal(
          handoff.changedFiles.length,
          1,
          'A cancelled picker must not touch the pending review',
        )
        await h.capture('save-copy-picker-cancelled')
      })

      let file
      let observed = {}
      await h.step('save/copy: confirm the download, then reopen the copy', async () => {
        await h.boundary(
          'window.showSaveFilePicker removed again for the documented download fallback',
        )
        file = await saveDownload(h, 'save-copy.taco.html', {
          trigger: async () => {
            await h.page.locator('button.save-more').click()
            await h.page
              .locator(SAVE_MENU)
              .getByRole('menuitem', { name: SAVE_COPY_ENTRY, exact: true })
              .click()
          },
        })
        const reopened = await h.reopen(file)
        assertPersistedBundle(h, reopened, { path, marker })
        assert.deepEqual(
          reopened.bundle.navigation,
          h.bundle.navigation,
          'Navigation must survive save and reopen',
        )
        assert.deepEqual(
          reopened.bundle.checkpoints,
          h.bundle.checkpoints,
          'Checkpoints must survive save and reopen',
        )
        const savedThread = assertCommentPersisted(reopened, edit.threadId, body)
        assert.deepEqual(
          savedThread.messages,
          edit.thread.messages,
          'The comment must survive save and reopen',
        )
        await selectFile(reopened.page, path)
        await openPanelTab(reopened.page, 'comments')
        const card = reopened.page.locator(
          `article.comment-thread[data-thread-id="${edit.threadId}"]`,
        )
        await card.waitFor({ state: 'visible' })
        assert(
          (await card.innerText()).includes(body),
          'The reopened panel must show the preserved comment',
        )
        await h.capture('save-copy-reopened', reopened.page)
        observed = {
          suggestedName: downloads[0] ?? null,
          originalTitle: h.bundle.title,
          savedTitle: reopened.bundle.title,
        }
      })

      const canSave = await h.page.evaluate(() => window.taco.canSave())
      assert.equal(
        canSave,
        false,
        'Without a file handle the app must report that in-place saving is unavailable',
      )
      await h.boundary(
        'in-place file writes need a native file handle; the fixture has no reader-access variant, so readonly gating was not exercised',
      )
      await evidence(h, 'save/copy-cancel-abort-confirm-preservation', {
        entryPoint: 'save/menu/save-a-copy',
        cancelledConfirmation: { downloaded: false },
        cancelledPicker: { pickerCalls: 1, feedbackSurfaced: true, downloaded: false },
        file,
        marker,
        comment: { threadId: edit.threadId, preserved: true },
        canSaveInPlace: canSave,
        observed,
      })
    },
  },
  {
    id: 'save/unpack-unsupported-branch',
    feature: 'save-handoff',
    async run(h) {
      await h.doctor()
      const path = markdownPath(h)
      const marker = 'SaveUnpackMarkerEpsilon'
      const token = 'SaveUnpackTokenEpsilon'
      const body = 'Unpack path keeps this review note'
      const edit = await h.step(
        'save/unpack: review with an unsaved edit and comment',
        async () => {
          const changed = await applyEdit(h, path, marker)
          const comment = await addComment(h, path, token, body)
          return { changed, ...comment }
        },
      )
      const downloads = countDownloads(h.page)
      let substituted = false
      await h.step(
        'save/unpack: require feedback and no writes when the browser cannot write folders',
        async () => {
          const hasDirectoryPicker = await pickerAvailable(h.page, 'showDirectoryPicker')
          if (hasDirectoryPicker) {
            substituted = true
            await h.boundary(
              'native showDirectoryPicker cannot be driven by Playwright; removed it to select the unsupported-branch the recipe covers',
            )
            await disablePicker(h.page, 'showDirectoryPicker')
          }
          assert.equal(
            await pickerAvailable(h.page, 'showDirectoryPicker'),
            false,
            'The unsupported branch requires a browser without directory access',
          )
          await h.page.locator('button.save-more').click()
          await h.page
            .locator(SAVE_MENU)
            .getByRole('menuitem', { name: SAVE_UNPACK_ENTRY, exact: true })
            .click()
          await waitForStatusFeedback(h.page)
          assert.equal(
            await expectNoDownload(h.page),
            false,
            'The unsupported unpack branch must not download anything',
          )
          assert.deepEqual(
            downloads,
            [],
            'The unsupported unpack branch must not download anything',
          )
          assert.equal(
            await openDialog(h.page, CONFIRM),
            false,
            'The unsupported branch must not ask for a download confirmation',
          )
          const handoff = await reviewHandoff(h.page)
          assert.equal(
            handoff.changedFiles.length,
            1,
            'The unsupported branch must leave the review untouched',
          )
          assert(handoff.changedFiles[0].content.includes(marker))
          await h.capture('save-unpack-unsupported')
        },
      )
      const bundleFiles = await h.page.evaluate(() => window.taco.listFiles().length)
      await h.step('save/unpack: the reviewed content still saves and reopens', async () => {
        const file = await saveDownload(h, 'save-unpack.taco.html')
        const reopened = await h.reopen(file)
        assertPersistedBundle(h, reopened, { path, marker })
        assertCommentPersisted(reopened, edit.threadId, body)
        await evidence(h, 'save/unpack-unsupported-branch', {
          entryPoint: 'save/menu/save-and-unpack',
          pickerSubstituted: substituted,
          feedbackSurfaced: true,
          downloaded: false,
          bundleFiles,
          savedFile: file,
          marker,
          commentPreserved: true,
          note: 'A real directory write needs a user-selected folder plus native permission; that stays a human/os boundary and is never counted as passed here.',
        })
      })
    },
  },
  {
    id: 'handoff/clipboard-feedback-and-denial',
    feature: 'save-handoff',
    async run(h) {
      await h.doctor()
      const origin = new URL(h.url).origin
      await h.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
      const path = markdownPath(h)
      const marker = 'HandoffClipboardMarkerZeta'
      const token = 'HandoffTokenZeta'
      const body = 'Handoff must carry this open comment'
      const edit = await h.step(
        'handoff/clipboard: create an unsaved edit and an open comment',
        async () => {
          const changed = await applyEdit(h, path, marker)
          const comment = await addComment(h, path, token, body)
          return { changed, ...comment }
        },
      )
      const handoff = await reviewHandoff(h.page)
      const downloads = countDownloads(h.page)
      assert.equal(
        await h.page.evaluate(() => typeof window.taco.handoff),
        'undefined',
        'A standalone (non-listener) Taco must not expose a listener handoff capability',
      )
      const primary = h.page.locator('button.copy-review-main')
      assert.equal(await primary.count(), 1, 'The review must expose one primary handoff control')
      let copied
      let successFeedback
      await h.step(
        'handoff/clipboard: copy the review and read back the real clipboard',
        async () => {
          await primary.click()
          await waitForStatusFeedback(h.page)
          successFeedback = await h.page.locator('.taco-toast[role="status"]').innerText()
          copied = await readClipboard(h.page)
          assert(
            copied.includes(reviewPath(h, path)),
            'The copied review must name the changed path',
          )
          assert(copied.includes(marker), 'The copied review must carry the reviewed text')
          assert(copied.includes(body), 'The copied review must carry comment content')
          assert(copied.includes(token), 'The copied review must carry the comment anchor quote')
          assert(copied.includes(AUTHOR), 'The copied review must carry the author')
          assert.equal(
            await expectNoDownload(h.page),
            false,
            'A clipboard handoff must not download a file',
          )
          await writeFile(resolve(h.outDir, 'handoff-clipboard.txt'), copied)
          await h.capture('handoff-clipboard-copied')
        },
      )
      let probe
      await h.step(
        'handoff/clipboard: record the browser permission probe without claiming a pass',
        async () => {
          await h.context.clearPermissions()
          probe = await h.page.evaluate(async () => {
            try {
              await navigator.clipboard.writeText('probe')
              return 'write allowed without the granted permission'
            } catch (error) {
              return `write rejected: ${error.name}`
            }
          })
          await h.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
          await h.boundary(
            'a live browser permission revocation is not deterministic in this build; the observed probe is recorded, and the failure path is proven with a substituted rejecting clipboard below',
          )
        },
      )
      await h.step('handoff/clipboard: report failure, never claim success', async () => {
        await writeClipboard(h.page, copied)
        await h.boundary(
          'navigator.clipboard.writeText substituted to reject with NotAllowedError to select the denied-permission feedback path',
        )
        await h.page.locator('.taco-toast').waitFor({ state: 'detached', timeout: 5000 })
        await h.page.evaluate(() => {
          window.__clipboardRejectCalls = 0
          navigator.clipboard.writeText = () => {
            window.__clipboardRejectCalls += 1
            return Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
          }
        })
        await primary.click()
        await h.page.waitForFunction(() => (window.__clipboardRejectCalls ?? 0) === 1)
        await waitForStatusFeedback(h.page)
        const failureFeedback = await h.page.locator('.taco-toast[role="status"]').innerText()
        assert.notEqual(
          failureFeedback,
          successFeedback,
          'A rejected copy must distinguish its feedback from a successful copy',
        )
        const icon = await h.page
          .locator('button.copy-review-main .ui-icon')
          .getAttribute('data-icon')
        assert.notEqual(icon, 'check', 'A denied copy must not show the check confirmation icon')
        assert.equal(
          await readClipboard(h.page),
          copied,
          'A denied copy must leave the clipboard unchanged',
        )
        assert.equal(
          await expectNoDownload(h.page),
          false,
          'A denied copy must not download a file',
        )
        await h.capture('handoff-clipboard-denied')
      })
      await h.step('handoff/clipboard: the reviewed change still saves and reopens', async () => {
        const file = await saveDownload(h, 'handoff-clipboard.taco.html')
        const reopened = await h.reopen(file)
        assertPersistedBundle(h, reopened, { path, marker })
        assertCommentPersisted(reopened, edit.threadId, body)
        await evidence(h, 'handoff/clipboard-feedback-and-denial', {
          entryPoint: 'handoff/clipboard',
          permissionProbe: probe,
          copiedBytes: copied.length,
          changedFiles: handoff.changedFiles.length,
          comments: handoff.comments.length,
          savedFile: file,
          commentPreserved: true,
          listener:
            'none: a real local listener receipt is automated by the CLI/Host smoke, never stubbed here',
          clipboardFile: 'handoff-clipboard.txt',
        })
      })
    },
  },
  {
    id: 'handoff/menu-entries-and-no-data-variant',
    feature: 'save-handoff',
    async run(h) {
      await h.doctor()
      const origin = new URL(h.url).origin
      await h.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
      const path = markdownPath(h)
      const marker = 'HandoffMenuMarkerEta'
      const token = 'HandoffMenuTokenEta'
      const body = 'Handoff menu keeps this open comment'
      const edit = await h.step(
        'handoff/menu: review with an unsaved edit and comment',
        async () => {
          const changed = await applyEdit(h, path, marker)
          const comment = await addComment(h, path, token, body)
          return { changed, ...comment }
        },
      )
      const downloads = countDownloads(h.page)
      let entries = []
      await h.step(
        'handoff/menu: the data-free handoff carries tab identity without review data',
        async () => {
          await h.page.locator('button.copy-review-more').click()
          const menu = h.page.locator(COPY_MENU)
          await menu.waitFor({ state: 'visible' })
          entries = (await menu.locator('button.popover-action').allTextContents()).map((value) =>
            value.trim(),
          )
          assert(
            entries.length >= 2,
            'The handoff menu must expose the copy actions the recipe covers',
          )
          await h.boundary(
            'the current UI has no downloaded-handoff entry: the handoff menu writes to the clipboard, and neither action produces a download',
          )
          await menu
            .locator('button.popover-action')
            .filter({ hasText: HANDOFF_NO_DATA_ENTRY })
            .click()
          await waitForStatusFeedback(h.page)
          const copied = await readClipboard(h.page)
          assert(
            copied.includes(await h.page.title()),
            'The handoff must identify the tab it came from',
          )
          assert(copied.includes(h.url), 'The handoff must carry the tab URL')
          assert(!copied.includes(marker), 'The data-free handoff must not ship the reviewed text')
          assert(
            !copied.includes(token),
            'The data-free handoff must not ship comment anchor quote',
          )
          assert(!copied.includes(body), 'The data-free handoff must not ship comment content')
          assert.equal(
            await expectNoDownload(h.page),
            false,
            'No handoff menu action may download a file',
          )
          assert.deepEqual(downloads, [], 'No handoff menu action may download a file')
          await writeFile(resolve(h.outDir, 'handoff-inspect.txt'), copied)
          await h.capture('handoff-menu-inspect')
        },
      )
      await h.step('handoff/menu: the reviewed change still saves and reopens', async () => {
        const inspectBytes = (await readFile(resolve(h.outDir, 'handoff-inspect.txt'), 'utf8'))
          .length
        const file = await saveDownload(h, 'handoff-menu.taco.html')
        const reopened = await h.reopen(file)
        assertPersistedBundle(h, reopened, { path, marker })
        assertCommentPersisted(reopened, edit.threadId, body)
        await evidence(h, 'handoff/menu-entries-and-no-data-variant', {
          entryPoint: 'handoff/menu',
          menuActions: entries,
          downloadedHandoff: 'unsupported by the current UI',
          inspectBytes,
          savedFile: file,
          commentPreserved: true,
        })
      })
    },
  },
]
