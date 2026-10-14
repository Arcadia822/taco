#!/usr/bin/env node
// Feature recipe: features/comments.md — anchored discussions created from real rich-text and
// source selections, thread lifecycle (reply, resolve/reopen, message edit, message tombstone,
// thread deletion), panel toggles with unsubmitted drafts, and anchor locate/stale behavior.
// Cases mutate only through the real UI, prove persistence by downloading the reviewed Taco and
// reopening it, and assert observed effects, content and state. The constants below are only the
// roles/names needed to drive real clicks; no case asserts UI prose or badge wording.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  AUTHOR_NAME,
  focusAtDocumentEnd,
  openPanelTab,
  saveDownload,
  selectFile,
  submitComment,
} from './ui.mjs'

const AUTHOR = AUTHOR_NAME
const EDITOR = 'main#taco-main .tiptap-editor-host .ProseMirror'
const SOURCE = 'textarea.source-editor-input'
const SELECTION_BUTTON = 'button.selection-comment-button'
const TOGGLE = 'button.comment-toggle'
const PANEL = 'aside.comment-panel'
const LIST = '#taco-comment-list'
const STALE = '.comment-stale-group'
// Action locators: the rendered names used to drive real clicks.
const REPLY_ACTION = 'Reply'
const RESOLVE_ACTION = 'Resolve'
const REOPEN_ACTION = 'Reopen'

const evidence = async (h, id, data) => {
  const path = resolve(h.outDir, `${id.replaceAll('/', '-')}.json`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify({ case: id, feature: 'comments', ...data }, null, 2))
  return path
}

const reviewHandoff = (page) => page.evaluate(() => window.taco.getReviewHandoff())
const threadsOf = async (page) => (await reviewHandoff(page)).comments ?? []
const threadOf = async (page, id) =>
  (await threadsOf(page)).find((thread) => thread.id === id) ?? null
const cardOf = (page, id) => page.locator(`article.comment-thread[data-thread-id="${id}"]`)
/** Direct DOM reads for state that a closed panel keeps in the document but outside the viewport. */
const domText = (page, selector) =>
  page.evaluate((value) => document.querySelector(value)?.textContent ?? null, selector)
const domValue = (page, selector) =>
  page.evaluate((value) => document.querySelector(value)?.value ?? null, selector)
const countOf = (page, selector) => page.locator(selector).count()
const panelState = (page) =>
  page.evaluate((value) => {
    const panel = document.querySelector(value)
    const toggle = document.querySelector('button.comment-toggle')
    return {
      open: panel
        ? !panel.hasAttribute('inert') && panel.getAttribute('aria-hidden') === 'false'
        : null,
      expanded: toggle?.getAttribute('aria-expanded') ?? null,
      rootClass:
        document.querySelector('.taco-shell')?.classList.contains('comment-panel-open') ?? null,
      dialogOpen: Boolean(document.querySelector('dialog[open], .topbar-popover')),
    }
  }, PANEL)

const markdownPath = (h) => {
  const prefix = `${h.bundle.root}/`
  const file = h.bundle.files.find(
    (entry) => entry.mediaType === 'text/markdown' && entry.path.startsWith(prefix),
  )
  assert(file, 'The fixture must provide a Markdown file for the comments recipe')
  return file.path
}

const sourcePath = (h) => {
  const prefix = `${h.bundle.root}/`
  const file = h.bundle.files.find(
    (entry) => entry.mediaType === 'text/plain' && entry.path.startsWith(prefix),
  )
  assert(file, 'The fixture must provide a plain-text file for the source comment recipe')
  return file.path
}

/** A short, letters-only token so keyboard word selection covers exactly what the case typed. */
const tokenFor = (name) => `Verification${name}Token`

const openCommentsPanel = async (page) => {
  await openPanelTab(page, 'comments')
  await page.locator(LIST).waitFor({ state: 'visible' })
}

/** Open threads' visible message count, derived from the public read-only review state. */
const openMessageCount = async (page) => {
  const threads = (await threadsOf(page)).filter((thread) => thread.status === 'open')
  return threads.reduce(
    (total, thread) => total + thread.messages.filter((message) => !message.deletedAt).length,
    0,
  )
}

const assertToggleBadge = async (page, context) => {
  const badge = await domText(page, `${TOGGLE} .comment-count`)
  assert.equal(
    badge === null ? 0 : Number(badge),
    await openMessageCount(page),
    `The panel toggle badge must count the open review messages (${context})`,
  )
}

/** Select a distinctive token typed through the real rich-text editor, then open the composer. */
const composeFromRichSelection = async (page, token) => {
  const editor = page.locator(EDITOR)
  await editor.waitFor({ state: 'visible' })
  await focusAtDocumentEnd(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type(token)
  assert.equal(
    await editor.locator(':scope > :last-child').innerText(),
    token,
    'The comment token must occupy a new final paragraph',
  )
  await page.keyboard.press('ControlOrMeta+Shift+ArrowLeft')
  assert.equal(
    await page.evaluate(() => window.getSelection()?.toString() ?? ''),
    token,
    'The keyboard selection must cover the typed rich-text token',
  )
  const selectionButton = page.locator(SELECTION_BUTTON)
  await selectionButton.waitFor({ state: 'visible' })
  await selectionButton.click()
  await page.locator('.comment-composer textarea.comment-input').waitFor({ state: 'visible' })
}

/** Select a real line of the source editor by keyboard, then open the composer. */
const composeFromSourceSelection = async (h, path, lineIndex) => {
  await selectFile(h.page, path)
  const input = h.page.locator(SOURCE)
  await input.waitFor({ state: 'visible' })
  await input.click({ position: { x: 8, y: 8 } })
  if (process.platform === 'darwin') {
    await h.page.keyboard.press('Meta+ArrowUp')
    for (let line = 0; line < lineIndex; line += 1) await h.page.keyboard.press('ArrowDown')
    await h.page.keyboard.press('Meta+ArrowLeft')
    await h.page.keyboard.press('Shift+Meta+ArrowRight')
  } else {
    await h.page.keyboard.press('Control+Home')
    for (let line = 0; line < lineIndex; line += 1) await h.page.keyboard.press('ArrowDown')
    await h.page.keyboard.press('Home')
    await h.page.keyboard.press('Shift+End')
  }
  const selected = await h.page.evaluate((selector) => {
    const area = document.querySelector(selector)
    return area ? area.value.slice(area.selectionStart, area.selectionEnd) : null
  }, SOURCE)
  assert(selected && selected.length > 0, 'The source editor must expose a real keyboard selection')
  const selectionButton = h.page.locator(SELECTION_BUTTON)
  await selectionButton.waitFor({ state: 'visible' })
  await selectionButton.click()
  await h.page.locator('.comment-composer textarea.comment-input').waitFor({ state: 'visible' })
  assert.equal(
    (await h.page.locator('.comment-composer .comment-quote').textContent())?.trim(),
    selected.trim(),
    'The composer must quote the selected source text',
  )
  return selected
}

const createRichThread = async (h, path, token, body) => {
  await selectFile(h.page, path)
  await composeFromRichSelection(h.page, token)
  return submitComment(h.page, body)
}

const assertThreadPersisted = (reopened, thread) => {
  const saved = reopened.bundle.comments?.find((entry) => entry.id === thread.id)
  assert(saved, `Reopened Taco is missing thread ${thread.id}`)
  assert.deepEqual(saved, thread, 'The persisted thread must match the reviewed thread exactly')
  return saved
}

/** Show the reopened panel for a file and return the persisted card. */
const showReopenedCard = async (reopened, path, threadId) => {
  await selectFile(reopened.page, path)
  await openCommentsPanel(reopened.page)
  const card = cardOf(reopened.page, threadId)
  await card.waitFor({ state: 'visible' })
  return card
}

const replyToCard = async (page, threadId, body) => {
  const card = cardOf(page, threadId)
  await card.getByRole('button', { name: REPLY_ACTION, exact: true }).click()
  const form = card.locator('.comment-reply-form')
  await form.locator('textarea.comment-input').fill(body)
  await form.locator('button.comment-submit').click()
  await page.waitForFunction(
    (id) =>
      window.taco.getReviewHandoff().comments.find((thread) => thread.id === id)?.messages
        .length === 2,
    threadId,
  )
}

export const cases = [
  {
    id: 'comments/rich-selection-author-submit',
    feature: 'comments',
    async run(h) {
      await h.doctor()
      const path = markdownPath(h)
      const token = tokenFor('Rich')
      const body = 'Rich selection review note'
      await h.step('comments/selection: start from an empty comment history', async () => {
        await selectFile(h.page, path)
        await openCommentsPanel(h.page)
        assert.deepEqual(
          await threadsOf(h.page),
          [],
          'The fixture must start without comment threads',
        )
        assert.equal(
          await countOf(h.page, `${LIST} .comment-empty-banner`),
          1,
          'An empty review must show its empty state',
        )
        await h.boundary(
          'read-only (reader access) comment gating is not exercised: the shared fixture has no reader variant and cases may not inject one through window.taco.loadBundle',
        )
        await h.capture('comments-rich-before')
      })
      await h.step('comments/selection: select rich text and open the composer', async () => {
        await composeFromRichSelection(h.page, token)
        assert.equal(
          await countOf(h.page, '.comment-composer-label'),
          1,
          'The composer must label the pending comment',
        )
        assert.equal(
          (await h.page.locator('.comment-composer .comment-quote').textContent())?.trim(),
          token,
        )
        await h.capture('comments-rich-composer')
      })
      let threadId
      await h.step('comments/author: submit through the real author dialog', async () => {
        await h.page.locator('.comment-composer textarea.comment-input').fill(body)
        await h.page.locator('.comment-composer button.comment-submit').click()
        const dialog = h.page.locator('dialog.author-name-dialog')
        await dialog.waitFor({ state: 'visible' })
        assert.equal(
          await dialog.locator('input.author-name-input').count(),
          1,
          'The author dialog must collect a display name',
        )
        assert.equal(
          await dialog.locator('.author-name-actions .control-button-primary').count(),
          1,
        )
        await dialog.locator('input.author-name-input').fill(AUTHOR)
        await dialog.locator('.author-name-actions .control-button-primary').click()
        await dialog.waitFor({ state: 'detached' })
        const created = (await threadsOf(h.page)).filter(
          (thread) => thread.messages[0]?.body === body,
        )
        assert.equal(created.length, 1, 'Submitting must create exactly one thread')
        threadId = created[0].id
        assert.equal(created[0].status, 'open')
        assert.equal(created[0].anchor.path, path)
        assert.equal(created[0].anchor.quote.exact, token)
        assert.equal(created[0].messages[0].author, AUTHOR)
        assert(created[0].messages[0].authorId, 'A submitted comment must carry comment identity')
      })
      await h.step('comments/thread: the panel card shows the quote and body', async () => {
        const card = cardOf(h.page, threadId)
        await card.waitFor({ state: 'visible' })
        assert.equal((await card.locator('.comment-quote-button').textContent())?.trim(), token)
        assert((await card.innerText()).includes(body))
        await assertToggleBadge(h.page, 'after one open comment')
        await h.capture('comments-rich-after')
      })
      await h.step('comments/persist: download and reopen the reviewed Taco', async () => {
        const thread = await threadOf(h.page, threadId)
        const file = await saveDownload(h, 'comments-rich.taco.html')
        const reopened = await h.reopen(file)
        assert.equal(reopened.bundle.docId, h.bundle.docId)
        assertThreadPersisted(reopened, thread)
        const card = await showReopenedCard(reopened, path, threadId)
        assert(
          (await card.innerText()).includes(body),
          'The reopened panel must show the persisted comment',
        )
        await h.capture('comments-rich-reopened', reopened.page)
        await evidence(h, 'comments/rich-selection-author-submit', {
          entryPoint: 'comments/selection+author',
          file,
          threadId,
          path,
          quote: token,
          author: AUTHOR,
          persisted: true,
        })
      })
    },
  },
  {
    id: 'comments/source-selection-submit',
    feature: 'comments',
    async run(h) {
      await h.doctor()
      const path = sourcePath(h)
      const file = h.bundle.files.find((entry) => entry.path === path)
      const lineIndex = file.content.split('\n').findIndex((line) => line.trim().length > 0)
      assert(lineIndex >= 0, 'The plain-text fixture needs a non-empty line')
      const body = 'Source selection review note'
      let selected
      let threadId
      await h.step('comments/selection: select a real source line and submit', async () => {
        selected = await composeFromSourceSelection(h, path, lineIndex)
        await h.capture('comments-source-composer')
        threadId = await submitComment(h.page, body)
        assert(threadId, 'submitComment must return the created thread id')
        const thread = await threadOf(h.page, threadId)
        assert.equal(
          thread.anchor.path,
          path,
          'The source comment must anchor to the selected file',
        )
        assert.equal(
          thread.anchor.quote.exact,
          selected,
          'The anchor quote must be the selected source text',
        )
        assert.equal(thread.messages[0].body, body)
        assert.equal(thread.messages[0].author, AUTHOR)
      })
      await h.step('comments/thread: the panel card shows the source quote and body', async () => {
        const card = cardOf(h.page, threadId)
        await card.waitFor({ state: 'visible' })
        assert.equal(
          (await card.locator('.comment-quote-button').textContent())?.trim(),
          selected.trim(),
        )
        assert((await card.innerText()).includes(body))
        await h.capture('comments-source-after')
      })
      await h.step('comments/persist: download and reopen the reviewed Taco', async () => {
        const thread = await threadOf(h.page, threadId)
        const saved = await saveDownload(h, 'comments-source.taco.html')
        const reopened = await h.reopen(saved)
        assertThreadPersisted(reopened, thread)
        const card = await showReopenedCard(reopened, path, threadId)
        assert.equal(
          (await card.locator('.comment-quote-button').textContent())?.trim(),
          selected.trim(),
        )
        await h.step(
          'comments/persist: the reopened source selection resolves to the same text',
          async () => {
            await card.locator('.comment-quote-button').click()
            const resolved = await reopened.page.evaluate((selector) => {
              const area = document.querySelector(selector)
              return area ? area.value.slice(area.selectionStart, area.selectionEnd) : null
            }, SOURCE)
            assert.equal(
              resolved,
              selected,
              'The persisted anchor must still locate the same source text',
            )
          },
        )
        await h.capture('comments-source-reopened', reopened.page)
        await evidence(h, 'comments/source-selection-submit', {
          entryPoint: 'comments/source-selection',
          file: saved,
          threadId,
          path,
          quote: selected,
          persisted: true,
        })
      })
    },
  },
  {
    id: 'comments/reply-resolve-reopen-history',
    feature: 'comments',
    async run(h) {
      await h.doctor()
      const path = markdownPath(h)
      const token = tokenFor('Reply')
      const first = 'Thread opener for the reply history'
      const reply = 'Reviewer reply kept through resolve and reopen'
      let threadId
      await h.step('comments/thread: open a thread and reply inside its own card', async () => {
        await openCommentsPanel(h.page)
        threadId = await createRichThread(h, path, token, first)
        await replyToCard(h.page, threadId, reply)
        const thread = await threadOf(h.page, threadId)
        assert.equal(thread.messages.length, 2)
        assert.deepEqual(
          thread.messages.map((message) => message.body),
          [first, reply],
        )
        assert(thread.messages.every((message) => message.author === AUTHOR))
        const card = cardOf(h.page, threadId)
        assert((await card.innerText()).includes(reply), 'The reply must render in the thread card')
        await assertToggleBadge(h.page, 'after a reply')
        await h.capture('comments-reply-after')
      })
      await h.step('comments/thread: resolve then reopen the thread', async () => {
        const card = cardOf(h.page, threadId)
        await card.getByRole('button', { name: RESOLVE_ACTION, exact: true }).click()
        await h.page.waitForFunction(
          (id) =>
            window.taco.getReviewHandoff().comments.find((thread) => thread.id === id)?.status ===
            'resolved',
          threadId,
        )
        assert(
          await card.evaluate((node) => node.classList.contains('is-resolved')),
          'A resolved card must be marked',
        )
        await h.capture('comments-resolved')
        await card.getByRole('button', { name: REOPEN_ACTION, exact: true }).click()
        await h.page.waitForFunction(
          (id) =>
            window.taco.getReviewHandoff().comments.find((thread) => thread.id === id)?.status ===
            'open',
          threadId,
        )
        assert(!(await card.evaluate((node) => node.classList.contains('is-resolved'))))
      })
      await h.step(
        'comments/persist: reopen the Taco and compare the message history',
        async () => {
          const thread = await threadOf(h.page, threadId)
          const saved = await saveDownload(h, 'comments-reply.taco.html')
          const reopened = await h.reopen(saved)
          const persisted = assertThreadPersisted(reopened, thread)
          assert.equal(persisted.status, 'open', 'The last status change must be the persisted one')
          assert.deepEqual(
            persisted.messages.map((message) => message.body),
            [first, reply],
          )
          await h.capture('comments-reply-reopened', reopened.page)
          await evidence(h, 'comments/reply-resolve-reopen-history', {
            entryPoint: 'comments/thread-reply-resolve',
            file: saved,
            threadId,
            messages: persisted.messages.length,
            status: persisted.status,
            persisted: true,
          })
        },
      )
    },
  },
  {
    id: 'comments/message-edit-and-delete-tombstone',
    feature: 'comments',
    async run(h) {
      await h.doctor()
      const path = markdownPath(h)
      const token = tokenFor('Edit')
      const original = 'Message that will be edited'
      const edited = 'Message body after the edit'
      const reply = 'Reply that must survive the message tombstone'
      let threadId
      let messageId
      await h.step(
        'comments/thread: open a thread and add the reply that must survive',
        async () => {
          await openCommentsPanel(h.page)
          threadId = await createRichThread(h, path, token, original)
          messageId = (await threadOf(h.page, threadId)).messages[0].id
          await replyToCard(h.page, threadId, reply)
        },
      )
      await h.step(
        'comments/thread: edit the authored message through its own editor',
        async () => {
          const message = h.page.locator(`.comment-message[data-message-id="${messageId}"]`)
          await message
            .getByRole('button', { name: `Edit message by ${AUTHOR}`, exact: true })
            .click()
          const editor = message.locator('.comment-message-editor')
          await editor.locator('textarea.comment-input').fill(edited)
          await editor.locator('button.comment-submit').click()
          await h.page.waitForFunction(
            (id) =>
              window.taco
                .getReviewHandoff()
                .comments.flatMap((thread) => thread.messages)
                .find((message) => message.id === id)?.body === 'Message body after the edit',
            messageId,
          )
          const updated = (await threadOf(h.page, threadId)).messages.find(
            (entry) => entry.id === messageId,
          )
          assert.equal(updated.body, edited, 'The edited message must keep the new body')
          assert(updated.updatedAt, 'An edited message must record its edit time')
          assert.equal(
            await message.locator('.comment-edited').count(),
            1,
            'An edited message must show its edit marker',
          )
          await h.capture('comments-message-edited')
        },
      )
      await h.step(
        'comments/thread: delete the message and require a tombstone while replies survive',
        async () => {
          const message = h.page.locator(`.comment-message[data-message-id="${messageId}"]`)
          let confirmed = false
          h.page.once('dialog', (dialog) => {
            confirmed = true
            dialog.accept()
          })
          await message.locator('button.comment-message-delete').click()
          await h.page.waitForFunction(
            (id) =>
              window.taco
                .getReviewHandoff()
                .comments.flatMap((thread) => thread.messages)
                .find((message) => message.id === id)?.deletedAt,
            messageId,
          )
          assert.equal(confirmed, true, 'Deleting a message must ask for its own confirmation')
          const thread = await threadOf(h.page, threadId)
          const deleted = thread.messages.find((entry) => entry.id === messageId)
          assert(deleted.deletedAt, 'A deleted message must keep its tombstone timestamp')
          assert(
            !deleted.body.includes(edited),
            'A deleted message must not keep the edited message text',
          )
          assert(
            !deleted.body.includes(original),
            'A deleted message must not keep the original message text',
          )
          assert.equal(thread.messages.length, 2, 'Deleting a message must keep its replies')
          assert.equal(
            await message.locator('.comment-tombstone').count(),
            1,
            'A deleted message must render a tombstone',
          )
          assert((await cardOf(h.page, threadId).innerText()).includes(reply))
          await h.capture('comments-message-deleted')
        },
      )
      await h.step(
        'comments/persist: reopen the Taco and check the tombstone history',
        async () => {
          const thread = await threadOf(h.page, threadId)
          const saved = await saveDownload(h, 'comments-message.taco.html')
          const reopened = await h.reopen(saved)
          const persisted = assertThreadPersisted(reopened, thread)
          const deleted = persisted.messages.find((entry) => entry.id === messageId)
          assert(deleted.deletedAt, 'The persisted history must keep the tombstone')
          assert(!deleted.body.includes(edited))
          assert(!deleted.body.includes(original))
          assert.equal(persisted.messages.length, 2)
          const card = await showReopenedCard(reopened, path, threadId)
          assert.equal(await card.locator('.comment-tombstone').count(), 1)
          assert((await card.innerText()).includes(reply))
          await h.capture('comments-message-reopened', reopened.page)
          await evidence(h, 'comments/message-edit-and-delete-tombstone', {
            entryPoint: 'comments/message-edit+delete',
            file: saved,
            threadId,
            messageId,
            editedBody: edited,
            tombstone: true,
            repliesSurvived: true,
            persisted: true,
          })
        },
      )
    },
  },
  {
    id: 'comments/thread-delete-removes-history',
    feature: 'comments',
    async run(h) {
      await h.doctor()
      const path = markdownPath(h)
      const token = tokenFor('Thread')
      const body = 'Whole thread scheduled for deletion'
      let threadId
      await h.step('comments/thread: open the thread that will be deleted', async () => {
        await openCommentsPanel(h.page)
        threadId = await createRichThread(h, path, token, body)
        await replyToCard(h.page, threadId, 'Reply inside the thread that will be deleted')
        await cardOf(h.page, threadId).waitFor({ state: 'visible' })
        await h.capture('comments-thread-before-delete')
      })
      await h.step(
        'comments/thread: delete the whole thread through its own confirmation',
        async () => {
          const card = cardOf(h.page, threadId)
          let confirmed = false
          h.page.once('dialog', (dialog) => {
            confirmed = true
            dialog.accept()
          })
          await card.locator('button.comment-delete').click()
          await h.page.waitForFunction(
            (id) => !window.taco.getReviewHandoff().comments.some((thread) => thread.id === id),
            threadId,
          )
          assert.equal(confirmed, true, 'Deleting a whole thread must ask for its own confirmation')
          await card.waitFor({ state: 'detached' })
          assert.deepEqual(
            await threadsOf(h.page),
            [],
            'Thread deletion must remove the whole history',
          )
          await assertToggleBadge(h.page, 'after deleting the only thread')
          assert.equal(
            await countOf(h.page, `${LIST} .comment-empty-banner`),
            1,
            'The review must return to its empty state',
          )
          await h.capture('comments-thread-deleted')
        },
      )
      await h.step('comments/persist: reopen the Taco and confirm the thread is gone', async () => {
        const saved = await saveDownload(h, 'comments-thread.taco.html')
        const reopened = await h.reopen(saved)
        assert.equal(
          reopened.bundle.comments?.length ?? 0,
          0,
          'A deleted thread must not come back after reopen',
        )
        await selectFile(reopened.page, path)
        await openCommentsPanel(reopened.page)
        assert.equal(
          await reopened.page
            .locator(`article.comment-thread[data-thread-id="${threadId}"]`)
            .count(),
          0,
        )
        assert.equal(await countOf(reopened.page, `${LIST} .comment-empty-banner`), 1)
        await h.capture('comments-thread-reopened', reopened.page)
        await evidence(h, 'comments/thread-delete-removes-history', {
          entryPoint: 'comments/thread-delete',
          file: saved,
          threadId,
          removed: true,
          persisted: true,
        })
      })
    },
  },
  {
    id: 'comments/panel-toggle-draft-escape',
    feature: 'comments',
    async run(h) {
      await h.doctor()
      const path = markdownPath(h)
      const token = tokenFor('Panel')
      const body = 'Thread that keeps an unsent reply draft'
      const draft = 'Unsubmitted reply draft that must survive a panel repaint'
      let threadId
      await h.step(
        'comments/panel: open a thread card and type an unsent reply draft',
        async () => {
          await openCommentsPanel(h.page)
          threadId = await createRichThread(h, path, token, body)
          const card = cardOf(h.page, threadId)
          await card.getByRole('button', { name: REPLY_ACTION, exact: true }).click()
          await card.locator('.comment-reply-form textarea.comment-input').fill(draft)
          await h.capture('comments-panel-draft')
        },
      )
      await h.step(
        'comments/panel: toggle the panel closed and open without dropping the draft',
        async () => {
          await h.page.locator(TOGGLE).click()
          await h.page.waitForFunction(
            () =>
              document.querySelector('button.comment-toggle')?.getAttribute('aria-expanded') ===
              'false',
          )
          assert.equal((await panelState(h.page)).open, false)
          assert.equal(await domValue(h.page, '.comment-reply-form textarea.comment-input'), draft)
          await h.page.locator(TOGGLE).click()
          await h.page.waitForFunction(
            () =>
              document.querySelector('button.comment-toggle')?.getAttribute('aria-expanded') ===
              'true',
          )
          assert.equal((await panelState(h.page)).open, true)
          assert.equal(await domValue(h.page, '.comment-reply-form textarea.comment-input'), draft)
        },
      )
      await h.step(
        'comments/panel: a real repaint keeps the draft and the thread state',
        async () => {
          await cardOf(h.page, threadId)
            .getByRole('button', { name: RESOLVE_ACTION, exact: true })
            .click()
          await h.page.waitForFunction(
            (id) =>
              window.taco.getReviewHandoff().comments.find((thread) => thread.id === id)?.status ===
              'resolved',
            threadId,
          )
          assert.equal(
            await domValue(h.page, '.comment-reply-form textarea.comment-input'),
            draft,
            'A panel rebuild must restore the unsubmitted reply',
          )
          await h.capture('comments-panel-repainted')
        },
      )
      await h.step(
        'comments/panel: Escape closes the panel when no dialog or menu holds focus',
        async () => {
          assert.equal((await panelState(h.page)).dialogOpen, false)
          await h.page.keyboard.press('Escape')
          await h.page.waitForFunction(
            () =>
              document.querySelector('button.comment-toggle')?.getAttribute('aria-expanded') ===
              'false',
          )
          const state = await panelState(h.page)
          assert.equal(state.open, false)
          assert.equal(state.rootClass, false)
          assert.equal(
            await h.page.evaluate(
              () => document.activeElement?.classList.contains('comment-toggle') ?? false,
            ),
            true,
            'Closing the panel must move focus back to its toggle',
          )
          await h.capture('comments-panel-escaped')
        },
      )
      await h.step('comments/panel: reopen and select the Comments tab explicitly', async () => {
        await h.page.locator(TOGGLE).click()
        const tab = h.page.getByRole('tab', { name: 'Comments', exact: true })
        await tab.click()
        assert.equal(await tab.getAttribute('aria-selected'), 'true')
        await h.page.locator(LIST).waitFor({ state: 'visible' })
        assert.equal(await domValue(h.page, '.comment-reply-form textarea.comment-input'), draft)
      })
      await h.step(
        'comments/persist: the draft is UI state, the resolved thread is document state',
        async () => {
          const saved = await saveDownload(h, 'comments-panel.taco.html')
          const reopened = await h.reopen(saved)
          const persisted = reopened.bundle.comments.find((thread) => thread.id === threadId)
          assert.equal(persisted?.status, 'resolved', 'The resolved thread must persist')
          assert(
            !JSON.stringify(reopened.bundle).includes(draft),
            'An unsubmitted draft must never be saved',
          )
          await h.capture('comments-panel-reopened', reopened.page)
          await evidence(h, 'comments/panel-toggle-draft-escape', {
            entryPoint: 'comments/panel-toggle',
            file: saved,
            threadId,
            draftRetained: true,
            escapeClosedPanel: true,
            draftPersisted: false,
            threadStatus: persisted?.status,
          })
        },
      )
    },
  },
  {
    id: 'comments/anchor-locate-then-stale',
    feature: 'comments',
    async run(h) {
      await h.doctor()
      const path = sourcePath(h)
      const file = h.bundle.files.find((entry) => entry.path === path)
      const lines = file.content.split('\n')
      const lineIndex = lines.findIndex((line) => line.trim().length > 0)
      assert(lineIndex >= 0, 'The plain-text fixture needs a non-empty line')
      const lineStart = lines.slice(0, lineIndex).reduce((sum, line) => sum + line.length + 1, 0)
      const replacement = 'VerificationAnchorReplacementLine'
      const body = 'Comment whose anchor will be lost'
      let selected
      let threadId
      await h.step('comments/anchor: comment a real source line', async () => {
        selected = await composeFromSourceSelection(h, path, lineIndex)
        threadId = await submitComment(h.page, body)
        const thread = await threadOf(h.page, threadId)
        assert.equal(thread.anchor.quote.exact, selected)
        await h.capture('comments-anchor-before')
      })
      await h.step('comments/anchor: the quote locates the live source text', async () => {
        const card = cardOf(h.page, threadId)
        await card.locator('.comment-quote-button').click()
        const located = await h.page.evaluate((selector) => {
          const area = document.querySelector(selector)
          if (!area) return null
          return {
            focused: document.activeElement === area,
            text: area.value.slice(area.selectionStart, area.selectionEnd),
            start: area.selectionStart,
            end: area.selectionEnd,
          }
        }, SOURCE)
        assert.equal(located?.focused, true, 'Locating a quote must focus the source editor')
        assert.equal(
          located.text,
          selected,
          'Locating a quote must select the anchored source text',
        )
        const anchor = (await threadOf(h.page, threadId)).anchor
        assert.equal(located.start, anchor.position.start)
        assert.equal(located.end, anchor.position.end)
        assert.equal(
          await h.page
            .locator(`${STALE} article.comment-thread[data-thread-id="${threadId}"]`)
            .count(),
          0,
        )
        await h.capture('comments-anchor-located')
      })
      await h.step('comments/anchor: change the source and require the lost position', async () => {
        const card = cardOf(h.page, threadId)
        await card.locator('.comment-quote-button').click()
        await h.page.keyboard.type(replacement)
        await h.page.waitForFunction((id) => {
          const group = document.querySelector('.comment-stale-group')
          return Boolean(group?.querySelector(`article.comment-thread[data-thread-id="${id}"]`))
        }, threadId)
        assert.equal(
          await countOf(h.page, `${STALE} .comment-stale-heading`),
          1,
          'Lost positions need their own group heading',
        )
        const card2 = h.page.locator(
          `${STALE} article.comment-thread[data-thread-id="${threadId}"]`,
        )
        assert.equal(
          await card2.locator('.comment-stale-badge').count(),
          1,
          'A lost anchor must be marked on its card',
        )
        const handoff = await reviewHandoff(h.page)
        assert(
          handoff.changedFiles.some((entry) => entry.content.includes(replacement)),
          'The source edit must be reviewed',
        )
        const anchor = (await threadOf(h.page, threadId)).anchor
        assert.equal(
          anchor.quote.exact,
          selected,
          'A lost anchor must keep its original quote, never silently reattach',
        )
        assert.equal(
          anchor.position.start,
          lineStart,
          'A lost anchor must keep its stored position',
        )
        assert.equal(anchor.position.end, lineStart + selected.length)
        await h.capture('comments-anchor-stale')
      })
      await h.step('comments/persist: the lost anchor survives save and reopen', async () => {
        const thread = await threadOf(h.page, threadId)
        const saved = await saveDownload(h, 'comments-anchor.taco.html')
        const reopened = await h.reopen(saved)
        const persisted = assertThreadPersisted(reopened, thread)
        assert.equal(persisted.anchor.quote.exact, selected)
        await selectFile(reopened.page, path)
        await openCommentsPanel(reopened.page)
        const staleCard = reopened.page.locator(
          `${STALE} article.comment-thread[data-thread-id="${threadId}"]`,
        )
        await staleCard.waitFor({ state: 'visible' })
        assert.equal(await staleCard.locator('.comment-stale-badge').count(), 1)
        assert((await staleCard.innerText()).includes(body))
        await h.capture('comments-anchor-reopened', reopened.page)
        await evidence(h, 'comments/anchor-locate-then-stale', {
          entryPoint: 'comments/anchor',
          file: saved,
          threadId,
          quote: selected,
          replacement,
          placement: 'stale',
          sourceFile: path,
          persisted: true,
        })
      })
    },
  },
]
