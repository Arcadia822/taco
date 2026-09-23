import { describe, expect, it } from 'vitest'
import { FORMAT, parseBundle, type NavigationManifest, type TacoBundle } from '../src/model.ts'
import { resolveDocumentNavigation } from '../src/navigation.ts'
import {
  addNavigationGroup,
  createInitialManifest,
  moveFileToGroup,
  removeFileFromManifest,
  removeNavigationGroup,
  renameFileInManifest,
  renameNavigationGroup,
  setNavigationEntry,
} from '../src/navigation-editor.ts'

const createBundle = (files: { path: string; content?: string }[]): TacoBundle => ({
  format: FORMAT,
  version: 1,
  docId: 'doc-1',
  title: 'Sample',
  root: 'specs/sample',
  files: files.map((f) => ({
    id: f.path,
    path: f.path,
    mediaType: 'text/markdown',
    content: f.content ?? '# test',
  })),
})

describe('resolveDocumentNavigation', () => {
  it('falls back to standard stage navigation when navigation field is absent', () => {
    const bundle = createBundle([
      { path: 'specs/sample/spec.md' },
      { path: 'specs/sample/plan.md' },
      { path: 'specs/sample/tasks.md' },
      { path: 'specs/sample/extra.md' },
    ])

    const res = resolveDocumentNavigation(bundle)
    expect(res.mode).toBe('stage')
    expect(res.groups.map((g) => g.id)).toEqual(['spec', 'plan', 'tasks'])
    expect(res.unassigned.map((f) => f.path)).toEqual(['specs/sample/extra.md'])
    expect(res.checkpointGroups).toEqual([])
    expect(res.warnings).toEqual([])
  })

  it('renders custom groups in order and places undeclared files into unassigned', () => {
    const bundle = createBundle([
      { path: 'specs/sample/arch.md' },
      { path: 'specs/sample/api.md' },
      { path: 'specs/sample/misc.md' },
    ])
    bundle.navigation = {
      version: 1,
      groups: [
        { id: 'g1', title: 'Architecture', paths: ['arch.md'] },
        { id: 'g2', title: 'API Reference', paths: ['specs/sample/api.md'] },
      ],
    }

    const res = resolveDocumentNavigation(bundle)
    expect(res.mode).toBe('custom')
    expect(res.groups.length).toBe(2)
    expect(res.groups[0].title).toBe('Architecture')
    if (res.groups[0].isCustom) {
      expect(res.groups[0].files.map((f) => f.path)).toEqual(['specs/sample/arch.md'])
    }
    expect(res.groups[1].title).toBe('API Reference')
    if (res.groups[1].isCustom) {
      expect(res.groups[1].files.map((f) => f.path)).toEqual(['specs/sample/api.md'])
    }
    expect(res.unassigned.map((f) => f.path)).toEqual(['specs/sample/misc.md'])
  })

  it('safely skips dangling paths without error', () => {
    const bundle = createBundle([
      { path: 'specs/sample/real.md' },
    ])
    bundle.navigation = {
      version: 1,
      groups: [
        { id: 'g1', title: 'Group', paths: ['not-found.md', 'real.md'] },
      ],
    }

    const res = resolveDocumentNavigation(bundle)
    expect(res.mode).toBe('custom')
    if (res.groups[0].isCustom) {
      expect(res.groups[0].files.map((f) => f.path)).toEqual(['specs/sample/real.md'])
    }
    expect(res.unassigned).toEqual([])
  })
})
describe('Checkpoint navigation', () => {
  it('orders Checkpoint groups by topology and each document once, including missing placeholders', () => {
    const bundle = createBundle([
      { path: 'specs/sample/plan.md' },
      { path: 'specs/sample/spec.md' },
      { path: 'specs/sample/extra.md' },
    ])
    bundle.checkpoints = {
      version: 1,
      nodes: [
        { id: 'later', title: 'Later', after: ['first'], documents: [
          { path: 'specs/sample/plan.md' },
        ] },
        { id: 'first', title: 'First', after: [], documents: [
          { path: 'specs/sample/optional.md', optional: true },
          { path: 'specs/sample/spec.md' },
          { path: 'specs/sample/required.md' },
        ] },
      ],
      documents: [],
    }

    const resolved = resolveDocumentNavigation(bundle)
    expect(resolved.mode).toBe('stage')
    expect(resolved.checkpointGroups.map((group) => group.checkpointId)).toEqual(['first', 'later'])
    expect(resolved.checkpointGroups[0].entries).toEqual([
      { kind: 'placeholder', path: 'specs/sample/required.md', checkpointId: 'first', optional: false },
      { kind: 'file', file: bundle.files[1] },
      { kind: 'placeholder', path: 'specs/sample/optional.md', checkpointId: 'first', optional: true },
    ])
    expect(resolved.checkpointGroups[1].entries).toEqual([{ kind: 'file', file: bundle.files[0] }])
    expect(resolved.checkpointGroups[0]).toMatchObject({ isCheckpoint: true, locked: true })
    const ordinaryPaths = [
      ...resolved.groups.flatMap((group) => group.isCustom
        ? group.files.map((file) => file.path)
        : group.stage.files.map((file) => file.path)),
      ...resolved.unassigned.map((file) => file.path),
    ]
    expect(ordinaryPaths).toEqual(['specs/sample/extra.md'])
    expect(resolved.warnings).toEqual([])
  })

  it('orders independent Checkpoints by id rather than input order', () => {
    const bundle = createBundle([])
    bundle.checkpoints = {
      version: 1,
      nodes: [
        { id: 'zeta', title: 'Zeta', after: [], documents: [{ path: 'specs/sample/z.md' }] },
        { id: 'alpha', title: 'Alpha', after: [], documents: [{ path: 'specs/sample/a.md' }] },
      ],
      documents: [],
    }
    expect(resolveDocumentNavigation(bundle).checkpointGroups.map((group) => group.checkpointId))
      .toEqual(['alpha', 'zeta'])
  })

  it('keeps owned entries out of manifest groups while preserving the manifest and warning deterministically', () => {
    const bundle = createBundle([
      { path: 'specs/sample/owned.md' },
      { path: 'specs/sample/ordinary.md' },
    ])
    bundle.checkpoints = {
      version: 1,
      nodes: [{ id: 'gate', title: 'Gate', after: [], documents: [
        { path: 'specs/sample/owned.md' }, { path: 'specs/sample/missing.md' },
      ] }],
      documents: [],
    }
    bundle.navigation = { version: 1, groups: [
      { id: 'custom', title: 'Custom', paths: ['owned.md', 'missing.md', 'ordinary.md'] },
    ] }
    const original = structuredClone(bundle.navigation)
    const resolved = resolveDocumentNavigation(bundle)
    expect(resolved.mode).toBe('custom')
    expect(resolved.groups[0].isCustom && resolved.groups[0].files.map((file) => file.path))
      .toEqual(['specs/sample/ordinary.md'])
    expect(resolved.unassigned).toEqual([])
    expect(resolved.warnings).toEqual([
      { path: 'specs/sample/missing.md', reason: 'manifest-path-owned-by-checkpoint' },
      { path: 'specs/sample/owned.md', reason: 'manifest-path-owned-by-checkpoint' },
    ])
    expect(bundle.navigation).toEqual(original)
    expect(createInitialManifest(bundle)).toEqual(original)
  })

  it('does not switch to category mode solely because an owned file declares a category', () => {
    const bundle = createBundle([
      { path: 'specs/sample/spec.md', content: '---\ncategory: Guides\n---\n# Spec' },
      { path: 'specs/sample/extra.md' },
    ])
    bundle.checkpoints = {
      version: 1,
      nodes: [{ id: 'gate', title: 'Gate', after: [], documents: [{ path: 'specs/sample/spec.md' }] }],
      documents: [],
    }
    const resolved = resolveDocumentNavigation(bundle)
    expect(resolved.mode).toBe('stage')
    expect(resolved.warnings).toEqual([{ path: 'specs/sample/spec.md', reason: 'category-overridden' }])
    expect(resolved.unassigned.map((file) => file.path)).toEqual(['specs/sample/extra.md'])
  })

  it('separates an ordinary category with the same title and warns of the collision', () => {
    const bundle = createBundle([
      { path: 'specs/sample/owned.md' },
      { path: 'specs/sample/other.md', content: '---\ncategory: Gate\n---\n# Other' },
    ])
    bundle.checkpoints = {
      version: 1,
      nodes: [{ id: 'gate', title: 'Gate', after: [], documents: [{ path: 'specs/sample/owned.md' }] }],
      documents: [],
    }
    const resolved = resolveDocumentNavigation(bundle)
    expect(resolved.mode).toBe('custom')
    expect(resolved.checkpointGroups[0].id).toBe('checkpoint-gate')
    expect(resolved.groups[0].id).toBe('category-Gate')
    expect(resolved.groups[0].isCustom && resolved.groups[0].files).toEqual([bundle.files[1]])
    expect(resolved.warnings).toEqual([
      { path: 'specs/sample/other.md', reason: 'category-title-collision' },
    ])
  })

  it('keeps category-only files in a Checkpoint sidebar group without adding tracked documents', () => {
    const bundle = createBundle([
      { path: 'specs/sample/owned.md' },
      { path: 'specs/sample/other.md', content: '---\ncategory: Gate\n---\n# Other' },
    ])
    bundle.checkpoints = {
      version: 1,
      nodes: [{ id: 'gate', title: 'Gate', after: [], documents: [{ path: 'specs/sample/owned.md' }] }],
      documents: [],
    }
    const original = structuredClone(bundle.checkpoints)
    const initial = createInitialManifest(bundle)
    const assigned = moveFileToGroup(initial, 'other.md', 'checkpoint-gate', bundle.root, bundle)
    bundle.navigation = assigned

    const resolved = resolveDocumentNavigation(bundle)
    expect(resolved.checkpointGroups[0].entries).toEqual([
      { kind: 'file', file: bundle.files[0] },
      { kind: 'category-file', file: bundle.files[1] },
    ])
    expect(resolved.groups.every((group) => !group.isCustom || !group.files.includes(bundle.files[1]))).toBe(true)
    expect(resolved.unassigned).not.toContain(bundle.files[1])
    expect(resolved.warnings).toEqual([])
    expect(bundle.checkpoints).toEqual(original)

    bundle.navigation = moveFileToGroup(assigned, 'other.md', null, bundle.root, bundle)
    expect(resolveDocumentNavigation(bundle).checkpointGroups[0].entries).toEqual([{ kind: 'file', file: bundle.files[0] }])
    expect(bundle.checkpoints).toEqual(original)
  })

  it('preserves malformed checkpoints in the bundle but keeps legacy navigation intact', () => {
    const raw = { ...createBundle([{ path: 'specs/sample/spec.md' }]),
      checkpoints: { version: 1, nodes: 'invalid', documents: [] } }
    const parsed = parseBundle(JSON.stringify(raw))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.bundle.checkpoints).toEqual(raw.checkpoints)
    const resolved = resolveDocumentNavigation(parsed.bundle)
    expect(resolved.checkpointGroups).toEqual([])
    expect(resolved.groups.map((group) => group.id)).toEqual(['spec', 'plan', 'tasks'])
    expect(resolved.warnings).toEqual([])
  })
})


describe('navigation-editor operations', () => {
  it('creates initial manifest from unconfigured bundle', () => {
    const bundle = createBundle([
      { path: 'specs/sample/spec.md' },
      { path: 'specs/sample/plan.md' },
    ])
    const manifest = createInitialManifest(bundle)
    expect(manifest.version).toBe(1)
    expect(manifest.groups.length).toBeGreaterThanOrEqual(2)
  })

  it('adds, renames, and removes groups cleanly', () => {
    const initial: NavigationManifest = {
      version: 1,
      groups: [
        { id: 'g1', title: 'First', paths: ['a.md'] },
      ],
    }

    const added = addNavigationGroup(initial, 'Second')
    expect(added.groups).toHaveLength(2)
    expect(added.groups[1].title).toBe('Second')
    const g2Id = added.groups[1].id

    const renamed = renameNavigationGroup(added, g2Id, 'Second Updated')
    expect(renamed.groups.find((g) => g.id === g2Id)?.title).toBe('Second Updated')

    const removed = removeNavigationGroup(renamed, 'g1')
    expect(removed.groups.map((g) => g.id)).toEqual([g2Id])
  })

  it('moves files between groups and unassigned', () => {
    const initial: NavigationManifest = {
      version: 1,
      groups: [
        { id: 'g1', title: 'First', paths: ['a.md'] },
        { id: 'g2', title: 'Second', paths: [] },
      ],
    }

    const moved = moveFileToGroup(initial, 'specs/sample/a.md', 'g2', 'specs/sample', createBundle([]))
    expect(moved.groups[0].paths).toEqual([])
    expect(moved.groups[1].paths).toEqual(['a.md'])

    // 移入 null 则从所有组移除（归入未分配）
    const unassigned = moveFileToGroup(moved, 'specs/sample/a.md', null, 'specs/sample', createBundle([]))
    expect(unassigned.groups[0].paths).toEqual([])
    expect(unassigned.groups[1].paths).toEqual([])
  })

  it('renames and removes file references from manifest', () => {
    const initial: NavigationManifest = {
      version: 1,
      entry: 'a.md',
      groups: [
        { id: 'g1', title: 'First', paths: ['a.md', 'b.md'] },
      ],
    }

    const renamed = renameFileInManifest(initial, 'specs/sample/a.md', 'specs/sample/c.md', 'specs/sample')
    expect(renamed.entry).toBe('c.md')
    expect(renamed.groups[0].paths).toEqual(['c.md', 'b.md'])

    const removed = removeFileFromManifest(renamed, 'specs/sample/c.md', 'specs/sample')
    expect(removed.entry).toBeUndefined()
    expect(removed.groups[0].paths).toEqual(['b.md'])
  })

  it('sets and unsets entry file', () => {
    const initial: NavigationManifest = {
      version: 1,
      groups: [],
    }

    const withEntry = setNavigationEntry(initial, 'specs/sample/doc.md', 'specs/sample')
    expect(withEntry.entry).toBe('doc.md')

    const cleared = setNavigationEntry(withEntry, undefined, 'specs/sample')
    expect(cleared.entry).toBeUndefined()
  })
})

describe('Checkpoint navigation editing', () => {
  it('refuses to move an owned path without changing its manifest', () => {
    const bundle = createBundle([{ path: 'specs/sample/owned.md' }])
    bundle.checkpoints = {
      version: 1,
      nodes: [{ id: 'gate', title: 'Gate', after: [], documents: [{ path: 'specs/sample/owned.md' }] }],
      documents: [],
    }
    const manifest: NavigationManifest = {
      version: 1,
      groups: [{ id: 'other', title: 'Other', paths: ['owned.md'] }],
    }
    expect(moveFileToGroup(manifest, 'specs/sample/owned.md', null, bundle.root, bundle)).toBe(manifest)
    expect(moveFileToGroup(manifest, 'owned.md', 'other', bundle.root, bundle)).toBe(manifest)
    expect(manifest.groups[0].paths).toEqual(['owned.md'])
  })
})
