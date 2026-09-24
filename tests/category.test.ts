import { describe, expect, it } from 'vitest'
import { FORMAT, type TacoBundle } from '../src/model.ts'
import {
  addCategory,
  deleteCategory,
  listCategories,
  renameCategory,
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

describe('Category management: listCategories, renameCategory, deleteCategory, addCategory', () => {
  it('listCategories accurately identifies first-level directory categories and counts files', () => {
    const bundle = createBundle([
      { path: 'specs/sample/api/v1.md', content: '# API V1' },
      { path: 'specs/sample/api/v2.md', content: '# API V2' },
      { path: 'specs/sample/docs/intro.md', content: '# Intro' },
      { path: 'specs/sample/README.md', content: '# Other' },
    ])

    const categories = listCategories(bundle)
    expect(categories).toHaveLength(2)

    const api = categories.find((c) => c.name === 'api')!
    expect(api).toBeDefined()
    expect(api.name).toBe('api')
    expect(api.files.map((f) => f.path)).toEqual([
      'specs/sample/api/v1.md',
      'specs/sample/api/v2.md',
    ])
    expect(api.isCheckpointOverridden).toBe(false)

    const docs = categories.find((c) => c.name === 'docs')!
    expect(docs).toBeDefined()
    expect(docs.files.map((f) => f.path)).toEqual([
      'specs/sample/docs/intro.md',
    ])
    expect(docs.isCheckpointOverridden).toBe(false)
  })

  it('listCategories properly excludes checkpoint files and tracks isCheckpointOverridden', () => {
    const bundle = createBundle([
      { path: 'specs/sample/locked/item.md', content: '# Locked' },
      { path: 'specs/sample/docs/owned.md', content: '# Owned' },
      { path: 'specs/sample/docs/free.md', content: '# Free' },
    ])
    bundle.checkpoints = {
      version: 1,
      nodes: [{
        id: 'review',
        title: 'Review',
        after: [],
        documents: [
          { path: 'specs/sample/locked/item.md' },
          { path: 'specs/sample/docs/owned.md' },
        ],
      }],
      documents: [],
    }

    const categories = listCategories(bundle)
    expect(categories).toHaveLength(3)
    const locked = categories.find((c) => c.name === 'locked')!
    expect(locked.files).toHaveLength(0)
    expect(locked.isCheckpointOverridden).toBe(true)

    const docs = categories.find((c) => c.name === 'docs')!
    expect(docs.files.map((f) => f.path)).toEqual(['specs/sample/docs/free.md'])
    expect(docs.isCheckpointOverridden).toBe(false)
  })

  it('renameCategory physically moves files to new directory and updates navigation manifest', () => {
    const bundle = createBundle([
      { path: 'specs/sample/OldGuides/step1.md', content: '# Step 1' },
      { path: 'specs/sample/OldGuides/step2.md', content: '# Step 2' },
    ])
    bundle.navigation = {
      version: 1,
      groups: [
        { id: 'category-OldGuides', title: 'OldGuides', paths: ['OldGuides/step1.md', 'OldGuides/step2.md'] },
        { id: 'custom-other', title: 'Other', paths: [] },
      ],
    }

    const { updatedBundle, modifiedFiles } = renameCategory(bundle, 'OldGuides', 'NewGuides')

    // 验证物理路径已移至新目录
    expect(updatedBundle.files.find((f) => f.path === 'specs/sample/NewGuides/step1.md')).toBeDefined()
    expect(updatedBundle.files.find((f) => f.path === 'specs/sample/NewGuides/step2.md')).toBeDefined()
    expect(updatedBundle.files.find((f) => f.path === 'specs/sample/OldGuides/step1.md')).toBeUndefined()

    // 验证 modifiedFiles
    expect(modifiedFiles.map((f) => f.path)).toEqual([
      'specs/sample/NewGuides/step1.md',
      'specs/sample/NewGuides/step2.md',
    ])

    // 验证导航 manifest 同步更新
    expect(updatedBundle.navigation?.groups[0]).toEqual({
      id: 'category-NewGuides',
      title: 'NewGuides',
      paths: ['NewGuides/step1.md', 'NewGuides/step2.md'],
    })

    // 验证重新解析文件类别均已变为 NewGuides
    expect(resolveFileCategory(updatedBundle, updatedBundle.files[0]).category).toBe('NewGuides')
  })

  it('renameCategory validates inputs correctly', () => {
    const bundle = createBundle([
      { path: 'specs/sample/Test/file.md', content: '# Content' },
    ])

    expect(() => renameCategory(bundle, 'Test', '')).toThrow(/empty/)
    expect(() => renameCategory(bundle, 'Test', '   ')).toThrow(/empty/)
    expect(() => renameCategory(bundle, 'Test', UNCLASSIFIED_CATEGORY)).toThrow(/未分类/)

    const noopResult = renameCategory(bundle, 'Test', 'Test')
    expect(noopResult.modifiedFiles).toHaveLength(0)
  })

  it('deleteCategory moves files in category directory back to root (unclassified) without deleting files', () => {
    const bundle = createBundle([
      { path: 'specs/sample/Docs/page.md', content: '# Page' },
      { path: 'specs/sample/Docs/sub/deep.md', content: '# Deep' },
    ])
    bundle.navigation = {
      version: 1,
      groups: [
        { id: 'category-Docs', title: 'Docs', paths: ['Docs/page.md'] },
        { id: 'category-Other', title: 'Other', paths: [] },
      ],
    }

    const { updatedBundle, modifiedFiles } = deleteCategory(bundle, 'Docs')

    // 1. 验证文件被安全移回根目录，没有删除文档
    expect(updatedBundle.files.find((f) => f.path === 'specs/sample/page.md')).toBeDefined()
    expect(updatedBundle.files.find((f) => f.path === 'specs/sample/deep.md')).toBeDefined()

    // 2. 验证 modifiedFiles
    expect(modifiedFiles.map((f) => f.path)).toEqual([
      'specs/sample/page.md',
      'specs/sample/deep.md',
    ])

    // 3. 验证导航状态：对应 Docs 分组被移除
    expect(updatedBundle.navigation?.groups.map((g) => g.title)).toEqual(['Other'])

    // 4. 验证所有原分类文件重新解析均变为 未分类
    expect(resolveFileCategory(updatedBundle, updatedBundle.files[0]).category).toBe(UNCLASSIFIED_CATEGORY)
    expect(resolveFileCategory(updatedBundle, updatedBundle.files[1]).category).toBe(UNCLASSIFIED_CATEGORY)
  })

  it('deleteCategory validates inputs correctly', () => {
    const bundle = createBundle([
      { path: 'specs/sample/Test/file.md', content: '# Content' },
    ])

    expect(() => deleteCategory(bundle, '')).toThrow(/Invalid/)
    expect(() => deleteCategory(bundle, '  ')).toThrow(/Invalid/)
    expect(() => deleteCategory(bundle, UNCLASSIFIED_CATEGORY)).toThrow(/Invalid/)
  })

  it('addCategory records category in navigation manifest without creating dummy _dir.yaml files', () => {
    const bundle = createBundle([
      { path: 'specs/sample/README.md', content: '# Readme' },
    ])

    const { updatedBundle } = addCategory(bundle, 'Architecture')

    // 1. 验证没有创建任何 _dir.yaml 文件
    expect(updatedBundle.files.some((f) => f.path.includes('_dir.yaml'))).toBe(false)

    // 2. 验证 listCategories 能够在 model 中直接查到该分类
    const categories = listCategories(updatedBundle)
    const arch = categories.find((c) => c.name === 'Architecture')
    expect(arch).toBeDefined()
    expect(arch?.files).toHaveLength(0)

    // 3. 验证 navigation groups 同步添加
    expect(updatedBundle.navigation?.groups.some((g) => g.title === 'Architecture')).toBe(true)
  })

  it('addCategory validates inputs and rejects duplicates', () => {
    const bundle = createBundle([
      { path: 'specs/sample/Existing/file.md', content: '# Existing\n' },
    ])

    expect(() => addCategory(bundle, '')).toThrow(/Invalid/)
    expect(() => addCategory(bundle, '   ')).toThrow(/Invalid/)
    expect(() => addCategory(bundle, UNCLASSIFIED_CATEGORY)).toThrow(/Invalid/)
    expect(() => addCategory(bundle, 'Existing')).toThrow(/already exists/)
  })
})
