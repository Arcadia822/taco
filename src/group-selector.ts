import { type TacoBundle, type TacoFile } from './model.ts'
import { resolveDocumentNavigation } from './navigation.ts'
import { el, sidebarRow, svgIcon } from './ui-primitives.ts'

export interface GroupSelectOption {
  id: string
  title: string
}

export interface FileGroupResolution {
  groupId: string | null
  groupTitle: string
}

/**
 * 实时计算某个文件在当前侧栏导航中所归属的分组名称与 ID
 */
export function getFileCurrentGroup(
  bundle: TacoBundle,
  file: TacoFile,
  ungroupedTitle?: string,
): FileGroupResolution {
  const resolved = resolveDocumentNavigation(bundle)
  for (const group of resolved.checkpointGroups) {
    if (group.entries.some((entry) => entry.kind === 'category-file' && entry.file.path === file.path)) {
      return { groupId: group.id, groupTitle: group.title }
    }
  }


  for (const group of resolved.groups) {
    if (group.files.some((f) => f.path === file.path)) {
      return {
        groupId: group.id,
        groupTitle: group.title,
      }
    }
  }

  return {
    groupId: null,
    groupTitle: ungroupedTitle ?? 'Ungrouped',
  }
}

/**
 * 获取当前所有可供选择的左侧分组列表
 */
export function getAvailableGroups(
  bundle: TacoBundle,
): GroupSelectOption[] {
  const resolved = resolveDocumentNavigation(bundle)
  return [
    ...resolved.checkpointGroups.map(({ id, title }) => ({ id, title: `${title} · Checkpoint` })),
    ...resolved.groups.map(({ id, title }) => ({ id, title })),
  ]
}

export interface OpenGroupSelectorOptions {
  anchor: HTMLElement
  bundle: TacoBundle
  file: TacoFile
  currentGroupId: string | null
  labels?: {
    ungrouped: string
    manageCategories?: string
  }
  onSelectGroup: (groupId: string | null) => void
  onManageCategories?: () => void
}

/**
 * 弹出分组下拉选择菜单（包含已有分组列表 + 未分组 + 新建分组选项）
 */
export function openGroupSelectorPopover(options: OpenGroupSelectorOptions): void {
  document.querySelector('.group-selector-popover')?.remove()

  const popover = el('div', 'topbar-popover group-selector-popover')
  popover.setAttribute('role', 'menu')

  const groups = getAvailableGroups(options.bundle)

  // 1. 已有分组列表
  for (const group of groups) {
    const isSelected = options.currentGroupId === group.id
    const row = sidebarRow('button', {
      className: `popover-action${isSelected ? ' is-active' : ''}`,
      leading: isSelected ? svgIcon('check') : undefined,
      label: group.title,
    }) as HTMLButtonElement
    row.type = 'button'
    row.addEventListener('click', () => {
      popover.remove()
      options.onSelectGroup(group.id)
    })
    popover.append(row)
  }

  // 2. 未分组（移出所有分组）
  const unassignedRow = sidebarRow('button', {
    className: `popover-action${options.currentGroupId === null ? ' is-active' : ''}`,
    leading: options.currentGroupId === null ? svgIcon('check') : undefined,
    label: options.labels?.ungrouped ?? 'Ungrouped',
  }) as HTMLButtonElement
  unassignedRow.type = 'button'
  unassignedRow.addEventListener('click', () => {
    popover.remove()
    options.onSelectGroup(null)
  })
  popover.append(unassignedRow)

  // 3. 管理分类
  if (options.onManageCategories) {
    const sep = el('div', 'share-separator')
    popover.append(sep)

    const manageCategoriesRow = sidebarRow('button', {
      className: 'popover-action',
      leading: svgIcon('tag'),
      label: options.labels?.manageCategories ?? 'Manage categories',
    }) as HTMLButtonElement
    manageCategoriesRow.type = 'button'
    manageCategoriesRow.addEventListener('click', () => {
      popover.remove()
      options.onManageCategories?.()
    })
    popover.append(manageCategoriesRow)
  }

  // 定位 popover
  document.body.append(popover)
  const rect = options.anchor.getBoundingClientRect()
  popover.style.top = `${Math.min(window.innerHeight - popover.offsetHeight - 12, rect.bottom + 4)}px`
  popover.style.left = `${Math.max(8, Math.min(window.innerWidth - popover.offsetWidth - 8, rect.left))}px`

  const onOutside = (event: MouseEvent): void => {
    if (!popover.contains(event.target as Node) && !options.anchor.contains(event.target as Node)) {
      popover.remove()
      window.removeEventListener('click', onOutside, true)
    }
  }
  setTimeout(() => window.addEventListener('click', onOutside, true), 10)
}
