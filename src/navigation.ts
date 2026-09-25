import { checkpointLayout, checkpointMembership, validateCheckpoints } from '@taco/protocol'
import { isInternalFile, type TacoBundle, type TacoFile } from './model.ts'
import { resolveFileCategory, resolvePathCategory, UNCLASSIFIED_CATEGORY } from './category.ts'

export interface ResolvedCustomGroup {
  id: string
  title: string
  files: TacoFile[]
  isCustom: true
}

export type ResolvedGroup = ResolvedCustomGroup

export interface PlaceholderEntry {
  kind: 'placeholder'
  path: string
  checkpointId: string
  optional: boolean
}

export type NavigationEntry = { kind: 'file' | 'category-file'; file: TacoFile } | PlaceholderEntry

export interface ResolvedCheckpointGroup {
  id: `checkpoint-${string}`
  title: string
  checkpointId: string
  entries: NavigationEntry[]
  isCustom: false
  isCheckpoint: true
  locked: true
}

export interface NavigationWarning {
  path: string
  reason: 'manifest-path-owned-by-checkpoint' | 'category-overridden' | 'category-title-collision'
}

export interface ResolvedDocumentNavigation {
  checkpointGroups: ResolvedCheckpointGroup[]
  groups: ResolvedGroup[]
  unassigned: TacoFile[]
  warnings: NavigationWarning[]
}

export function resolveDocumentNavigation(bundle: TacoBundle): ResolvedDocumentNavigation {
  const validated = bundle.checkpoints === undefined
    ? null
    : validateCheckpoints(bundle.checkpoints, bundle.root)
  const state = validated?.ok ? validated.value : null
  const members = state ? checkpointMembership(state) : new Map<string, never>()
  const ordinaryFiles = bundle.files.filter((file) => !members.has(file.path) && !isInternalFile(file.path))
  const filesByPath = new Map(bundle.files.map((file) => [file.path, file]))
  const checkpointGroups: ResolvedCheckpointGroup[] = []
  const warnings: NavigationWarning[] = []

  if (state) {
    const nodesById = new Map(state.nodes.map((node) => [node.id, node]))
    for (const layer of checkpointLayout(state)) {
      for (const id of layer) {
        const node = nodesById.get(id)!
        const documents = [...node.documents].sort((a, b) =>
          Number(Boolean(a.optional)) - Number(Boolean(b.optional)) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        checkpointGroups.push({
          id: `checkpoint-${node.id}`,
          title: node.title,
          checkpointId: node.id,
          entries: documents.map((document): NavigationEntry => {
            const file = filesByPath.get(document.path)
            return file
              ? { kind: 'file', file }
              : { kind: 'placeholder', path: document.path, checkpointId: node.id, optional: Boolean(document.optional) }
          }),
          isCustom: false,
          isCheckpoint: true,
          locked: true,
        })
      }
    }

    const titles = new Set(state.nodes.map((node) => node.title))
    for (const path of members.keys()) {
      if (resolvePathCategory(bundle, path).overridden !== undefined) {
        warnings.push({ path, reason: 'category-overridden' })
      }
    }
    for (const file of ordinaryFiles) {
      const category = resolveFileCategory(bundle, file)
      if (category.source === 'first-level-dir' && titles.has(category.category)) {
        warnings.push({ path: file.path, reason: 'category-title-collision' })
      }
    }
  }

  const result = (groups: ResolvedGroup[], unassigned: TacoFile[]): ResolvedDocumentNavigation => ({
    checkpointGroups,
    groups,
    unassigned,
    warnings: [...warnings].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1
      : a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0),
  })

  const manifest = bundle.navigation

  // 1. 显式 navigation manifest 决定分组；Checkpoint 持有的路径始终归 Checkpoint
  if (manifest && manifest.version === 1 && Array.isArray(manifest.groups)) {
    const warnedOwnedPaths = new Set<string>()
    const assignedPaths = new Set<string>()
    const groups: ResolvedCustomGroup[] = []
    const checkpointByGroupId = new Map<string, ResolvedCheckpointGroup>(checkpointGroups.map((group) => [group.id, group]))
    for (const group of manifest.groups) {
      const checkpoint = checkpointByGroupId.get(group.id)
      const files: TacoFile[] = []
      for (const path of group.paths) {
        const resolvedPath = path.startsWith(`${bundle.root}/`) ? path : `${bundle.root}/${path}`
        if (members.has(resolvedPath)) {
          if (!warnedOwnedPaths.has(resolvedPath)) {
            warnedOwnedPaths.add(resolvedPath)
            warnings.push({ path: resolvedPath, reason: 'manifest-path-owned-by-checkpoint' })
          }
          continue
        }
        const file = filesByPath.get(resolvedPath) ?? filesByPath.get(path)
        if (file && !assignedPaths.has(file.path) && !isInternalFile(file.path)) {
          assignedPaths.add(file.path)
          if (checkpoint) checkpoint.entries.push({ kind: 'category-file', file })
          else files.push(file)
        }
      }
      if (!checkpoint) {
        groups.push({
          id: group.id,
          title: group.title,
          files,
          isCustom: true,
        })
      }
    }

    const unassigned = ordinaryFiles.filter((file) => !assignedPaths.has(file.path))
    return result(groups, unassigned)
  }

  // 2. 没有显式 manifest：按一级目录推导分组，根目录文件一律归入未分配
  const categoryMap = new Map<string, TacoFile[]>()
  const unassigned: TacoFile[] = []

  for (const file of ordinaryFiles) {
    const res = resolveFileCategory(bundle, file)
    if (res.category === UNCLASSIFIED_CATEGORY) {
      unassigned.push(file)
    } else {
      const list = categoryMap.get(res.category)
      if (list) list.push(file)
      else categoryMap.set(res.category, [file])
    }
  }

  const groups: ResolvedCustomGroup[] = Array.from(categoryMap.entries()).map(([catName, files]) => ({
    id: `category-${catName}`,
    title: catName,
    files,
    isCustom: true,
  }))
  return result(groups, unassigned)
}
