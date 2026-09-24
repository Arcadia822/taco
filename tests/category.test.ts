import { describe, expect, it } from 'vitest'
import { FORMAT, parseBundle, type TacoBundle } from '../src/model.ts'
import {
  resolveFileCategory,
  resolvePathCategory,
  UNCLASSIFIED_CATEGORY,
  updateFileCategory,
  validateDirectoryDepth,
} from '../src/category.ts'

const createBundle = (files: Array<{ path: string; content?: string }>): TacoBundle => ({
  format: FORMAT,
  version: 1,
  docId: 'doc-test',
  title: 'Test',
  root: 'specs/sample',
  files: files.map((f) => ({
    id: f.path,
    path: f.path,
    mediaType: f.path.endsWith('.yaml') ? 'application/yaml' : 'text/markdown',
    content: f.content ?? '# test',
  })),
})

describe('Category resolution and directory constraints', () => {
  it('enforces directory depth limit of at most 2 levels', () => {
    expect(validateDirectoryDepth('file.md')).toEqual({ valid: true, depth: 0 })
    expect(validateDirectoryDepth('docs/file.md')).toEqual({ valid: true, depth: 1 })
    expect(validateDirectoryDepth('docs/api/file.md')).toEqual({ valid: true, depth: 2 })
    expect(validateDirectoryDepth('docs/api/v1/file.md')).toEqual({ valid: false, depth: 3 })
  })

  it('root files default to 未分类', () => {
    const bundle = createBundle([
      { path: 'specs/sample/README.md', content: '# Hello' },
      { path: 'specs/sample/spec.md', content: '# Spec' },
    ])

    const res1 = resolveFileCategory(bundle, bundle.files[0])
    expect(res1.category).toBe(UNCLASSIFIED_CATEGORY)
    expect(res1.canEdit).toBe(true)

    const res2 = resolveFileCategory(bundle, bundle.files[1])
    expect(res2.category).toBe(UNCLASSIFIED_CATEGORY)
    expect(res2.canEdit).toBe(true)
  })

  it('first-level directories automatically become categories', () => {
    const bundle = createBundle([
      { path: 'specs/sample/models/user.md' },
      { path: 'specs/sample/models/sub/order.md' },
      { path: 'specs/sample/architecture/overview.md' },
    ])

    const userRes = resolveFileCategory(bundle, bundle.files[0])
    expect(userRes.category).toBe('models')
    expect(userRes.source).toBe('first-level-dir')
    expect(userRes.canEdit).toBe(true)

    const subOrderRes = resolveFileCategory(bundle, bundle.files[1])
    expect(subOrderRes.category).toBe('models')
    expect(subOrderRes.source).toBe('first-level-dir')
    expect(subOrderRes.canEdit).toBe(true)

    const archRes = resolveFileCategory(bundle, bundle.files[2])
    expect(archRes.category).toBe('architecture')
    expect(archRes.source).toBe('first-level-dir')
    expect(archRes.canEdit).toBe(true)
  })

  it('all first-level directories automatically become categories', () => {
    const bundle = createBundle([
      { path: 'specs/sample/guides/requirements.md' },
      { path: 'specs/sample/api/v1.yaml' },
    ])

    const res1 = resolveFileCategory(bundle, bundle.files[0])
    expect(res1.category).toBe('guides')
    expect(res1.source).toBe('first-level-dir')

    const res2 = resolveFileCategory(bundle, bundle.files[1])
    expect(res2.category).toBe('api')
    expect(res2.source).toBe('first-level-dir')
  })

  it('updates file category by moving file to category directory', () => {
    const bundle = createBundle([
      { path: 'specs/sample/file.md', content: '# Content\n' },
    ])

    const { modifiedFile } = updateFileCategory(bundle, bundle.files[0], 'Architecture')
    expect(modifiedFile.path).toBe('specs/sample/Architecture/file.md')

    const res = resolveFileCategory(bundle, modifiedFile)
    expect(res.category).toBe('Architecture')
  })

  it('updates file category back to root when reset to 未分类', () => {
    const bundle = createBundle([
      { path: 'specs/sample/Architecture/file.md', content: '# Architecture\n' },
    ])

    const { modifiedFile } = updateFileCategory(bundle, bundle.files[0], UNCLASSIFIED_CATEGORY)
    expect(modifiedFile.path).toBe('specs/sample/file.md')

    const res = resolveFileCategory(bundle, modifiedFile)
    expect(res.category).toBe(UNCLASSIFIED_CATEGORY)
  })
  it.each([
    ['file:///Users/example/project/specs/sample/design%20notes.html', 'file:///Users/example/project/specs/sample/Guides/design%20notes.html'],
    ['../specs/sample/design notes.html', '../specs/sample/Guides/design notes.html'],
  ])('keeps the HTML source reference valid after a category move from %s', (sourceUrl, expectedUrl) => {
    const bundle = createBundle([{ path: 'specs/sample/design notes.html', content: '<h1>Design</h1>' }])
    bundle.files[0].mediaType = 'text/html'
    bundle.files[0].sourceUrl = sourceUrl
    expect(parseBundle(JSON.stringify(bundle)).ok).toBe(true)

    updateFileCategory(bundle, bundle.files[0], 'Guides')
    expect(bundle.files[0].sourceUrl).toBe(expectedUrl)
    expect(parseBundle(JSON.stringify(bundle)).ok).toBe(true)
  })

  it('keeps comment threads on a file moved back to the root with a filename collision', () => {
    const bundle = createBundle([
      { path: 'specs/sample/docs/intro.md', content: '# Intro' },
      { path: 'specs/sample/intro.md', content: '# Existing' },
    ])
    bundle.comments = [{
      id: 'thread-1',
      anchor: { path: 'specs/sample/docs/intro.md', position: { start: 0, end: 7 }, quote: { exact: '# Intro', prefix: '', suffix: '' } },
      status: 'open',
      messages: [{ id: 'message-1', author: 'Ada', body: 'Clarify', createdAt: '2026-09-24T00:00:00.000Z' }],
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
    }]
    expect(parseBundle(JSON.stringify(bundle)).ok).toBe(true)

    updateFileCategory(bundle, bundle.files[0], UNCLASSIFIED_CATEGORY)
    expect(bundle.files[0].path).toBe('specs/sample/intro-1.md')
    expect(bundle.comments[0].anchor.path).toBe(bundle.files[0].path)
    expect(parseBundle(JSON.stringify(bundle)).ok).toBe(true)
  })

})

describe('Checkpoint category precedence', () => {
  it('overrides declared file and directory categories without changing their content', () => {
    const bundle = createBundle([
      { path: 'specs/sample/intro.md', content: '# Intro' },
      { path: 'specs/sample/docs/owned.md' },
      { path: 'specs/sample/docs/ordinary.md' },
    ])
    bundle.checkpoints = {
      version: 1,
      nodes: [{ id: 'review', title: 'Review', after: [], documents: [
        { path: 'specs/sample/intro.md' },
        { path: 'specs/sample/docs/owned.md' },
        { path: 'specs/sample/docs/missing.md' },
      ] }],
      documents: [],
    }

    expect(resolveFileCategory(bundle, bundle.files[0])).toMatchObject({
      category: 'Review', source: 'checkpoint', canEdit: false, checkpointId: 'review',
    })
    expect(resolveFileCategory(bundle, bundle.files[1])).toMatchObject({
      category: 'Review', source: 'checkpoint', canEdit: false, checkpointId: 'review', overridden: 'docs',
    })
    expect(resolvePathCategory(bundle, 'specs/sample/docs/missing.md')).toMatchObject({
      category: 'Review', source: 'checkpoint', canEdit: false, checkpointId: 'review', overridden: 'docs',
    })
    expect(resolveFileCategory(bundle, bundle.files[2]).category).toBe('docs')
    expect(() => updateFileCategory(bundle, bundle.files[0], 'Other')).toThrow(/Checkpoint/)
  })

  it('ignores invalid definitions while preserving the original category', () => {
    const bundle = createBundle([
      { path: 'specs/sample/guides/doc.md', content: '# Doc' },
    ])
    bundle.checkpoints = { version: 1, nodes: 'invalid', documents: [] }
    expect(resolveFileCategory(bundle, bundle.files[0])).toMatchObject({
      category: 'guides', source: 'first-level-dir', canEdit: true,
    })
    const { modifiedFile } = updateFileCategory(bundle, bundle.files[0], 'Other')
    expect(modifiedFile.path).toBe('specs/sample/Other/doc.md')
  })
})

