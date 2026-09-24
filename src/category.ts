import { fileByPath, isInternalFile, relativePath, type NavigationManifest, type TacoBundle, type TacoFile } from './model.ts'
import { frontmatterString, replaceFrontmatterProperty } from './frontmatter.ts'
import { checkpointMembership, validateCheckpoints } from '@taco/protocol'
import { createInitialManifest } from './navigation-editor.ts'
import { resolveDocumentNavigation } from './navigation.ts'
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
      const oldPath = file.path
      const newPath = safeRootPath(bundle, file.path)
      file.path = newPath
      file.content = replaceFrontmatterProperty(file.content, 'category', undefined)
      if (bundle.navigation) {
        updateNavigationPath(bundle.navigation, bundle.root, oldPath, newPath)
      }
    } else {
      file.content = replaceFrontmatterProperty(file.content, 'category', undefined)
    }
    return { modifiedFile: file, updatedBundle: bundle }
  }

  // 2. 目标是具体分类 (移至对应一级目录)
  const targetDir = findCategoryDir(bundle, catTrimmed) || slugifyCategoryDir(catTrimmed, bundle)
  const oldPath = file.path
  const newPath = safeDirPath(bundle, targetDir, file.path)
  file.path = newPath
  file.content = replaceFrontmatterProperty(file.content, 'category', undefined)

  if (bundle.navigation) {
    updateNavigationPath(bundle.navigation, bundle.root, oldPath, newPath)
  }

  return { modifiedFile: file, updatedBundle: bundle }
}

export interface CategorySource {
  type: 'first-level-dir'
  path: string
  targetDir: string
}

export interface CategoryDetail {
  name: string
  files: TacoFile[]
  sources: CategorySource[]
  isCheckpointOverridden: boolean
}

/**
 * 列出 Taco 文档中声明的所有 Category 详情
 */
export function listCategories(bundle: TacoBundle): CategoryDetail[] {
  const validated = bundle.checkpoints === undefined ? null : validateCheckpoints(bundle.checkpoints, bundle.root)
  const state = validated?.ok ? validated.value : null
  const checkpointMembers = state ? checkpointMembership(state) : new Map<string, unknown>()

  interface CategoryAccumulator {
    name: string
    files: Map<string, TacoFile>
    checkpointFilesCount: number
    isCheckpointLocked?: boolean
  }

  const categoryMap = new Map<string, CategoryAccumulator>()
  const getOrCreate = (name: string): CategoryAccumulator => {
    let item = categoryMap.get(name)
    if (!item) {
      item = {
        name,
        files: new Map(),
        checkpointFilesCount: 0,
      }
      categoryMap.set(name, item)
    }
    return item
  }

  // 1. 如果有 Checkpoint，将所有 Checkpoint 节点作为分类纳入列表（标注为锁定，在管理页可见但不能编辑）
  if (state) {
    for (const node of state.nodes) {
      const acc = getOrCreate(node.title)
      acc.isCheckpointLocked = true
      for (const doc of node.documents) {
        const file = fileByPath(bundle, doc.path)
        if (file && !isInternalFile(file.path)) {
          acc.files.set(file.path, file)
        }
      }
    }
  }

  // 2. 扫描当前导航中渲染的所有普通分组
  const resolved = resolveDocumentNavigation(bundle)
  for (const group of resolved.groups) {
    if (group.title && group.title !== UNCLASSIFIED_CATEGORY) {
      const acc = getOrCreate(group.title)
      for (const file of group.files) {
        if (!checkpointMembers.has(file.path) && !isInternalFile(file.path)) {
          acc.files.set(file.path, file)
        }
        if (checkpointMembers.has(file.path)) {
          acc.checkpointFilesCount += 1
        }
      }
    }
  }

  // 3. 统计被 Checkpoint 锁定的普通物理分类目录
  for (const file of bundle.files) {
    if (isInternalFile(file.path)) continue
    if (checkpointMembers.has(file.path)) {
      const ordinary = resolveOrdinaryPathCategory(bundle, file.path, file)
      if (ordinary.category !== UNCLASSIFIED_CATEGORY) {
        getOrCreate(ordinary.category).checkpointFilesCount += 1
      }
    }
  }

  const details: CategoryDetail[] = []
  for (const [, acc] of categoryMap) {
    const files = Array.from(acc.files.values()).sort((a, b) => a.path.localeCompare(b.path))
    const isCheckpointOverridden = Boolean(acc.isCheckpointLocked) || (files.length === 0 && acc.checkpointFilesCount > 0)
    details.push({
      name: acc.name,
      files,
      sources: [{ type: 'first-level-dir', path: `${bundle.root}/${acc.name}`, targetDir: acc.name }],
      isCheckpointOverridden,
    })
  }

  return details.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 重命名 Category：
 * 物理重命名对应的一级目录，更新文件路径；同步更新导航 manifest 分组
 */
export function renameCategory(
  bundle: TacoBundle,
  oldName: string,
  newName: string,
): { updatedBundle: TacoBundle; modifiedFiles: TacoFile[] } {
  const fromName = oldName?.trim()
  const toName = newName?.trim()
  if (!fromName || !toName) {
    throw new Error('Category name cannot be empty')
  }
  if (toName === UNCLASSIFIED_CATEGORY) {
    throw new Error(`Cannot rename category to ${UNCLASSIFIED_CATEGORY}`)
  }
  if (fromName === toName) {
    return { updatedBundle: bundle, modifiedFiles: [] }
  }
  const categories = listCategories(bundle)
  const target = categories.find((c) => c.name.toLowerCase() === fromName.toLowerCase())
  if (target?.isCheckpointOverridden) {
    throw new Error(`Cannot rename Checkpoint locked category: ${fromName}`)
  }


  // 保证 bundle.navigation 存在，使对初始派生出的 spec/plan/tasks 或一级目录分类重命名持久生效
  if (!bundle.navigation || !Array.isArray(bundle.navigation.groups)) {
    bundle.navigation = createInitialManifest(bundle)
  }

  const modifiedFiles: TacoFile[] = []
  const modifiedPaths = new Set<string>()

  // 1. 如果存在物理目录，物理重命名对应一级目录及文件路径
  const oldPrefix = `${bundle.root}/${fromName}/`
  const targetDir = slugifyCategoryDir(toName, bundle)
  const newPrefix = `${bundle.root}/${targetDir}/`

  for (const file of bundle.files) {
    if (file.path.startsWith(oldPrefix)) {
      const subPath = file.path.slice(oldPrefix.length)
      const nextPath = `${newPrefix}${subPath}`
      const previousPath = file.path
      file.path = nextPath

      if (bundle.navigation) {
        updateNavigationPath(bundle.navigation, bundle.root, previousPath, nextPath)
      }
      if (!modifiedPaths.has(file.path)) {
        modifiedPaths.add(file.path)
        modifiedFiles.push(file)
      }
    }
  }

  // 2. 导航状态同步更新分组
  for (const group of bundle.navigation.groups) {
    if (group.title === fromName || group.id === fromName || group.id === `category-${fromName}`) {
      group.title = toName
      group.id = `category-${toName}`
    }
  }

  return { updatedBundle: bundle, modifiedFiles }
}

/**
 * 删除 Category：
 * 将属于该目录的所有文档安全移回根目录（变为未分类），绝不删除文档本身；清理导航分组
 */
export function deleteCategory(
  bundle: TacoBundle,
  categoryName: string,
): { updatedBundle: TacoBundle; modifiedFiles: TacoFile[] } {
  const cat = categoryName?.trim()
  if (!cat || cat === UNCLASSIFIED_CATEGORY) {
    throw new Error('Invalid category name to delete')
  }

  const categories = listCategories(bundle)
  const target = categories.find((c) => c.name.toLowerCase() === cat.toLowerCase())
  if (target?.isCheckpointOverridden) {
    throw new Error(`Cannot delete Checkpoint locked category: ${cat}`)
  }

  // 保证 bundle.navigation 存在，使删除初始派生出的 spec/plan/tasks 或一级目录分类持久生效
  if (!bundle.navigation || !Array.isArray(bundle.navigation.groups)) {
    bundle.navigation = createInitialManifest(bundle)
  }

  const modifiedFiles: TacoFile[] = []
  const modifiedPaths = new Set<string>()

  const prefix = `${bundle.root}/${cat}/`
  const filesToMove = bundle.files.filter((f) => f.path.startsWith(prefix))

  for (const file of filesToMove) {
    if (isInternalFile(file.path)) {
      bundle.files = bundle.files.filter((f) => f !== file)
      continue
    }

    const oldPath = file.path
    const newPath = safeRootPath(bundle, file.path)
    file.path = newPath

    if (bundle.navigation) {
      updateNavigationPath(bundle.navigation, bundle.root, oldPath, newPath)
    }
    if (!modifiedPaths.has(file.path)) {
      modifiedPaths.add(file.path)
      modifiedFiles.push(file)
    }
  }

  // 导航状态清理
  bundle.navigation.groups = bundle.navigation.groups.filter(
    (group) => group.title !== cat && group.id !== cat && group.id !== `category-${cat}`,
  )

  return { updatedBundle: bundle, modifiedFiles }
}

/**
 * 添加新的 Category：
 * 在导航清单中注册该分类分组，零临时文件
 */
export function addCategory(
  bundle: TacoBundle,
  categoryName: string,
): { updatedBundle: TacoBundle } {
  const catTrimmed = categoryName?.trim()
  if (!catTrimmed || catTrimmed === UNCLASSIFIED_CATEGORY) {
    throw new Error('Invalid category name')
  }

  const existing = listCategories(bundle)
  if (existing.some((c) => c.name.toLowerCase() === catTrimmed.toLowerCase())) {
    throw new Error(`Category "${catTrimmed}" already exists`)
  }

  if (!bundle.navigation || !Array.isArray(bundle.navigation.groups)) {
    bundle.navigation = createInitialManifest(bundle)
  }

  const groupId = `category-${catTrimmed}`
  if (!bundle.navigation.groups.some((g) => g.id === groupId || g.title.toLowerCase() === catTrimmed.toLowerCase())) {
    bundle.navigation.groups.push({
      id: groupId,
      title: catTrimmed,
      paths: [],
    })
  }

  return { updatedBundle: bundle }
}
