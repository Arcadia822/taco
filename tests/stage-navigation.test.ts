import { describe, expect, it } from 'vitest'
import { buildStageNavigation, STAGES } from '../src/stage-navigation.ts'
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
  file('plan.md'),
  file('contracts/api.md'),
  file('tasks.md'),
  file('checklists/implementation.md', '# Audit'),
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
  it('derives stages from the three core filenames and the Spec Kit convention paths', () => {
    const navigation = buildStageNavigation(bundle())

    expect(STAGES.map(({ id }) => id)).toEqual(['spec', 'plan', 'tasks'])
    expect(navigation.stages[0].files.map((item) => item.path)).toEqual([
      'specs/001-stage/README.md',
      'specs/001-stage/spec.md',
      'specs/001-stage/prototypes/checkout.html',
    ])
    expect(navigation.stages[1].files.map((item) => item.path)).toEqual(expect.arrayContaining([
      'specs/001-stage/checklists/requirements.md',
      'specs/001-stage/checklists/implementation.md',
      'specs/001-stage/plan.md',
      'specs/001-stage/contracts/api.md',
    ]))
    expect(navigation.stages[2].files.map((item) => item.path)).toEqual(['specs/001-stage/tasks.md'])
    expect(navigation.unassigned.map((item) => item.path)).toEqual(['specs/001-stage/notes.md'])
  })

  it('keeps all default stages without requiring a core file', () => {
    const navigation = buildStageNavigation({ ...bundle(), files: [file('README.md', '# Guide')] })

    expect(navigation.stages.map(({ definition }) => definition.id)).toEqual(['spec', 'plan', 'tasks'])
    expect(navigation.stages[0].files.map(({ path }) => path)).toEqual(['specs/001-stage/README.md'])
  })

  it('leaves every other document unassigned, whatever its frontmatter declares', () => {
    const documents = [
      ['plan-draft.md', '---\ntaco_scope: plan\n---\n## Draft'],
      ['plan-draft.md', '**Taco scope**: tasks'],
      ['plan-draft.md', '---\ncategory: plan\n---\n## Draft'],
      ['plan-draft.md', '---\ntitle: Plan\n---\n## Draft'],
      ['notes.md', '---\ntaco_scope: tasks\n---\n## Notes'],
    ] as const

    for (const [path, content] of documents) {
      const navigation = buildStageNavigation(bundle([file(path, content)]))
      expect(navigation.stages.every((stage) => stage.files.length === 0), content).toBe(true)
      expect(navigation.unassigned.map((item) => item.path), content).toEqual([`specs/001-stage/${path}`])
    }
  })
})
