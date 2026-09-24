import { fileByPath, isInternalFile, relativePath, type NavigationManifest, type TacoBundle, type TacoFile } from './model.ts'
import { relocateLocalFileReference } from './local-file-url.ts'
import { frontmatterString, replaceFrontmatterProperty } from './frontmatter.ts'
import { checkpointMembership, validateCheckpoints } from '@taco/protocol'
import { conventionStage } from './stage-navigation.ts'

export const UNCLASSIFIED_CATEGORY = '未分类'

/**
 * 校验子目录层级：最多限定创建 2 级子目录
 */
export function validateDirectoryDepth(relPath: string): { valid: boolean; depth: number } {
  const parts = relPath.split('/').filter(Boolean)
  const depth = parts.length > 1 ? parts.length - 1 : 0
  return {
    valid: depth <= 2,
    depth,
  }
}

export interface FileCategoryResolution {
  category: string
  source: 'checkpoint' | 'root-default' | 'root-file' | 'first-level-dir'
  canEdit: boolean
  firstLevelDir: string | null
  checkpointId?: string
  overridden?: string
}

/**
 * 解析文件的所属 Category：
 * Category 直接与一级目录对齐（一级目录即 Category，根目录即未分类）。
 */
export function resolveFileCategory(bundle: TacoBundle, file: TacoFile): FileCategoryResolution {
  return resolveCategory(bundle, file.path, file)
}

/** Resolve a path even when its Checkpoint document has not yet been created. */
export function resolvePathCategory(bundle: TacoBundle, path: string): FileCategoryResolution {
  return resolveCategory(bundle, path, fileByPath(bundle, path))
}

function resolveCategory(bundle: TacoBundle, path: string, file: TacoFile | null): FileCategoryResolution {
  const original = resolveOrdinaryPathCategory(bundle, path, file)
  if (bundle.checkpoints === undefined) return original
  const validated = validateCheckpoints(bundle.checkpoints, bundle.root)
  if (!validated.ok) return original
  const member = checkpointMembership(validated.value).get(path)
  if (!member) return original
  const node = validated.value.nodes.find(({ id }) => id === member.nodeId)!
  const overridden = (original.source === 'first-level-dir' || original.source === 'root-file') ? original.category : undefined
  return {
    category: node.title,
    source: 'checkpoint',
    canEdit: false,
    firstLevelDir: original.firstLevelDir,
    checkpointId: node.id,
    ...(overridden !== undefined && overridden !== node.title ? { overridden } : {}),
  }
}

function resolveOrdinaryPathCategory(bundle: TacoBundle, path: string, file: TacoFile | null): FileCategoryResolution {
  const rel = path.slice(bundle.root.length + 1)
  const parts = rel.split('/').filter(Boolean)

  // 1. 根目录下的文件 (parts.length === 1)
  if (parts.length === 1) {
    const selfCategory = file ? frontmatterString(file.content, 'category')?.trim() : undefined
    if (selfCategory) {
      return {
        category: selfCategory,
        source: 'root-file',
        canEdit: true,
        firstLevelDir: null,
      }
    }
    return {
      category: UNCLASSIFIED_CATEGORY,
      source: 'root-default',
      canEdit: true,
      firstLevelDir: null,
    }
  }

  // 2. 子目录文件 (parts.length >= 2):
  // 若属于内置阶段路径，按阶段处理；否则一级目录直接即分类名！
  if (conventionStage(rel) !== null) {
    return {
      category: UNCLASSIFIED_CATEGORY,
      source: 'first-level-dir',
      canEdit: true,
      firstLevelDir: parts[0],
    }
  }

  const firstLevelDir = parts[0]
  return {
    category: firstLevelDir,
    source: 'first-level-dir',
    canEdit: true,
    firstLevelDir,
  }
}

export function slugifyCategoryDir(name: string, bundle: TacoBundle): string {
  let clean = name.trim().replace(/[/\\:*?"<>|]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'category'
  let dir = clean
  let counter = 1
  while (bundle.files.some((f) => {
    if (isInternalFile(f.path)) return false
    const rel = relativePath(bundle, f)
    const parts = rel.split('/').filter(Boolean)
    return parts.length >= 2 && parts[0] === dir && parts[0].toLowerCase() !== name.toLowerCase()
  })) {
    dir = `${clean}-${counter++}`
  }
  return dir
}

export function findCategoryDir(bundle: TacoBundle, categoryName: string): string | null {
  for (const f of bundle.files) {
    if (isInternalFile(f.path)) continue
    const rel = relativePath(bundle, f)
    const parts = rel.split('/').filter(Boolean)
    if (parts.length >= 2) {
      const dir = parts[0]
      if (dir.toLowerCase() === categoryName.toLowerCase()) {
        return dir
      }
    }
  }
  return null
}

function safeRootPath(bundle: TacoBundle, currentFilePath: string): string {
  const base = currentFilePath.split('/').pop() || 'document.md'
  const target = `${bundle.root}/${base}`
  if (!bundle.files.some((f) => f.path === target && f.path !== currentFilePath)) {
    return target
  }
  const dot = base.lastIndexOf('.')
  const name = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  let counter = 1
  let candidate = `${bundle.root}/${name}-${counter}${ext}`
  while (bundle.files.some((f) => f.path === candidate && f.path !== currentFilePath)) {
    counter += 1
    candidate = `${bundle.root}/${name}-${counter}${ext}`
  }
  return candidate
}

function safeDirPath(bundle: TacoBundle, targetDir: string, currentFilePath: string): string {
  const base = currentFilePath.split('/').pop() || 'document.md'
  const target = `${bundle.root}/${targetDir}/${base}`
  if (!bundle.files.some((f) => f.path === target && f.path !== currentFilePath)) {
    return target
  }
  const dot = base.lastIndexOf('.')
  const name = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  let counter = 1
  let candidate = `${bundle.root}/${targetDir}/${name}-${counter}${ext}`
  while (bundle.files.some((f) => f.path === candidate && f.path !== currentFilePath)) {
    counter += 1
    candidate = `${bundle.root}/${targetDir}/${name}-${counter}${ext}`
  }
  return candidate
}

function updateNavigationPath(navigation: NavigationManifest, root: string, oldPath: string, newPath: string): void {
  const oldRel = oldPath.slice(root.length + 1)
  const newRel = newPath.slice(root.length + 1)
  if (Array.isArray(navigation.groups)) {
    for (const group of navigation.groups) {
      group.paths = group.paths.map((p) => (p === oldRel ? newRel : p))
    }
  }
  if (navigation.entry === oldRel) {
    navigation.entry = newRel
  }
}

function relocateFile(bundle: TacoBundle, file: TacoFile, newPath: string): void {
  const oldPath = file.path
  if (oldPath === newPath) return
  const sourceUrl = file.sourceUrl === undefined
    ? undefined
    : relocateLocalFileReference(file.sourceUrl, oldPath, newPath)
  file.path = newPath
  if (sourceUrl !== undefined) file.sourceUrl = sourceUrl
  for (const thread of bundle.comments ?? []) {
    if (thread.anchor.path === oldPath) thread.anchor.path = newPath
  }
  if (bundle.navigation) updateNavigationPath(bundle.navigation, bundle.root, oldPath, newPath)
}

/**
 * 修改某文件的所属 Category：
 * Category 直接与 Folder 对齐，修改分类将文件物理移动到对应目录下，或移回根目录（未分类）
 */
export function updateFileCategory(
  bundle: TacoBundle,
  file: TacoFile,
  newCategory: string,
): { modifiedFile: TacoFile; updatedBundle: TacoBundle } {
  if (resolveFileCategory(bundle, file).source === 'checkpoint') {
    throw new Error(`Cannot change category of Checkpoint document: ${file.path}`)
  }
  const rel = relativePath(bundle, file)
  const parts = rel.split('/').filter(Boolean)
  const catTrimmed = newCategory?.trim() || UNCLASSIFIED_CATEGORY
  const currentCategory = resolveFileCategory(bundle, file).category

  if (currentCategory === catTrimmed) {
    return { modifiedFile: file, updatedBundle: bundle }
  }

  // 1. 若目标是未分类 (移至根目录)
  if (catTrimmed === UNCLASSIFIED_CATEGORY) {
    if (parts.length > 1) {
      const newPath = safeRootPath(bundle, file.path)
      relocateFile(bundle, file, newPath)
      file.content = replaceFrontmatterProperty(file.content, 'category', undefined)
    } else {
      file.content = replaceFrontmatterProperty(file.content, 'category', undefined)
    }
    return { modifiedFile: file, updatedBundle: bundle }
  }

  // 2. 目标是具体分类 (移至对应一级目录)
  const targetDir = findCategoryDir(bundle, catTrimmed) || slugifyCategoryDir(catTrimmed, bundle)
  const newPath = safeDirPath(bundle, targetDir, file.path)
  relocateFile(bundle, file, newPath)
  file.content = replaceFrontmatterProperty(file.content, 'category', undefined)


  return { modifiedFile: file, updatedBundle: bundle }
}

