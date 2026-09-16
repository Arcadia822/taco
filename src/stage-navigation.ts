import { relativePath, type TacoBundle, type TacoFile } from './model.ts'
import { parseFrontmatter } from './frontmatter.ts'

export type StageId = 'spec' | 'plan' | 'tasks'

export const TACO_SCOPES = ['spec', 'plan', 'tasks'] as const satisfies readonly StageId[]

const tacoScopeValues = new Set<string>(TACO_SCOPES)
const tacoScopePrefix = '**Taco scope**:'

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

export const tacoScope = (file: TacoFile): StageId | null => {
  if (!file.path.toLowerCase().endsWith('.md')) return null
  const frontmatter = parseFrontmatter(file.content)
  if (frontmatter.kind === 'invalid') return null
  let legacySource = file.content
  if (frontmatter.kind === 'valid') {
    const scope = frontmatter.entries.find((entry) => entry.key === 'taco_scope')
    if (scope) return scope.kind === 'string' && tacoScopeValues.has(String(scope.value))
      ? scope.value as StageId
      : null
    legacySource = frontmatter.block.body
  }
  for (const line of legacySource.split('\n')) {
    const declaration = line.trim()
    if (!declaration) continue
    if (declaration.startsWith(tacoScopePrefix)) {
      const value = declaration.slice(tacoScopePrefix.length).trim()
      return tacoScopeValues.has(value) ? value as StageId : null
    }
    if (declaration.startsWith('**') && declaration.includes('**:')) continue
    return null
  }
  return null
}

export const buildStageNavigation = (bundle: TacoBundle): StageNavigation => {
  const conventions = new Map<StageId, TacoFile[]>(STAGES.map(({ id }) => [id, []]))
  const scoped = new Map<StageId, TacoFile[]>(STAGES.map(({ id }) => [id, []]))
  const unassigned: TacoFile[] = []

  for (const file of bundle.files) {
    const path = relativePath(bundle, file)
    const convention = conventionStage(path)
    if (convention) {
      conventions.get(convention)!.push(file)
      continue
    }

    const scope = tacoScope(file)
    if (scope) scoped.get(scope)!.push(file)
    else unassigned.push(file)
  }

  const stages = STAGES.map((definition) => ({
    definition,
    core: null,
    files: [...conventions.get(definition.id)!, ...scoped.get(definition.id)!],
  }))
  return { stages, unassigned }
}
