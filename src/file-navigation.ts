import { createBrandMarkContainer } from './brand.ts'
import { buildStageNavigation, type StageId } from './stage-navigation.ts'
import { fileName, relativePath, type TacoBundle, type TacoFile } from './model.ts'
import { createControlButton, createFileTypeIcon, el, sidebarRow, svgIcon } from './ui-primitives.ts'

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
  stages: Record<StageId, string>
}

export interface FileNavigationOptions {
  bundle: TacoBundle
  selected: TacoFile | null
  labels: FileNavigationLabels
  stageOpenState: Map<string, boolean>
  folderOpenState: Map<string, boolean>
  scrollTop: number
  onSelect: (file: TacoFile) => void
  onToggleSidebar: () => void
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

  constructor(private readonly options: FileNavigationOptions) {
    this.selected = options.selected
    this.scrollTop = options.scrollTop
    this.element = el('nav', 'file-sidebar')
    this.element.setAttribute('aria-label', options.labels.files)

    const header = el('header', 'panel-header sidebar-header')
    const brand = sidebarRow('div', {
      className: 'sidebar-brand-row',
      leading: createBrandMarkContainer(),
      label: 'Taco',
      labelClass: 'brand-name',
    })
    this.toggle = createControlButton(
      'panel-left-close',
      options.labels.collapseFiles,
      options.onToggleSidebar,
      'panel-toggle left-panel-toggle',
    )
    brand.append(this.toggle)
    header.append(brand)
    this.element.append(header)
    this.paint(this.selected)
  }

  getScrollTop(): number {
    return this.scroll?.scrollTop ?? this.scrollTop
  }

  refresh(selected: TacoFile | null): void {
    if (this.scroll) this.scrollTop = this.scroll.scrollTop
    this.scroll?.remove()
    this.scroll = null
    this.paint(selected)
  }

  paint(selected: TacoFile | null): void {
    this.selected = selected
    if (this.scroll) {
      this.scrollTop = this.scroll.scrollTop
      for (const button of this.scroll.querySelectorAll<HTMLButtonElement>('.file-row')) {
        button.classList.toggle('is-selected', button.dataset.path === selected?.path)
      }
      return
    }

    const scroll = el('div', 'sidebar-scroll')
    const navigation = el('div', 'stage-navigation')
    const structure = buildStageNavigation(this.options.bundle)
    for (const group of structure.stages) {
      const stage = el('details', 'stage-group') as HTMLDetailsElement
      stage.dataset.stage = group.definition.id
      this.bindDisclosureState(stage, group.definition.id, this.options.stageOpenState)
      const summary = sidebarRow('summary', {
        className: 'stage-summary',
        label: this.options.labels.stages[group.definition.id],
        labelClass: 'stage-name',
        trailing: this.disclosureIcon('stage-caret'),
      })
      stage.append(summary)
      if (group.core) stage.append(this.fileList([group.core]))
      if (group.files.length) {
        const tree = el('div', 'file-tree')
        this.renderDirectory(buildTree(this.options.bundle, group.files), tree, true)
        stage.append(tree)
      }
      stage.querySelector('.file-row')?.classList.add('is-featured')
      navigation.append(stage)
    }
    if (structure.unassigned.length) {
      const other = el('details', 'stage-group other-files-group') as HTMLDetailsElement
      other.dataset.stage = 'other'
      this.bindDisclosureState(other, 'other', this.options.stageOpenState)
      other.append(sidebarRow('summary', {
        className: 'stage-summary',
        label: this.options.labels.otherFiles,
        labelClass: 'stage-name',
        trailing: this.disclosureIcon('stage-caret'),
      }))
      const tree = el('div', 'file-tree')
      this.renderDirectory(buildTree(this.options.bundle, structure.unassigned), tree, true)
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

  private fileList(files: TacoFile[]): HTMLUListElement {
    const list = el('ul', 'tree-list')
    for (const file of files) {
      const item = el('li')
      item.append(this.fileButton(file))
      list.append(item)
    }
    return list
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

  private fileButton(file: TacoFile): HTMLButtonElement {
    const button = sidebarRow('button', {
      className: 'file-row',
      leading: createFileTypeIcon(file),
      label: fileName(file.path),
      labelClass: 'file-name',
    }) as HTMLButtonElement
    button.type = 'button'
    button.dataset.path = file.path
    button.classList.toggle('is-selected', file.path === this.selected?.path)
    button.addEventListener('click', () => this.options.onSelect(file))
    return button
  }
}
