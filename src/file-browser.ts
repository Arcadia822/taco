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
import { canSaveAndUnpack, canWriteInPlace, saveAndUnpack, saveCopy, saveFile, type SaveResult } from './kernel/save.ts'
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
  showConfirmDialog,
  sidebarRow,
  svgIcon,
} from './ui-primitives.ts'
import { BundleDirtyTracker } from './dirty-tracker.ts'
import type { MermaidRuntime } from './mermaid.ts'
import { CommentsController } from './comments-controller.ts'
import { joinFromDoc } from './sync/online.ts'
import { LOCALE_CHOICES, copy, resolveLocale, type Locale } from './i18n.ts'
import { createUnifiedDiff } from './kernel/diff.ts'
import { MarkdownBlockReconstructor } from './markdown-block-reconstructor.ts'
import { OutlineController } from './outline-controller.ts'
import { PresenceController } from './presence-controller.ts'
import { ShareController } from './share-controller.ts'
import { openPngPreview, resolveEmbeddedMarkdownAssets } from './markdown-assets.ts'
import { hasCollabSecrets } from './security.ts'
import { localFileUrl } from './local-file-url.ts'
import { frontmatterTitle, parseFrontmatter } from './frontmatter.ts'
import { setEditorFrontmatterProperty } from './tiptap-document-properties.ts'
import { tacoScope } from './stage-navigation.ts'
import { createStructuredFileViewer, structuredFileLabels } from './structured-file-viewer.ts'
import { createSegmentedControl } from './segmented-control.ts'

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
  private readonly markdownMigrationErrors = new Map<string, string>()
  private markdownEditor: Editor | null = null
  private readonly markdownReconstructor = new MarkdownBlockReconstructor()
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
  private copyFeedbackTimer: number | null = null
  private readonly dirtyTracker: BundleDirtyTracker
  private readonly cleanups: Array<() => void> = []
  private readonly narrowLayout: MediaQueryList
  private copyButton!: HTMLButtonElement
  private copyReviewGroup!: HTMLElement
  private readonly systemAppearance = window.matchMedia('(prefers-color-scheme: dark)')
  private themePreference: 'system' | 'light' | 'dark' = 'system'
  private readonly handleSystemAppearanceChange = (): void => {
    if (this.themePreference === 'system') this.applyAppearance()
  }
  private applyingRemoteEditor = false
  private sidebarClosed: boolean
  private commentPanelOpen: boolean
  private desktopCommentPanelOpen: boolean
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
    this.commentPanelOpen = !event.matches && this.desktopCommentPanelOpen
    this.syncPanelToggles()
  }

  getModifiedReviewFiles(): Array<{ path: string; mediaType: string; content: string; diff?: string }> {
    const dirtyIds = this.dirtyTracker.getDirtyFileIds()
    return this.bundle.files
      .filter((file) => dirtyIds.has(file.id ?? file.path))
      .map((file) => {
        const rel = relativePath(this.bundle, file)
        const baseline = this.dirtyTracker.getBaselineContent(file.id ?? file.path) ?? ''
        const diff = file.mediaType !== 'image/png' ? createUnifiedDiff(baseline, file.content, rel) : undefined
        return {
          path: rel,
          mediaType: file.mediaType,
          content: file.content,
          ...(diff ? { diff } : {}),
        }
      })
  }

  constructor(private root: HTMLElement, private bundle: TacoBundle, private readonly options: FileBrowserOptions = {}) {
    this.store = new TacoStore(bundle)
    this.locale = resolveLocale(
      storageGet('taco-locale'),
      __DEFAULT_LOCALE__ ? [__DEFAULT_LOCALE__] : undefined,
    )
    document.documentElement.lang = this.locale
    const savedTheme = storageGet('taco-theme')
    this.themePreference = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system'
    this.applyAppearance()
    for (const failure of migrateTacoBundleBlocks(bundle, this.mermaidLabels())) {
      this.markdownMigrationErrors.set(failure.path, failure.message)
    }
    this.dirtyTracker = new BundleDirtyTracker(bundle)
    this.narrowLayout = matchMedia('(max-width: 820px)')
    this.sidebarClosed = this.narrowLayout.matches
    this.desktopCommentPanelOpen = storageGet(`taco-right-panel:${bundle.docId}`, 'session') !== 'closed'
    this.commentPanelOpen = !this.narrowLayout.matches && this.desktopCommentPanelOpen
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
      confirmDownload: (credentialBearing) => this.confirmDownloadFallback(credentialBearing),
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
    this.dirtyTracker.markSaved()
    this.syncDirtyState()
    document.addEventListener('keydown', this.handleDocumentKeyDown)
    window.addEventListener('resize', this.handleWindowResize)
    this.narrowLayout.addEventListener('change', this.handleNarrowLayoutChange)
    this.systemAppearance.addEventListener('change', this.handleSystemAppearanceChange)
  }

  destroy(): void {
    window.removeEventListener('hashchange', this.handleHashChange)
    document.removeEventListener('keydown', this.handleDocumentKeyDown)
    window.removeEventListener('resize', this.handleWindowResize)
    this.narrowLayout.removeEventListener('change', this.handleNarrowLayoutChange)
    this.systemAppearance.removeEventListener('change', this.handleSystemAppearanceChange)
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.sync.close()
    this.markdownEditor?.destroy()
    this.markdownEditor = null
    this.outline.destroy()
    this.resetHtmlPreviewUrl()
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
        otherFiles: this.t.otherFiles,
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
    this.copyButton = createControlButton('copy', this.t.copyReview, () => { void this.copyReviewFull() }, 'copy-review-main', false, false)
    this.copyButton.classList.remove('control-button-icon')
    this.copyButton.classList.add('control-button-with-label')
    this.copyButton.setAttribute('aria-label', this.t.copyReview)
    this.copyButton.title = this.t.copyReview
    const copyLabel = el('span', 'button-label', this.t.copyReviewLabel)
    this.copyButton.append(copyLabel)

    const copyMore = createControlButton('chevron-down', this.t.copyReview, () => this.openCopyReviewMenu(copyMore), 'copy-review-more', false, true)
    copyMore.setAttribute('aria-label', this.t.copyReview)
    copyMore.title = this.t.copyReview
    this.copyReviewGroup = el('div', 'copy-review-group v2-button-group')
    this.copyReviewGroup.append(this.copyButton, copyMore)

    this.saveButton = createControlButton('save', this.t.save, () => { void this.handleSave('save') }, 'save-button', true, true)
    const saveMore = createControlButton('chevron-down', this.t.saveCopy, () => this.openSaveMenu(saveMore), 'save-more', false, true)
    const saveGroup = el('div', 'save-group v2-button-group')
    saveGroup.append(this.saveButton, saveMore)
    const language = createControlButton('globe', this.t.language, () => this.openLanguageMenu(language))
    const theme = createControlButton(
      this.themePreference === 'system' ? 'monitor' : this.themePreference === 'dark' ? 'moon' : 'sun',
      this.t.mermaidTheme,
      () => {
        const menu = this.openPopover(theme, 'theme-menu')
        const themeIcons: Record<'system' | 'light' | 'dark', Parameters<typeof svgIcon>[0]> = {
          system: 'monitor',
          light: 'sun',
          dark: 'moon',
        }
        for (const preference of ['system', 'light', 'dark'] as const) {
          const label = preference === 'system' ? this.t.systemTheme : preference === 'light' ? this.t.lightTheme : this.t.darkTheme
          menu.append(this.menuButton(label, () => {
            this.themePreference = preference
            storageSet('taco-theme', preference)
            setButtonIcon(theme, preference === 'system' ? 'monitor' : preference === 'dark' ? 'moon' : 'sun')
            this.applyAppearance()
            menu.remove()
          }, { active: preference === this.themePreference, icon: themeIcons[preference] }))
        }
      },
      'theme-toggle',
    )
    this.commentToggle = createControlButton('panel-right-open', this.t.expandRightPanel, () => this.toggleCommentPanel())
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
      share,
      this.copyReviewGroup,
      saveGroup,
      theme,
      language,
      this.commentToggle,
    )

    const workspaceBody = el('div', 'workspace-body')
    this.viewer = el('main', 'file-viewer')
    this.viewer.id = 'taco-main'
    this.viewer.addEventListener('click', (event) => this.comments.openHighlightedComment(event))
    this.viewer.addEventListener('scroll', () => {
      this.presence.paintRemoteCursors()
      this.outline.scheduleActive()
    }, { passive: true })
    this.commentPanel = this.buildCommentPanel()
    this.comments.mount(this.commentList, this.commentToggle)
    this.outline.mount(this.outlineList)
    const commentScrim = el('button', 'comment-scrim') as HTMLButtonElement
    commentScrim.type = 'button'
    commentScrim.tabIndex = -1
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
    this.resetHtmlPreviewUrl()
    this.viewer.innerHTML = ''
    const file = this.selected
    if (!file) {
      this.viewer.append(el('div', 'empty-state', this.t.empty))
      if (animateEntrance) this.animateSurfaceEntrance(this.viewer.firstElementChild as HTMLElement | null, 'file')
      return
    }
    const kind = fileKind(file)

    if (file.mediaType === 'image/png') {
      const image = el('img', 'png-document-preview')
      image.src = file.content
      image.alt = file.title || fallbackFileTitle(file)
      const open = el('button', '', 'View full size')
      open.addEventListener('click', () => openPngPreview(file))
      this.viewer.append(open, image)
    } else if (kind === 'markdown') {
      this.mountMarkdownEditor(file, mountSerial)
    } else if (kind === 'html') {
      this.mountHtmlPrototype(file)
    } else if (kind === 'yaml' || kind === 'json' || kind === 'mermaid') {
      const structured = createStructuredFileViewer({
        file,
        kind,
        labels: structuredFileLabels(this.locale),
        mermaidLabels: this.mermaidLabels(),
        mermaidRuntime: this.options.mermaidRuntime,
        readOnly: !bundleCanWrite(this.bundle),
        sourceLabel: this.t.sourceEditor(kind),
        onNodeComment: (source) => this.comments.captureSourceSelection(source, file, undefined, true),
        onChange: (content) => {
          this.updateFileContent(file.path, content, undefined)
          requestAnimationFrame(() => this.comments.refreshHighlights())
        },
        onModeChange: () => this.comments.refreshHighlights(),
      })
      this.sourceEditor = structured.sourceEditor
      this.viewer.append(structured.element)
      structured.sourceEditor.input.addEventListener('mouseup', (event) => this.comments.captureSourceSelection(structured.sourceEditor, file, event))
      structured.sourceEditor.input.addEventListener('keyup', (event) => {
        if (event.key === 'Shift') return
        this.comments.captureSourceSelection(structured.sourceEditor, file)
      })
      this.comments.refreshHighlights()
    } else {
      const sourceEditor = createSourceEditor({
        value: file.content,
        language: undefined,
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

  private resetHtmlPreviewUrl(): void {
    this.htmlPreviewUrl = null
  }

  private mountHtmlPrototype(file: TacoFile): void {
    const shell = el('section', 'html-preview-shell')
    const card = el('article', 'html-preview-card')
    const icon = fileTypeIcon(file)
    icon.classList.add('html-preview-icon')
    icon.setAttribute('aria-hidden', 'true')

    const title = el('h1', 'html-preview-title', file.title?.trim() || fallbackFileTitle(file))

    this.htmlPreviewUrl = localFileUrl(file.sourceUrl, file.path)
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

  private mountMarkdownFallback(host: HTMLElement, file: TacoFile, message: string): void {
    host.dataset.editorError = message
    const source = createSourceEditor({
      value: file.content,
      label: this.t.sourceEditor('markdown'),
      readOnly: true,
      onChange: () => {},
    })
    this.sourceEditor = source
    host.replaceChildren(el('p', 'editor-error', `${this.t.editorFailed} ${file.path}: ${message}`), source.element)
  }

  private mountMarkdownEditor(file: TacoFile, mountSerial: number): void {
    const migrationError = this.markdownMigrationErrors.get(file.path)
    if (migrationError) {
      this.mountMarkdownFallback(this.viewer, file, migrationError)
      return
    }
    const parsedFrontmatter = parseFrontmatter(file.content)
    const canonicalTitle = frontmatterTitle(file.content)
    if (canonicalTitle) file.title = canonicalTitle
    else if (parsedFrontmatter.kind === 'valid') delete file.title
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
      if (!this.markdownEditor || !setEditorFrontmatterProperty(this.markdownEditor, 'title', nextTitle || undefined)) {
        title.setAttribute('aria-invalid', 'true')
      } else title.removeAttribute('aria-invalid')
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
    let mounting = true
    let editor: Editor | undefined
    try {
      editor = new Editor({
        element: editorHost,
        extensions,
        editable: bundleCanWrite(this.bundle),
        content: hasBlocks ? blockHtml(file.blocks) : file.content,
        ...(hasBlocks ? { parseOptions: { preserveWhitespace: 'full' as const } } : { contentType: 'markdown' as const }),
        editorProps: {
          attributes: {
            class: 'tiptap',
            'aria-label': this.t.markdownEditor,
          },
        },
        onUpdate: ({ editor: activeEditor, transaction }) => {
          if (mounting) return
          if (this.markdownEditor !== activeEditor || mountSerial !== this.editorMountSerial) return
          if (!transaction.docChanged) return
          if (this.applyingRemoteEditor) return
          if (ensureTacoBlockIds(activeEditor, file.id ?? file.path, false)) return
          const nextMarkdown = this.markdownReconstructor.reconstruct(activeEditor)
          if (nextMarkdown === file.content) return
          this.updateFileContent(file.path, nextMarkdown, blocksFromEditor(activeEditor, extensions))
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
      ensureTacoBlockIds(editor, file.id ?? file.path, !hasBlocks)
      this.markdownEditor = editor
      this.markdownReconstructor.init(file.content, editor)
      if (!file.blocks?.length) {
        file.blocks = blocksFromEditor(editor, extensions)
      }
      mounting = false
    } catch (error) {
      editor?.destroy()
      this.mountMarkdownFallback(editorHost, file, error instanceof Error ? error.message : String(error))
      return
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
      theme: this.t.mermaidTheme,
      direction: this.t.mermaidDirection,
      liveUpdate: this.t.mermaidLiveUpdate,
      updateDiagram: this.t.mermaidUpdateDiagram,
      codePanel: this.t.mermaidCodePanel,
      lineComment: this.t.mermaidLineComment,
      nodeComment: this.t.mermaidNodeComment,
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
    const close = createControlButton('x', this.t.collapseRightPanel, () => this.closeCommentPanel(), 'comment-panel-close')
    close.setAttribute('aria-keyshortcuts', 'Escape')
    const tabs = createSegmentedControl<AuxiliaryTab>({
      label: this.t.rightPanel,
      value: this.auxiliaryTab,
      variant: 'tabs',
      className: 'right-panel-tabs',
      options: [
        { value: 'outline', label: this.t.outline, controls: 'taco-outline' },
        { value: 'comments', label: this.t.comments, controls: 'taco-comment-list' },
      ],
      onChange: (tab) => this.setAuxiliaryTab(tab),
    })
    this.outlineTab = tabs.buttonFor('outline')!
    this.commentsTab = tabs.buttonFor('comments')!
    header.append(tabs.element, close)
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
    if (this.commentPanelOpen) this.closeCommentPanel()
    else this.setCommentPanelOpen(true)
  }

  private closeCommentPanel(): void {
    this.setCommentPanelOpen(false)
    this.commentToggle.focus({ preventScroll: true })
  }

  private showComments(): void {
    this.auxiliaryTab = 'comments'
    this.setCommentPanelOpen(true)
  }

  private setCommentPanelOpen(open: boolean): void {
    this.commentPanelOpen = open
    if (!this.narrowLayout.matches) {
      this.desktopCommentPanelOpen = open
      storageSet(`taco-right-panel:${this.bundle.docId}`, open ? 'open' : 'closed', 'session')
    }
    this.syncPanelToggles()
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
        this.markdownEditor.commands.setContent(blockHtml(this.selected.blocks) || '<p></p>', { emitUpdate: false, parseOptions: { preserveWhitespace: 'full' } })
        this.selected.content = this.markdownReconstructor.reconstruct(this.markdownEditor)
        const title = frontmatterTitle(this.selected.content)
        if (title) this.selected.title = title
        else if (parseFrontmatter(this.selected.content).kind === 'valid') delete this.selected.title
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
    } else if (this.selected) this.paintViewer()
    this.fileNavigation?.refresh(this.selected)
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
    const layoutChanged = this.root.classList.contains('comment-panel-open') !== this.commentPanelOpen
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
    const commentsOpen = this.commentPanelOpen
    if (!commentsOpen && this.commentPanel.contains(document.activeElement)) {
      this.commentToggle.focus({ preventScroll: true })
    }
    this.root.classList.toggle('comment-panel-open', commentsOpen)
    this.commentPanel.toggleAttribute('inert', !commentsOpen)
    this.commentPanel.setAttribute('aria-hidden', String(!commentsOpen))
    setButtonIcon(this.commentToggle, commentsOpen ? 'panel-right-close' : 'panel-right-open')
    this.commentToggle.title = commentsOpen ? this.t.collapseRightPanel : this.t.expandRightPanel
    this.commentToggle.setAttribute('aria-label', this.commentToggle.title)
    this.commentToggle.setAttribute('aria-pressed', String(commentsOpen))
    this.commentToggle.setAttribute('aria-expanded', String(commentsOpen))
    this.syncAuxiliaryTabs()
    if (layoutChanged) requestAnimationFrame(() => {
      if (!this.root.isConnected) return
      this.comments.refreshHighlights()
      this.presence.paintRemoteCursors()
      this.outline.scheduleActive()
    })
  }

  private updateFileContent(path: string, content: string, blocks: TacoFile['blocks']): void {
    const canonical = fileByPath(this.bundle, path)
    if (!canonical) return
    const previousScope = tacoScope(canonical)
    const previousTitle = canonical.title
    const parsedFrontmatter = parseFrontmatter(content)
    const nextTitle = frontmatterTitle(content)
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
      if (nextTitle) canonical.title = nextTitle
      else if (parsedFrontmatter.kind === 'valid') delete canonical.title
      if (this.selected?.path === path) {
        this.selected.content = content
        this.selected.blocks = blocks
        if (nextTitle) this.selected.title = nextTitle
        else if (parsedFrontmatter.kind === 'valid') delete this.selected.title
      }
    })
    const nextScope = tacoScope(canonical)
    if (previousScope !== nextScope) this.fileNavigation?.refresh(this.selected)
    if (previousTitle !== canonical.title && this.selected?.path === path) {
      const title = this.viewer.querySelector<HTMLElement>('.document-inline-title-text')
      if (title && document.activeElement !== title) title.textContent = canonical.title?.trim() || fallbackFileTitle(canonical)
    }
  }

  private syncDirtyState(): void {
    const dirty = this.dirtyTracker.isDirty()
    this.saveButton.classList.toggle('is-dirty', dirty)
    this.saveButton.title = dirty ? this.t.unsaved : this.t.save
    this.saveButton.setAttribute('aria-label', this.saveButton.title)
    this.copyButton.classList.toggle('is-dirty', dirty)
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
    options: { active?: boolean; icon?: Parameters<typeof svgIcon>[0]; leading?: Element; menuitem?: boolean } = {},
  ): HTMLButtonElement {
    const check = options.active ? el('span', 'popover-check', '✓') : undefined
    const button = sidebarRow('button', {
      className: 'popover-action',
      leading: options.leading ?? (options.icon ? svgIcon(options.icon) : undefined),
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

  private applyAppearance(): void {
    const appearance = this.themePreference === 'system'
      ? this.systemAppearance.matches ? 'dark' : 'light'
      : this.themePreference
    if (document.documentElement.dataset.theme === appearance) return
    document.documentElement.dataset.theme = appearance
    document.querySelectorAll('.tiptap-mermaid-container').forEach((container) => {
      container.dispatchEvent(new CustomEvent('taco-appearance-change', { detail: appearance }))
    })
  }

  private openLanguageMenu(anchor: HTMLElement): void {
    const menu = this.openPopover(anchor, 'language-menu')
    const langBadges: Record<string, string> = {
      'zh-Hans': '简',
      en: 'EN',
      'zh-Hant': '繁',
      ja: 'JA',
      es: 'ES',
      fr: 'FR',
      de: 'DE',
      it: 'IT',
      pt: 'PT',
    }
    for (const { code: locale, label } of LOCALE_CHOICES) {
      const badge = el('span', 'lang-badge', langBadges[locale] || locale.slice(0, 2).toUpperCase())
      const button = this.menuButton(label, () => {
        this.locale = locale
        storageSet('taco-locale', locale)
        document.documentElement.lang = locale
        this.build()
        menu.remove()
      }, { active: locale === this.locale, leading: badge })
      menu.append(button)
    }
  }

  private openCopyReviewMenu(anchor: HTMLElement): void {
    const menu = this.openPopover(anchor, 'copy-review-menu')
    menu.append(
      this.menuButton(this.t.copyAllChanges, () => {
        menu.remove()
        void this.copyReviewFull()
      }, { icon: 'copy', menuitem: false }),
      this.menuButton(this.t.copyTabInspect, () => {
        menu.remove()
        void this.copyReviewInspectPrompt()
      }, { icon: 'eye', menuitem: false }),
    )
  }

  private async copyReviewFull(): Promise<void> {
    const changedFiles = this.getModifiedReviewFiles()
    const comments = (this.bundle.comments ?? []).filter((c) => c.status === 'open').map((c) => {
      let location = c.anchor.path
      let quote = c.anchor.quote.exact
      if (c.anchor.block) {
        const b = c.anchor.block
        if (b.language === 'mermaid') {
          if (b.nodeId || b.nodeLabel) {
            const label = b.nodeLabel && b.nodeId && b.nodeLabel !== b.nodeId
              ? `${b.nodeLabel} [${b.nodeId}]`
              : b.nodeLabel || b.nodeId!
            quote = label
            location += ` (${this.t.handoffMermaidNode(label)})`
          } else if (b.lineNumber) {
            location += ` (${this.t.handoffMermaidLine(b.lineNumber)})`
            quote = b.lineText ?? this.t.handoffMermaidLine(b.lineNumber)
          } else {
            location += ` (${this.t.handoffMermaidDiagram})`
            quote = this.t.handoffMermaidDiagram
          }
        } else if (b.language) {
          location += ` (${this.t.handoffCodeBlock(b.language)})`
        }
      }
      return {
        id: c.id,
        path: c.anchor.path,
        location,
        quote,
        status: c.status,
        messages: c.messages.map((m) => ({
          author: m.author,
          body: m.deletedAt ? this.t.messageDeleted : m.body,
          createdAt: m.createdAt,
        })),
      }
    })
    if (changedFiles.length === 0 && comments.length === 0 && !this.dirtyTracker.isDirty()) {
      this.toast(this.t.noReviewChanges)
      return
    }
    const originPath = new URLSearchParams(location.search).get('origin_path')
    const diffSections = changedFiles.map((f) => {
      if (f.diff) return `\n### \`${f.path}\`\n\`\`\`diff\n${f.diff}\n\`\`\``
      return `\n### \`${f.path}\`\n*${this.t.handoffBinaryNotice}*\n`
    }).join('\n')
    const commentSections = comments.map((c) => {
      const msgs = c.messages.map((m) => `  - **${m.author}**: ${m.body}`).join('\n')
      return `- [${c.location}] ${this.t.handoffQuoteLabel}: "${c.quote}"\n${msgs}`
    }).join('\n\n')
    const prompt = [
      this.t.handoffIntro,
      `- ${this.t.handoffDocTitle}: "${this.bundle.title}"`,
      originPath ? `- ${this.t.handoffLocalPath}: ${originPath}` : '',
      diffSections ? `\n## ${this.t.handoffDiffHeader}${diffSections}` : '',
      commentSections ? `\n## ${this.t.handoffCommentsHeader}\n${commentSections}` : '',
    ].filter(Boolean).join('\n')
    const text = prompt
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(text)
      this.toast(this.t.reviewCopied)
      setButtonIcon(this.copyButton, 'check')
      if (this.copyFeedbackTimer !== null) window.clearTimeout(this.copyFeedbackTimer)
      this.copyFeedbackTimer = window.setTimeout(() => {
        setButtonIcon(this.copyButton, 'copy')
        this.copyFeedbackTimer = null
      }, 1500)
    } catch {
      this.toast(this.t.copyFailed)
    }
  }
  private async copyReviewInspectPrompt(): Promise<void> {
    const title = document.title
    const url = location.href
    const originPath = new URLSearchParams(location.search).get('origin_path')
    const prompt = [
      this.t.handoffInspectIntro,
      `- ${this.t.handoffPageTitle}: "${title}"`,
      `- ${this.t.handoffTabUrl}: ${url}`,
      originPath ? `- ${this.t.handoffLocalPath}: ${originPath}` : '',
      this.t.handoffInspectAction,
    ].filter(Boolean).join('\n')

    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(prompt)
      this.toast(this.t.reviewCopied)
      setButtonIcon(this.copyButton, 'check')
      if (this.copyFeedbackTimer !== null) window.clearTimeout(this.copyFeedbackTimer)
      this.copyFeedbackTimer = window.setTimeout(() => {
        setButtonIcon(this.copyButton, 'copy')
        this.copyFeedbackTimer = null
      }, 1500)
    } catch {
      this.toast(this.t.copyFailed)
    }
  }

  private openSaveMenu(anchor: HTMLElement): void {
    const menu = this.openPopover(anchor, 'save-menu')
    menu.append(
      this.menuButton(this.t.save, () => { menu.remove(); void this.handleSave('save') }, { icon: 'save' }),
      this.menuButton(this.t.saveCopy, () => { menu.remove(); void this.handleSave('copy') }, { icon: 'template' }),
      this.menuButton(this.t.saveAndUnpack, () => { menu.remove(); void this.handleSave('unpack') }, { icon: 'folder-open' }),
    )
  }

  private async handleSave(mode: 'save' | 'copy' | 'unpack'): Promise<void> {
    if (mode === 'unpack' && !canSaveAndUnpack()) {
      this.toast(this.t.unpackUnsupported)
      return
    }
    const credentialBearing = hasCollabSecrets(this.bundle)
    if (mode !== 'unpack' && !canWriteInPlace()) {
      if (!await this.confirmDownloadFallback(credentialBearing)) return
    } else if (credentialBearing && !window.confirm(this.t.credentialSaveConfirm)) return
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
    if (result !== 'downloaded') this.saveButton.querySelector('.button-label')!.textContent = this.t.saved
    this.toast(result === 'downloaded'
      ? this.t.downloadStarted
      : result === 'saved-and-unpacked'
        ? this.t.saveUnpacked(this.bundle.files.length)
        : this.t.saved)
    if (result !== 'downloaded') {
      setTimeout(() => { this.saveButton.querySelector('.button-label')!.textContent = this.t.save }, 1800)
    }
  }

  private reportExport(result: SaveResult): void {
    if (result === 'cancelled') { this.toast(this.t.saveCancelled); return }
    if (result === 'directory-unavailable') { this.toast(this.t.directoryUnavailable); return }
    this.toast(result === 'downloaded' ? this.t.downloadStarted : this.t.saved)
  }

  private confirmDownloadFallback(credentialBearing: boolean): Promise<boolean> {
    return showConfirmDialog({
      title: this.t.downloadConfirmTitle,
      messages: [
        this.t.downloadConfirmBody,
        ...(credentialBearing ? [this.t.downloadConfirmCredential] : []),
      ],
      confirmLabel: this.t.download,
      cancelLabel: this.t.cancel,
    })
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
    if (event.defaultPrevented || event.isComposing || !this.root.isConnected) return
    if (event.key === 'Escape' && this.commentPanelOpen) {
      if (document.querySelector('dialog[open], .topbar-popover')) return
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
