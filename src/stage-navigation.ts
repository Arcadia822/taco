import { relativePath, type TacoBundle, type TacoFile } from './model.ts'
import { parseFrontmatter } from './frontmatter.ts'
import { resolveFileCategory, UNCLASSIFIED_CATEGORY } from './category.ts'

export type StageId = 'spec' | 'plan' | 'tasks'

/**
 * The three default stage groups are reached through the general `category`
 * property. These exact values route a Markdown file into a stage; every other
 * value stays a custom category and is never narrowed back to this set.
 */
export const STAGE_CATEGORIES = ['spec', 'plan', 'tasks'] as const satisfies readonly StageId[]

const stageCategories = new Set<string>(STAGE_CATEGORIES)
const legacyScopePrefix = '**Taco scope**:'

export interface StageDefinition {
  id: StageId
}

export interface StageGroup {
  definition: StageDefinition
  core?: TacoFile | null
  files: TacoFile[]
}

export interface StageNavigation {
  stages: StageGroup[]
  unassigned: TacoFile[]
}

export const STAGES: readonly StageDefinition[] = [
  { id: 'spec' },
  { id: 'plan' },
  { id: 'tasks' },
]

const conventionStage = (path: string): StageId | null => {
  if (path.toLowerCase() === 'readme.md' || path === 'spec.md') return 'spec'
  if (path === 'plan.md') return 'plan'
  if (path === 'tasks.md') return 'tasks'
  if (path.startsWith('checklists/')) return 'plan'
  if (path === 'research.md' || path === 'data-model.md' || path === 'quickstart.md' || path.startsWith('contracts/')) return 'plan'
  if (/\.html?$/i.test(path)) return 'spec'
  return null
}

/**
 * Legacy routing, readable only for bundles written before `category` existed:
 * a `taco_scope` frontmatter key, or a leading `**Taco scope**:` line.
 */
export const legacyStageScope = (file: TacoFile): StageId | null => {
  if (!file.path.toLowerCase().endsWith('.md')) return null
  const frontmatter = parseFrontmatter(file.content)
  if (frontmatter.kind === 'invalid') return null
  let legacySource = file.content
  if (frontmatter.kind === 'valid') {
    const scope = frontmatter.entries.find((entry) => entry.key === 'taco_scope')
    if (scope) return scope.kind === 'string' && stageCategories.has(String(scope.value))
      ? scope.value as StageId
      : null
    legacySource = frontmatter.block.body
  }
  for (const line of legacySource.split('\n')) {
    const declaration = line.trim()
    if (!declaration) continue
    if (declaration.startsWith(legacyScopePrefix)) {
      const value = declaration.slice(legacyScopePrefix.length).trim()
      return stageCategories.has(value) ? value as StageId : null
    }
    if (declaration.startsWith('**') && declaration.includes('**:')) continue
    return null
  }
  return null
}

/**
 * The stage a file routes to. The general `category` property decides — a root
 * file's own frontmatter, or the first-level directory's `_dir.yaml` — and the
 * deprecated `taco_scope` applies only while no category is declared, so a
 * declared category is never overridden by a legacy value.
 *
 * Convention paths (`spec.md`, `checklists/…`) are resolved by the caller first.
 */
export const stageCategory = (bundle: TacoBundle, file: TacoFile): StageId | null => {
  if (!file.path.toLowerCase().endsWith('.md')) return null
  const category = resolveFileCategory(bundle, file).category
  if (category !== UNCLASSIFIED_CATEGORY) return stageCategories.has(category) ? category as StageId : null
  return legacyStageScope(file)
}

export const buildStageNavigation = (bundle: TacoBundle): StageNavigation => {
  const conventions = new Map<StageId, TacoFile[]>(STAGES.map(({ id }) => [id, []]))
  const categorized = new Map<StageId, TacoFile[]>(STAGES.map(({ id }) => [id, []]))
  const unassigned: TacoFile[] = []

  for (const file of bundle.files) {
    const path = relativePath(bundle, file)
    const convention = conventionStage(path)
    if (convention) {
      conventions.get(convention)!.push(file)
      continue
    }

    const stage = stageCategory(bundle, file)
    if (stage) categorized.get(stage)!.push(file)
    else unassigned.push(file)
  }

  const stages = STAGES.map((definition) => ({
    definition,
    core: null,
    files: [...conventions.get(definition.id)!, ...categorized.get(definition.id)!],
  }))
  return { stages, unassigned }
}
