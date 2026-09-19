import { describe, expect, it } from 'vitest'
import { buildStageNavigation, legacyStageScope, stageCategory, STAGE_CATEGORIES } from '../src/stage-navigation.ts'
import type { TacoBundle, TacoFile } from '../src/model.ts'

const file = (path: string, content = `# ${path}`): TacoFile => ({
  path: `specs/001-stage/${path}`,
  mediaType: 'text/markdown',
  content,
})

const bundle = (files: TacoFile[] = [
  file('README.md', '# Guide'),
  file('spec.md'),
  { path: 'specs/001-stage/prototypes/checkout.html', mediaType: 'text/html', content: '<!doctype html><title>Checkout</title>' },
  file('checklists/requirements.md'),
  file('interaction-design.md', '---\ncategory: plan\n---\n## Interaction'),
  file('plan.md'),
  file('contracts/api.md'),
  file('tasks.md'),
  file('checklists/implementation.md', '# Audit\n\n**Taco scope**: tasks'),
  file('notes.md'),
]): TacoBundle => ({
  format: 'taco/files',
  version: 1,
  docId: 'stage-test',
  title: 'Stage test',
  root: 'specs/001-stage',
  files,
})

describe('stage navigation', () => {
  it('routes only the three reserved category values into stages', () => {
    const host = bundle()
    expect(STAGE_CATEGORIES).toEqual(['spec', 'plan', 'tasks'])
    expect(stageCategory(host, file('visual-system.md', '---\ncategory: plan\n---\n'))).toBe('plan')
    expect(stageCategory(host, file('visual-system.md', '---\ncategory: design\n---\n'))).toBeNull()
    expect(stageCategory(host, file('visual-system.md', '---\ncategory: [plan]\n---\n'))).toBeNull()
    expect(stageCategory(host, file('visual-system.md', '---\ncategory: Plan\n---\n'))).toBeNull()
    expect(stageCategory(host, file('visual-system.md'))).toBeNull()
    expect(stageCategory(host, file('diagram.mmd', '---\ncategory: plan\n---\n'))).toBeNull()
  })

  it('keeps the deprecated taco_scope readable while no category is declared', () => {
    const host = bundle()
    expect(stageCategory(host, file('visual-system.md', '---\ntaco_scope: plan\n---\n'))).toBe('plan')
    expect(stageCategory(host, file('visual-system.md', '---\ntitle: Plan\n---\n\n**Taco scope**: tasks'))).toBe('tasks')
    expect(stageCategory(host, file('visual-system.md', '**Taco scope**: plan\n'))).toBe('plan')
    expect(legacyStageScope(file('visual-system.md', '---\ntaco_scope: design\n---\n'))).toBeNull()
    expect(stageCategory(host, file('visual-system.md', '---\ntaco_scope: [plan]\n---\n'))).toBeNull()
    expect(stageCategory(host, file('visual-system.md', '**Taco scope**: extends `plan.md`\n'))).toBeNull()
    expect(stageCategory(host, file('visual-system.md', '**Taco scope**: design\n'))).toBeNull()
    expect(stageCategory(host, file('visual-system.md', '# Visual system\n\n**Taco scope**: plan\n'))).toBeNull()
  })

  it('never lets the legacy scope override a declared category', () => {
    const host = bundle()
    expect(stageCategory(host, file('notes.md', '---\ncategory: spec\ntaco_scope: plan\n---\n'))).toBe('spec')
    expect(stageCategory(host, file('notes.md', '---\ncategory: Guides\ntaco_scope: plan\n---\n'))).toBeNull()
    expect(stageCategory(host, file('notes.md', '---\ncategory: spec\n---\n\n**Taco scope**: tasks'))).toBe('spec')
  })

  it('routes a first-level directory category into its stage', () => {
    const host = bundle([
      file('docs/_dir.yaml', 'category: plan\n'),
      file('docs/decisions.md'),
    ])
    expect(stageCategory(host, host.files[1])).toBe('plan')
  })

  it('places every assigned file directly in one of the three stages', () => {
    const navigation = buildStageNavigation(bundle())
    expect(navigation.stages[0].files.map((item) => item.path)).toEqual(expect.arrayContaining([
      'specs/001-stage/spec.md',
      'specs/001-stage/README.md',
      'specs/001-stage/prototypes/checkout.html',
    ]))
    expect(navigation.stages[1].files.map((item) => item.path)).toEqual(expect.arrayContaining([
      'specs/001-stage/plan.md',
      'specs/001-stage/checklists/requirements.md',
      'specs/001-stage/checklists/implementation.md',
      'specs/001-stage/contracts/api.md',
      'specs/001-stage/interaction-design.md',
    ]))
    expect(navigation.stages[2].files.map((item) => item.path)).toEqual(['specs/001-stage/tasks.md'])
    expect(navigation.unassigned.map((item) => item.path)).toEqual(['specs/001-stage/notes.md'])
  })

  it('keeps all default stages and routes enum values without requiring a core file', () => {
    const navigation = buildStageNavigation({
      ...bundle(),
      files: [file('README.md', '# Guide')],
    })

    expect(navigation.stages.map(({ definition }) => definition.id)).toEqual(['spec', 'plan', 'tasks'])
    expect(navigation.stages[0].files.map(({ path }) => path)).toEqual(['specs/001-stage/README.md'])
  })
})
