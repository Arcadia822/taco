import { bundleCanWrite, type TacoBundle, type TacoCommentMessage, type TacoCommentThread, type TacoFile, type TacoTextAnchor } from './model.ts'
import { canDeleteMessage, canEditMessage, commentsForPath, createTextAnchor, deleteCommentMessage, editCommentMessage, isDeletedMessage, resolveTextAnchor, sortCommentMessages } from './comments.ts'
import { resolveCommentPlacement, type CommentAnchorProbe, type CommentPlacement, type CommentRange } from './comment-position.ts'
import { domRange, textOffset } from './dom-text-range.ts'
import { requireAuthorName } from './author-name-dialog.ts'
import { copy, type Locale } from './i18n.ts'
import { localId } from './local-id.ts'
import { commentPrincipal, type CommentPrincipal } from './identity.ts'
import type { SourceEditorController } from './source-editor.ts'
import type { TacoStore } from './store.ts'
import type { TacoSyncSession } from './sync/session.ts'
import type { TacoCodeBlockCommentTarget } from './tiptap-code-block.ts'
import { el } from './ui-primitives.ts'

export interface CommentsControllerOptions {
  bundle: TacoBundle
  store: TacoStore
  sync: TacoSyncSession
  getSelected: () => TacoFile | null
  getViewer: () => HTMLElement
  getSourceEditor: () => SourceEditorController | null
  getLocale: () => Locale
  openComments: () => void
  toast: (message: string) => void
}

interface HighlightTarget {
  set(name: string, value: unknown): void
  delete(name: string): void
}

// The bundled DOM types declare neither HighlightRegistry.set nor Highlight.add, so validate structurally.
const isHighlightTarget = (value: unknown): value is HighlightTarget =>
  typeof value === 'object' && value !== null
  && 'set' in value && typeof value.set === 'function'
  && 'delete' in value && typeof value.delete === 'function'

const cssHighlights = (): HighlightTarget | undefined => {
  const candidate: unknown = typeof CSS === 'undefined' ? undefined : CSS.highlights
  return isHighlightTarget(candidate) ? candidate : undefined
}

const createHighlight = (ranges: Range[]): unknown =>
  typeof Highlight === 'undefined' ? null : new Highlight(...ranges)

const placementKey = (placement: CommentPlacement): string =>
  `${placement.placed.map((entry) => entry.thread.id).join(',')}|${placement.stale.map((thread) => thread.id).join(',')}`

export class CommentsController {
  private commentList: HTMLElement | null = null
  private commentToggle: HTMLButtonElement | null = null
  private pendingAnchor: TacoTextAnchor | null = null
  private selectionButton: HTMLButtonElement | null = null
  private principal: CommentPrincipal | null = null
  private principalNoticeShown = false
  private placement: CommentPlacement = { placed: [], stale: [] }

  constructor(private readonly options: CommentsControllerOptions) {}

  mount(commentList: HTMLElement, commentToggle: HTMLButtonElement): void {
    this.commentList = commentList
    this.commentToggle = commentToggle
  }

  resetForFileChange(): void {
    this.pendingAnchor = null
    this.removeSelectionButton()
  }

  destroy(): void {
    this.clearHighlights()
    this.removeSelectionButton()
    this.commentList = null
    this.commentToggle = null
  }

  paint(): void {
    if (!this.commentList || !this.commentToggle) return
    this.commentList.innerHTML = ''
    const path = this.options.getSelected()?.path
    const threads = path ? commentsForPath(this.options.bundle.comments, path) : []
    const openCount = threads
      .filter((thread) => thread.status === 'open')
      .reduce((count, thread) => count + thread.messages.filter((message) => !isDeletedMessage(message)).length, 0)
    this.commentToggle.querySelector('.comment-count')?.remove()
    if (openCount) this.commentToggle.append(el('span', 'comment-count', String(openCount)))

    this.placement = resolveCommentPlacement(threads, this.anchorProbe())
    const pendingAnchor = this.pendingAnchor?.path === path ? this.pendingAnchor : null
    if (pendingAnchor) this.commentList.append(this.buildNewCommentComposer(pendingAnchor))
    if (!threads.length && !pendingAnchor) this.commentList.append(this.buildEmptyCommentBanner())
    for (const { thread } of this.placement.placed) this.commentList.append(this.buildCommentThread(thread))
    if (this.placement.stale.length) this.commentList.append(this.buildStaleCommentGroup(this.placement.stale))
  }

  captureEditorSelection(editorHost: HTMLElement, file: TacoFile): void {
    if (!bundleCanWrite(this.options.bundle)) return
    this.removeSelectionButton()
    const article = editorHost.querySelector<HTMLElement>('.tiptap')
    const selection = window.getSelection()
    if (!article || !selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (range.collapsed) return
    if (!article.contains(range.startContainer) || !article.contains(range.endContainer)) return
    const start = textOffset(article, range.startContainer, range.startOffset)
    const end = textOffset(article, range.endContainer, range.endOffset)
    if (end <= start) return
    const anchor = createTextAnchor(file.path, article.textContent ?? '', start, end)
    if (!anchor.quote.exact.trim()) return
    const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null
    this.showSelectionCommentButton(anchor, rect?.left ?? 8, (rect?.bottom ?? 8) + 8)
  }

  startCodeBlockComment(editorHost: HTMLElement, file: TacoFile, target: TacoCodeBlockCommentTarget): void {
    if (!bundleCanWrite(this.options.bundle)) return
    this.removeSelectionButton()
    const article = editorHost.querySelector<HTMLElement>('.tiptap')
    if (!article || !article.contains(target.content)) return
    const blockStart = textOffset(article, target.content, 0)
    const start = blockStart + (target.selection?.start ?? 0)
    const end = target.selection ? blockStart + target.selection.end : textOffset(article, target.content, target.content.childNodes.length)
    if (end <= start) return
    const anchor = createTextAnchor(file.path, article.textContent ?? '', start, end)
    anchor.block = {
      id: target.blockId,
      type: 'codeBlock',
      language: target.language,
      ...(target.nodeId ? { nodeId: target.nodeId } : {}),
      ...(target.nodeLabel ? { nodeLabel: target.nodeLabel } : {}),
      ...(target.lineNumber ? { lineNumber: target.lineNumber } : {}),
      ...(target.lineText ? { lineText: target.lineText } : {}),
    }
    if (target.selection && target.sourceEditor) {
      const rect = target.sourceEditor.input.getBoundingClientRect()
      this.showSelectionCommentButton(anchor, target.selectionEvent?.clientX ?? rect.left + 8, (target.selectionEvent?.clientY ?? rect.top) + 8)
      return
    }
    document.querySelector<HTMLDialogElement>('.mermaid-zoom-dialog[open]')?.dispatchEvent(new Event('cancel', { cancelable: true }))
    this.pendingAnchor = anchor
    this.options.openComments()
    this.paint()
  }

  captureSourceSelection(sourceEditor: SourceEditorController, file: TacoFile, event?: MouseEvent, immediate = false): void {
    if (!bundleCanWrite(this.options.bundle)) return
    this.removeSelectionButton()
    const { input } = sourceEditor
    const start = Math.min(input.selectionStart, input.selectionEnd)
    const end = Math.max(input.selectionStart, input.selectionEnd)
    if (end <= start) return
    const anchor = createTextAnchor(file.path, input.value, start, end)
    if (!anchor.quote.exact.trim()) return
    if (immediate) {
      document.querySelector<HTMLDialogElement>('.mermaid-zoom-dialog[open]')?.dispatchEvent(new Event('cancel', { cancelable: true }))
      this.pendingAnchor = anchor
      this.options.openComments()
      this.paint()
      return
    }
    const rect = input.getBoundingClientRect()
    const left = event?.clientX || rect.left + 8
    const top = event?.clientY ? event.clientY + 8 : rect.top + 8
    this.showSelectionCommentButton(anchor, left, top)
  }

  openHighlightedComment(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    const file = this.options.getSelected()
    const target = event.target
    if (!file || !(target instanceof Element)) return
    const source = this.options.getSourceEditor()
    const article = this.options.getViewer().querySelector<HTMLElement>('.tiptap')
    const inSource = source && target === source.input
    if (inSource) {
      if (source.input.selectionStart !== source.input.selectionEnd) return
    } else {
      if (!article?.contains(target) || target.closest('a, button, input, textarea, select')) return
      if (window.getSelection()?.isCollapsed === false) return
    }
    const entry = this.currentPlacement().placed.find((candidate) => {
      if (candidate.thread.status !== 'open') return false
      if (candidate.thread.anchor.block && !inSource) return this.findCommentBlock(candidate.thread.anchor)?.contains(target) ?? false
      if (!candidate.range) return false
      if (inSource) return source.input.selectionStart >= candidate.range.start && source.input.selectionStart < candidate.range.end
      const range = domRange(article!, candidate.range.start, candidate.range.end)
      return range && Array.from(range.getClientRects()).some((rect) =>
        event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom)
    })
    if (!entry) return
    this.removeSelectionButton()
    this.options.openComments()
    const card = Array.from(this.commentList?.querySelectorAll<HTMLElement>('.comment-thread') ?? [])
      .find((node) => node.dataset.threadId === entry.thread.id)
    card?.querySelector<HTMLButtonElement>('.comment-quote-button')?.focus({ preventScroll: true })
    card?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' })
  }

  refreshHighlights(editorHost = this.options.getViewer().querySelector<HTMLElement>('.tiptap-editor-host')): void {
    this.clearHighlights()
    const path = this.options.getSelected()?.path
    if (!path) return
    const placement = this.currentPlacement()
    // Marks and panel share this resolution: only a genuine change of order or of the stale set repaints the list.
    if (placementKey(placement) !== placementKey(this.placement)) {
      this.placement = placement
      this.paint()
    }
    const open = placement.placed.filter((entry) => entry.thread.status === 'open')
    const sourceEditor = this.options.getSourceEditor()
    if (sourceEditor) {
      sourceEditor.setCommentRanges(open.map((entry) => entry.range).filter((range): range is CommentRange => Boolean(range)))
      return
    }
    const article = editorHost?.querySelector<HTMLElement>('.tiptap')
    if (!article || !editorHost) return
    for (const entry of open) {
      if (entry.thread.anchor.block) this.findCommentBlock(entry.thread.anchor)?.classList.add('has-comment')
    }
    const ranges = open
      .filter((entry) => entry.range && !entry.thread.anchor.block)
      .map((entry) => domRange(article, entry.range!.start, entry.range!.end))
      .filter((range): range is Range => Boolean(range))
    const highlights = cssHighlights()
    const highlight = ranges.length ? createHighlight(ranges) : null
    if (highlights && highlight) highlights.set('taco-comments', highlight)
    else if (ranges.length) this.paintFallbackHighlights(editorHost, ranges, 'comments')
  }

  clearHighlights(): void {
    const sourceEditor = this.options.getSourceEditor()
    sourceEditor?.setCommentRanges([])
    sourceEditor?.activateRange(null)
    const highlights = cssHighlights()
    highlights?.delete('taco-comments')
    highlights?.delete('taco-active-comment')
    highlights?.delete('taco-hover-comment')
    const viewer = this.options.getViewer()
    for (const block of viewer.querySelectorAll('.tiptap-code-block.has-comment, .tiptap-code-block.is-active-comment')) {
      block.classList.remove('has-comment', 'is-active-comment')
    }
    for (const layer of viewer.querySelectorAll('[data-comment-highlight-layer]')) layer.remove()
  }

  /** Where the current document can be read from: the source editor while it is shown, otherwise the rendered document. */
  private anchorProbe(): CommentAnchorProbe {
    const sourceEditor = this.options.getSourceEditor()
    if (sourceEditor) {
      const text = sourceEditor.input.value
      // Source mode renders no code-block element, so block anchors resolve against the editable text.
      return { text, blockRange: (anchor) => resolveTextAnchor(text, anchor) }
    }
    const article = this.options.getViewer().querySelector<HTMLElement>('.tiptap')
    if (!article) return { text: null, blockRange: () => null }
    return {
      text: article.textContent ?? '',
      blockRange: (anchor) => {
        const block = this.findCommentBlock(anchor)
        if (!block) return null
        const start = textOffset(article, block, 0)
        return { start, end: start + (block.textContent?.length ?? 0) }
      },
    }
  }

  private currentPlacement(): CommentPlacement {
    const path = this.options.getSelected()?.path
    const threads = path ? commentsForPath(this.options.bundle.comments, path) : []
    return resolveCommentPlacement(threads, this.anchorProbe())
  }

  private get t() { return copy[this.options.getLocale()] }

  private buildEmptyCommentBanner(): HTMLElement {
    const banner = el('section', 'comment-empty-banner')
    banner.setAttribute('role', 'status')
    banner.append(
      el('strong', 'comment-empty-title', this.t.noComments),
      el('p', 'comment-empty-hint', this.t.commentsEmptyHint),
    )
    return banner
  }

  private buildNewCommentComposer(anchor: TacoTextAnchor): HTMLElement {
    const composer = el('section', 'comment-composer')
    composer.append(el('div', 'comment-composer-label', this.t.addComment), this.buildQuote(anchor))
    const form = el('form', 'comment-form')
    const textarea = el('textarea', 'comment-input') as HTMLTextAreaElement
    textarea.placeholder = this.t.commentPlaceholder
    textarea.setAttribute('aria-label', this.t.commentPlaceholder)
    const actions = el('div', 'comment-form-actions')
    const cancel = el('button', 'comment-action', this.t.cancel) as HTMLButtonElement
    cancel.type = 'button'
    cancel.addEventListener('click', () => {
      this.pendingAnchor = null
      this.removeSelectionButton()
      this.paint()
    })
    const submit = el('button', 'comment-submit', this.t.addComment) as HTMLButtonElement
    submit.type = 'submit'
    actions.append(cancel, submit)
    form.append(textarea, actions)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const body = textarea.value.trim()
      if (!body) { this.options.toast(this.t.emptyComment); textarea.focus(); return }
      this.addCommentThread(anchor, body)
    })
    composer.append(form)
    requestAnimationFrame(() => textarea.focus())
    return composer
  }

  private buildCommentThread(thread: TacoCommentThread, stale = false): HTMLElement {
    const card = el('article', `comment-thread${thread.status === 'resolved' ? ' is-resolved' : ''}${stale ? ' is-stale' : ''}`)
    card.dataset.threadId = thread.id
    card.addEventListener('pointerenter', () => this.previewCommentThread(thread))
    card.addEventListener('pointerleave', () => this.clearCommentPreview())
    const quote = this.buildQuote(thread.anchor, true) as HTMLButtonElement
    quote.type = 'button'
    quote.addEventListener('click', () => this.activateCommentThread(thread))
    card.append(quote)
    if (stale) card.append(el('p', 'comment-stale-badge', this.t.positionLost))
    for (const message of sortCommentMessages(thread.messages)) card.append(this.buildCommentMessage(thread, message))
    if (!bundleCanWrite(this.options.bundle)) return card
    const actions = el('div', 'comment-thread-actions')
    const reply = el('button', 'comment-action', this.t.reply) as HTMLButtonElement
    reply.type = 'button'
    reply.addEventListener('click', () => this.openReplyComposer(card, thread))
    const resolve = el('button', 'comment-action', thread.status === 'open' ? this.t.resolve : this.t.reopen) as HTMLButtonElement
    resolve.type = 'button'
    resolve.addEventListener('click', () => this.toggleThreadStatus(thread))
    const remove = el('button', 'comment-action comment-delete', this.t.deleteThread) as HTMLButtonElement
    remove.type = 'button'
    remove.addEventListener('click', () => this.deleteThread(thread))
    actions.append(reply, resolve, remove)
    card.append(actions)
    return card
  }

  private buildStaleCommentGroup(threads: TacoCommentThread[]): HTMLElement {
    const group = el('section', 'comment-stale-group')
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', this.t.positionLost)
    group.append(el('h3', 'comment-stale-heading', this.t.positionLost))
    for (const thread of threads) group.append(this.buildCommentThread(thread, true))
    return group
  }

  /** Point at a thread's live range while the pointer rests on its card, without disturbing the reading surface. */
  private previewCommentThread(thread: TacoCommentThread): void {
    const entry = this.currentPlacement().placed.find((candidate) => candidate.thread.id === thread.id)
    if (!entry?.range) return
    const sourceEditor = this.options.getSourceEditor()
    if (sourceEditor) {
      sourceEditor.highlightRange(entry.range)
      return
    }
    const article = this.options.getViewer().querySelector<HTMLElement>('.tiptap')
    const host = article?.closest<HTMLElement>('.tiptap-editor-host')
    if (!article || !host) return
    const range = domRange(article, entry.range.start, entry.range.end)
    if (!range) return
    const highlights = cssHighlights()
    const highlight = createHighlight([range])
    if (highlights && highlight) highlights.set('taco-hover-comment', highlight)
    else {
      host.querySelector('[data-highlight-name="hover"]')?.remove()
      this.paintFallbackHighlights(host, [range], 'hover')
    }
  }

  private clearCommentPreview(): void {
    this.options.getSourceEditor()?.highlightRange(null)
    cssHighlights()?.delete('taco-hover-comment')
    this.options.getViewer().querySelector('[data-highlight-name="hover"]')?.remove()
  }

  private buildCommentMessage(thread: TacoCommentThread, message: TacoCommentMessage): HTMLElement {
    const node = el('section', `comment-message${isDeletedMessage(message) ? ' is-deleted' : ''}`)
    node.dataset.threadId = thread.id
    node.dataset.messageId = message.id
    const meta = el('div', 'comment-meta')
    const dates = el('span', 'comment-dates')
    const created = el('time', '', this.formatCommentDate(message.createdAt)) as HTMLTimeElement
    created.dateTime = message.createdAt
    dates.append(created)
    if (message.updatedAt && !message.deletedAt) {
      const edited = el('span', 'comment-edited', this.t.edited)
      edited.setAttribute('aria-label', this.t.editedAt(this.formatCommentDate(message.updatedAt)))
      edited.title = this.t.editedAt(this.formatCommentDate(message.updatedAt))
      dates.append(edited)
    }
    meta.append(el('strong', '', message.author), dates)
    node.append(meta)
    if (isDeletedMessage(message)) {
      const tombstone = el('p', 'comment-tombstone', this.t.messageDeleted)
      tombstone.setAttribute('role', 'status')
      node.append(tombstone)
      return node
    }
    node.append(el('p', 'comment-body', message.body))
    const writable = bundleCanWrite(this.options.bundle)
    if (!writable) return node
    const actions = el('div', 'comment-message-actions')
    const principal = this.getPrincipal()
    if (canEditMessage(message, principal.id, writable)) {
      const edit = el('button', 'comment-action', this.t.editMessage) as HTMLButtonElement
      edit.type = 'button'
      edit.setAttribute('aria-label', this.t.editMessageBy(message.author))
      edit.addEventListener('click', () => this.openMessageEditor(node, thread, message))
      actions.append(edit)
    }
    if (canDeleteMessage(message, writable)) {
      const remove = el('button', 'comment-action comment-message-delete', this.t.deleteMessage) as HTMLButtonElement
      remove.type = 'button'
      remove.setAttribute('aria-label', this.t.deleteMessageBy(message.author))
      remove.addEventListener('click', () => this.deleteMessage(thread, message))
      actions.append(remove)
    }
    if (actions.childElementCount) node.append(actions)
    return node
  }

  private openMessageEditor(
    node: HTMLElement,
    thread: TacoCommentThread,
    message: TacoCommentMessage,
  ): void {
    const existing = node.closest('.comment-thread')?.querySelector('.comment-message-editor')?.closest<HTMLElement>('.comment-message')
    if (existing && existing !== node) {
      const existingMessage = thread.messages.find((candidate) => candidate.id === existing.dataset.messageId)
      if (existingMessage) existing.replaceWith(this.buildCommentMessage(thread, existingMessage))
    }
    const signature = `${message.body}\u0000${message.updatedAt ?? ''}\u0000${message.deletedAt ?? ''}`
    node.querySelector('.comment-body')?.remove()
    node.querySelector('.comment-message-actions')?.remove()
    const form = el('form', 'comment-form comment-message-editor')
    const textarea = el('textarea', 'comment-input') as HTMLTextAreaElement
    textarea.value = message.body
    textarea.setAttribute('aria-label', this.t.editMessageBy(message.author))
    const error = el('p', 'comment-validation')
    error.id = localId('comment-error')
    error.setAttribute('role', 'alert')
    error.hidden = true
    textarea.setAttribute('aria-describedby', error.id)
    const actions = el('div', 'comment-form-actions')
    const cancel = el('button', 'comment-action', this.t.cancel) as HTMLButtonElement
    cancel.type = 'button'
    const save = el('button', 'comment-submit', this.t.saveMessage) as HTMLButtonElement
    save.type = 'submit'
    actions.append(cancel, save)
    form.append(textarea, error, actions)
    node.append(form)
    const restore = (): void => {
      node.replaceWith(this.buildCommentMessage(thread, message))
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-message-id="${message.id}"] .comment-action`)?.focus())
    }
    cancel.addEventListener('click', restore)
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); restore() }
    })
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const body = textarea.value.trim()
      if (!body) {
        error.textContent = this.t.emptyComment
        error.hidden = false
        textarea.setAttribute('aria-invalid', 'true')
        textarea.focus()
        return
      }
      const current = thread.messages.find((candidate) => candidate.id === message.id)
      const currentSignature = current ? `${current.body}\u0000${current.updatedAt ?? ''}\u0000${current.deletedAt ?? ''}` : ''
      if (!current || currentSignature !== signature) {
        this.options.toast(this.t.messageChangedRemotely)
        this.paint()
        return
      }
      if (body === current.body) { restore(); return }
      const timestamp = new Date().toISOString()
      this.options.store.commit({ kind: 'comments', path: thread.anchor.path }, () => {
        editCommentMessage(thread, message.id, body, timestamp)
      })
      this.paint()
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-message-id="${message.id}"] .comment-action`)?.focus())
    })
    requestAnimationFrame(() => { textarea.focus(); textarea.select() })
  }

  private deleteMessage(thread: TacoCommentThread, message: TacoCommentMessage): void {
    if (!canDeleteMessage(message, bundleCanWrite(this.options.bundle))) return
    if (typeof window.confirm === 'function' && !window.confirm(this.t.deleteMessageConfirm)) return
    const timestamp = new Date().toISOString()
    this.options.store.commit({ kind: 'comments', path: thread.anchor.path }, () => {
      deleteCommentMessage(thread, message.id, timestamp)
    })
    this.paint()
  }

  private buildQuote(anchor: TacoTextAnchor, interactive = false): HTMLElement {
    const quote = el(interactive ? 'button' : 'blockquote', `comment-quote${interactive ? ' comment-quote-button' : ''}${anchor.block ? ' is-block' : ''}`)
    if (quote instanceof HTMLButtonElement) quote.type = 'button'
    quote.textContent = anchor.block ? this.blockReferenceLabel(anchor) : anchor.quote.exact
    return quote
  }

  private blockReferenceLabel(anchor: TacoTextAnchor): string {
    if (anchor.block?.language === 'mermaid') {
      if (anchor.block.nodeLabel || anchor.block.nodeId) {
        return `${this.t.mermaidBlockReference} · ${anchor.block.nodeLabel || anchor.block.nodeId}`
      }
      if (anchor.block.lineNumber) {
        return `${this.t.mermaidBlockReference} · L${anchor.block.lineNumber}`
      }
      return this.t.mermaidBlockReference
    }
    const language = anchor.block?.language ? this.displayCodeLanguage(anchor.block.language) : ''
    return this.t.codeBlockReference(language)
  }

  private displayCodeLanguage(language: string): string {
    const names: Record<string, string> = {
      bash: 'Bash', css: 'CSS', html: 'HTML', javascript: 'JavaScript', js: 'JavaScript', json: 'JSON',
      markdown: 'Markdown', python: 'Python', shell: 'Shell', sh: 'Shell', sql: 'SQL', ts: 'TypeScript',
      typescript: 'TypeScript', xml: 'XML', yaml: 'YAML', yml: 'YAML', text: this.t.codePlainText, plaintext: this.t.codePlainText,
    }
    return names[language] ?? `${language.charAt(0).toLocaleUpperCase()}${language.slice(1)}`
  }

  private addCommentThread(anchor: TacoTextAnchor, body: string): void {
    if (!bundleCanWrite(this.options.bundle)) return
    requireAuthorName({ title: this.t.yourName, hint: this.t.nameHint, cancel: this.t.cancel, confirm: this.t.addComment }, (author) => {
      if (!bundleCanWrite(this.options.bundle)) return
      const timestamp = new Date().toISOString()
      const thread: TacoCommentThread = {
        id: localId('thread'),
        anchor: structuredClone(anchor),
        status: 'open',
        messages: [{ id: localId('message'), author, authorId: this.getPrincipal().id, body, createdAt: timestamp }],
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      this.options.store.commit({ kind: 'comments', path: anchor.path }, () => { (this.options.bundle.comments ??= []).push(thread) })
      this.options.sync.setPresence({ name: author })
      this.pendingAnchor = null
      this.removeSelectionButton()
      this.paint()
      this.refreshHighlights()
    })
  }

  private openReplyComposer(card: HTMLElement, thread: TacoCommentThread): void {
    if (!bundleCanWrite(this.options.bundle)) return
    card.querySelector('.comment-reply-form')?.remove()
    const form = el('form', 'comment-form comment-reply-form')
    const textarea = el('textarea', 'comment-input') as HTMLTextAreaElement
    textarea.placeholder = this.t.replyPlaceholder
    textarea.setAttribute('aria-label', this.t.replyPlaceholder)
    const submit = el('button', 'comment-submit', this.t.reply) as HTMLButtonElement
    submit.type = 'submit'
    form.append(textarea, submit)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const body = textarea.value.trim()
      if (!body) { this.options.toast(this.t.emptyComment); return }
      requireAuthorName({ title: this.t.yourName, hint: this.t.nameHint, cancel: this.t.cancel, confirm: this.t.reply }, (author) => {
        if (!bundleCanWrite(this.options.bundle)) return
        const timestamp = new Date().toISOString()
        this.options.store.commit({ kind: 'comments', path: thread.anchor.path }, () => {
          thread.messages.push({ id: localId('message'), author, authorId: this.getPrincipal().id, body, createdAt: timestamp })
          thread.updatedAt = timestamp
        })
        this.options.sync.setPresence({ name: author })
        this.paint()
      })
    })
    card.append(form)
    textarea.focus()
  }

  private toggleThreadStatus(thread: TacoCommentThread): void {
    if (!bundleCanWrite(this.options.bundle)) return
    this.options.store.commit({ kind: 'comments', path: thread.anchor.path }, () => {
      thread.status = thread.status === 'open' ? 'resolved' : 'open'
      thread.updatedAt = new Date().toISOString()
    })
    this.paint()
    this.refreshHighlights()
  }

  private deleteThread(thread: TacoCommentThread): void {
    if (!bundleCanWrite(this.options.bundle)) return
    if (typeof window.confirm === 'function' && !window.confirm(this.t.deleteThreadConfirm)) return
    const comments = this.options.bundle.comments ?? []
    const index = comments.findIndex((candidate) => candidate.id === thread.id)
    if (index === -1) return
    this.options.store.commit({ kind: 'comments', path: thread.anchor.path }, () => { comments.splice(index, 1) })
    this.paint()
    this.refreshHighlights()
  }

  private getPrincipal(): CommentPrincipal {
    this.principal ??= commentPrincipal(this.options.bundle.docId)
    if (!this.principal.persistent && !this.principalNoticeShown) {
      this.principalNoticeShown = true
      this.options.toast(this.t.principalSessionOnly)
    }
    return this.principal
  }

  private showSelectionCommentButton(anchor: TacoTextAnchor, left: number, top: number): void {
    this.pendingAnchor = anchor
    const button = el('button', 'selection-comment-button', this.t.commentSelection) as HTMLButtonElement
    button.type = 'button'
    button.setAttribute('data-taco-transient', '')
    button.style.left = `${Math.min(innerWidth - 132, Math.max(8, left))}px`
    button.style.top = `${Math.min(innerHeight - 44, Math.max(8, top))}px`
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', () => {
      document.querySelector<HTMLDialogElement>('.mermaid-zoom-dialog[open]')?.dispatchEvent(new Event('cancel', { cancelable: true }))
      this.options.openComments()
      this.paint()
    })
    ;(document.querySelector('.mermaid-zoom-dialog[open]') ?? document.body).append(button)
    this.selectionButton = button
  }

  private activateCommentThread(thread: TacoCommentThread): void {
    const viewer = this.options.getViewer()
    if (thread.anchor.block) {
      const block = this.findCommentBlock(thread.anchor)
      if (!block) { this.options.toast(this.t.unresolvedAnchor); return }
      viewer.querySelector('.tiptap-code-block.is-active-comment')?.classList.remove('is-active-comment')
      block.classList.add('is-active-comment')
      const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      block.scrollIntoView?.({ behavior, block: 'center' })
      if (thread.anchor.block.nodeId) {
        const node = block.querySelector<SVGElement>(`[data-node-id="${CSS.escape(thread.anchor.block.nodeId)}"]`)
        if (node) {
          block.querySelectorAll('.interactive-mermaid-node.is-node-active').forEach((n) => n.classList.remove('is-node-active'))
          node.classList.add('is-node-active')
        }
      }
      if (thread.anchor.block.lineNumber) {
        const toggle = block.querySelector<HTMLButtonElement>('.tiptap-code-block-panel')
        if (toggle?.getAttribute('aria-pressed') !== 'true') toggle?.click()
        const input = block.querySelector<HTMLTextAreaElement>('.mermaid-floating-code-panel textarea')
        if (input) {
          const lines = input.value.split('\n')
          const start = lines.slice(0, thread.anchor.block.lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0)
          input.focus()
          input.setSelectionRange(start, start + (lines[thread.anchor.block.lineNumber - 1]?.length ?? 0))
        }
      }
      return
    }
    const entry = this.currentPlacement().placed.find((candidate) => candidate.thread.id === thread.id)
    if (!entry?.range) { this.options.toast(this.t.unresolvedAnchor); return }
    const sourceEditor = this.options.getSourceEditor()
    if (sourceEditor) {
      sourceEditor.activateRange(entry.range)
      return
    }
    const article = viewer.querySelector<HTMLElement>('.tiptap')
    if (!article) return
    const range = domRange(article, entry.range.start, entry.range.end)
    if (!range) { this.options.toast(this.t.unresolvedAnchor); return }
    const highlights = cssHighlights()
    const highlight = createHighlight([range])
    if (highlights && highlight) highlights.set('taco-active-comment', highlight)
    else {
      const host = article.closest<HTMLElement>('.tiptap-editor-host')
      if (host) {
        host.querySelector('[data-highlight-name="active"]')?.remove()
        this.paintFallbackHighlights(host, [range], 'active')
      }
    }
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    range.startContainer.parentElement?.scrollIntoView({ behavior, block: 'center' })
  }

  private findCommentBlock(anchor: TacoTextAnchor): HTMLElement | null {
    if (!anchor.block) return null
    return Array.from(this.options.getViewer().querySelectorAll<HTMLElement>('.tiptap-code-block[data-taco-block-id]'))
      .find((block) => block.dataset.tacoBlockId === anchor.block?.id) ?? null
  }

  private paintFallbackHighlights(editorHost: HTMLElement, ranges: Range[], name: 'comments' | 'hover' | 'active'): void {
    const layer = el('div', `comment-highlight-layer is-${name}`)
    layer.setAttribute('data-comment-highlight-layer', '')
    layer.dataset.highlightName = name
    layer.setAttribute('aria-hidden', 'true')
    const hostRect = editorHost.getBoundingClientRect()
    for (const range of ranges) {
      const rects = typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : []
      for (const rect of rects) {
        if (rect.width === 0 || rect.height === 0) continue
        const mark = el('span', 'comment-highlight-mark')
        mark.style.left = `${rect.left - hostRect.left}px`
        mark.style.top = `${rect.top - hostRect.top}px`
        mark.style.width = `${rect.width}px`
        mark.style.height = `${rect.height}px`
        layer.append(mark)
      }
    }
    editorHost.append(layer)
  }

  private removeSelectionButton(): void {
    this.selectionButton?.remove()
    this.selectionButton = null
  }

  private formatCommentDate(value: string): string {
    const date = new Date(value)
    return Number.isNaN(date.valueOf())
      ? value
      : new Intl.DateTimeFormat(this.options.getLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
  }
}
