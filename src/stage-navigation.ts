import { relativePath, type TacoBundle, type TacoFile } from './model.ts'

export type StageId = 'spec' | 'plan' | 'tasks'

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

/**
 * Stage placement is derived from the file tree alone: the three core filenames and the known
 * Spec Kit convention paths. Every other document stays Unassigned until a reviewer groups it,
 * which is what Taco's built-in Category control does — it records the grouping in the bundle's
 * navigation manifest. No document frontmatter property takes part in routing, and the deprecated
 * Spec-specific scope keys are not read at all.
 */
const conventionStage = (path: string): StageId | null => {
  if (path.toLowerCase() === 'readme.md' || path === 'spec.md') return 'spec'
  if (path === 'plan.md') return 'plan'
  if (path === 'tasks.md') return 'tasks'
  if (path.startsWith('checklists/')) return 'plan'
  if (path === 'research.md' || path === 'data-model.md' || path === 'quickstart.md' || path.startsWith('contracts/')) return 'plan'
  if (/\.html?$/i.test(path)) return 'spec'
  return null
}

export const buildStageNavigation = (bundle: TacoBundle): StageNavigation => {
  const conventions = new Map<StageId, TacoFile[]>(STAGES.map(({ id }) => [id, []]))
  const unassigned: TacoFile[] = []

  for (const file of bundle.files) {
    const stage = conventionStage(relativePath(bundle, file))
    if (stage) conventions.get(stage)!.push(file)
    else unassigned.push(file)
  }

  const stages = STAGES.map((definition) => ({
    definition,
    core: null,
    files: conventions.get(definition.id)!,
  }))
  return { stages, unassigned }
}
