import { describe, expect, it } from 'vitest'
import { buildStageNavigation, tacoScope, TACO_SCOPES } from '../src/stage-navigation.ts'
import type { TacoBundle, TacoFile } from '../src/model.ts'

const file = (path: string, content = `# ${path}`): TacoFile => ({
  path: `specs/001-stage/${path}`,
  mediaType: 'text/markdown',
  content,
})

const bundle = (): TacoBundle => ({
  format: 'taco/files',
  version: 1,
  docId: 'stage-test',
  title: 'Stage test',
  root: 'specs/001-stage',
  files: [
    file('README.md', '# Guide'),
    file('spec.md'),
    { path: 'specs/001-stage/prototypes/checkout.html', mediaType: 'text/html', content: '<!doctype html><title>Checkout</title>' },
    file('checklists/requirements.md'),
    file('interaction-design.md', '**Taco scope**: plan\n\n# Interaction'),
    file('plan.md'),
    file('contracts/api.md'),
    file('tasks.md'),
    file('checklists/implementation.md', '# Audit\n\n**Taco scope**: tasks'),
    file('notes.md'),
  ],
})

describe('stage navigation', () => {
  it('recognizes only the three exact Taco scope enum values', () => {
    expect(TACO_SCOPES).toEqual(['spec', 'plan', 'tasks'])
    expect(tacoScope(file('visual-system.md', '**Taco scope**: plan\n'))).toBe('plan')
    expect(tacoScope(file('visual-system.md', '**Taco scope**: extends `plan.md`\n'))).toBeNull()
    expect(tacoScope(file('visual-system.md', '**Taco scope**: design\n'))).toBeNull()
    expect(tacoScope(file('visual-system.md', '# Visual system\n\n**Taco scope**: plan\n'))).toBeNull()
    expect(tacoScope(file('visual-system.md'))).toBeNull()
  })

  it('places every assigned file directly in one of the three stages', () => {
    const navigation = buildStageNavigation(bundle())
    expect(navigation.stages.map((stage) => stage.core?.path.split('/').at(-1))).toEqual(['spec.md', 'plan.md', 'tasks.md'])
    expect(navigation.stages[0].files.map((item) => item.path)).toEqual([
      'specs/001-stage/README.md',
      'specs/001-stage/prototypes/checkout.html',
    ])
    expect(navigation.stages[1].files.map((item) => item.path)).toEqual(expect.arrayContaining([
      'specs/001-stage/checklists/requirements.md',
      'specs/001-stage/checklists/implementation.md',
      'specs/001-stage/contracts/api.md',
      'specs/001-stage/interaction-design.md',
    ]))
    expect(navigation.stages[2].files).toHaveLength(0)
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
