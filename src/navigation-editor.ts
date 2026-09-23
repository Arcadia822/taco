import { checkpointMembership, validateCheckpoints } from '@taco/protocol'
import { type NavigationGroup, type NavigationManifest, type TacoBundle, type TacoFile } from './model.ts'
import { resolveDocumentNavigation } from './navigation.ts'

export function createInitialManifest(bundle: TacoBundle): NavigationManifest {
  if (bundle.navigation && bundle.navigation.version === 1 && Array.isArray(bundle.navigation.groups)) {
    return structuredClone(bundle.navigation)
  }

  // 从当前解析状态派生出初始 manifest
  const resolved = resolveDocumentNavigation(bundle)
  const groups: NavigationGroup[] = []

  for (const g of resolved.groups) {
    const files: TacoFile[] = g.isCustom
      ? g.files
      : [...(g.stage.core ? [g.stage.core] : []), ...g.stage.files]
    if (files.length > 0) {
      groups.push({
        id: g.id,
        title: g.title,
        paths: files.map((f) => f.path.slice(bundle.root.length + 1)),
      })
    }
  }

  return {
    version: 1,
    entry: bundle.navigation?.entry,
    groups,
  }
}

export function addNavigationGroup(manifest: NavigationManifest, title: string): NavigationManifest {
  const next = structuredClone(manifest)
  const id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  next.groups.push({
    id,
    title: title.trim() || 'Untitled Group',
    paths: [],
  })
  return next
}

export function removeNavigationGroup(manifest: NavigationManifest, groupId: string): NavigationManifest {
  const next = structuredClone(manifest)
  next.groups = next.groups.filter((g) => g.id !== groupId)
  return next
}

export function renameNavigationGroup(manifest: NavigationManifest, groupId: string, newTitle: string): NavigationManifest {
  const next = structuredClone(manifest)
  const group = next.groups.find((g) => g.id === groupId)
  if (group) {
    group.title = newTitle.trim() || group.title
  }
  return next
}

export function moveFileToGroup(
  manifest: NavigationManifest,
  filePath: string,
  targetGroupId: string | null, // null 表示移出所有组，回到未分配
  bundleRoot: string,
  bundle: TacoBundle,
): NavigationManifest {
  if (bundle.checkpoints !== undefined) {
    const validated = validateCheckpoints(bundle.checkpoints, bundle.root)
    const fullPath = filePath.startsWith(`${bundleRoot}/`) ? filePath : `${bundleRoot}/${filePath}`
    if (validated.ok && checkpointMembership(validated.value).has(fullPath)) return manifest
  }
  const next = structuredClone(manifest)
  const relPath = filePath.startsWith(`${bundleRoot}/`) ? filePath.slice(bundleRoot.length + 1) : filePath

  // 先从所有组中移除该文件
  for (const group of next.groups) {
    group.paths = group.paths.filter((p) => {
      const pRel = p.startsWith(`${bundleRoot}/`) ? p.slice(bundleRoot.length + 1) : p
      return pRel !== relPath
    })
  }

  // Checkpoint categories are navigation groups, not node document requirements.
  if (targetGroupId) {
    let targetGroup = next.groups.find((g) => g.id === targetGroupId)
    if (!targetGroup) {
      const validated = bundle.checkpoints === undefined ? null : validateCheckpoints(bundle.checkpoints, bundle.root)
      const node = validated?.ok ? validated.value.nodes.find(({ id }) => `checkpoint-${id}` === targetGroupId) : undefined
      if (node) {
        targetGroup = { id: targetGroupId, title: node.title, paths: [] }
        next.groups.push(targetGroup)
      }
    }
    targetGroup?.paths.push(relPath)
  }

  return next
}

export function setNavigationEntry(
  manifest: NavigationManifest,
  filePath: string | undefined,
  bundleRoot: string,
): NavigationManifest {
  const next = structuredClone(manifest)
  if (!filePath) {
    delete next.entry
  } else {
    next.entry = filePath.startsWith(`${bundleRoot}/`) ? filePath.slice(bundleRoot.length + 1) : filePath
  }
  return next
}

export function renameFileInManifest(
  manifest: NavigationManifest,
  oldPath: string,
  newPath: string,
  bundleRoot: string,
): NavigationManifest {
  const next = structuredClone(manifest)
  const oldRel = oldPath.startsWith(`${bundleRoot}/`) ? oldPath.slice(bundleRoot.length + 1) : oldPath
  const newRel = newPath.startsWith(`${bundleRoot}/`) ? newPath.slice(bundleRoot.length + 1) : newPath

  for (const group of next.groups) {
    group.paths = group.paths.map((p) => {
      const pRel = p.startsWith(`${bundleRoot}/`) ? p.slice(bundleRoot.length + 1) : p
      return pRel === oldRel ? newRel : p
    })
  }

  if (next.entry) {
    const entryRel = next.entry.startsWith(`${bundleRoot}/`) ? next.entry.slice(bundleRoot.length + 1) : next.entry
    if (entryRel === oldRel) next.entry = newRel
  }

  return next
}

export function removeFileFromManifest(
  manifest: NavigationManifest,
  filePath: string,
  bundleRoot: string,
): NavigationManifest {
  const next = structuredClone(manifest)
  const rel = filePath.startsWith(`${bundleRoot}/`) ? filePath.slice(bundleRoot.length + 1) : filePath

  for (const group of next.groups) {
    group.paths = group.paths.filter((p) => {
      const pRel = p.startsWith(`${bundleRoot}/`) ? p.slice(bundleRoot.length + 1) : p
      return pRel !== rel
    })
  }

  if (next.entry) {
    const entryRel = next.entry.startsWith(`${bundleRoot}/`) ? next.entry.slice(bundleRoot.length + 1) : next.entry
    if (entryRel === rel) delete next.entry
  }

  return next
}
