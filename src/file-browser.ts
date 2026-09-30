import {
  defaultFile,
  bundleCanWrite,
  ensureFileIds,
  fileByPath,
  fileKind,
  fileName,
  isMediaFileKind,
  relativePath,
  isInternalFile,
  type TacoBundle,
  type TacoCommentThread,
  type NavigationManifest,
  type TacoFile,
} from './model.ts'
import { resolveCheckpoints, setDocumentStatus, type DocumentStatus, type ResolvedCheckpoints } from '@taco/protocol'
import { canSaveAndUnpack, canWriteInPlace, saveAndUnpack, saveCopy, saveFile, type SaveResult } from './kernel/save.ts'
import { getDefaultRichEditorAdapter, type RichEditorAdapter, type RichEditorHandle } from './rich-editor.ts'
import type { SourceHighlighter } from './source-editor.ts'
import { TacoStore } from './store.ts'

import { storageGet, storageSet } from './kernel/storage.ts'
import {
  filePathFromHash,
  fileSelectionSessionKey,
  selectedPathForLoad,
  serializeFileSelection,
  usesUrlHashForFileSelection,
} from './file-selection.ts'
import { createBrandMarkContainer } from './brand.ts'
import { createSourceEditor, setDefaultHighlighter, type SourceEditorController } from './source-editor.ts'
import { FileNavigation } from './file-navigation.ts'
import { getAvailableGroups } from './group-selector.ts'
import { assignFileToGroup, createInitialManifest } from './navigation-editor.ts'
import { showNewFileDialog } from './new-file-dialog.ts'
import {
  createControlButton,
  createFileTypeIcon as fileTypeIcon,
  el,
  fallbackFileTitle,
  setButtonIcon,
  showConfirmDialog,
  showPromptDialog,
  sidebarRow,
  svgIcon,
} from './ui-primitives.ts'
import { BundleDirtyTracker } from './dirty-tracker.ts'
import type { MermaidRuntime } from './mermaid.ts'
import { CommentsController } from './comments-controller.ts'

import { LOCALE_CHOICES, copy, resolveLocale, type Locale } from './i18n.ts'
import { createUnifiedDiff } from './kernel/diff.ts'

import { OutlineController } from './outline-controller.ts'

import { applyNaturalSize, isSvgFileKind, mediaSource, openPngPreview, svgIntrinsicSize } from './markdown-assets.ts'
import { hasCollabSecrets } from './security.ts'
import { frontmatterTitle, parseFrontmatter } from './frontmatter.ts'

import { resolveFileCategory } from './category.ts'
import { commentLineReference } from './comment-position.ts'
import { createStructuredFileViewer, structuredFileLabels } from './structured-file-viewer.ts'
import { createSegmentedControl, type SegmentedControl } from './segmented-control.ts'
import { createCheckpointView } from './checkpoint-view.ts'
import { checkpointCopy } from './i18n.ts'

type AuxiliaryTab = 'outline' | 'comments' | 'instruction'

export interface FileBrowserOptions {
  richEditorAdapter?: RichEditorAdapter | Promise<RichEditorAdapter> | (() => Promise<RichEditorAdapter>)
  highlighter?: SourceHighlighter | Promise<SourceHighlighter>
  mermaidRuntime?: MermaidRuntime
}

/**
 * Sidebar grouping identity: Taco's built-in Category decides how the sidebar groups a file, so a
 * change here — a directory declaration or a root document's own category — re-renders navigation.
 */
const navigationSignature = (bundle: TacoBundle, file: TacoFile): string =>
  resolveFileCategory(bundle, file).category

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
  private checkpointView = false
  private selectedPlaceholder: string | null = null
  private checkpointBaseline = new Map<string, DocumentStatus>()
  private checkpointTemplateBaseline: string | null = null
  private checkpointDocumentBaseline = new Set<string>()
  private cachedResolvedCheckpoints: { ref: unknown; resolved: ResolvedCheckpoints } | null = null
  private sidebar!: HTMLElement
  private fileNavigation: FileNavigation | null = null
  private viewer!: HTMLElement
  private leftToggle!: HTMLButtonElement
  private commentToggle!: HTMLButtonElement
  private saveButton!: HTMLButtonElement
  private commentPanel!: HTMLElement
  private commentList!: HTMLElement
  private outlineList!: HTMLElement
  private tabsControl!: SegmentedControl<AuxiliaryTab>
  private outlineTab!: HTMLButtonElement
  private commentsTab!: HTMLButtonElement
  private instructionTab!: HTMLButtonElement
  private instructionPanel!: HTMLElement
  private instructionContent!: HTMLElement
  private workspacePath!: HTMLElement
  private readonly markdownMigrationErrors = new Map<string, { message: string; content: string }>()

  /**
   * A migration failure belongs to the content that produced it: once the reviewer edits the file,
   * the old failure no longer describes the current document and must stop reporting.
   */
  private recordMigrationFailure(failure: { path: string; message: string }): void {
    const content = this.bundle.files.find((file) => file.path === failure.path)?.content ?? ''
    this.markdownMigrationErrors.set(failure.path, { message: failure.message, content })
  }
  private richEditorAdapter: RichEditorAdapter | null = null
  private richEditorLoading = false
  private richEditor: RichEditorHandle | null = null
  private awaitingRichEditor: { path: string; content: string; serial: number } | null = null
  private richEditorFailure: string | null = null
  private highlighter: SourceHighlighter | undefined
  readonly initialPreviewReady: Promise<void>
  private initialPreviewPath: string | null = null
  private resolveInitialPreview: (() => void) | null = null

  get markdownEditor(): unknown {
    return this.richEditor?.rawEditor ?? null
  }
  private sourceEditor: SourceEditorController | null = null
  private editorMountSerial = 0
  private locale: Locale
  private readonly store: TacoStore
  private readonly comments: CommentsController
  private readonly outline: OutlineController
  private copyFeedbackTimer: number | null = null
  private readonly dirtyTracker: BundleDirtyTracker
  private readonly cleanups: Array<() => void> = []
  private readonly narrowLayout: MediaQueryList
  private copyButton!: HTMLButtonElement
  private copyReviewGroup!: HTMLElement
  private workspaceHeaderSpacer!: HTMLElement
  private structureLocked = false
  private primaryHandoffHandler?: () => Promise<void>
  private primaryHandoffTooltip?: string
  private primaryHandoffIcon?: Parameters<typeof svgIcon>[0]
  private primaryHandoffLabel?: string
  private copyReviewMenuCustomizer?: ((menu: HTMLElement, defaultItems: HTMLElement[]) => void)
  private pendingWritesCheck?: () => boolean
  private durableActionsOnlyCheck?: () => boolean
  private readonly headerExtraControls: Array<{ control: HTMLElement; position: 'left' | 'right' }> = []
  private readonly changeListeners = new Set<(kind: 'content' | 'comments') => void>()
  private readonly localeListeners = new Set<(locale: Locale) => void>()
  private readonly destructListeners = new Set<() => void>()
  private readonly systemAppearance = window.matchMedia('(prefers-color-scheme: dark)')
  private themePreference: 'system' | 'light' | 'dark' = 'system'
  /** Embedded in a host page (`?embed`): the host owns theme and language; comments lead. */
  private readonly embedded = new URLSearchParams(location.search).has('embed')
  private readonly handleSystemAppearanceChange = (): void => {
    if (this.themePreference === 'system') this.applyAppearance()
  }

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

  private readonly handleNarrowLayoutChange = (event: MediaQueryListEvent): void => {
    this.root.classList.add('panel-motion-disabled')
    this.sidebarClosed = event.matches
    this.commentPanelOpen = !event.matches && this.desktopCommentPanelOpen
    this.syncPanelToggles()
  }

  getModifiedReviewFiles(): Array<{ path: string; mediaType: string; content: string; diff?: string }> {
    const dirtyIds = this.dirtyTracker.getDirtyFileIds()
    return this.bundle.files
      .filter((file) => !isInternalFile(file.path) && dirtyIds.has(file.id ?? file.path))
      .map((file) => {
        const rel = relativePath(this.bundle, file)
        const baseline = this.dirtyTracker.getBaselineContent(file.id ?? file.path) ?? ''
        const diff = isMediaFileKind(fileKind(file)) ? undefined : createUnifiedDiff(baseline, file.content, rel)
        return {
          path: rel,
          mediaType: file.mediaType,
          content: file.content,
          ...(diff ? { diff } : {}),
        }
      })
  }

  getCheckpointChanges(): Array<{ path: string; from: DocumentStatus; to: DocumentStatus }> {
    const current = resolveCheckpoints(this.bundle)
    if (!current.valid) return []
    const statuses = new Map(current.state?.documents.map(({ path, status }) => [path, status]))
    const paths = new Set([...this.checkpointBaseline.keys(), ...statuses.keys()])
    return [...paths].sort().flatMap((path) => {
      const from = this.checkpointBaseline.get(path) ?? 'todo'
      const to = statuses.get(path) ?? 'todo'
      return from === to ? [] : [{ path, from, to }]
    })
  }
  getCheckpointTemplateChange(): { from: string | null; to: string | null } | null {
    const current = resolveCheckpoints(this.bundle)
    if (!current.valid) return null
    const to = current.state?.template?.trim() || null
    return this.checkpointTemplateBaseline === to ? null : { from: this.checkpointTemplateBaseline, to }
  }

  getCheckpointDocumentAdditions(): Array<{ checkpointId: string; path: string }> {
    const current = resolveCheckpoints(this.bundle)
    if (!current.valid) return []
    return current.nodes.flatMap((node) => node.documents
      .filter((doc) => !this.checkpointDocumentBaseline.has(`${node.id}\u0000${doc.path}`))
      .map((doc) => ({ checkpointId: node.id, path: doc.path })))
  }

  private captureCheckpointBaseline(): void {
    const result = resolveCheckpoints(this.bundle)
    this.checkpointBaseline = new Map(result.valid ? result.state?.documents.map(({ path, status }) => [path, status]) : [])
    this.checkpointTemplateBaseline = result.valid ? result.state?.template?.trim() || null : null
    this.checkpointDocumentBaseline = new Set(result.valid
      ? result.nodes.flatMap((node) => node.documents.map((doc) => `${node.id}\u0000${doc.path}`))
      : [])
  }

  get currentBundle(): TacoBundle { return this.bundle }

  get currentLocale(): Locale { return this.locale }

  getRenderErrors(): Array<{ path: string; message: string }> {
    const current = new Map(this.bundle.files.map((file) => [file.path, file.content]))
    return [...this.markdownMigrationErrors.entries()]
      .filter(([path, failure]) => current.get(path) === failure.content)
      .map(([path, failure]) => ({ path, message: failure.message }))
  }

  constructor(private root: HTMLElement, private bundle: TacoBundle, private readonly options: FileBrowserOptions = {}) {
    // The Host controller shares this live bundle; adopting remote content mutates it in place.
    this.store = new TacoStore(bundle)
    const embedParams = new URLSearchParams(location.search)
    this.locale = resolveLocale(
      (this.embedded ? embedParams.get('lang') : null) ?? storageGet('taco-locale'),
      __DEFAULT_LOCALE__ ? [__DEFAULT_LOCALE__] : undefined,
    )
    document.documentElement.lang = this.locale
    document.documentElement.classList.toggle('taco-embedded', this.embedded)
    const savedTheme = (this.embedded ? embedParams.get('theme') : null) ?? storageGet('taco-theme')
    this.themePreference = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system'
    this.applyAppearance()
    const highlighter = options.highlighter
    if (highlighter && typeof (highlighter as Promise<SourceHighlighter>).then === 'function') {
      void (highlighter as Promise<SourceHighlighter>).then((ready) => {
        this.highlighter = ready
        setDefaultHighlighter(ready)
        this.sourceEditor?.refreshHighlight()
      }).catch(() => {
        // Source editing is available without syntax highlighting.
      })
    } else {
      this.highlighter = highlighter as SourceHighlighter | undefined
      if (this.highlighter) setDefaultHighlighter(this.highlighter)
    }
    const adapterOption = options.richEditorAdapter ?? getDefaultRichEditorAdapter()
    const adapterPromise = typeof adapterOption === 'function' ? adapterOption() : adapterOption
    if (adapterPromise && typeof (adapterPromise as Promise<RichEditorAdapter>).then === 'function') {
      this.richEditorLoading = true
      void (adapterPromise as Promise<RichEditorAdapter>).then((adapter) => {
        this.richEditorLoading = false
        this.richEditorAdapter = adapter
        for (const failure of adapter.migrateBundleBlocks(this.bundle, this.mermaidLabels())) {
          this.recordMigrationFailure(failure)
        }
        this.promoteAwaitingMarkdown()
      }).catch((error: unknown) => {
        this.richEditorLoading = false
        this.richEditorFailure = error instanceof Error ? error.message : String(error)
        const waiting = this.awaitingRichEditor
        this.awaitingRichEditor = null
        if (waiting && this.selected?.path === waiting.path && this.editorMountSerial === waiting.serial) {
          this.viewer.removeAttribute('aria-busy')
          this.mountMarkdownFallback(this.viewer, this.selected, this.richEditorFailure)
        }
      })
    } else if (adapterOption) {
      this.richEditorAdapter = adapterOption as RichEditorAdapter
      for (const failure of this.richEditorAdapter.migrateBundleBlocks(bundle, this.mermaidLabels())) {
        this.recordMigrationFailure(failure)
      }
    }
    this.dirtyTracker = new BundleDirtyTracker(bundle)
    this.narrowLayout = matchMedia('(max-width: 820px)')
    this.sidebarClosed = this.narrowLayout.matches
    this.desktopCommentPanelOpen = storageGet(`taco-right-panel:${bundle.docId}`, 'session') !== 'closed'
    this.commentPanelOpen = !this.narrowLayout.matches && this.desktopCommentPanelOpen
    const selectionKey = fileSelectionSessionKey(bundle.docId)
    const initialPath = selectedPathForLoad(location.protocol, location.hash, storageGet(selectionKey, 'session'))
    this.selected = fileByPath(bundle, initialPath) ?? defaultFile(bundle)
    if (this.selected && fileKind(this.selected) === 'mermaid') this.initialPreviewPath = this.selected.path
    this.initialPreviewReady = this.initialPreviewPath
      ? new Promise<void>((resolve) => { this.resolveInitialPreview = resolve })
      : Promise.resolve()
    if (this.selected) this.rememberOfflineSelection(this.selected)
    this.auxiliaryTab = this.embedded || !this.selected || fileKind(this.selected) !== 'markdown' ? 'comments' : 'outline'
    this.comments = new CommentsController({
      bundle: this.bundle,
      store: this.store,
      getSelected: () => this.selected,
      getViewer: () => this.viewer,
      getSourceEditor: () => this.sourceEditor,
      getLocale: () => this.locale,
      openComments: () => this.showComments(),
      toast: (message) => this.toast(message),
      durableActionsOnly: () => this.durableActionsOnlyCheck?.() ?? false,
    })
    this.outline = new OutlineController({
      getViewer: () => this.viewer,
      getSelected: () => this.selected,
      getNoHeadingsLabel: () => this.t.noHeadings,
      onSelectHeading: (file, headingId) => this.updateSelectionLocation(file, true, headingId),
      onVisibilityChange: () => this.syncAuxiliaryTabs(),
    })
    this.cleanups.push(this.store.onChange(({ change }) => {
      this.dirtyTracker.note(change)
      if (this.saveButton) this.syncDirtyState()
      for (const listener of this.changeListeners) listener(change.kind === 'comments' ? 'comments' : 'content')
    }))

    this.build()
    window.addEventListener('hashchange', this.handleHashChange)
    this.dirtyTracker.markSaved()
    // An embedding page may present the file as a reviewer's in-progress session (e.g. the Tacobin demo).
    if (this.embedded && new URLSearchParams(location.search).has('pending')) this.dirtyTracker.markCommentsPending()
    this.captureCheckpointBaseline()
    this.syncDirtyState()
    document.addEventListener('keydown', this.handleDocumentKeyDown)
    window.addEventListener('beforeunload', this.handleBeforeUnload)
    this.cleanups.push(() => window.removeEventListener('beforeunload', this.handleBeforeUnload))

    this.narrowLayout.addEventListener('change', this.handleNarrowLayoutChange)
    this.systemAppearance.addEventListener('change', this.handleSystemAppearanceChange)
  }

  destroy(): void {
    this.finishInitialPreview()
    window.removeEventListener('hashchange', this.handleHashChange)
    document.removeEventListener('keydown', this.handleDocumentKeyDown)

    this.narrowLayout.removeEventListener('change', this.handleNarrowLayoutChange)
    this.systemAppearance.removeEventListener('change', this.handleSystemAppearanceChange)
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.richEditor?.destroy()
    this.richEditor = null
    this.awaitingRichEditor = null
    this.outline.destroy()
    this.fileNavigation?.destroy()
    this.fileNavigation = null
    this.comments.destroy()
    for (const listener of this.destructListeners) listener()
    this.destructListeners.clear()

    this.root.replaceChildren()
    this.root.className = ''
  }

  private build(): void {
    if (this.fileNavigation) this.sidebarScrollTop = this.fileNavigation.getScrollTop()
    this.fileNavigation?.destroy()
    this.fileNavigation = null
    this.richEditor?.destroy()
    this.richEditor = null
    this.awaitingRichEditor = null
    this.root.innerHTML = ''
    this.root.className = 'taco-shell panel-motion-disabled'
    this.root.classList.toggle('sidebar-closed', this.sidebarClosed)
    this.root.classList.toggle('is-readonly', !bundleCanWrite(this.bundle))
    this.root.classList.toggle('is-checkpoint-view', this.checkpointView)

    const layout = el('div', 'panel-layout')

    this.fileNavigation = new FileNavigation({
      bundle: this.bundle,
      checkpointView: this.checkpointView,
      selectedPlaceholderPath: this.selectedPlaceholder,
      checkpointLabels: checkpointCopy(this.locale),
      onSelectCheckpoint: () => this.showCheckpoints(),
      onSelectPlaceholder: (path) => this.selectPlaceholder(path),
      onChangeCheckpointStatus: (path, status) => this.changeCheckpointStatus(path, status),
      selected: this.selected,
      labels: {
        files: this.t.files,
        collapseFiles: this.t.collapseFiles,
        otherFiles: this.t.otherFiles,
        addGroup: this.t.addGroup,
        renameGroup: this.t.renameGroup,
        deleteGroup: this.t.deleteGroup,
        addFile: this.t.addFile,
        renameFile: this.t.renameFile,
        deleteFile: this.t.deleteFile,
        actions: this.t.actions,
        setEntry: this.t.setEntry,
        entryBadge: this.t.entryBadge,
        newGroupPrompt: this.t.newGroupPrompt,
        newFilePrompt: this.t.newFilePrompt,
        renameFilePrompt: this.t.renameFilePrompt,
        confirm: this.t.save ?? 'Confirm',
        cancel: this.t.cancel ?? 'Cancel',
      },
      editable: bundleCanWrite(this.bundle),
      canManageGroups: this.canManageStructure,
      onUpdateNavigation: (navigation) => {
        this.store.updateNavigation(navigation)
        this.fileNavigation?.refresh(this.selected)
      },
      onCreateFile: (targetGroupId) => this.handleCreateFile(targetGroupId),
      onRenameFile: (file) => this.handleRenameFile(file),
      onDeleteFile: (file) => this.handleDeleteFile(file),
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
    const leftHeaderToggle = createControlButton('panel-left', this.t.expandFiles, () => this.toggleSidebar(), 'header-panel-toggle workspace-left-toggle')
    const checkpointPageTitle = el('span', 'checkpoint-page-title', checkpointCopy(this.locale).checkpoints)
    this.workspacePath = el('div', 'workspace-path')
    this.syncWorkspaceHeader()
    this.workspaceHeaderSpacer = el('span', 'workspace-header-spacer')

    this.copyButton = createControlButton(this.primaryHandoffIcon ?? 'copy', this.primaryHandoffLabel ?? this.t.copyReview, () => { void this.primaryHandoff() }, 'copy-review-main', true)
    this.copyButton.title = this.primaryHandoffTooltip ?? this.t.copyReview
    this.copyButton.querySelector('.button-label')!.textContent = this.primaryHandoffLabel ?? this.t.copyReviewLabel

    const copyMore = createControlButton('chevron-down', this.t.copyReview, () => this.openCopyReviewMenu(copyMore), 'copy-review-more')
    copyMore.setAttribute('aria-label', this.t.copyReview)
    copyMore.title = this.t.copyReview
    this.copyReviewGroup = el('div', 'copy-review-group v2-button-group')
    this.copyReviewGroup.append(this.copyButton, copyMore)

    this.saveButton = createControlButton('save', this.t.save, () => { void this.handleSave('save') }, 'save-button', true, true)
    const saveMore = createControlButton('chevron-down', this.t.saveCopy, () => this.openSaveMenu(saveMore), 'save-more', false, true)
    const saveGroup = el('div', 'save-group v2-button-group')
    saveGroup.append(this.saveButton, saveMore)
    const language = createControlButton('globe', this.t.language, () => { if (!this.embedded) this.openLanguageMenu(language) })
    const theme = createControlButton(
      this.themePreference === 'system' ? 'monitor' : this.themePreference === 'dark' ? 'moon' : 'sun',
      this.t.mermaidTheme,
      () => {
        if (this.embedded) return
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
    this.commentToggle = createControlButton('panel-right', this.t.expandRightPanel, () => this.toggleCommentPanel())
    this.commentToggle.classList.add('comment-toggle')
    this.commentToggle.setAttribute('aria-controls', 'taco-comments')
    this.commentToggle.addEventListener('click', (event) => {
      this.root.classList.toggle('panel-motion-disabled', event.detail === 0)
    }, { capture: true })


    workspaceHeader.append(
      collapsedBrandMark,
      collapsedBrandName,
      leftHeaderToggle,
      this.workspacePath,
      checkpointPageTitle,
      ...this.headerExtraControls.filter(({ position }) => position === 'left').map(({ control }) => control),
      this.workspaceHeaderSpacer,
      ...this.headerExtraControls.filter(({ position }) => position === 'right').map(({ control }) => control),
      this.copyReviewGroup,
      saveGroup,
      theme,
      language,
      this.commentToggle,
    )

    const workspaceBody = el('div', 'workspace-body')
    workspaceBody.addEventListener('transitionend', (event) => {
      if (event.target !== workspaceBody || event.propertyName !== 'grid-template-columns') return
      this.comments.refreshHighlights()

      this.outline.scheduleActive()
    })
    this.viewer = el('main', 'file-viewer')
    this.viewer.id = 'taco-main'
    this.viewer.addEventListener('click', (event) => this.comments.openHighlightedComment(event))
    this.viewer.addEventListener('scroll', () => {

      this.outline.scheduleActive()
    }, { passive: true })
    this.commentPanel = this.buildCommentPanel()
    this.comments.mount(this.commentList, this.commentToggle)
    this.outline.mount(this.outlineList)
    const commentScrim = el('button', 'comment-scrim') as HTMLButtonElement
    commentScrim.type = 'button'
    commentScrim.tabIndex = -1
    commentScrim.setAttribute('aria-label', this.t.close)
    commentScrim.addEventListener('click', () => {
      this.root.classList.remove('panel-motion-disabled')
      this.closeCommentPanel()
    })
    workspaceBody.append(this.viewer, commentScrim, this.commentPanel)
    workspacePanel.append(workspaceHeader, workspaceBody)
    layout.append(this.sidebar, workspacePanel)
    this.root.append(layout)
    this.paintViewer()
    this.syncPanelToggles()
    this.comments.paint()
    this.syncAuxiliaryTabs()

    this.syncDirtyState()
  }

  private selectFile(file: TacoFile, writeHash = true): void {
    this.checkpointView = false
    this.selectedPlaceholder = null
    this.root.classList.remove('is-checkpoint-view')
    this.selected = file
    const instruction = this.getSelectedInstruction()
    if (this.auxiliaryTab === 'instruction' && !instruction) {
      this.auxiliaryTab = this.embedded || fileKind(file) !== 'markdown' ? 'comments' : 'outline'
    } else if (this.auxiliaryTab === 'outline' && (!this.selected || fileKind(file) !== 'markdown')) {
      this.auxiliaryTab = instruction ? 'instruction' : 'comments'
    } else if (!this.auxiliaryTab) {
      this.auxiliaryTab = this.embedded || fileKind(file) !== 'markdown' ? 'comments' : 'outline'
    }
    this.comments.resetForFileChange()
    this.updateSelectionLocation(file, writeHash)
    this.syncWorkspaceHeader()
    this.fileNavigation?.paint(file, false, null)
    this.paintViewer(false)
    this.comments.paint()
    this.syncAuxiliaryTabs()
    this.viewer.scrollTop = 0
    if (this.narrowLayout.matches) {
      this.sidebarClosed = true
      this.commentPanelOpen = false
      this.syncPanelToggles()
    }
  }

  private showCheckpoints(): void {
    if (this.bundle.checkpoints === undefined) return
    this.checkpointView = true
    this.selectedPlaceholder = null
    this.root.classList.add('is-checkpoint-view')
    this.selected = null
    this.comments.resetForFileChange()

    this.syncWorkspaceHeader()
    this.fileNavigation?.paint(null, true, null)
    this.paintViewer()
    this.comments.paint()
    this.syncAuxiliaryTabs()
    this.viewer.scrollTop = 0
  }

  private selectPlaceholder(path: string): void {
    const result = resolveCheckpoints(this.bundle)
    if (!result.valid || !result.nodes.some((node) => node.documents.some((doc) => doc.path === path && !doc.exists))) return
    this.checkpointView = false
    this.root.classList.remove('is-checkpoint-view')
    this.selectedPlaceholder = path
    this.selected = null
    this.comments.resetForFileChange()
    this.syncWorkspaceHeader()
    this.fileNavigation?.paint(null, false, path)
    this.paintViewer()
    this.comments.paint()
    this.syncAuxiliaryTabs()
    this.viewer.scrollTop = 0
  }

  private changeCheckpointStatus(path: string, status: DocumentStatus): void {
    const current = resolveCheckpoints(this.bundle)
    if (!bundleCanWrite(this.bundle) || !current.valid || !current.state) return
    if (!current.nodes.some((node) => node.documents.some((doc) => doc.path === path))) return
    const next = setDocumentStatus(current.state, path, status, new Date().toISOString())
    if (next === current.state) return
    this.store.commit({ kind: 'document' }, () => { this.bundle.checkpoints = next })
    this.fileNavigation?.refresh(this.selected, this.checkpointView, this.selectedPlaceholder)
    if (this.checkpointView || this.selectedPlaceholder) this.paintViewer()
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

  private finishInitialPreview(): void {
    this.resolveInitialPreview?.()
    this.resolveInitialPreview = null
    this.initialPreviewPath = null
  }

  private paintViewer(animateEntrance = false): void {
    const mountSerial = ++this.editorMountSerial
    if (this.initialPreviewPath && (this.checkpointView || this.selected?.path !== this.initialPreviewPath)) {
      this.finishInitialPreview()
    }
    this.richEditor?.destroy()
    this.richEditor = null
    this.awaitingRichEditor = null
    this.sourceEditor = null
    this.viewer.innerHTML = ''
    this.viewer.removeAttribute('aria-busy')
    if (this.checkpointView) {
      this.viewer.append(createCheckpointView(resolveCheckpoints(this.bundle), checkpointCopy(this.locale), {
        readOnly: !bundleCanWrite(this.bundle),
        onSelect: (path) => {
          const file = fileByPath(this.bundle, path)
          if (file) this.selectFile(file)
          else this.selectPlaceholder(path)
        },
        onSet: (path, status) => this.changeCheckpointStatus(path, status),
        onOpenView: () => this.showCheckpoints(),
      }))
      return
    }
    if (this.selectedPlaceholder) {
      this.paintCheckpointPlaceholder(this.selectedPlaceholder)
      return
    }
    const file = this.selected
    if (!file) {
      this.viewer.append(el('div', 'empty-state', this.t.empty))
      if (animateEntrance) this.animateSurfaceEntrance(this.viewer.firstElementChild as HTMLElement | null, 'file')
      return
    }
    const kind = fileKind(file)

    if (kind === 'image') {
      const container = el('div', 'media-document-container')
      const image = el('img', 'media-document-preview image-preview')
      const src = mediaSource(file)
      if (src) {
        image.src = src
        image.alt = file.title || fallbackFileTitle(file)
        if (isSvgFileKind(file)) applyNaturalSize(image, svgIntrinsicSize(file.content))
        image.addEventListener('click', () => openPngPreview(file))
        container.append(image)
      } else {
        container.append(el('p', 'empty-state', this.t.mediaUnsupported))
      }
      this.viewer.append(container)
    } else if (kind === 'video') {
      const container = el('div', 'media-document-container')
      const video = document.createElement('video')
      video.className = 'media-document-preview video-preview'
      video.controls = true
      video.playsInline = true
      if (file.content.startsWith('data:video/')) {
        video.src = file.content
      }
      container.append(video)
      this.viewer.append(container)
    } else if (kind === 'audio') {
      const container = el('div', 'media-document-container')
      const audio = document.createElement('audio')
      audio.className = 'media-document-preview audio-preview'
      audio.controls = true
      if (file.content.startsWith('data:audio/')) {
        audio.src = file.content
      }
      container.append(audio)
      this.viewer.append(container)
    } else if (kind === 'markdown') {
      this.mountMarkdownEditor(file, mountSerial)
    } else if (kind === 'yaml' || kind === 'json' || kind === 'mermaid') {
      const structured = createStructuredFileViewer({
        file,
        kind,
        labels: structuredFileLabels(this.locale),
        mermaidLabels: this.mermaidLabels(),
        mermaidRuntime: this.options.mermaidRuntime,
        onPreviewSettled: file.path === this.initialPreviewPath ? () => {
          if (this.editorMountSerial === mountSerial) this.finishInitialPreview()
        } : undefined,
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
        if (event.key === 'Shift' || event.key === 'Escape') return
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
        if (event.key === 'Shift' || event.key === 'Escape') return
        this.comments.captureSourceSelection(sourceEditor, file)
      })
      this.comments.refreshHighlights()
    }
    if (animateEntrance) this.animateSurfaceEntrance(this.viewer.firstElementChild as HTMLElement | null, 'file')
  }

  private paintCheckpointPlaceholder(path: string): void {
    const result = resolveCheckpoints(this.bundle)
    if (!result.valid) return
    const node = result.nodes.find((item) => item.documents.some((doc) => doc.path === path))
    const doc = node?.documents.find((item) => item.path === path)
    if (!node || !doc) return
    const labels = checkpointCopy(this.locale)
    const surface = el('section', 'checkpoint-placeholder')
    surface.append(svgIcon('file-text'), el('h1', '', fileName(path)), el('p', 'checkpoint-placeholder-path', path))
    const meta = el('div', 'checkpoint-placeholder-meta')
    meta.append(el('span', '', `${node.title} · ${doc.optional ? labels.checkpointOptional : labels.checkpointRequired}`))
    surface.append(meta)
    if (bundleCanWrite(this.bundle)) {
      const create = el('button', 'checkpoint-create-button', labels.checkpointCreateFile) as HTMLButtonElement
      create.type = 'button'
      create.addEventListener('click', () => this.createCheckpointFile(path))
      surface.append(create)
    } else surface.append(el('p', 'checkpoint-create-hint', labels.checkpointNotCreatedRead))
    this.viewer.append(surface)
  }

  private createCheckpointFile(path: string): void {
    if (!bundleCanWrite(this.bundle) || fileByPath(this.bundle, path)) return
    const ext = path.split('.').at(-1)?.toLowerCase()
    const mediaType = ext === 'md' ? 'text/markdown'
      : ext === 'yaml' || ext === 'yml' ? 'application/yaml'
        : ext === 'json' ? 'application/json'
          : 'text/plain'
    const file: TacoFile = { id: `file-${crypto.randomUUID()}`, path, mediaType, content: '' }
    this.store.commit({ kind: 'file', fileId: file.id! }, () => { this.bundle.files.push(file) })
    this.selectFile(file)
    this.fileNavigation?.refresh(this.selected)
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


  private promoteAwaitingMarkdown(): void {
    if (!this.richEditorAdapter || !this.awaitingRichEditor) return
    const { path, content, serial } = this.awaitingRichEditor
    if (this.selected?.path !== path) return
    if (this.selected.content !== content) return
    if (this.editorMountSerial !== serial) return
    this.awaitingRichEditor = null
    this.mountMarkdownEditor(this.selected, serial)
  }

  private mountMarkdownFallback(host: HTMLElement, file: TacoFile, message?: string): void {
    if (message) host.dataset.editorError = message
    else delete host.dataset.editorError
    const source = createSourceEditor({
      value: file.content,
      label: this.t.sourceEditor('markdown'),
      readOnly: !bundleCanWrite(this.bundle),
      highlighter: this.highlighter,
      onChange: (content) => {
        this.awaitingRichEditor = null
        this.updateFileContent(file.path, content, undefined)
        requestAnimationFrame(() => this.comments.refreshHighlights())
      },
    })
    this.sourceEditor = source
    source.input.addEventListener('mouseup', (event) => this.comments.captureSourceSelection(source, file, event))
    source.input.addEventListener('keyup', (event) => {
      if (event.key === 'Shift' || event.key === 'Escape') return
      this.comments.captureSourceSelection(source, file)
    })
    if (message) {
      host.replaceChildren(el('p', 'editor-error', `${this.t.editorFailed} ${file.path}: ${message}`), source.element)
    } else {
      host.replaceChildren(source.element)
    }
    this.comments.refreshHighlights()
    this.outline.paint()
  }

  private mountMarkdownEditor(file: TacoFile, mountSerial: number): void {
    if (!this.richEditorAdapter) {
      if (this.richEditorLoading) {
        this.awaitingRichEditor = { path: file.path, content: file.content, serial: mountSerial }
        this.viewer.setAttribute('aria-busy', 'true')
        const loading = el('div', 'empty-state', this.t.editorLoading)
        loading.setAttribute('role', 'status')
        this.viewer.replaceChildren(loading)
      } else {
        this.mountMarkdownFallback(this.viewer, file, this.richEditorFailure ?? undefined)
      }
      return
    }
    const migration = this.markdownMigrationErrors.get(file.path)
    if (migration && migration.content === file.content) {
      this.mountMarkdownFallback(this.viewer, file, migration.message)
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
      if (!this.richEditor || !this.richEditor.setTitle(nextTitle)) {
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
    this.sourceEditor = null
    delete this.viewer.dataset.editorError
    this.viewer.replaceChildren(shell)
    this.viewer.removeAttribute('aria-busy')

    try {
      this.richEditor = this.richEditorAdapter.mount({
        element: editorHost,
        file,
        bundle: this.bundle,
        readOnly: !bundleCanWrite(this.bundle),
        labels: {
          markdownEditor: this.t.markdownEditor,
          ...this.mermaidLabels(),
        },
        mermaidRuntime: this.options.mermaidRuntime,
        onUpdate: (nextMarkdown, blocks) => {
          if (mountSerial !== this.editorMountSerial) return
          this.updateFileContent(file.path, nextMarkdown, blocks)
        },
        onCodeBlockComment: (target) => this.comments.startCodeBlockComment(editorHost, file, target),
        onLinkClick: (event) => this.handleEditorLink(event, file),
        onSelectionChange: () => this.comments.captureEditorSelection(editorHost, file),
        onRefreshHighlights: (host) => this.comments.refreshHighlights(host),
        onOutlinePaint: () => this.outline.paint(),
        scrollToHeading: (headingHash) => this.outline.scrollToHeading(headingHash, 'auto'),
      })
    } catch (error) {
      this.mountMarkdownFallback(editorHost, file, error instanceof Error ? error.message : String(error))
      return
    }
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
      diagnostic: {
        syntax: this.t.mermaidDiagnosticSyntax,
        unknownType: this.t.mermaidDiagnosticUnknownType,
        render: this.t.mermaidDiagnosticRender,
        runtime: this.t.mermaidDiagnosticRuntime,
        noPosition: this.t.mermaidDiagnosticNoPosition,
        position: this.t.mermaidDiagnosticPosition,
        copyDetail: this.t.mermaidDiagnosticCopyDetail,
        copied: this.t.mermaidDiagnosticCopied,
      },
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
  private getResolvedCheckpoints(): ResolvedCheckpoints {
    const ref = this.bundle.checkpoints
    if (this.cachedResolvedCheckpoints && this.cachedResolvedCheckpoints.ref === ref) {
      return this.cachedResolvedCheckpoints.resolved
    }
    const resolved = resolveCheckpoints(this.bundle)
    this.cachedResolvedCheckpoints = { ref, resolved }
    return resolved
  }

  private getSelectedInstruction(): string | undefined {
    const path = this.selected?.path ?? this.selectedPlaceholder
    if (!path) return undefined
    const checkpoints = this.getResolvedCheckpoints()
    if (!checkpoints.valid) return undefined
    const doc = checkpoints.documents.find((d) => d.path === path)
    return doc?.instruction
  }

  private buildCommentPanel(): HTMLElement {
    const panel = el('aside', 'comment-panel right-panel')
    panel.id = 'taco-comments'
    panel.setAttribute('aria-label', this.t.rightPanel)
    const header = el('header', 'panel-header comment-panel-header')
    this.tabsControl = createSegmentedControl<AuxiliaryTab>({
      label: this.t.rightPanel,
      value: this.auxiliaryTab,
      variant: 'tabs',
      className: 'right-panel-tabs',
      options: [
        { value: 'outline', label: this.t.outline, controls: 'taco-outline' },
        { value: 'comments', label: this.t.comments, controls: 'taco-comment-list' },
        { value: 'instruction', label: this.t.instruction, controls: 'taco-instruction-panel' },
      ],
      onChange: (tab) => this.setAuxiliaryTab(tab),
    })
    this.outlineTab = this.tabsControl.buttonFor('outline')!
    this.commentsTab = this.tabsControl.buttonFor('comments')!
    this.instructionTab = this.tabsControl.buttonFor('instruction')!
    this.instructionTab.remove()
    header.append(this.tabsControl.element)
    this.outlineList = el('nav', 'document-outline')
    this.outlineList.id = 'taco-outline'
    this.outlineList.setAttribute('aria-label', this.t.outline)
    this.outlineList.setAttribute('role', 'tabpanel')
    this.commentList = el('div', 'comment-list')
    this.commentList.id = 'taco-comment-list'
    this.commentList.setAttribute('role', 'tabpanel')

    this.instructionPanel = el('div', 'instruction-panel')
    this.instructionPanel.id = 'taco-instruction-panel'
    this.instructionPanel.setAttribute('role', 'tabpanel')
    this.instructionContent = el('div', 'instruction-body')
    this.instructionPanel.append(this.instructionContent)

    panel.append(header, this.outlineList, this.commentList, this.instructionPanel)
    return panel
  }

  private setAuxiliaryTab(tab: AuxiliaryTab): void {
    if (tab === 'outline' && (!this.selected || fileKind(this.selected) !== 'markdown')) return
    if (tab === 'instruction' && !this.getSelectedInstruction()) return
    const changed = this.auxiliaryTab !== tab
    this.auxiliaryTab = tab
    this.syncAuxiliaryTabs()
    this.syncPanelToggles()
    if (tab === 'outline') this.outline.scheduleActive()
    else if (tab === 'comments') this.commentList.scrollTop = 0
    else if (tab === 'instruction') this.instructionPanel.scrollTop = 0
    if (changed) {
      const activeSurface = tab === 'outline' ? this.outlineList : tab === 'instruction' ? this.instructionPanel : this.commentList
      this.animateSurfaceEntrance(activeSurface)
    }
  }

  private syncAuxiliaryTabs(): void {
    if (!this.outlineTab || !this.commentsTab || !this.instructionTab || !this.outlineList || !this.commentList || !this.instructionPanel) return
    const hasOutline = Boolean(this.selected && fileKind(this.selected) === 'markdown')
    const instruction = this.getSelectedInstruction()
    const hasInstruction = Boolean(instruction)

    if (!hasInstruction && this.auxiliaryTab === 'instruction') {
      this.auxiliaryTab = hasOutline ? 'outline' : 'comments'
    } else if (!hasOutline && this.auxiliaryTab === 'outline') {
      this.auxiliaryTab = hasInstruction ? 'instruction' : 'comments'
    }

    this.outlineTab.hidden = !hasOutline
    if (hasInstruction) {
      if (!this.instructionTab.isConnected) {
        this.commentsTab.after(this.instructionTab)
      }
      this.instructionTab.hidden = false
      if (this.instructionContent) {
        this.instructionContent.textContent = instruction ?? ''
      }
    } else {
      this.instructionTab.remove()
      this.instructionTab.hidden = true
    }

    for (const [tab, button] of [['outline', this.outlineTab], ['comments', this.commentsTab], ['instruction', this.instructionTab]] as const) {
      const active = this.auxiliaryTab === tab
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-selected', String(active))
      button.tabIndex = active ? 0 : -1
    }
    this.tabsControl?.setValue(this.auxiliaryTab)
    const outlineVisible = hasOutline && this.auxiliaryTab === 'outline'
    this.outlineList.hidden = !outlineVisible
    this.commentList.hidden = this.auxiliaryTab !== 'comments'
    this.instructionPanel.hidden = this.auxiliaryTab !== 'instruction'
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
    this.root.classList.remove('panel-motion-disabled')
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
        !isInternalFile(file.path)
        && (relativePath(this.bundle, file).toLocaleLowerCase().includes(query)
        || file.content.toLocaleLowerCase().includes(query)))
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
    const path = this.selected?.path ?? this.selectedPlaceholder
    this.workspacePath.textContent = path?.split('/').pop() ?? ''
    this.workspacePath.title = this.workspacePath.textContent
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
    this.commentToggle.title = commentsOpen ? this.t.collapseRightPanel : this.t.expandRightPanel
    this.commentToggle.setAttribute('aria-label', this.commentToggle.title)
    this.commentToggle.setAttribute('aria-pressed', String(commentsOpen))
    this.commentToggle.setAttribute('aria-expanded', String(commentsOpen))
    this.syncAuxiliaryTabs()
    if (layoutChanged) requestAnimationFrame(() => {
      if (!this.root.isConnected) return
      this.comments.refreshHighlights()

      this.outline.scheduleActive()
    })
  }

  private updateFileContent(path: string, content: string, blocks: TacoFile['blocks']): void {
    const canonical = fileByPath(this.bundle, path)
    if (!canonical) return
    const previousNavigation = navigationSignature(this.bundle, canonical)
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
    if (previousNavigation !== navigationSignature(this.bundle, canonical)) this.fileNavigation?.refresh(this.selected)
    if (previousTitle !== canonical.title && this.selected?.path === path) {
      this.syncWorkspaceHeader()
      const title = this.viewer.querySelector<HTMLElement>('.document-inline-title-text')
      if (title && document.activeElement !== title) title.textContent = canonical.title?.trim() || fallbackFileTitle(canonical)
    }
  }

  private syncDirtyState(): void {
    const saveDirty = this.dirtyTracker.isDirty()
    this.saveButton.classList.toggle('is-dirty', saveDirty)
    this.saveButton.title = saveDirty ? this.t.unsaved : this.t.save
    this.saveButton.setAttribute('aria-label', this.saveButton.title)

    // Handoff reflects actual file, comment, and Checkpoint changes.
    const hasFileChanges = this.dirtyTracker.getDirtyFileIds().size > 0
    const hasCommentChanges = this.dirtyTracker.isCommentsDirty()
    const hasOpenComments = (this.bundle.comments ?? []).some((c) => c.status === 'open')
    const hasCheckpointChanges = this.dirtyTracker.isDocumentDirty()
      && (this.getCheckpointChanges().length > 0 || this.getCheckpointTemplateChange() !== null
        || this.getCheckpointDocumentAdditions().length > 0)
    const handoffDirty = hasFileChanges || hasCommentChanges || hasCheckpointChanges || (hasOpenComments && saveDirty)
    this.copyButton.classList.toggle('is-dirty', handoffDirty)
  }

  private get canManageStructure(): boolean {
    return bundleCanWrite(this.bundle) && !this.structureLocked
  }

  /**
   * The header's primary action. When a custom handoff handler is registered (e.g. hosted mode),
   * it executes that; everywhere else it copies the review verbatim.
   */
  private async primaryHandoff(): Promise<void> {
    if (this.primaryHandoffHandler) {
      await this.primaryHandoffHandler()
      return
    }
    await this.copyReviewFull()
  }

  adoptBundleContent(content: {
    title?: string
    files: TacoFile[]
    navigation?: NavigationManifest
    checkpoints?: unknown
    comments: TacoCommentThread[]
  }): void {
    const previousPath = this.selected?.path ?? this.selectedPlaceholder
    const wasCheckpointView = this.checkpointView
    this.bundle.title = content.title || this.bundle.title
    this.bundle.files = content.files
    ensureFileIds(this.bundle)
    if (content.navigation) this.bundle.navigation = content.navigation
    else delete this.bundle.navigation
    if (content.checkpoints === undefined) delete this.bundle.checkpoints
    else this.bundle.checkpoints = content.checkpoints
    this.bundle.comments = content.comments
    document.title = `${this.bundle.title} — Taco`
    this.checkpointView = wasCheckpointView && content.checkpoints !== undefined
    this.selected = this.checkpointView ? null : ((previousPath ? fileByPath(this.bundle, previousPath) : null) ?? defaultFile(this.bundle))
    this.selectedPlaceholder = null
    this.cachedResolvedCheckpoints = null
    this.dirtyTracker.markSaved()
    this.captureCheckpointBaseline()
    this.build()
    this.fileNavigation?.refresh(this.selected)
  }

  rebuild(): void {
    this.build()
  }

  setStructureLocked(locked: boolean): void {
    this.structureLocked = locked
    if (this.fileNavigation) {
      this.fileNavigation.refresh(this.selected)
    }
  }

  setPrimaryHandoffHandler(handler: (() => Promise<void>) | null, tooltip?: string, icon?: Parameters<typeof svgIcon>[0], label?: string): void {
    this.primaryHandoffHandler = handler ?? undefined
    this.primaryHandoffTooltip = tooltip
    this.primaryHandoffIcon = handler ? icon : undefined
    this.primaryHandoffLabel = handler ? label : undefined
    if (this.copyButton) {
      this.copyButton.title = tooltip ?? this.t.copyReview
      this.copyButton.setAttribute('aria-label', this.primaryHandoffLabel ?? this.t.copyReview)
      setButtonIcon(this.copyButton, this.primaryHandoffIcon ?? 'copy')
      this.copyButton.querySelector('.button-label')!.textContent = this.primaryHandoffLabel ?? this.t.copyReviewLabel
    }
  }
  setCopyReviewMenuCustomizer(customizer: ((menu: HTMLElement, defaultItems: HTMLElement[]) => void) | null): void {
    this.copyReviewMenuCustomizer = customizer ?? undefined
  }

  setCopyButtonTitle(title: string): void {
    this.primaryHandoffTooltip = title
    if (this.copyButton) {
      this.copyButton.title = title
    }
  }

  setPendingWritesCheck(check: (() => boolean) | null): void {
    this.pendingWritesCheck = check ?? undefined
  }

  setDurableCommentsOnlyCheck(check: (() => boolean) | null): void {
    this.durableActionsOnlyCheck = check ?? undefined
  }

  addHeaderControl(control: HTMLElement, position: 'left' | 'right' = 'right'): () => void {
    const entry = { control, position }
    this.headerExtraControls.push(entry)
    if (this.workspaceHeaderSpacer?.parentElement) {
      if (position === 'left') {
        this.workspaceHeaderSpacer.parentElement.insertBefore(control, this.workspaceHeaderSpacer)
      } else {
        // Insert right after spacer or before copyReviewGroup
        this.workspaceHeaderSpacer.parentElement.insertBefore(control, this.copyReviewGroup)
      }
    }
    return () => {
      const idx = this.headerExtraControls.indexOf(entry)
      if (idx !== -1) this.headerExtraControls.splice(idx, 1)
      control.remove()
    }
  }

  onDocumentChange(listener: (kind: 'content' | 'comments') => void): () => void {
    this.changeListeners.add(listener)
    return () => { this.changeListeners.delete(listener) }
  }

  onLocaleChange(listener: (locale: Locale) => void): () => void {
    this.localeListeners.add(listener)
    return () => { this.localeListeners.delete(listener) }
  }

  onDestruct(listener: () => void): () => void {
    this.destructListeners.add(listener)
    return () => { this.destructListeners.delete(listener) }
  }

  startDocumentComment(): void {
    this.comments.startDocumentComment()
  }

  private readonly handleBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (this.pendingWritesCheck?.() || this.dirtyTracker.isDirty()) {
      event.preventDefault()
      event.returnValue = ''
    }
  }


  openPopover(anchor: HTMLElement, className: string): HTMLElement {
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

  menuButton(
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
    const langBadges: Record<Locale, string> = { 'zh-Hans': '简', en: 'EN' }
    for (const { code: locale, label } of LOCALE_CHOICES) {
      const badge = el('span', 'lang-badge', langBadges[locale])
      const button = this.menuButton(label, () => {
        this.locale = locale
        storageSet('taco-locale', locale)
        document.documentElement.lang = locale
        this.build()
        for (const listener of this.localeListeners) listener(locale)
        menu.remove()
      }, { active: locale === this.locale, leading: badge })
      menu.append(button)
    }
  }

  private openCopyReviewMenu(anchor: HTMLElement): void {
    const menu = this.openPopover(anchor, 'copy-review-menu')
    const manualHandoffLabel = this.primaryHandoffHandler
      ? (this.locale === 'zh-Hans' ? '手动交接' : 'Manual Handoff')
      : this.t.copyAllChanges
    const manualHandoffNoDataLabel = this.primaryHandoffHandler
      ? (this.locale === 'zh-Hans' ? '手动交接（不含数据）' : 'Manual Handoff (w/o data)')
      : this.t.copyTabInspect
    const defaultItems = [
      this.menuButton(manualHandoffLabel, () => {
        menu.remove()
        void this.copyReviewFull()
      }, { icon: 'copy', menuitem: false }),
      this.menuButton(manualHandoffNoDataLabel, () => {
        menu.remove()
        void this.copyReviewInspectPrompt()
      }, { icon: 'eye', menuitem: false }),
    ]
    if (this.copyReviewMenuCustomizer) {
      this.copyReviewMenuCustomizer(menu, defaultItems)
    } else {
      menu.append(...defaultItems)
    }
  }

  async copyReviewFull(): Promise<void> {
    const changedFiles = this.getModifiedReviewFiles()
    const comments = (this.bundle.comments ?? []).filter((c) => c.status === 'open').map((c) => {
      // A whole-document comment quotes nothing, so it is reported by scope instead of by position.
      const anchor = c.anchor
      let location = this.t.documentComment
      let quote = ''
      if (anchor) {
        // Line numbers follow the file's current body text, never the stored creation-time offsets.
        const file = fileByPath(this.bundle, anchor.path)
        const lines = file ? commentLineReference(file.content, anchor) : null
        location = lines ? `${anchor.path}:${lines}` : `${anchor.path} (${this.t.positionLost})`
        quote = anchor.quote.exact
      }
      if (anchor?.block) {
        const b = anchor.block
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
        path: anchor?.path ?? null,
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
    const checkpointChanges = this.getCheckpointChanges()
    const checkpointTemplateChange = this.getCheckpointTemplateChange()
    const checkpointDocumentAdditions = this.getCheckpointDocumentAdditions()
    const hasDocTitleChange = this.dirtyTracker.isDocumentDirty() && !this.bundle.navigation
    const hasFileOrCommentChanges = changedFiles.length > 0 || comments.length > 0 || checkpointChanges.length > 0
      || checkpointTemplateChange !== null || checkpointDocumentAdditions.length > 0
      || this.dirtyTracker.isCommentsDirty() || this.dirtyTracker.getDirtyFileIds().size > 0
    if (!hasDocTitleChange && !hasFileOrCommentChanges) {
      this.toast(this.t.noReviewChanges)
      return
    }
    const originPath = new URLSearchParams(location.search).get('origin_path')
    const diffSections = changedFiles.map((f) => {
      if (f.diff) return `\n### \`${f.path}\`\n\`\`\`diff\n${f.diff}\n\`\`\``
      return `\n### \`${f.path}\`\n*${this.t.handoffBinaryNotice}*\n`
    }).join('\n')
    const checkpointSections = checkpointChanges.map(({ path, from, to }) =>
      `- \`${path}\`: ${from} → ${to}`).join('\n')
    const checkpointDefinitionSections = [
      checkpointTemplateChange
        ? `- template: ${JSON.stringify(checkpointTemplateChange.from)} → ${JSON.stringify(checkpointTemplateChange.to)}`
        : '',
      ...checkpointDocumentAdditions.map(({ checkpointId, path }) => `- ${JSON.stringify(checkpointId)}: add \`${path}\``),
    ].filter(Boolean).join('\n')
    const commentSections = comments.map((c) => {
      const msgs = c.messages.map((m) => `  - **${m.author}**: ${m.body}`).join('\n')
      const head = c.quote ? `- [${c.location}] ${this.t.handoffQuoteLabel}: "${c.quote}"` : `- [${c.location}]`
      return `${head}\n${msgs}`
    }).join('\n\n')
    const prompt = [
      this.t.handoffIntro,
      `- ${this.t.handoffDocTitle}: "${this.bundle.title}"`,
      originPath ? `- ${this.t.handoffLocalPath}: ${originPath}` : '',
      diffSections ? `\n## ${this.t.handoffDiffHeader}${diffSections}` : '',
      checkpointSections ? `\n## Checkpoint status changes\n${checkpointSections}` : '',
      checkpointDefinitionSections ? `\n## Checkpoint definition changes\n${checkpointDefinitionSections}` : '',
      commentSections ? `\n## ${this.t.handoffCommentsHeader}\n${commentSections}` : '',
    ].filter(Boolean).join('\n')
    const text = prompt
    // Same-origin host pages (e.g. the Tacobin homepage demo) may react to a handoff; other origins get nothing.
    if (this.embedded && window.parent !== window && location.origin !== 'null') {
      window.parent.postMessage({ type: 'taco:handoff', text }, location.origin)
    }
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
    this.captureCheckpointBaseline()
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

  toast(message: string): void {
    document.querySelector('.taco-toast')?.remove()
    const toast = el('div', 'taco-toast', message)
    toast.setAttribute('role', 'status')
    document.body.append(toast)
    setTimeout(() => toast.classList.add('is-leaving'), 2200)
    setTimeout(() => toast.remove(), 2360)
  }
  private async handleCreateFile(targetGroupId: string | null): Promise<void> {
    // When structure is locked, there is no grouping choice: a new file lands in its category-derived group.
    const groups = this.structureLocked ? [] : getAvailableGroups(this.bundle, checkpointCopy(this.locale).checkpoint)
    const result = await showNewFileDialog({
      title: this.t.addFile,
      typeLabel: this.t.newFileType,
      nameLabel: this.t.newFileName,
      categoryLabel: this.t.newFileCategory,
      ungroupedLabel: this.t.ungrouped,
      groups,
      initialGroupId: targetGroupId && groups.some((group) => group.id === targetGroupId) ? targetGroupId : null,
      confirmLabel: this.t.create,
      cancelLabel: this.t.cancel,
    })
    if (!result) return

    const fileNameClean = result.fileName.trim().replaceAll('\\', '/').split('/').filter(Boolean).join('/')
    const fullPath = `${this.bundle.root}/${fileNameClean}`
    if (fileByPath(this.bundle, fullPath)) return
    if (result.groupId && !groups.some(({ id }) => id === result.groupId)) return
    const navigation = result.groupId ? createInitialManifest(this.bundle) : null

    const newFile: TacoFile = {
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path: fullPath,
      mediaType: result.mediaType,
      content: result.content,
    }

    this.store.commit({ kind: 'all' }, () => {
      this.bundle.files.push(newFile)
      if (navigation) {
        this.bundle.navigation = assignFileToGroup(navigation, fullPath, result.groupId, this.bundle.root, this.bundle)
      }
    })

    this.selectFile(newFile)
    this.fileNavigation?.refresh(this.selected)
  }

  private async handleRenameFile(file: TacoFile): Promise<void> {
    const fullName = fileName(file.path)
    const dotIndex = fullName.lastIndexOf('.')
    const baseName = dotIndex > 0 ? fullName.slice(0, dotIndex) : fullName
    const extension = dotIndex > 0 ? fullName.slice(dotIndex) : ''

    const promptText = this.t.renameFilePrompt ?? 'New file name:'
    const newName = await showPromptDialog({
      title: this.t.renameFile ?? 'Rename file',
      placeholder: promptText,
      initialValue: baseName, // 仅允许编辑纯主名称
      confirmLabel: this.t.save ?? 'Rename',
      cancelLabel: this.t.cancel ?? 'Cancel',
    })
    if (!newName || !newName.trim()) return

    // 清理并剥除可能误输的相同后缀，严格强制追加原有后缀名
    let cleanBase = newName.trim().replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? ''
    if (extension && cleanBase.toLowerCase().endsWith(extension.toLowerCase())) {
      cleanBase = cleanBase.slice(0, -extension.length).trim()
    }
    if (!cleanBase || cleanBase === baseName) return

    const finalName = `${cleanBase}${extension}`
    const dir = file.path.slice(0, file.path.lastIndexOf('/'))
    const newPath = `${dir}/${finalName}`
    if (fileByPath(this.bundle, newPath)) return

    const oldPath = file.path
    const checkpoints = resolveCheckpoints(this.bundle)
    const wasTracked = checkpoints.valid && checkpoints.nodes.some((node) => node.documents.some((document) => document.path === oldPath))
    this.store.commit({ kind: 'document' }, () => {
      file.path = newPath
      if (this.bundle.navigation) {
        const oldRel = oldPath.slice(this.bundle.root.length + 1)
        const newRel = newPath.slice(this.bundle.root.length + 1)
        for (const group of this.bundle.navigation.groups) {
          group.paths = group.paths.map((p) => (p === oldRel ? newRel : p))
        }
        if (this.bundle.navigation.entry === oldRel) {
          this.bundle.navigation.entry = newRel
        }
      }
      if (wasTracked && checkpoints.state) {
        this.bundle.checkpoints = { ...checkpoints.state, documents: checkpoints.state.documents.filter((record) => record.path !== oldPath) }
      }
    })

    this.selectFile(file)
    this.fileNavigation?.refresh(this.selected)
  }

  private async handleDeleteFile(file: TacoFile): Promise<void> {
    const confirmText = this.t.deleteFileConfirm ?? 'Delete this file permanently?'
    const confirmed = await showConfirmDialog({
      title: this.t.deleteFile ?? 'Delete file',
      messages: [confirmText],
      confirmLabel: this.t.deleteFile ?? 'Delete',
      cancelLabel: this.t.cancel ?? 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    const filePath = file.path
    const checkpoints = resolveCheckpoints(this.bundle)
    const wasTracked = checkpoints.valid && checkpoints.nodes.some((node) => node.documents.some((document) => document.path === filePath))
    this.store.commit({ kind: 'document' }, () => {
      this.bundle.files = this.bundle.files.filter((f) => f.path !== filePath)
      if (this.bundle.navigation) {
        const rel = filePath.slice(this.bundle.root.length + 1)
        for (const group of this.bundle.navigation.groups) {
          group.paths = group.paths.filter((p) => p !== rel)
        }
        if (this.bundle.navigation.entry === rel) {
          delete this.bundle.navigation.entry
        }
      }
      if (wasTracked && checkpoints.state) {
        this.bundle.checkpoints = { ...checkpoints.state, documents: checkpoints.state.documents.filter((record) => record.path !== filePath) }
      }
    })

    if (this.selected?.path === filePath) {
      if (wasTracked) this.selectPlaceholder(filePath)
      else {
        const next = defaultFile(this.bundle)
        if (next) this.selectFile(next)
        else {
          this.selected = null
          this.comments.resetForFileChange()
          this.syncWorkspaceHeader()
          this.paintViewer()
          this.comments.paint()
          this.syncAuxiliaryTabs()
        }
      }
    }
    this.fileNavigation?.refresh(this.selected, this.checkpointView, this.selectedPlaceholder)
  }




  private onKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || !this.root.isConnected) return
    if (event.key === 'Escape' && this.commentPanelOpen) {
      if (document.querySelector('dialog[open], .topbar-popover')) return
      event.preventDefault()
      this.root.classList.add('panel-motion-disabled')
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
