import type { TacoBundle, TacoFile } from './model.ts'
import { checkpointMembership, validateCheckpoints } from '@taco/protocol'

export const UNCLASSIFIED_CATEGORY = '未分类'

export interface FileCategoryResolution {
  category: string
  source: 'checkpoint' | 'manifest' | 'root-default' | 'first-level-dir'
  canEdit: boolean
  firstLevelDir: string | null
  checkpointId?: string
  overridden?: string
}

/**
 * 解析文件的所属 Category（纯读取，绝不修改 bundle 的任何状态）：
 * Checkpoint 归属最高优先，其次是显式 navigation manifest 分组；
 * 其余文件按一级目录推导，根目录文件归入未分类；文档内容不决定分类。
 */
export function resolveFileCategory(bundle: TacoBundle, file: TacoFile): FileCategoryResolution {
  return resolveCategory(bundle, file.path)
}

/** Resolve a path even when its Checkpoint document has not yet been created. */
export function resolvePathCategory(bundle: TacoBundle, path: string): FileCategoryResolution {
  return resolveCategory(bundle, path)
}

function resolveCategory(bundle: TacoBundle, path: string): FileCategoryResolution {
  const original = resolveOrdinaryPathCategory(bundle, path)

  if (bundle.checkpoints !== undefined) {
    const validated = validateCheckpoints(bundle.checkpoints, bundle.root)
    if (validated.ok) {
      const member = checkpointMembership(validated.value).get(path)
      if (member) {
        const node = validated.value.nodes.find(({ id }) => id === member.nodeId)!
        const overridden = original.source === 'first-level-dir' ? original.category : undefined
        return {
          category: node.title,
          source: 'checkpoint',
          canEdit: false,
          firstLevelDir: original.firstLevelDir,
          checkpointId: node.id,
          ...(overridden !== undefined && overridden !== node.title ? { overridden } : {}),
        }
      }
    }
  }

  const assigned = resolveManifestCategory(bundle, path)
  if (assigned !== null) {
    return {
      category: assigned,
      source: 'manifest',
      canEdit: true,
      firstLevelDir: original.firstLevelDir,
    }
  }

  return original
}

function resolveOrdinaryPathCategory(bundle: TacoBundle, path: string): FileCategoryResolution {
  const rel = path.slice(bundle.root.length + 1)
  const parts = rel.split('/').filter(Boolean)

  // 根目录文件没有隐式分类；只有导航清单可以显式分配。
  if (parts.length === 1) {
    return {
      category: UNCLASSIFIED_CATEGORY,
      source: 'root-default',
      canEdit: true,
      firstLevelDir: null,
    }
  }

  // 子目录文件：一级目录即分类名，没有任何约定路径特例
  const firstLevelDir = parts[0]
  return {
    category: firstLevelDir,
    source: 'first-level-dir',
    canEdit: true,
    firstLevelDir,
  }
}

/** 显式 manifest 归属：路径命中任一分组的 paths 时返回该分组标题；没有有效 manifest 时返回 null。 */
function resolveManifestCategory(bundle: TacoBundle, path: string): string | null {
  const manifest = bundle.navigation
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.groups)) return null
  const rel = path.startsWith(`${bundle.root}/`) ? path.slice(bundle.root.length + 1) : path
  for (const group of manifest.groups) {
    if (group.paths.some((candidate) => candidate === rel || candidate === path || `${bundle.root}/${candidate}` === path)) {
      return group.title
    }
  }
  return null
}
