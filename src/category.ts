import { fileByPath, relativePath, type TacoBundle, type TacoFile } from './model.ts'
import { frontmatterString, replaceFrontmatterProperty } from './frontmatter.ts'
import { parseDocument } from 'yaml'

export const UNCLASSIFIED_CATEGORY = '未分类'

/** The general classification property, in frontmatter or in a directory's `_dir.yaml`. */
export const CATEGORY_PROPERTY = 'category'

/**
 * 校验子目录层级：最多限定创建 2 级子目录
 * 例：
 *   specs/root/file.md -> 0 级（根目录文件）
 *   specs/root/docs/file.md -> 1 级子目录（允许）
 *   specs/root/docs/sub/file.md -> 2 级子目录（允许）
 *   specs/root/docs/sub/deep/file.md -> 3 级（超出限制，非法）
 */
export function validateDirectoryDepth(relPath: string): { valid: boolean; depth: number } {
  const parts = relPath.split('/').filter(Boolean)
  // parts 最后若是文件名，目录层级数为 parts.length - 1
  const depth = parts.length > 1 ? parts.length - 1 : 0
  return {
    valid: depth <= 2,
    depth,
  }
}

/**
 * 读取某目录下的 _dir.yaml 文件中定义的 category
 */
export function getDirYamlCategory(bundle: TacoBundle, dirRelPath: string): string | null {
  const cleanDir = dirRelPath.replace(/^\/+|\/+$/g, '')
  const dirYamlRel = cleanDir ? `${cleanDir}/_dir.yaml` : '_dir.yaml'
  const fullPath = `${bundle.root}/${dirYamlRel}`
  const dirFile = fileByPath(bundle, fullPath)
  if (!dirFile || !dirFile.content.trim()) return null

  try {
    const doc = parseDocument(dirFile.content)
    const val: unknown = doc.get(CATEGORY_PROPERTY)
    if (typeof val === 'string' && val.trim()) return val.trim()
  } catch {
    return null
  }
  return null
}

export interface FileCategoryResolution {
  category: string
  source: 'root-default' | 'root-file' | 'first-level-dir' | 'inherited-root'
  canEdit: boolean
  firstLevelDir: string | null
}

/**
 * 解析文件的所属 Category：
 * 1. 所有根目录默认在“未分类”category 下，子目录和文件继承父目录的 category，如果仍未定义则向上一层走，直到走到根目录（未分类）
 * 2. 根目录下，一级目录可通过 _dir.yaml 定义 category
 * 3. 所有根目录文件可自己定义 category（通过其 frontmatter 的 category 字段）
 * 4. 子目录和子目录下的文件则不能自定义 category（使用一级目录的，如果没有则继承根目录的未分类）
 * 5. 子目录最多限定创建 2 级
 */
export function resolveFileCategory(bundle: TacoBundle, file: TacoFile): FileCategoryResolution {
  const rel = relativePath(bundle, file)
  const parts = rel.split('/').filter(Boolean)

  // 1. 根目录下的文件 (parts.length === 1)
  if (parts.length === 1) {
    const selfCategory = frontmatterString(file.content, CATEGORY_PROPERTY)?.trim()
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

  // 2. 子目录文件 (parts.length >= 2)
  const firstLevelDir = parts[0]
  const dirCat = getDirYamlCategory(bundle, firstLevelDir)
  if (dirCat) {
    return {
      category: dirCat,
      source: 'first-level-dir',
      canEdit: false, // 子目录文件不能自定义 category，必须跟随一级目录
      firstLevelDir,
    }
  }

  // 没有定义则向上一层走，直到走到根目录（未分类）
  return {
    category: UNCLASSIFIED_CATEGORY,
    source: 'inherited-root',
    canEdit: false,
    firstLevelDir,
  }
}

/**
 * 修改某文件的所属 Category：
 * - 若为根目录文件：直接修改或设置该文件的 frontmatter category
 * - 若为一级目录下的文件：修改对应的 `<firstLevelDir>/_dir.yaml` 文件中的 category
 */
export function updateFileCategory(
  bundle: TacoBundle,
  file: TacoFile,
  newCategory: string,
): { modifiedFile: TacoFile; updatedBundle: TacoBundle } {
  const rel = relativePath(bundle, file)
  const parts = rel.split('/').filter(Boolean)
  const catTrimmed = newCategory.trim() || UNCLASSIFIED_CATEGORY

  if (parts.length === 1) {
    // 根目录文件自建 frontmatter
    const nextContent = replaceFrontmatterProperty(
      file.content,
      CATEGORY_PROPERTY,
      catTrimmed === UNCLASSIFIED_CATEGORY ? undefined : catTrimmed,
    )
    file.content = nextContent
    return { modifiedFile: file, updatedBundle: bundle }
  }

  // 一级目录或其子文件：写入或更新该一级目录下的 _dir.yaml
  const firstLevelDir = parts[0]
  const dirYamlPath = `${bundle.root}/${firstLevelDir}/_dir.yaml`
  let dirFile = fileByPath(bundle, dirYamlPath)

  if (!dirFile) {
    dirFile = {
      id: `file-dir-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path: dirYamlPath,
      mediaType: 'application/yaml',
      content: `category: "${catTrimmed}"\n`,
    }
    bundle.files.push(dirFile)
  } else {
    try {
      const doc = parseDocument(dirFile.content)
      doc.set(CATEGORY_PROPERTY, catTrimmed)
      dirFile.content = doc.toString()
    } catch {
      dirFile.content = `category: "${catTrimmed}"\n`
    }
  }

  return { modifiedFile: dirFile, updatedBundle: bundle }
}
