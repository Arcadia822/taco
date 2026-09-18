import { fileByPath, type TacoBundle, type TacoFile } from './model.ts'
import { buildStageNavigation, type StageGroup } from './stage-navigation.ts'
import { resolveFileCategory, UNCLASSIFIED_CATEGORY } from './category.ts'

export interface ResolvedCustomGroup {
  id: string
  title: string
  files: TacoFile[]
  isCustom: true
}

export interface ResolvedStageGroup {
  id: string
  title: string
  stage: StageGroup
  isCustom: false
}

export type ResolvedGroup = ResolvedCustomGroup | ResolvedStageGroup

export interface ResolvedDocumentNavigation {
  mode: 'custom' | 'stage'
  groups: ResolvedGroup[]
  unassigned: TacoFile[]
}

export function resolveDocumentNavigation(bundle: TacoBundle): ResolvedDocumentNavigation {
  const manifest = bundle.navigation

  // 1. 如果有显式 navigation 声明，按声明组织
  if (manifest && manifest.version === 1 && Array.isArray(manifest.groups)) {
    const assignedPaths = new Set<string>()
    const groups: ResolvedCustomGroup[] = []

    for (const group of manifest.groups) {
      const files: TacoFile[] = []
      for (const path of group.paths) {
        const resolvedPath = path.startsWith(`${bundle.root}/`) ? path : `${bundle.root}/${path}`
        const file = fileByPath(bundle, resolvedPath) ?? fileByPath(bundle, path)
        if (file && !assignedPaths.has(file.path)) {
          assignedPaths.add(file.path)
          files.push(file)
        }
      }
      groups.push({
        id: group.id,
        title: group.title,
        files,
        isCustom: true,
      })
    }

    const unassigned = bundle.files.filter((file) => !assignedPaths.has(file.path))
    return {
      mode: 'custom',
      groups,
      unassigned,
    }
  }

  // 2. 检查是否有文件或一级目录显式声明了非 stage 的通用自定义 category
  // 注意：若声明的值本身就是 Spec Kit 阶段关键字 ('spec', 'plan', 'tasks')，
  // 则优先保持原生的 stage 导航体系，避免将规范阶段割裂降级为未分类目录
  const hasCategoryDeclaration = bundle.files.some((file) => {
    const res = resolveFileCategory(bundle, file)
    return (
      res.category !== UNCLASSIFIED_CATEGORY &&
      res.category !== 'spec' &&
      res.category !== 'plan' &&
      res.category !== 'tasks'
    )
  })
  if (hasCategoryDeclaration) {
    const categoryMap = new Map<string, TacoFile[]>()
    const unassigned: TacoFile[] = []

    for (const file of bundle.files) {
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

    const groups: ResolvedCustomGroup[] = Array.from(categoryMap.entries()).map(([catName, files]) => ({
      id: `category-${catName}`,
      title: catName,
      files,
      isCustom: true,
    }))

    return {
      mode: 'custom',
      groups,
      unassigned,
    }
  }

  // 3. 既没有 navigation 也无任何自定义 category，保持原先 Spec Kit 三阶段派生逻辑
  const structure = buildStageNavigation(bundle)
  const groups: ResolvedStageGroup[] = structure.stages.map((stage) => ({
    id: stage.definition.id,
    title: stage.definition.id,
    stage,
    isCustom: false,
  }))

  return {
    mode: 'stage',
    groups,
    unassigned: structure.unassigned,
  }
}
