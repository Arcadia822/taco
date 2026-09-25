import { describe, expect, it } from 'vitest'
import { FORMAT, parseBundle, type NavigationManifest, type TacoBundle } from '../src/model.ts'
import { resolveDocumentNavigation } from '../src/navigation.ts'
import {
  addNavigationGroup,
  assignFileToGroup,
  createInitialManifest,
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
  it('groups by first-level directory and leaves root files unassigned without a manifest', () => {
    const bundle = createBundle([
      { path: 'specs/sample/spec.md' },
      { path: 'specs/sample/plan.md' },
      { path: 'specs/sample/tasks.md' },
      { path: 'specs/sample/extra.md' },
      { path: 'specs/sample/docs/guide.md' },
      { path: 'specs/sample/docs/api/reference.md' },
      { path: 'specs/sample/checklists/requirements.md' },
      { path: 'specs/sample/notes/spec.md' },
    ])

    const res = resolveDocumentNavigation(bundle)
    expect(res.groups.map((g) => [g.id, g.files.map((f) => f.path)])).toEqual([
      ['category-docs', ['specs/sample/docs/guide.md', 'specs/sample/docs/api/reference.md']],
      ['category-checklists', ['specs/sample/checklists/requirements.md']],
      ['category-notes', ['specs/sample/notes/spec.md']],
    ])
    expect(res.unassigned.map((f) => f.path)).toEqual([
      'specs/sample/spec.md',
      'specs/sample/plan.md',
      'specs/sample/tasks.md',
      'specs/sample/extra.md',
    ])
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

  it('renders a root-path file assigned through the manifest inside its category group', () => {
    const bundle = createBundle([
      { path: 'specs/sample/brief.md' },
      { path: 'specs/sample/docs/spec.md' },
      { path: 'specs/sample/loose.md' },
    ])
    bundle.navigation = {
      version: 1,
      groups: [
        { id: 'category-Reviews', title: 'Reviews', paths: ['brief.md'] },
      ],
    }

    const res = resolveDocumentNavigation(bundle)
    expect(res.groups.map((group) => [group.id, group.files.map((file) => file.path)]))
      .toEqual([['category-Reviews', ['specs/sample/brief.md']]])
    // With an explicit manifest, files it does not list stay unassigned even under a directory.
    expect(res.unassigned.map((file) => file.path))
      .toEqual(['specs/sample/docs/spec.md', 'specs/sample/loose.md'])
    expect(res.checkpointGroups).toEqual([])
    expect(res.warnings).toEqual([])
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
    expect(resolved.checkpointGroups.map((group) => group.checkpointId)).toEqual(['first', 'later'])
    expect(resolved.checkpointGroups[0].entries).toEqual([
      { kind: 'placeholder', path: 'specs/sample/required.md', checkpointId: 'first', optional: false },
      { kind: 'file', file: bundle.files[1] },
      { kind: 'placeholder', path: 'specs/sample/optional.md', checkpointId: 'first', optional: true },
    ])
    expect(resolved.checkpointGroups[1].entries).toEqual([{ kind: 'file', file: bundle.files[0] }])
    expect(resolved.checkpointGroups[0]).toMatchObject({ isCheckpoint: true, locked: true })
    const ordinaryPaths = [
      ...resolved.groups.flatMap((group) => group.files.map((file) => file.path)),
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

  it('does not treat a document frontmatter category as a Checkpoint override', () => {
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
    expect(resolved.groups).toEqual([])
    expect(resolved.warnings).toEqual([])
    expect(resolved.unassigned.map((file) => file.path)).toEqual(['specs/sample/extra.md'])
  })

  it('separates an ordinary category with the same title and warns of the collision', () => {
    const bundle = createBundle([
      { path: 'specs/sample/owned.md' },
      { path: 'specs/sample/Gate/other.md' },
    ])
    bundle.checkpoints = {
      version: 1,
      nodes: [{ id: 'gate', title: 'Gate', after: [], documents: [{ path: 'specs/sample/owned.md' }] }],
      documents: [],
    }
    const resolved = resolveDocumentNavigation(bundle)
    expect(resolved.checkpointGroups[0].id).toBe('checkpoint-gate')
    expect(resolved.groups[0].id).toBe('category-Gate')
    expect(resolved.groups[0].isCustom && resolved.groups[0].files).toEqual([bundle.files[1]])
    expect(resolved.warnings).toEqual([
      { path: 'specs/sample/Gate/other.md', reason: 'category-title-collision' },
    ])
  })

  it('keeps category-only files in a Checkpoint sidebar group without adding tracked documents', () => {
    const bundle = createBundle([
      { path: 'specs/sample/owned.md' },
      { path: 'specs/sample/other.md' },
    ])
    bundle.checkpoints = {
      version: 1,
      nodes: [{ id: 'gate', title: 'Gate', after: [], documents: [{ path: 'specs/sample/owned.md' }] }],
      documents: [],
    }
    const original = structuredClone(bundle.checkpoints)
    const initial = createInitialManifest(bundle)
    const assigned = assignFileToGroup(initial, 'other.md', 'checkpoint-gate', bundle.root, bundle)
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

    bundle.navigation = assignFileToGroup(assigned, 'other.md', null, bundle.root, bundle)
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
    expect(resolved.groups).toEqual([])
    expect(resolved.unassigned.map((file) => file.path)).toEqual(['specs/sample/spec.md'])
    expect(resolved.warnings).toEqual([])
  })
})


describe('navigation-editor operations', () => {
  it('derives an initial manifest from first-level directory groups', () => {
    const bundle = createBundle([
      { path: 'specs/sample/docs/arch.md' },
      { path: 'specs/sample/guides/setup.md' },
    ])
    const manifest = createInitialManifest(bundle)
    expect(manifest.version).toBe(1)
    expect(manifest.groups.map((group) => group.id)).toEqual(['category-docs', 'category-guides'])
    expect(manifest.groups.map((group) => group.paths)).toEqual([['docs/arch.md'], ['guides/setup.md']])
  })

  it('creates an empty manifest when every file sits at the root', () => {
    const bundle = createBundle([
      { path: 'specs/sample/spec.md' },
      { path: 'specs/sample/plan.md' },
    ])
    const manifest = createInitialManifest(bundle)
    expect(manifest.version).toBe(1)
    expect(manifest.groups).toEqual([])
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

  it('assigns files between groups and unassigned', () => {
    const initial: NavigationManifest = {
      version: 1,
      groups: [
        { id: 'g1', title: 'First', paths: ['a.md'] },
        { id: 'g2', title: 'Second', paths: [] },
      ],
    }

    const assigned = assignFileToGroup(initial, 'specs/sample/a.md', 'g2', 'specs/sample', createBundle([]))
    expect(assigned.groups[0].paths).toEqual([])
    expect(assigned.groups[1].paths).toEqual(['a.md'])

    // Assigning to null removes the membership from every group (back to unassigned).
    const unassigned = assignFileToGroup(assigned, 'specs/sample/a.md', null, 'specs/sample', createBundle([]))
    expect(unassigned.groups[0].paths).toEqual([])
    expect(unassigned.groups[1].paths).toEqual([])
  })

  it('assigning a file changes only the manifest, never the file record', () => {
    const bundle = createBundle([{ path: 'specs/sample/brief.md', content: '# Brief' }])
    bundle.comments = [{
      id: 'thread-1',
      anchor: { path: 'specs/sample/brief.md', position: { start: 0, end: 7 }, quote: { exact: '# Brief', prefix: '', suffix: '' } },
      status: 'open',
      messages: [{ id: 'message-1', author: 'Ada', body: 'Clarify', createdAt: '2026-09-24T00:00:00.000Z' }],
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
    }]
    const before = structuredClone(bundle)

    const withGroup = addNavigationGroup(createInitialManifest(bundle), 'Reviews')
    bundle.navigation = assignFileToGroup(withGroup, 'brief.md', withGroup.groups[0].id, bundle.root, bundle)

    expect(bundle.files).toEqual(before.files)
    expect(bundle.comments).toEqual(before.comments)
    const resolved = resolveDocumentNavigation(bundle)
    expect(resolved.groups.map((group) => [group.title, group.files.map((file) => file.path)]))
      .toEqual([['Reviews', ['specs/sample/brief.md']]])
    expect(resolved.unassigned).toEqual([])
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
  it('refuses to reassign an owned path without changing its manifest', () => {
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
    expect(assignFileToGroup(manifest, 'specs/sample/owned.md', null, bundle.root, bundle)).toBe(manifest)
    expect(assignFileToGroup(manifest, 'owned.md', 'other', bundle.root, bundle)).toBe(manifest)
    expect(manifest.groups[0].paths).toEqual(['owned.md'])
  })
})
