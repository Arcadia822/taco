import {
  defaultFile,
  bundleCanWrite,
  fileByPath,
  fileKind,
  relativePath,
  type TacoBundle,
  type TacoFile,
} from './model.ts'
import { Editor } from '@tiptap/core'
import { canSaveAndUnpack, saveAndUnpack, saveCopy, saveFile, type SaveResult } from './kernel/save.ts'
import { blockHtml, blocksFromEditor, createTacoEditorExtensions, ensureTacoBlockIds, migrateTacoBundleBlocks } from './tiptap-editor.ts'
import { TacoStore } from './store.ts'
import { TacoSyncSession } from './sync/session.ts'
import { displayAuthorName } from './identity.ts'
import { storageGet, storageSet } from './kernel/storage.ts'
import {
  filePathFromHash,
  fileSelectionSessionKey,
  selectedPathForLoad,
  serializeFileSelection,
  usesUrlHashForFileSelection,
} from './file-selection.ts'
import { createBrandMarkContainer } from './brand.ts'
import { createSourceEditor, type SourceEditorController } from './source-editor.ts'
import { FileNavigation } from './file-navigation.ts'
import {
  createControlButton,
  createFileTypeIcon as fileTypeIcon,
  el,
  fallbackFileTitle,
  setButtonIcon,
  sidebarRow,
  svgIcon,
} from './ui-primitives.ts'
import { BundleDirtyTracker } from './dirty-tracker.ts'
import type { MermaidRuntime } from './mermaid.ts'
import { CommentsController } from './comments-controller.ts'
import { joinFromDoc } from './sync/online.ts'
import { LOCALE_CHOICES, copy, resolveLocale, type Locale } from './i18n.ts'
import { OutlineController } from './outline-controller.ts'
import { PresenceController } from './presence-controller.ts'
import { ShareController } from './share-controller.ts'
import { resolveEmbeddedMarkdownAssets } from './markdown-assets.ts'
import { hasCollabSecrets, isolatedPrototypeUrl } from './security.ts'

type AuxiliaryTab = 'outline' | 'comments'

export interface FileBrowserOptions {
  mermaidRuntime?: MermaidRuntime
}

const normalizeRelativeLink = (fromPath: string, href: string): { path: string; hash: string } => {
  const [target, hash = ''] = href.split('#', 2)
  if (!target) return { path: fromPath, hash }
  const base = fromPath.split('/').slice(0, -1)
  const parts = target.startsWith('/') ? target.slice(1).split('/') : [...base, ...target.split('/')]
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') normalized.pop()
    else normalized.push(part)
  }
  return { path: normalized.join('/'), hash }
}

export class FileBrowser {
  private selected: TacoFile | null
  private sidebar!: HTMLElement
  private fileNavigation: FileNavigation | null = null
  private viewer!: HTMLElement
  private leftToggle!: HTMLButtonElement
  private commentToggle!: HTMLButtonElement
  private saveButton!: HTMLButtonElement
  private commentPanel!: HTMLElement
  private commentList!: HTMLElement
  private outlineList!: HTMLElement
  private outlineTab!: HTMLButtonElement
  private commentsTab!: HTMLButtonElement
  private workspacePath!: HTMLElement
  private markdownEditor: Editor | null = null
  private sourceEditor: SourceEditorController | null = null
  private htmlPreviewUrl: string | null = null
  private editorMountSerial = 0
  private locale: Locale
  private readonly store: TacoStore
  private readonly sync: TacoSyncSession
  private readonly comments: CommentsController
  private readonly outline: OutlineController
  private readonly presence: PresenceController
  private readonly share: ShareController
  private readonly dirtyTracker: BundleDirtyTracker
  private readonly cleanups: Array<() => void> = []
  private readonly narrowLayout: MediaQueryList
  private applyingRemoteEditor = false
  private sidebarClosed: boolean
  private commentPanelOpen: boolean
  private auxiliaryTab: AuxiliaryTab
  private sidebarScrollTop = 0
  private readonly stageOpenState = new Map<string, boolean>()
  private readonly folderOpenState = new Map<string, boolean>()
  private readonly handleHashChange = (): void => {
    const path = filePathFromHash(location.hash)
    const file = fileByPath(this.bundle, path)
    if (!file) return
    if (file.path !== this.selected?.path) this.selectFile(file, false)
    else this.rememberOfflineSelection(file)
  }
  private readonly handleDocumentKeyDown = (event: KeyboardEvent): void => this.onKey(event)
  private readonly handleWindowResize = (): void => this.presence.paintRemoteCursors()
  private readonly handleNarrowLayoutChange = (event: MediaQueryListEvent): void => {
    this.sidebarClosed = event.matches
    this.commentPanelOpen = !event.matches
    this.syncPanelToggles()
  }

  constructor(private root: HTMLElement, private bundle: TacoBundle, private readonly options: FileBrowserOptions = {}) {
    this.store = new TacoStore(bundle)
    this.locale = resolveLocale(
      storageGet('taco-locale'),
      __DEFAULT_LOCALE__ ? [__DEFAULT_LOCALE__] : undefined,
    )
    document.documentElement.lang = this.locale
    migrateTacoBundleBlocks(bundle, this.mermaidLabels())
    this.dirtyTracker = new BundleDirtyTracker(bundle)
    this.narrowLayout = matchMedia('(max-width: 820px)')
    this.sidebarClosed = this.narrowLayout.matches
    this.commentPanelOpen = !this.narrowLayout.matches
    const selectionKey = fileSelectionSessionKey(bundle.docId)
    const initialPath = selectedPathForLoad(location.protocol, location.hash, storageGet(selectionKey, 'session'))
    this.selected = fileByPath(bundle, initialPath) ?? defaultFile(bundle)
    if (this.selected) this.rememberOfflineSelection(this.selected)
    this.auxiliaryTab = this.selected && fileKind(this.selected) === 'markdown' ? 'outline' : 'comments'
    this.sync = new TacoSyncSession(this.store)
    this.comments = new CommentsController({
      bundle: this.bundle,
      store: this.store,
      sync: this.sync,
      getSelected: () => this.selected,
      getViewer: () => this.viewer,
      getSourceEditor: () => this.sourceEditor,
      getLocale: () => this.locale,
      openComments: () => this.showComments(),
      toast: (message) => this.toast(message),
    })
    this.outline = new OutlineController({
      getViewer: () => this.viewer,
      getSelected: () => this.selected,
      getNoHeadingsLabel: () => this.t.noHeadings,
      onSelectHeading: (file, headingId) => this.updateSelectionLocation(file, true, headingId),
      onVisibilityChange: () => this.syncAuxiliaryTabs(),
    })
    this.presence = new PresenceController({
      sync: this.sync,
      getEditor: () => this.markdownEditor,
      getSelected: () => this.selected,
      getViewer: () => this.viewer,
      getLabels: () => this.t,
    })
    this.share = new ShareController({
      bundle: this.bundle,
      store: this.store,
      sync: this.sync,
      getLocale: () => this.locale,
      openPopover: (anchor, className) => this.openPopover(anchor, className),
      menuButton: (label, action, options) => this.menuButton(label, action, options),
      selectFile: (file) => this.selectFile(file),
      paintPresence: () => this.presence.paint(),
      reportExport: (result) => this.reportExport(result),
      toast: (message) => this.toast(message),
    })
    this.sync.setPresence({ name: displayAuthorName(), fileId: this.selected?.id ?? '' })
    this.cleanups.push(this.sync.onPeers(() => {
      this.presence.paint()
      this.presence.paintRemoteCursors()
      this.share.refresh()
    }))
    this.cleanups.push(this.sync.onRemote(() => this.applyRemoteState()))
    this.cleanups.push(this.store.onChange(({ change }) => {
      this.dirtyTracker.note(change)
      if (this.saveButton) this.syncDirtyState()
    }))
    if (this.bundle.collab?.room && this.bundle.collab.on !== false) {
      this.sync.enable()
      this.share.wireOnlineStatus(joinFromDoc(this.sync, this.store))
    }
    this.build()
    window.addEventListener('hashchange', this.handleHashChange)
    document.addEventListener('keydown', this.handleDocumentKeyDown)
    window.addEventListener('resize', this.handleWindowResize)
    this.narrowLayout.addEventListener('change', this.handleNarrowLayoutChange)
  }

  destroy(): void {
    window.removeEventListener('hashchange', this.handleHashChange)
    document.removeEventListener('keydown', this.handleDocumentKeyDown)
    window.removeEventListener('resize', this.handleWindowResize)
    this.narrowLayout.removeEventListener('change', this.handleNarrowLayoutChange)
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.sync.close()
    this.markdownEditor?.destroy()
    this.markdownEditor = null
    this.outline.destroy()
    this.revokeHtmlPreviewUrl()
    this.fileNavigation?.destroy()
    this.fileNavigation = null
    this.comments.destroy()
    this.presence.destroy()
    this.share.destroy()
    this.root.replaceChildren()
    this.root.className = ''
  }

  private build(): void {
    if (this.fileNavigation) this.sidebarScrollTop = this.fileNavigation.getScrollTop()
    this.fileNavigation?.destroy()
    this.fileNavigation = null
    this.markdownEditor?.destroy()
    this.markdownEditor = null
    this.root.innerHTML = ''
    this.root.className = 'taco-shell'
    this.root.classList.toggle('sidebar-closed', this.sidebarClosed)
    this.root.classList.toggle('is-readonly', !bundleCanWrite(this.bundle))

    const layout = el('div', 'panel-layout')

    this.fileNavigation = new FileNavigation({
      bundle: this.bundle,
      selected: this.selected,
      labels: {
        files: this.t.files,
        collapseFiles: this.t.collapseFiles,
        stages: this.t.stages,
      },
      stageOpenState: this.stageOpenState,
      folderOpenState: this.folderOpenState,
      scrollTop: this.sidebarScrollTop,
      onSelect: (file) => this.selectFile(file),
      onToggleSidebar: () => this.toggleSidebar(),
    })
    this.sidebar = this.fileNavigation.element
    this.leftToggle = this.fileNavigation.toggle

    const workspacePanel = el('section', 'file-workspace')
    const workspaceHeader = el('header', 'panel-header workspace-header')
    const collapsedBrandMark = createBrandMarkContainer('collapsed-brand-mark brand-mark')
    const collapsedBrandName = el('strong', 'collapsed-brand-name', 'Taco')
    const leftHeaderToggle = createControlButton('panel-left-open', this.t.expandFiles, () => this.toggleSidebar(), 'header-panel-toggle workspace-left-toggle')
    const title = el('input', 'bundle-title')
    title.type = 'text'
    title.value = this.bundle.title
    title.size = Math.max(1, Math.min(title.value.length, 56))
    title.spellcheck = false
    title.disabled = !bundleCanWrite(this.bundle)
    title.title = this.t.documentTitle
    title.setAttribute('aria-label', this.t.documentTitle)
    title.addEventListener('input', () => {
      title.size = Math.max(1, Math.min(title.value.length, 56))
      this.store.commit({ kind: 'document' }, () => { this.bundle.title = title.value.trim() || 'Untitled' })
      document.title = `${this.bundle.title} — Taco`
    })
    title.addEventListener('change', () => {
      title.value = this.bundle.title
    })
    this.workspacePath = el('div', 'workspace-path', this.selected ? relativePath(this.bundle, this.selected) : '')
    const workspaceHeaderSpacer = el('span', 'workspace-header-spacer')
    const share = createControlButton('share', this.t.share, () => this.share.open(share), 'share-button')
    this.share.mount(share)
    const presenceStrip = el('div', 'presence-strip')
    this.presence.mount(presenceStrip)
    this.saveButton = createControlButton('save', this.t.save, () => { void this.handleSave('save') }, 'save-button', true, true)
    const saveMore = createControlButton('chevron-down', this.t.saveCopy, () => this.openSaveMenu(saveMore), 'save-more', false, true)
    const saveGroup = el('div', 'save-group v2-button-group')
    saveGroup.append(this.saveButton, saveMore)
    const language = createControlButton('globe', this.t.language, () => this.openLanguageMenu(language))
    this.commentToggle = createControlButton('message-square', this.t.openComments, () => this.toggleCommentPanel())
    this.commentToggle.classList.add('comment-toggle')
    this.commentToggle.setAttribute('aria-controls', 'taco-comments')
    workspaceHeader.append(
      collapsedBrandMark,
      collapsedBrandName,
      leftHeaderToggle,
      title,
      this.workspacePath,
      workspaceHeaderSpacer,
      presenceStrip,
      this.commentToggle,
      share,
      saveGroup,
      language,
    )

    const workspaceBody = el('div', 'workspace-body')
    this.viewer = el('main', 'file-viewer')
    this.viewer.id = 'taco-main'
    this.viewer.addEventListener('scroll', () => {
      this.presence.paintRemoteCursors()
      this.outline.scheduleActive()
    }, { passive: true })
    this.commentPanel = this.buildCommentPanel()
    this.comments.mount(this.commentList, this.commentToggle)
    this.outline.mount(this.outlineList)
    const commentScrim = el('button', 'comment-scrim') as HTMLButtonElement
    commentScrim.type = 'button'
    commentScrim.setAttribute('aria-label', this.t.close)
    commentScrim.addEventListener('click', () => this.closeCommentPanel())
    workspaceBody.append(this.viewer, commentScrim, this.commentPanel)
    workspacePanel.append(workspaceHeader, workspaceBody)
    layout.append(this.sidebar, workspacePanel)
    this.root.append(layout)
    this.paintViewer()
    this.syncPanelToggles()
    this.comments.paint()
    this.syncAuxiliaryTabs()
    this.presence.paint()
    this.syncDirtyState()
  }

  private selectFile(file: TacoFile, writeHash = true): void {
    this.selected = file
    this.auxiliaryTab = fileKind(file) === 'markdown' ? 'outline' : 'comments'
    this.sync.setPresence({ fileId: file.id ?? '', from: 0, to: 0, focused: false, hasCursor: false })
    this.comments.resetForFileChange()
    this.updateSelectionLocation(file, writeHash)
    this.syncWorkspaceHeader()
    this.fileNavigation?.paint(file)
    this.paintViewer(true)
    this.comments.paint()
    this.syncAuxiliaryTabs()
    this.viewer.scrollTop = 0
    if (this.narrowLayout.matches) {
      this.sidebarClosed = true
      this.commentPanelOpen = false
      this.syncPanelToggles()
    }
  }

  private rememberOfflineSelection(file: TacoFile): void {
    if (usesUrlHashForFileSelection(location.protocol)) return
    storageSet(
      fileSelectionSessionKey(this.bundle.docId),
      serializeFileSelection(file.path, location.hash),
      'session',
    )
  }

  private updateSelectionLocation(file: TacoFile, writeHash: boolean, headingId?: string): void {
    if (!usesUrlHashForFileSelection(location.protocol)) {
      this.rememberOfflineSelection(file)
      return
    }
    if (!writeHash) return
    const heading = headingId ? `::${encodeURIComponent(headingId)}` : ''
    history.replaceState(null, '', `#${encodeURIComponent(file.path)}${heading}`)
  }

  private paintViewer(animateEntrance = false): void {
    const mountSerial = ++this.editorMountSerial
    this.markdownEditor?.destroy()
    this.markdownEditor = null
    this.sourceEditor = null
    this.revokeHtmlPreviewUrl()
    this.viewer.innerHTML = ''
    const file = this.selected
    if (!file) {
      this.viewer.append(el('div', 'empty-state', this.t.empty))
      if (animateEntrance) this.animateSurfaceEntrance(this.viewer.firstElementChild as HTMLElement | null, 'file')
      return
    }
    const kind = fileKind(file)

    if (kind === 'markdown') {
      this.mountMarkdownEditor(file, mountSerial)
    } else if (kind === 'html') {
      this.mountHtmlPrototype(file)
    } else {
      const sourceEditor = createSourceEditor({
        value: file.content,
        language: kind === 'json' ? 'json' : undefined,
        label: this.t.sourceEditor(kind),
        readOnly: !bundleCanWrite(this.bundle),
        onChange: (content) => {
          this.updateFileContent(file.path, content, undefined)
          requestAnimationFrame(() => this.comments.refreshHighlights())
        },
      })
      this.sourceEditor = sourceEditor
      this.viewer.append(sourceEditor.element)
      sourceEditor.input.addEventListener('mouseup', (event) => this.comments.captureSourceSelection(sourceEditor, file, event))
      sourceEditor.input.addEventListener('keyup', (event) => {
        if (event.key === 'Shift') return
        this.comments.captureSourceSelection(sourceEditor, file)
      })
      this.comments.refreshHighlights()
    }
    if (animateEntrance) this.animateSurfaceEntrance(this.viewer.firstElementChild as HTMLElement | null, 'file')
  }

  private animateSurfaceEntrance(surface: HTMLElement | null, profile: 'file' | 'panel' = 'panel'): void {
    if (!surface || matchMedia('(prefers-reduced-motion: reduce)').matches || typeof surface.animate !== 'function') return
    const fileSwitch = profile === 'file'
    surface.animate([
      { opacity: fileSwitch ? .84 : .68, transform: `translateY(${fileSwitch ? 2 : 4}px)` },
      { opacity: 1, transform: 'translateY(0)' },
    ], {
      duration: fileSwitch ? 220 : 160,
      easing: 'cubic-bezier(.23, 1, .32, 1)',
    })
  }

  private revokeHtmlPreviewUrl(): void {
    if (!this.htmlPreviewUrl) return
    if (this.htmlPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(this.htmlPreviewUrl)
    this.htmlPreviewUrl = null
  }

  private mountHtmlPrototype(file: TacoFile): void {
    const shell = el('section', 'html-preview-shell')
    const card = el('article', 'html-preview-card')
    const icon = fileTypeIcon(file)
    icon.classList.add('html-preview-icon')
    icon.setAttribute('aria-hidden', 'true')

    const title = el('h1', 'html-preview-title', file.title?.trim() || fallbackFileTitle(file))

    try {
      this.htmlPreviewUrl = isolatedPrototypeUrl(file.content)
    } catch {
      this.htmlPreviewUrl = null
    }
    const preview = el('a', 'html-preview-action')
    if (this.htmlPreviewUrl) {
      preview.href = this.htmlPreviewUrl
      preview.target = '_blank'
      preview.rel = 'noopener noreferrer'
      preview.referrerPolicy = 'no-referrer'
      preview.append(el('span', '', this.t.openHtmlPrototype), svgIcon('external-link'))
    } else {
      preview.removeAttribute('href')
      preview.setAttribute('aria-disabled', 'true')
      preview.append(el('span', '', this.t.openHtmlPrototype))
      const source = el('pre', 'html-preview-source-fallback')
      source.textContent = file.content
      card.append(icon, title, preview, source)
      shell.append(card)
      this.viewer.append(shell)
      return
    }

    card.append(icon, title, preview)
    shell.append(card)
    this.viewer.append(shell)
  }

  private mountMarkdownEditor(file: TacoFile, mountSerial: number): void {
    const shell = el('section', 'markdown-document-shell')
    const titleRow = el('header', 'document-inline-title')
    const titleIcon = fileTypeIcon(file)
    titleIcon.classList.add('document-inline-title-icon')
    titleIcon.setAttribute('aria-hidden', 'true')
    const title = el('h1', 'document-inline-title-text', file.title?.trim() || fallbackFileTitle(file))
    title.contentEditable = bundleCanWrite(this.bundle) ? 'plaintext-only' : 'false'
    title.spellcheck = true
    title.setAttribute('role', 'textbox')
    title.setAttribute('aria-label', this.t.fileTitle)
    title.title = this.t.fileTitle
    title.addEventListener('input', () => {
      const nextTitle = title.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      this.store.commit({ kind: 'file', fileId: file.id! }, () => {
        if (nextTitle) file.title = nextTitle
        else delete file.title
      })
    })
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        title.blur()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        title.textContent = file.title?.trim() || fallbackFileTitle(file)
        title.blur()
      }
    })
    title.addEventListener('blur', () => {
      const normalized = title.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      title.textContent = normalized || fallbackFileTitle(file)
    })
    titleRow.append(titleIcon, title)
    const editorHost = el('div', 'tiptap-editor-host')
    shell.append(titleRow, editorHost)
    this.viewer.append(shell)

    const extensions = createTacoEditorExtensions(this.mermaidLabels(), {
      mermaidRuntime: this.options.mermaidRuntime,
      onCodeBlockComment: (target) => this.comments.startCodeBlockComment(editorHost, file, target),
    })
    const hasBlocks = Boolean(file.blocks?.length)
    let editor: Editor
    try {
      editor = new Editor({
        element: editorHost,
        extensions,
        editable: bundleCanWrite(this.bundle),
        content: hasBlocks ? blockHtml(file.blocks) : file.content,
        ...(hasBlocks ? {} : { contentType: 'markdown' as const }),
        editorProps: {
          attributes: {
            class: 'tiptap',
            'aria-label': this.t.markdownEditor,
          },
        },
        onUpdate: ({ editor: activeEditor, transaction }) => {
          if (this.markdownEditor !== activeEditor || mountSerial !== this.editorMountSerial) return
          if (!transaction.docChanged) return
          if (this.applyingRemoteEditor) return
          if (ensureTacoBlockIds(activeEditor, file.id ?? file.path, false)) return
          this.updateFileContent(file.path, activeEditor.getMarkdown(), blocksFromEditor(activeEditor, extensions))
          requestAnimationFrame(() => {
            resolveEmbeddedMarkdownAssets(editorHost, this.bundle, file)
            this.comments.refreshHighlights(editorHost)
            this.presence.publish(activeEditor)
            this.outline.paint()
          })
        },
        onSelectionUpdate: ({ editor: activeEditor }) => this.presence.publish(activeEditor),
        onFocus: ({ editor: activeEditor }) => this.presence.publish(activeEditor, true),
        onBlur: ({ editor: activeEditor }) => this.presence.publish(activeEditor, false),
      })
    } catch (error) {
      editorHost.dataset.editorError = error instanceof Error ? error.message : String(error)
      editorHost.replaceChildren(el('p', 'editor-error', this.t.editorFailed))
      return
    }
    this.markdownEditor = editor
    ensureTacoBlockIds(editor, file.id ?? file.path, !hasBlocks)
    if (!file.blocks?.length) {
      file.blocks = blocksFromEditor(editor, extensions)
      this.store.changed({ kind: 'file', fileId: file.id! })
    }
    requestAnimationFrame(() => {
      if (this.markdownEditor !== editor || mountSerial !== this.editorMountSerial) return
      resolveEmbeddedMarkdownAssets(editorHost, this.bundle, file)
      this.comments.refreshHighlights(editorHost)
      const headingHash = decodeURIComponent(location.hash.split('::')[1] ?? '')
      if (headingHash) this.outline.scrollToHeading(headingHash, 'auto')
      this.presence.publish(editor, editor.isFocused, false)
      this.presence.paintRemoteCursors()
      this.outline.paint()
    })
    editorHost.addEventListener('click', (event) => this.handleEditorLink(event, file))
    editorHost.addEventListener('mouseup', () => this.comments.captureEditorSelection(editorHost, file))
    editorHost.addEventListener('keyup', (event) => {
      if ((event as KeyboardEvent).key === 'Shift') return
      this.comments.captureEditorSelection(editorHost, file)
    })
  }

  private mermaidLabels() {
    return {
      source: this.t.mermaidSource,
      hidePreview: this.t.mermaidHidePreview,
      zoom: this.t.mermaidZoom,
      zoomIn: this.t.mermaidZoomIn,
      zoomOut: this.t.mermaidZoomOut,
      resetZoom: this.t.mermaidResetZoom,
      zoomLevel: this.t.mermaidZoomLevel,
      close: this.t.close,
      previewTitle: this.t.mermaidPreviewTitle,
      copy: this.t.codeCopy,
      copied: this.t.codeCopied,
      copyFailed: this.t.codeCopyFailed,
      comment: this.t.commentBlock,
      auto: this.t.codeAuto,
      plainText: this.t.codePlainText,
      loading: this.t.mermaidLoading,
      error: this.t.mermaidError,
    }
  }

  private handleEditorLink(event: Event, file: TacoFile): void {
    const target = event.target as Element | null
    const link = target?.closest<HTMLAnchorElement>('a[href]')
    if (!link) return
    const href = link.getAttribute('href') ?? ''
    if (/^(https?:|mailto:)/i.test(href)) { link.target = '_blank'; link.rel = 'noreferrer noopener'; return }
    const resolved = normalizeRelativeLink(file.path, href)
    const targetFile = fileByPath(this.bundle, resolved.path)
    if (!targetFile) return
    event.preventDefault()
    this.selectFile(targetFile)
    if (resolved.hash) requestAnimationFrame(() => this.outline.scrollToHeading(resolved.hash, 'auto'))
  }

  private buildCommentPanel(): HTMLElement {
    const panel = el('aside', 'comment-panel right-panel')
    panel.id = 'taco-comments'
    panel.setAttribute('aria-label', this.t.rightPanel)
    const header = el('header', 'panel-header comment-panel-header')
    const close = createControlButton('x', this.t.close, () => this.closeCommentPanel(), 'comment-panel-close')
    const tabs = el('div', 'right-panel-tabs segmented-control')
    tabs.setAttribute('role', 'tablist')
    tabs.setAttribute('aria-label', this.t.rightPanel)
    this.outlineTab = this.buildAuxiliaryTab('outline', this.t.outline)
    this.commentsTab = this.buildAuxiliaryTab('comments', this.t.comments)
    tabs.append(this.outlineTab, this.commentsTab)
    header.append(tabs, close)
    this.outlineList = el('nav', 'document-outline')
    this.outlineList.id = 'taco-outline'
    this.outlineList.setAttribute('aria-label', this.t.outline)
    this.outlineList.setAttribute('role', 'tabpanel')
    this.commentList = el('div', 'comment-list')
    this.commentList.id = 'taco-comment-list'
    this.commentList.setAttribute('role', 'tabpanel')
    panel.append(header, this.outlineList, this.commentList)
    return panel
  }

  private buildAuxiliaryTab(tab: AuxiliaryTab, label: string): HTMLButtonElement {
    const button = el('button', 'segmented-control-option', label) as HTMLButtonElement
    button.type = 'button'
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-controls', tab === 'outline' ? 'taco-outline' : 'taco-comment-list')
    button.addEventListener('click', () => this.setAuxiliaryTab(tab))
    return button
  }

  private setAuxiliaryTab(tab: AuxiliaryTab): void {
    if (tab === 'outline' && (!this.selected || fileKind(this.selected) !== 'markdown')) return
    const changed = this.auxiliaryTab !== tab
    this.auxiliaryTab = tab
    this.syncAuxiliaryTabs()
    this.syncPanelToggles()
    if (tab === 'outline') this.outline.scheduleActive()
    else this.commentList.scrollTop = 0
    if (changed) this.animateSurfaceEntrance(tab === 'outline' ? this.outlineList : this.commentList)
  }

  private syncAuxiliaryTabs(): void {
    if (!this.outlineTab || !this.commentsTab || !this.outlineList || !this.commentList) return
    const hasOutline = Boolean(this.selected && fileKind(this.selected) === 'markdown')
    if (!hasOutline && this.auxiliaryTab === 'outline') this.auxiliaryTab = 'comments'
    this.outlineTab.hidden = !hasOutline
    for (const [tab, button] of [['outline', this.outlineTab], ['comments', this.commentsTab]] as const) {
      const active = this.auxiliaryTab === tab
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-selected', String(active))
      button.tabIndex = active ? 0 : -1
    }
    const outlineVisible = hasOutline && this.auxiliaryTab === 'outline'
    this.outlineList.hidden = !outlineVisible
    this.commentList.hidden = this.auxiliaryTab !== 'comments'
  }

  private toggleCommentPanel(): void {
    const wasShowingComments = this.auxiliaryTab === 'comments'
    this.auxiliaryTab = 'comments'
    if (this.narrowLayout.matches) {
      this.commentPanelOpen = wasShowingComments ? !this.commentPanelOpen : true
    }
    this.syncPanelToggles()
    this.comments.paint()
    this.syncAuxiliaryTabs()
    this.commentList.scrollTop = 0
    if (!wasShowingComments) this.animateSurfaceEntrance(this.commentList)
  }

  private closeCommentPanel(): void {
    if (!this.narrowLayout.matches) return
    this.commentPanelOpen = false
    this.syncPanelToggles()
    this.commentToggle.focus()
  }

  private showComments(): void {
    this.auxiliaryTab = 'comments'
    this.commentPanelOpen = true
    this.syncPanelToggles()
    this.syncAuxiliaryTabs()
  }

  private openSearch(): void {
    document.querySelector('dialog')?.remove()
    const dialog = el('dialog', 'search-dialog') as HTMLDialogElement
    const header = el('header', 'dialog-head')
    header.append(el('h2', '', this.t.searchTitle))
    const close = createControlButton('x', this.t.close, () => dialog.close())
    header.append(close)
    const body = el('div', 'dialog-body')
    const input = el('input', 'search-input') as HTMLInputElement
    input.placeholder = this.t.searchPlaceholder
    input.setAttribute('aria-label', this.t.search)
    const results = el('div', 'search-results')
    const paint = () => {
      results.innerHTML = ''
      const query = input.value.trim().toLocaleLowerCase()
      if (!query) return
      const matches = this.bundle.files.filter((file) =>
        relativePath(this.bundle, file).toLocaleLowerCase().includes(query)
        || file.content.toLocaleLowerCase().includes(query))
      for (const file of matches.slice(0, 50)) {
        const button = el('button', 'search-result') as HTMLButtonElement
        button.type = 'button'
        const type = fileTypeIcon(file)
        type.setAttribute('aria-hidden', 'true')
        button.append(type, el('span', '', relativePath(this.bundle, file)))
        button.addEventListener('click', () => { dialog.close(); this.selectFile(file) })
        results.append(button)
      }
      if (!matches.length) results.append(el('p', 'empty-state', this.t.noMatches))
    }
    input.addEventListener('input', paint)
    body.append(input, results)
    dialog.append(header, body)
    dialog.addEventListener('close', () => dialog.remove())
    document.body.append(dialog)
    dialog.showModal()
    input.focus()
  }

  private get t() { return copy[this.locale] }

  private syncWorkspaceHeader(): void {
    this.workspacePath.textContent = this.selected ? relativePath(this.bundle, this.selected) : ''
  }

  private applyRemoteState(): void {
    const selectedId = this.selected?.id
    this.selected = this.bundle.files.find((file) => file.id === selectedId)
      ?? (this.selected ? fileByPath(this.bundle, this.selected.path) : null)
      ?? defaultFile(this.bundle)
    const title = this.root.querySelector<HTMLInputElement>('.bundle-title')
    if (title && title.value !== this.bundle.title) title.value = this.bundle.title
    document.title = `${this.bundle.title} — Taco`

    if (this.markdownEditor && this.selected && fileKind(this.selected) === 'markdown') {
      const selection = this.markdownEditor.state.selection
      this.applyingRemoteEditor = true
      try {
        this.markdownEditor.commands.setContent(blockHtml(this.selected.blocks) || '<p></p>', { emitUpdate: false })
        this.selected.content = this.markdownEditor.getMarkdown()
        const maximum = this.markdownEditor.state.doc.content.size
        this.markdownEditor.commands.setTextSelection({
          from: Math.max(1, Math.min(selection.from, maximum)),
          to: Math.max(1, Math.min(selection.to, maximum)),
        })
      } finally {
        this.applyingRemoteEditor = false
      }
      const host = this.viewer.querySelector<HTMLElement>('.tiptap-editor-host')
      if (host) {
        resolveEmbeddedMarkdownAssets(host, this.bundle, this.selected)
        this.comments.refreshHighlights(host)
      }
      this.outline.paint()
    }
    this.syncWorkspaceHeader()
    this.comments.paint()
    this.syncDirtyState()
    if (this.markdownEditor) {
      const presence = this.sync.presence()
      this.presence.publish(this.markdownEditor, this.markdownEditor.isFocused, presence.hasCursor)
    }
    requestAnimationFrame(() => this.presence.paintRemoteCursors())
  }

  private toggleSidebar(): void {
    this.sidebarClosed = !this.sidebarClosed
    this.syncPanelToggles()
  }

  private syncPanelToggles(): void {
    const sidebarClosed = this.sidebarClosed
    this.root.classList.toggle('sidebar-closed', sidebarClosed)
    this.sidebar.toggleAttribute('inert', sidebarClosed)
    this.sidebar.setAttribute('aria-hidden', String(sidebarClosed))
    setButtonIcon(this.leftToggle, sidebarClosed ? 'panel-left-open' : 'panel-left-close')
    this.leftToggle.title = sidebarClosed ? this.t.expandFiles : this.t.collapseFiles
    this.leftToggle.setAttribute('aria-label', this.leftToggle.title)
    for (const toggle of this.root.querySelectorAll<HTMLButtonElement>('.panel-toggle')) {
      toggle.setAttribute('aria-expanded', String(!sidebarClosed))
    }
    const commentsOpen = !this.narrowLayout.matches || this.commentPanelOpen
    this.root.classList.toggle('comment-panel-open', commentsOpen)
    this.commentPanel.toggleAttribute('inert', !commentsOpen)
    this.commentPanel.setAttribute('aria-hidden', String(!commentsOpen))
    this.commentToggle.title = commentsOpen && this.narrowLayout.matches ? this.t.close : this.t.openComments
    this.commentToggle.setAttribute('aria-label', this.commentToggle.title)
    this.commentToggle.setAttribute('aria-pressed', String(commentsOpen && this.auxiliaryTab === 'comments'))
    this.commentToggle.setAttribute('aria-expanded', String(commentsOpen))
    this.syncAuxiliaryTabs()
  }

  private updateFileContent(path: string, content: string, blocks: TacoFile['blocks']): void {
    const canonical = fileByPath(this.bundle, path)
    if (!canonical) return
    const sameBlocks = canonical.blocks === blocks
      || (canonical.blocks?.length === blocks?.length
        && canonical.blocks?.every((block, index) => {
          const candidate = blocks?.[index]
          return candidate?.id === block.id && candidate.type === block.type && candidate.html === block.html
        }))
    if (canonical.content === content && sameBlocks) return
    this.store.commit({ kind: 'file', fileId: canonical.id! }, () => {
      canonical.content = content
      canonical.blocks = blocks
      if (this.selected?.path === path) {
        this.selected.content = content
        this.selected.blocks = blocks
      }
    })
  }

  private syncDirtyState(): void {
    const dirty = this.dirtyTracker.isDirty()
    this.saveButton.classList.toggle('is-dirty', dirty)
    this.saveButton.title = dirty ? this.t.unsaved : this.t.save
    this.saveButton.setAttribute('aria-label', this.saveButton.title)
  }

  private openPopover(anchor: HTMLElement, className: string): HTMLElement {
    document.querySelector('.topbar-popover')?.remove()
    const popover = el('div', `topbar-popover ${className}`)
    popover.setAttribute('role', 'menu')
    const rect = anchor.getBoundingClientRect()
    popover.style.right = `${Math.max(8, innerWidth - rect.right)}px`
    document.body.append(popover)
    const popoverRect = popover.getBoundingClientRect()
    const originX = Math.min(popoverRect.width - 8, Math.max(8, rect.left + (rect.width / 2) - popoverRect.left))
    const originY = Math.min(popoverRect.height, Math.max(0, rect.bottom - popoverRect.top))
    popover.style.setProperty('--popover-origin-x', `${originX}px`)
    popover.style.setProperty('--popover-origin-y', `${originY}px`)
    const close = (event: Event) => {
      if (!popover.contains(event.target as Node) && event.target !== anchor) {
        popover.remove()
        document.removeEventListener('pointerdown', close)
      }
    }
    requestAnimationFrame(() => document.addEventListener('pointerdown', close))
    return popover
  }

  private menuButton(
    label: string,
    action: () => void | Promise<void>,
    options: { active?: boolean; icon?: Parameters<typeof svgIcon>[0]; menuitem?: boolean } = {},
  ): HTMLButtonElement {
    const check = options.active ? el('span', 'popover-check', '✓') : undefined
    const button = sidebarRow('button', {
      className: 'popover-action',
      leading: options.icon ? svgIcon(options.icon) : undefined,
      label,
      labelClass: 'popover-action-label',
      trailing: check,
    }) as HTMLButtonElement
    button.type = 'button'
    if (options.menuitem !== false) button.setAttribute('role', 'menuitem')
    button.classList.toggle('is-active', options.active === true)
    button.addEventListener('click', () => { void action() })
    return button
  }

  private openLanguageMenu(anchor: HTMLElement): void {
    const menu = this.openPopover(anchor, 'language-menu')
    for (const { code: locale, label } of LOCALE_CHOICES) {
      const button = this.menuButton(label, () => {
        this.locale = locale
        storageSet('taco-locale', locale)
        document.documentElement.lang = locale
        this.build()
        menu.remove()
      }, { active: locale === this.locale })
      menu.append(button)
    }
  }

  private openSaveMenu(anchor: HTMLElement): void {
    const menu = this.openPopover(anchor, 'save-menu')
    menu.append(
      this.menuButton(this.t.save, () => { menu.remove(); void this.handleSave('save') }),
      this.menuButton(this.t.saveCopy, () => { menu.remove(); void this.handleSave('copy') }),
      this.menuButton(this.t.saveAndUnpack, () => { menu.remove(); void this.handleSave('unpack') }),
    )
  }

  private async handleSave(mode: 'save' | 'copy' | 'unpack'): Promise<void> {
    if (mode === 'unpack' && !canSaveAndUnpack()) {
      this.toast(this.t.unpackUnsupported)
      return
    }
    if (hasCollabSecrets(this.bundle) && !window.confirm(this.t.credentialSaveConfirm)) return
    try {
      this.sync.stampInto(this.bundle)
      const result = mode === 'copy'
        ? await saveCopy(this.bundle)
        : mode === 'unpack'
          ? await saveAndUnpack(this.bundle)
          : await saveFile(this.bundle)
      this.reportSave(result)
    } catch {
      this.toast(this.t.saveFailed)
    }
  }

  private reportSave(result: SaveResult): void {
    if (result === 'cancelled') { this.toast(this.t.saveCancelled); return }
    if (result === 'directory-unavailable') { this.toast(this.t.directoryUnavailable); return }
    this.dirtyTracker.markSaved()
    this.syncDirtyState()
    this.saveButton.querySelector('.button-label')!.textContent = this.t.saved
    this.toast(result === 'downloaded'
      ? this.t.saveDownloaded
      : result === 'saved-and-unpacked'
        ? this.t.saveUnpacked(this.bundle.files.length)
        : this.t.saved)
    setTimeout(() => { this.saveButton.querySelector('.button-label')!.textContent = this.t.save }, 1800)
  }

  private reportExport(result: SaveResult): void {
    if (result === 'cancelled') { this.toast(this.t.saveCancelled); return }
    if (result === 'directory-unavailable') { this.toast(this.t.directoryUnavailable); return }
    this.toast(result === 'downloaded' ? this.t.saveDownloaded : this.t.saved)
  }

  private toast(message: string): void {
    document.querySelector('.taco-toast')?.remove()
    const toast = el('div', 'taco-toast', message)
    toast.setAttribute('role', 'status')
    document.body.append(toast)
    setTimeout(() => toast.classList.add('is-leaving'), 2200)
    setTimeout(() => toast.remove(), 2360)
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.narrowLayout.matches && this.commentPanelOpen) {
      event.preventDefault()
      this.closeCommentPanel()
      return
    }
    if (!(event.metaKey || event.ctrlKey)) return
    if (event.key.toLowerCase() === 'k') {
      event.preventDefault()
      this.openSearch()
    } else if (event.key.toLowerCase() === 's') {
      event.preventDefault()
      void this.handleSave('save')
    }
  }
}
