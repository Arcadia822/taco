import { checkpointLayout, checkpointMembership, validateCheckpoints } from '@taco/protocol'
import { isInternalFile, relativePath, type TacoBundle, type TacoFile } from './model.ts'
import { resolveFileCategory, resolvePathCategory, UNCLASSIFIED_CATEGORY } from './category.ts'
import { buildStageNavigation } from './stage-navigation.ts'

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
  mode: 'custom' | 'stage'
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
  const categoryAssignedPaths = new Set<string>()

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
      if ((category.source === 'first-level-dir' || category.source === 'root-file') && titles.has(category.category)) {
        warnings.push({ path: file.path, reason: 'category-title-collision' })
      }
    }
  }

  const result = (mode: 'custom' | 'stage', groups: ResolvedGroup[], unassigned: TacoFile[]): ResolvedDocumentNavigation => ({
    mode,
    checkpointGroups,
    groups,
    unassigned,
    warnings: warnings.filter(({ path, reason }) =>
      reason !== 'category-title-collision' || !categoryAssignedPaths.has(path))
      .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1
        : a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0),
  })

  const manifest = bundle.navigation

  // 1. 如果有显式 navigation 声明，按声明组织
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
          if (checkpoint) {
            checkpoint.entries.push({ kind: 'category-file', file })
            categoryAssignedPaths.add(file.path)
          }
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
    return result('custom', groups, unassigned)
  }

  // 2. 检查是否为内置三阶段项目（拥有根目录 spec.md / plan.md / tasks.md）
  const isStageProject = bundle.files.some((file) => {
    const rel = relativePath(bundle, file)
    return rel === 'spec.md' || rel === 'plan.md' || rel === 'tasks.md'
  })

  if (!isStageProject) {
    const categoryMap = new Map<string, TacoFile[]>()
    const unassigned: TacoFile[] = []

    for (const file of ordinaryFiles) {
      const res = resolveFileCategory(bundle, file)
      if (res.category === UNCLASSIFIED_CATEGORY) {
        unassigned.push(file)
      } else {
        let list = categoryMap.get(res.category)
        if (!list) {
          list = []
          categoryMap.set(res.category, list)
        }
        list.push(file)
      }
    }

    if (categoryMap.size > 0 || !isStageProject) {
      const groups: ResolvedCustomGroup[] = Array.from(categoryMap.entries()).map(([catName, files]) => ({
        id: `category-${catName}`,
        title: catName,
        files,
        isCustom: true,
      }))
      return result('custom', groups, unassigned)
    }
  }
  // 3. 只有当确实存在阶段文件 (spec.md / plan.md / tasks.md) 时才派生阶段分组
  const structure = buildStageNavigation({ ...bundle, files: ordinaryFiles })
  const stageGroups: ResolvedCustomGroup[] = structure.stages
    .filter((stage) => !state || stage.files.length > 0)
    .map((stage) => ({
      id: stage.definition.id,
      title: stage.definition.id,
      files: [...(stage.core ? [stage.core] : []), ...stage.files],
      isCustom: true,
    }))

  return result('stage', stageGroups, structure.unassigned)
}
