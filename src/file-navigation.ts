import type { DocumentStatus } from '@taco/protocol'
import { resolveCheckpoints } from '@taco/protocol'
import { createBrandMarkContainer } from './brand.ts'
import { openCheckpointStatusMenu, statusLabel, type CheckpointLabels } from './checkpoint-view.ts'
import { defaultFile, fileName, relativePath, type NavigationManifest, type TacoBundle, type TacoFile } from './model.ts'
import { createControlButton, createFileAttribute, createFileTypeIcon, createStatusIcon, el, showConfirmDialog, showPromptDialog, sidebarRow, svgIcon } from './ui-primitives.ts'
import { resolveDocumentNavigation } from './navigation.ts'
import {
  addNavigationGroup,
  createInitialManifest,
  moveFileToGroup,
  removeNavigationGroup,
  renameNavigationGroup,
  setNavigationEntry,
} from './navigation-editor.ts'

interface DirNode {
  name: string
  path: string
  dirs: Map<string, DirNode>
  files: TacoFile[]
}

export interface FileNavigationLabels {
  files: string
  collapseFiles: string
  otherFiles: string
  addGroup?: string
  renameGroup?: string
  deleteGroup?: string
  addFile?: string
  renameFile?: string
  deleteFile?: string
  setEntry?: string
  entryBadge?: string
  newGroupPrompt?: string
  newFilePrompt?: string
  renameFilePrompt?: string
  deleteGroupConfirm?: string
  deleteFileConfirm?: string
  confirm?: string
  cancel?: string
}

export interface FileNavigationOptions {
  bundle: TacoBundle
  selected: TacoFile | null
  labels: FileNavigationLabels
  checkpointLabels: CheckpointLabels
  checkpointView?: boolean
  selectedPlaceholderPath?: string | null
  stageOpenState: Map<string, boolean>
  folderOpenState: Map<string, boolean>
  scrollTop: number
  editable?: boolean
  onSelect: (file: TacoFile) => void
  onSelectCheckpoint?: () => void
  onSelectPlaceholder?: (path: string) => void
  onChangeCheckpointStatus?: (path: string, status: DocumentStatus) => void
  onToggleSidebar: () => void
  onUpdateNavigation?: (navigation: NavigationManifest) => void
  onCreateFile?: (targetGroupId: string | null) => void
  onRenameFile?: (file: TacoFile) => void
  onDeleteFile?: (file: TacoFile) => void
}

const buildTree = (bundle: TacoBundle, files: TacoFile[]): DirNode => {
  const root: DirNode = {
    name: bundle.root.split('/').at(-1) ?? bundle.root,
    path: bundle.root,
    dirs: new Map(),
    files: [],
  }
  for (const file of files) {
    const parts = relativePath(bundle, file).split('/')
    parts.pop()
    let cursor = root
    for (const part of parts) {
      let child = cursor.dirs.get(part)
      if (!child) {
        child = { name: part, path: `${cursor.path}/${part}`, dirs: new Map(), files: [] }
        cursor.dirs.set(part, child)
      }
      cursor = child
    }
    cursor.files.push(file)
  }
  return root
}

export class FileNavigation {
  readonly element: HTMLElement
  readonly toggle: HTMLButtonElement
  private selected: TacoFile | null
  private scrollTop: number
  private scroll: HTMLElement | null = null
  private checkpointView: boolean
  private selectedPlaceholderPath: string | null
  private readonly checkpointPinned: HTMLElement
  private readonly checkpointButton: HTMLButtonElement
  private checkpointWarning: HTMLElement | null = null

  constructor(private readonly options: FileNavigationOptions) {
    this.selected = options.selected
    this.scrollTop = options.scrollTop
    this.checkpointView = options.checkpointView ?? false
    this.selectedPlaceholderPath = options.selectedPlaceholderPath ?? null
    this.element = el('nav', 'file-sidebar')
    this.element.setAttribute('aria-label', options.labels.files)

    const header = el('header', 'panel-header sidebar-header')
    const brand = sidebarRow('div', {
      className: 'sidebar-brand-row',
      leading: createBrandMarkContainer(),
      label: 'Taco',
      labelClass: 'brand-name',
    })

    if (options.editable && options.onUpdateNavigation) {
      const addGroupBtn = createControlButton(
        'plus',
        options.labels.addGroup ?? 'Add group',
        () => { void this.promptAddGroup() },
        'sidebar-action-btn add-group-btn',
      )
      brand.append(addGroupBtn)
    }

    this.toggle = createControlButton(
      'panel-left',
      options.labels.collapseFiles,
      options.onToggleSidebar,
      'panel-toggle left-panel-toggle',
    )
    brand.append(this.toggle)
    header.append(brand)
    this.element.append(header)
    this.checkpointButton = sidebarRow('button', {
      className: 'checkpoint-nav-item',
      leading: svgIcon('workflow'),
      label: options.checkpointLabels.checkpoints,
    }) as HTMLButtonElement
    this.checkpointButton.type = 'button'
    this.checkpointButton.addEventListener('click', () => options.onSelectCheckpoint?.())
    this.checkpointPinned = el('div', 'sidebar-pinned')
    this.checkpointPinned.append(this.checkpointButton)
    this.paint(this.selected)
  }

  getScrollTop(): number {
    return this.scroll?.scrollTop ?? this.scrollTop
  }

  refresh(
    selected: TacoFile | null,
    checkpointView = this.checkpointView,
    selectedPlaceholderPath = this.selectedPlaceholderPath,
  ): void {
    if (this.scroll) this.scrollTop = this.scroll.scrollTop
    this.scroll?.remove()
    this.scroll = null
    this.checkpointView = checkpointView
    this.selectedPlaceholderPath = selectedPlaceholderPath
    this.checkpointWarning?.remove()
    this.checkpointWarning = null
    this.paint(selected)
  }

  paint(
    selected: TacoFile | null,
    checkpointView = this.checkpointView,
    selectedPlaceholderPath = this.selectedPlaceholderPath,
  ): void {
    this.selected = selected
    this.checkpointView = checkpointView
    this.selectedPlaceholderPath = selectedPlaceholderPath
    this.checkpointButton.classList.toggle('is-selected', this.checkpointView)
    if (this.scroll) {
      this.scrollTop = this.scroll.scrollTop
      for (const button of this.scroll.querySelectorAll<HTMLButtonElement>('.file-row')) {
        button.classList.toggle('is-selected',
          !this.checkpointView && (button.dataset.placeholder === 'true'
            ? button.dataset.path === this.selectedPlaceholderPath
            : button.dataset.path === selected?.path))
      }
      return
    }

    const scroll = el('div', 'sidebar-scroll')
    const navigation = el('div', 'stage-navigation')
    const resolved = resolveDocumentNavigation(this.options.bundle)
    const checkpoints = resolveCheckpoints(this.options.bundle)
    if (this.options.bundle.checkpoints !== undefined && checkpoints.valid) {
      this.element.querySelector('.sidebar-header')?.after(this.checkpointPinned)
    } else {
      this.checkpointPinned.remove()
    }
    if (!checkpoints.valid && this.options.bundle.checkpoints !== undefined) {
      const warning = el('div', 'checkpoint-warning-row', `${this.options.checkpointLabels.checkpointsInvalid}: ${checkpoints.error}`)
      warning.title = checkpoints.error
      this.checkpointWarning = warning
      this.element.querySelector('.sidebar-header')?.after(warning)
    }
    const nodes = new Map(checkpoints.nodes.map((node) => [node.id, node]))
    const documents = new Map(checkpoints.documents.map((document) => [document.path, document]))
    for (const group of resolved.checkpointGroups) {
      const stage = el('details', 'stage-group checkpoint-group') as HTMLDetailsElement
      stage.dataset.stage = group.id
      this.bindDisclosureState(stage, group.id, this.options.stageOpenState)

      const summary = el('summary', 'stage-summary sidebar-row')
      const head = el('span', 'stage-head')
      head.append(el('span', 'stage-name', group.title), this.disclosureIcon('stage-caret'))
      summary.append(head, el('span', 'stage-spacer'))
      if (this.options.editable && this.options.onCreateFile) {
        const actions = el('span', 'group-actions')
        const addFileBtn = createControlButton(
          'plus',
          this.options.labels.addFile ?? 'Add file',
          () => this.options.onCreateFile?.(group.id),
          'group-action-btn add-file-to-group-btn',
        )
        addFileBtn.addEventListener('click', (event) => {
          event.stopPropagation()
          event.preventDefault()
        })
        actions.append(addFileBtn)
        summary.append(actions)
      }
      const aggregate = nodes.get(group.checkpointId)?.aggregate ?? 'todo'
      const groupStatus = el('span', 'checkpoint-group-status')
      groupStatus.append(createStatusIcon(aggregate, statusLabel(aggregate, this.options.checkpointLabels)))
      groupStatus.title = statusLabel(aggregate, this.options.checkpointLabels)
      summary.append(groupStatus)
      stage.append(summary)

      const list = el('ul', 'tree-list')
      for (const entry of group.entries) {
        const item = el('li')
        if (entry.kind === 'category-file') {
          item.append(this.fileButton(entry.file))
        } else {
          const path = entry.kind === 'placeholder' ? entry.path : entry.file.path
          const document = documents.get(path)
          item.append(this.checkpointFileRow(
            path,
            document?.status ?? 'todo',
            document?.optional ?? (entry.kind === 'placeholder' && entry.optional),
            entry.kind === 'file' ? entry.file : null,
          ))
        }
        list.append(item)
      }
      stage.append(list)
      navigation.append(stage)
    }

    for (const group of resolved.groups) {
      const stage = el('details', 'stage-group') as HTMLDetailsElement
      stage.dataset.stage = group.id
      this.bindDisclosureState(stage, group.id, this.options.stageOpenState)

      const summary = el('summary', 'stage-summary sidebar-row')
      const head = el('span', 'stage-head')
      const summaryText = group.title
      const label = el('span', 'stage-name', summaryText)
      const caret = this.disclosureIcon('stage-caret')
      head.append(label, caret)
      const spacer = el('span', 'stage-spacer')
      summary.append(head, spacer)
      if (this.options.editable) {
        const actions = el('span', 'group-actions')

        // 需求3：把重命名和删除收敛至操作菜单按钮（more-horizontal）中
        if (this.options.onUpdateNavigation && group.isCustom) {
          const menuBtn = createControlButton(
            'more-horizontal',
            'Actions',
            () => {
              this.openGroupMenu(menuBtn, group)
            },
            'group-action-btn group-menu-btn',
          )
          menuBtn.addEventListener('click', (event) => {
            event.stopPropagation()
            event.preventDefault()
          })
          actions.append(menuBtn)
        }
        // 需求3：快捷显式只露出新建文件按钮
        if (this.options.onCreateFile) {
          const addFileBtn = createControlButton(
            'plus',
            this.options.labels.addFile ?? 'Add file',
            () => this.options.onCreateFile?.(group.id),
            'group-action-btn add-file-to-group-btn',
          )
          addFileBtn.addEventListener('click', (event) => {
            event.stopPropagation()
            event.preventDefault()
          })
          actions.append(addFileBtn)
        }


        summary.append(actions)
      }

      stage.append(summary)

      if (this.options.editable && this.options.onUpdateNavigation) {
        stage.addEventListener('dragover', (e) => {
          e.preventDefault()
          stage.classList.add('is-drag-over')
        })
        stage.addEventListener('dragleave', () => stage.classList.remove('is-drag-over'))
        stage.addEventListener('drop', (e) => {
          e.preventDefault()
          stage.classList.remove('is-drag-over')
          const filePath = e.dataTransfer?.getData('text/plain')
          if (filePath) {
            this.handleMoveFile(filePath, group.id)
          }
        })
      }

      if (group.isCustom) {
        if (group.files.length) {
          const tree = el('div', 'file-tree')
          this.renderDirectory(buildTree(this.options.bundle, group.files), tree, true)
          stage.append(tree)
        }
      } else {
        if (group.stage.files.length) {
          const tree = el('div', 'file-tree')
          this.renderDirectory(buildTree(this.options.bundle, group.stage.files), tree, true)
          stage.append(tree)
        }
      }
      navigation.append(stage)
    }

    if (resolved.unassigned.length) {
      const other = el('details', 'stage-group other-files-group') as HTMLDetailsElement
      other.dataset.stage = 'other'
      const otherSummary = el('summary', 'stage-summary sidebar-row')
      const otherHead = el('span', 'stage-head')
      const otherLabel = el('span', 'stage-name', this.options.labels.otherFiles)
      const otherCaret = this.disclosureIcon('stage-caret')
      otherHead.append(otherLabel, otherCaret)
      const otherSpacer = el('span', 'stage-spacer')
      otherSummary.append(otherHead, otherSpacer)
      if (this.options.editable && this.options.onCreateFile) {
        const actions = el('span', 'group-actions')
        const addFileBtn = createControlButton(
          'plus',
          this.options.labels.addFile ?? 'Add file',
          () => this.options.onCreateFile?.(null),
          'group-action-btn add-file-to-group-btn',
        )
        addFileBtn.addEventListener('click', (event) => {
          event.stopPropagation()
          event.preventDefault()
        })
        actions.append(addFileBtn)
        otherSummary.append(actions)
      }

      other.append(otherSummary)

      if (this.options.editable && this.options.onUpdateNavigation) {
        other.addEventListener('dragover', (e) => {
          e.preventDefault()
          other.classList.add('is-drag-over')
        })
        other.addEventListener('dragleave', () => other.classList.remove('is-drag-over'))
        other.addEventListener('drop', (e) => {
          e.preventDefault()
          other.classList.remove('is-drag-over')
          const filePath = e.dataTransfer?.getData('text/plain')
          if (filePath) {
            this.handleMoveFile(filePath, null)
          }
        })
      }

      const tree = el('div', 'file-tree')
      this.renderDirectory(buildTree(this.options.bundle, resolved.unassigned), tree, true)
      other.append(tree)
      navigation.append(other)
    }

    scroll.append(navigation)
    this.element.append(scroll)
    scroll.scrollTop = this.scrollTop
    scroll.addEventListener('scroll', () => { this.scrollTop = scroll.scrollTop }, { passive: true })
    this.scroll = scroll
  }

  destroy(): void {
    this.closePopover()
    this.element.remove()
    this.scroll = null
  }

  private bindDisclosureState(details: HTMLDetailsElement, key: string, state: Map<string, boolean>): void {
    details.open = state.get(key) ?? true
    details.addEventListener('toggle', () => state.set(key, details.open))
  }

  private disclosureIcon(className: string): HTMLElement {
    const icon = el('span', className)
    icon.setAttribute('aria-hidden', 'true')
    icon.append(svgIcon('chevron-right'))
    return icon
  }


  private renderDirectory(node: DirNode, parent: HTMLElement, root = false): void {
    const container = root ? parent : el('details', 'tree-folder')
    if (!root) {
      const folder = container as HTMLDetailsElement
      folder.dataset.path = node.path
      this.bindDisclosureState(folder, node.path, this.options.folderOpenState)
      const folderIcon = el('span', 'folder-icon')
      folderIcon.append(svgIcon('folder'), svgIcon('folder-open'))
      container.append(sidebarRow('summary', {
        className: 'folder-row',
        leading: folderIcon,
        label: node.name,
        labelClass: 'folder-name',
      }))
      parent.append(container)
    }
    const list = el('ul', 'tree-list')
    const locale = document.documentElement.lang || undefined
    const directories = [...node.dirs.values()].sort((left, right) =>
      left.name.localeCompare(right.name, locale) || left.path.localeCompare(right.path, locale))
    for (const directory of directories) {
      const item = el('li')
      this.renderDirectory(directory, item)
      list.append(item)
    }
    for (const file of [...node.files].sort((left, right) =>
      fileName(left.path).localeCompare(fileName(right.path), locale) || left.path.localeCompare(right.path, locale))) {
      const item = el('li')
      item.append(this.fileButton(file))
      list.append(item)
    }
    container.append(list)
  }

  private checkpointFileRow(
    path: string,
    status: DocumentStatus,
    optional: boolean,
    file: TacoFile | null,
  ): HTMLElement {
    const labels = this.options.checkpointLabels
    const leading = file ? createFileTypeIcon(file) : svgIcon('file')
    if (!file) leading.classList.add('file-type')
    const row = el('div', `checkpoint-file-row${file ? '' : ' checkpoint-placeholder-row'}`)
    const name = fileName(path)
    const select = sidebarRow('button', {
      className: 'file-row checkpoint-file-select',
      leading,
      label: name,
      labelClass: 'file-name',
    }) as HTMLButtonElement
    select.type = 'button'
    select.dataset.path = path
    if (!file) select.dataset.placeholder = 'true'
    select.title = file ? path : `${path} · ${labels.checkpointMissingFile}`
    select.classList.toggle('is-selected', !this.checkpointView &&
      (file ? this.selected?.path === path : this.selectedPlaceholderPath === path))
    if (file && defaultFile(this.options.bundle)?.path === path) select.append(createFileAttribute('key', this.options.labels.entryBadge ?? 'Entry', 'entry-label'))
    if (optional) select.append(createFileAttribute('optional', labels.checkpointOptional, 'checkpoint-optional'))
    select.addEventListener('click', () => {
      if (file) this.options.onSelect(file)
      else this.options.onSelectPlaceholder?.(path)
    })
    row.append(select)
    if (!file) return row

    const actions = el('span', 'checkpoint-row-actions')
    if (this.options.editable) {
      const menu = createControlButton(
        'more-horizontal',
        'Actions',
        () => this.openFileMenu(menu, file, true),
        'file-action-btn checkpoint-file-menu',
      )
      actions.append(menu)
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault()
        this.openFileMenu(menu, file, true)
      })
    }
    const statusText = statusLabel(status, labels)
    const statusButton = el('button', 'checkpoint-status-button') as HTMLButtonElement
    statusButton.type = 'button'
    statusButton.title = `${name} · ${statusText}`
    statusButton.setAttribute('aria-label', statusButton.title)
    statusButton.append(createStatusIcon(status, statusText))
    statusButton.addEventListener('click', () => {
      openCheckpointStatusMenu(statusButton, {
        path,
        title: name,
        optional,
        status,
        labels,
        readOnly: !this.options.editable || !this.options.onChangeCheckpointStatus,
        onSet: (next) => this.options.onChangeCheckpointStatus?.(path, next),
        onOpenView: () => this.options.onSelectCheckpoint?.(),
      })
    })
    actions.append(statusButton)
    row.append(actions)
    return row
  }

  private fileButton(file: TacoFile): HTMLButtonElement {
    const button = sidebarRow('button', {
      className: 'file-row',
      leading: createFileTypeIcon(file),
      label: fileName(file.path),
      labelClass: 'file-name',
    }) as HTMLButtonElement
    button.type = 'button'
    button.dataset.path = file.path
    button.classList.toggle('is-selected', !this.checkpointView && file.path === this.selected?.path)

    if (defaultFile(this.options.bundle)?.path === file.path) button.append(createFileAttribute('key', this.options.labels.entryBadge ?? 'Entry', 'entry-label'))
    const fileMeta = el('span', 'file-meta')

    if (this.options.editable) {
      button.draggable = true
      button.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', file.path)
      })

      // 需求3：文件行收敛为操作菜单按钮
      const fileActions = el('span', 'file-actions')
      const menuBtn = createControlButton(
        'more-horizontal',
        'Actions',
        () => {
          this.openFileMenu(menuBtn, file)
        },
        'file-action-btn file-menu-btn',
      )
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        e.preventDefault()
      })
      fileActions.append(menuBtn)
      fileMeta.append(fileActions)

      button.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        this.openFileMenu(button, file)
      })
    }
    button.append(fileMeta)

    button.addEventListener('click', () => this.options.onSelect(file))
    return button
  }

  private closePopover(): void {
    document.querySelector('.navigation-popover')?.remove()
  }

  private openGroupMenu(anchor: HTMLElement, group: { id: string; title: string }): void {
    this.closePopover()
    const popover = el('div', 'topbar-popover navigation-popover')
    popover.setAttribute('role', 'menu')

    const renameBtn = sidebarRow('button', {
      className: 'popover-action',
      leading: svgIcon('edit'),
      label: this.options.labels.renameGroup ?? 'Rename group',
    }) as HTMLButtonElement
    renameBtn.type = 'button'
    renameBtn.addEventListener('click', () => {
      this.closePopover()
      void this.promptRenameGroup(group.id, group.title)
    })

    const deleteBtn = sidebarRow('button', {
      className: 'popover-action is-destructive',
      leading: svgIcon('trash'),
      label: this.options.labels.deleteGroup ?? 'Delete group',
    }) as HTMLButtonElement
    deleteBtn.type = 'button'
    deleteBtn.addEventListener('click', () => {
      this.closePopover()
      void this.handleDeleteGroup(group.id)
    })

    popover.append(renameBtn, deleteBtn)
    this.positionPopover(popover, anchor)
  }

  private openFileMenu(anchor: HTMLElement, file: TacoFile, checkpointFile = false): void {
    this.closePopover()
    const popover = el('div', 'topbar-popover navigation-popover')
    popover.setAttribute('role', 'menu')

    const setEntryBtn = sidebarRow('button', {
      className: 'popover-action',
      leading: svgIcon('check'),
      label: this.options.labels.setEntry ?? 'Set as entry document',
    }) as HTMLButtonElement
    setEntryBtn.type = 'button'
    setEntryBtn.addEventListener('click', () => {
      this.closePopover()
      this.handleSetEntry(file.path)
    })
    popover.append(setEntryBtn)

    if (!checkpointFile && this.options.onRenameFile) {
      const renameBtn = sidebarRow('button', {
        className: 'popover-action',
        leading: svgIcon('edit'),
        label: this.options.labels.renameFile ?? 'Rename file',
      }) as HTMLButtonElement
      renameBtn.type = 'button'
      renameBtn.addEventListener('click', () => {
        this.closePopover()
        this.options.onRenameFile?.(file)
      })
      popover.append(renameBtn)
    }

    if (!checkpointFile && this.options.onDeleteFile) {
      const deleteBtn = sidebarRow('button', {
        className: 'popover-action is-destructive',
        leading: svgIcon('trash'),
        label: this.options.labels.deleteFile ?? 'Delete file',
      }) as HTMLButtonElement
      deleteBtn.type = 'button'
      deleteBtn.addEventListener('click', () => {
        this.closePopover()
        this.options.onDeleteFile?.(file)
      })
      popover.append(deleteBtn)
    }

    this.positionPopover(popover, anchor)
  }

  private positionPopover(popover: HTMLElement, anchor: HTMLElement): void {
    document.body.append(popover)
    const rect = anchor.getBoundingClientRect()
    popover.style.top = `${Math.min(window.innerHeight - popover.offsetHeight - 12, rect.bottom + 4)}px`
    popover.style.left = `${Math.max(8, Math.min(window.innerWidth - popover.offsetWidth - 8, rect.left))}px`

    const onOutside = (event: MouseEvent): void => {
      if (!popover.contains(event.target as Node) && !anchor.contains(event.target as Node)) {
        popover.remove()
        window.removeEventListener('click', onOutside, true)
      }
    }
    setTimeout(() => window.addEventListener('click', onOutside, true), 10)
  }

  private async promptAddGroup(): Promise<void> {
    const title = await showPromptDialog({
      title: this.options.labels.addGroup ?? 'Add group',
      placeholder: this.options.labels.newGroupPrompt ?? 'Group title:',
      confirmLabel: this.options.labels.confirm ?? 'Confirm',
      cancelLabel: this.options.labels.cancel ?? 'Cancel',
    })
    if (title && title.trim()) {
      const current = createInitialManifest(this.options.bundle)
      const next = addNavigationGroup(current, title.trim())
      this.options.onUpdateNavigation?.(next)
    }
  }

  private async promptRenameGroup(groupId: string, oldTitle: string): Promise<void> {
    const newTitle = await showPromptDialog({
      title: this.options.labels.renameGroup ?? 'Rename group',
      initialValue: oldTitle,
      confirmLabel: this.options.labels.confirm ?? 'Confirm',
      cancelLabel: this.options.labels.cancel ?? 'Cancel',
    })
    if (newTitle && newTitle.trim() && newTitle.trim() !== oldTitle) {
      const current = createInitialManifest(this.options.bundle)
      const next = renameNavigationGroup(current, groupId, newTitle.trim())
      this.options.onUpdateNavigation?.(next)
    }
  }

  private async handleDeleteGroup(groupId: string): Promise<void> {
    const confirmed = await showConfirmDialog({
      title: this.options.labels.deleteGroup ?? 'Delete group',
      messages: [this.options.labels.deleteGroupConfirm ?? 'Delete this group? Its files will be moved to Unassigned.'],
      confirmLabel: this.options.labels.deleteGroup ?? 'Delete',
      cancelLabel: this.options.labels.cancel ?? 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    const current = createInitialManifest(this.options.bundle)
    const next = removeNavigationGroup(current, groupId)
    this.options.onUpdateNavigation?.(next)
  }

  private handleMoveFile(filePath: string, targetGroupId: string | null): void {
    const current = createInitialManifest(this.options.bundle)
    const next = moveFileToGroup(current, filePath, targetGroupId, this.options.bundle.root, this.options.bundle)
    this.options.onUpdateNavigation?.(next)
  }

  private handleSetEntry(filePath: string): void {
    const current = createInitialManifest(this.options.bundle)
    const next = setNavigationEntry(current, filePath, this.options.bundle.root)
    this.options.onUpdateNavigation?.(next)
  }
}
