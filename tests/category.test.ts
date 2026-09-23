import { describe, expect, it } from 'vitest'
import { FORMAT, type TacoBundle } from '../src/model.ts'
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

  it('root files default to 未分类 and can declare their own category', () => {
    const bundle = createBundle([
      { path: 'specs/sample/README.md', content: '# Hello' },
      { path: 'specs/sample/custom.md', content: '---\ncategory: "Guides"\n---\n# Custom' },
    ])

    const res1 = resolveFileCategory(bundle, bundle.files[0])
    expect(res1.category).toBe(UNCLASSIFIED_CATEGORY)
    expect(res1.canEdit).toBe(true)

    const res2 = resolveFileCategory(bundle, bundle.files[1])
    expect(res2.category).toBe('Guides')
    expect(res2.canEdit).toBe(true)
  })

  it('child files inherit first-level directory category defined in _dir.yaml', () => {
    const bundle = createBundle([
      { path: 'specs/sample/models/_dir.yaml', content: 'category: "Domain Models"\n' },
      { path: 'specs/sample/models/user.md' },
      { path: 'specs/sample/models/sub/order.md' },
    ])

    const userRes = resolveFileCategory(bundle, bundle.files[1])
    expect(userRes.category).toBe('Domain Models')
    expect(userRes.source).toBe('first-level-dir')
    expect(userRes.canEdit).toBe(false) // 整个目录同属一个分类，不可单文件随意分拆

    const subOrderRes = resolveFileCategory(bundle, bundle.files[2])
    expect(subOrderRes.category).toBe('Domain Models')
    expect(subOrderRes.source).toBe('first-level-dir')
    expect(subOrderRes.canEdit).toBe(false)
  })

  it('child directory without _dir.yaml walks up to root and defaults to 未分类', () => {
    const bundle = createBundle([
      { path: 'specs/sample/other/file.md' },
    ])

    const res = resolveFileCategory(bundle, bundle.files[0])
    expect(res.category).toBe(UNCLASSIFIED_CATEGORY)
    expect(res.source).toBe('inherited-root')
    expect(res.canEdit).toBe(false)
  })

  it('updates root file category by writing back to frontmatter', () => {
    const bundle = createBundle([
      { path: 'specs/sample/file.md', content: '# Content\n' },
    ])

    updateFileCategory(bundle, bundle.files[0], 'Architecture')
    expect(bundle.files[0].content).toMatch(/category:\s*"?Architecture"?/)
  })

  it('updates directory category by modifying or creating _dir.yaml', () => {
    const bundle = createBundle([
      { path: 'specs/sample/api/endpoints.md' },
    ])

    const { modifiedFile } = updateFileCategory(bundle, bundle.files[0], 'API Reference')
    expect(modifiedFile.path).toBe('specs/sample/api/_dir.yaml')
    expect(modifiedFile.content).toContain('API Reference')

    // 再次解析该文件，确保类别已生效
    const res = resolveFileCategory(bundle, bundle.files[0])
    expect(res.category).toBe('API Reference')
  })
})

describe('Checkpoint category precedence', () => {
  it('overrides declared file and directory categories without changing their content', () => {
    const bundle = createBundle([
      { path: 'specs/sample/intro.md', content: '---\ncategory: Guides\n---\n# Intro' },
      { path: 'specs/sample/docs/_dir.yaml', content: 'category: References\n' },
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
      category: 'Review', source: 'checkpoint', canEdit: false, checkpointId: 'review', overridden: 'Guides',
    })
    expect(resolveFileCategory(bundle, bundle.files[2])).toMatchObject({
      category: 'Review', source: 'checkpoint', canEdit: false, checkpointId: 'review', overridden: 'References',
    })
    expect(resolvePathCategory(bundle, 'specs/sample/docs/missing.md')).toMatchObject({
      category: 'Review', source: 'checkpoint', canEdit: false, checkpointId: 'review', overridden: 'References',
    })
    expect(resolveFileCategory(bundle, bundle.files[3]).category).toBe('References')
    expect(() => updateFileCategory(bundle, bundle.files[0], 'Other')).toThrow(/Checkpoint/)
    expect(bundle.files[0].content).toContain('category: Guides')
    expect(bundle.files[1].content).toBe('category: References\n')
  })

  it('ignores invalid definitions while preserving the original category', () => {
    const bundle = createBundle([
      { path: 'specs/sample/doc.md', content: '---\ncategory: Guides\n---\n# Doc' },
    ])
    bundle.checkpoints = { version: 1, nodes: 'invalid', documents: [] }
    expect(resolveFileCategory(bundle, bundle.files[0])).toMatchObject({
      category: 'Guides', source: 'root-file', canEdit: true,
    })
    expect(updateFileCategory(bundle, bundle.files[0], 'Other').modifiedFile.content).toContain('Other')
  })
})
