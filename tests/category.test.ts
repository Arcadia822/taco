import { describe, expect, it } from 'vitest'
import { FORMAT, type TacoBundle } from '../src/model.ts'
import {
  resolveFileCategory,
  resolvePathCategory,
  UNCLASSIFIED_CATEGORY,
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

describe('Category resolution', () => {
  it('keeps root files in 未分类 regardless of file name or frontmatter', () => {
    const bundle = createBundle([
      { path: 'specs/sample/README.md', content: '# Hello' },
      { path: 'specs/sample/spec.md', content: '# Spec' },
      { path: 'specs/sample/brief.md', content: '---\ncategory: Guides\n---\n# Brief' },
    ])

    expect(resolveFileCategory(bundle, bundle.files[0])).toMatchObject({
      category: UNCLASSIFIED_CATEGORY,
      source: 'root-default',
      canEdit: true,
    })
    expect(resolveFileCategory(bundle, bundle.files[1])).toMatchObject({
      category: UNCLASSIFIED_CATEGORY,
      source: 'root-default',
      canEdit: true,
    })
    expect(resolveFileCategory(bundle, bundle.files[2])).toMatchObject({
      category: UNCLASSIFIED_CATEGORY,
      source: 'root-default',
      canEdit: true,
    })
  })

  it('derives categories from the first-level directory with no convention-path exceptions', () => {
    const bundle = createBundle([
      { path: 'specs/sample/models/user.md' },
      { path: 'specs/sample/models/sub/order.md' },
      { path: 'specs/sample/architecture/overview.md' },
      { path: 'specs/sample/api/v1.yaml' },
      { path: 'specs/sample/checklists/requirements.md' },
      { path: 'specs/sample/notes/spec.md' },
      { path: 'specs/sample/notes/plan.md' },
    ])

    expect(resolveFileCategory(bundle, bundle.files[0])).toMatchObject({
      category: 'models',
      source: 'first-level-dir',
      canEdit: true,
    })
    expect(resolveFileCategory(bundle, bundle.files[1])).toMatchObject({
      category: 'models',
      source: 'first-level-dir',
      canEdit: true,
    })
    expect(resolveFileCategory(bundle, bundle.files[2])).toMatchObject({
      category: 'architecture',
      source: 'first-level-dir',
      canEdit: true,
    })
    expect(resolveFileCategory(bundle, bundle.files[3])).toMatchObject({
      category: 'api',
      source: 'first-level-dir',
    })
    // Stage-era special filenames are ordinary files: their directory decides the category.
    expect(resolveFileCategory(bundle, bundle.files[4])).toMatchObject({
      category: 'checklists',
      source: 'first-level-dir',
    })
    expect(resolveFileCategory(bundle, bundle.files[5])).toMatchObject({
      category: 'notes',
      source: 'first-level-dir',
    })
    expect(resolveFileCategory(bundle, bundle.files[6])).toMatchObject({
      category: 'notes',
      source: 'first-level-dir',
    })
  })

  it('honors explicit manifest assignment ahead of directory inference', () => {
    const bundle = createBundle([
      { path: 'specs/sample/brief.md' },
      { path: 'specs/sample/docs/plan.md' },
      { path: 'specs/sample/docs/other.md' },
    ])
    bundle.navigation = {
      version: 1,
      groups: [
        { id: 'category-Reviews', title: 'Reviews', paths: ['brief.md', 'docs/plan.md'] },
      ],
    }

    // A root-path file assigned through the manifest reports the group, not 未分类.
    expect(resolveFileCategory(bundle, bundle.files[0])).toMatchObject({
      category: 'Reviews',
      source: 'manifest',
      canEdit: true,
      firstLevelDir: null,
    })
    // Manifest assignment outranks the directory category.
    expect(resolveFileCategory(bundle, bundle.files[1])).toMatchObject({
      category: 'Reviews',
      source: 'manifest',
      canEdit: true,
      firstLevelDir: 'docs',
    })
    // Files the manifest does not list keep directory inference.
    expect(resolveFileCategory(bundle, bundle.files[2])).toMatchObject({
      category: 'docs',
      source: 'first-level-dir',
    })
  })

  it('resolves without mutating any bundle state', () => {
    const bundle = createBundle([
      { path: 'specs/sample/docs/intro.md', content: '# Intro' },
      { path: 'specs/sample/root.md' },
    ])
    bundle.comments = [{
      id: 'thread-1',
      anchor: { path: 'specs/sample/docs/intro.md', position: { start: 0, end: 7 }, quote: { exact: '# Intro', prefix: '', suffix: '' } },
      status: 'open',
      messages: [{ id: 'message-1', author: 'Ada', body: 'Clarify', createdAt: '2026-09-24T00:00:00.000Z' }],
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
    }]
    bundle.navigation = {
      version: 1,
      groups: [{ id: 'category-Docs', title: 'Docs', paths: ['docs/intro.md'] }],
    }
    const before = structuredClone(bundle)

    resolveFileCategory(bundle, bundle.files[0])
    resolvePathCategory(bundle, 'specs/sample/docs/intro.md')
    resolvePathCategory(bundle, 'specs/sample/docs/never-created.md')

    expect(bundle).toEqual(before)
    expect(bundle.files.map((file) => file.path)).toEqual(before.files.map((file) => file.path))
  })
})

describe('Checkpoint category precedence', () => {
  it('overrides manifest assignment and directory categories without changing their content', () => {
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
    bundle.navigation = {
      version: 1,
      groups: [{ id: 'g1', title: 'Elsewhere', paths: ['docs/owned.md'] }],
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
    // An ordinary sibling keeps its own directory category.
    expect(resolveFileCategory(bundle, bundle.files[2])).toMatchObject({
      category: 'docs', source: 'first-level-dir',
    })
  })

  it('ignores invalid checkpoint definitions while preserving directory inference', () => {
    const bundle = createBundle([
      { path: 'specs/sample/guides/doc.md', content: '# Doc' },
    ])
    bundle.checkpoints = { version: 1, nodes: 'invalid', documents: [] }
    expect(resolveFileCategory(bundle, bundle.files[0])).toMatchObject({
      category: 'guides', source: 'first-level-dir', canEdit: true,
    })
  })
})
