import { describe, expect, it } from 'vitest'
import { FORMAT, type NavigationManifest, type TacoBundle } from '../src/model.ts'
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

    const moved = moveFileToGroup(initial, 'specs/sample/a.md', 'g2', 'specs/sample')
    expect(moved.groups[0].paths).toEqual([])
    expect(moved.groups[1].paths).toEqual(['a.md'])

    // 移入 null 则从所有组移除（归入未分配）
    const unassigned = moveFileToGroup(moved, 'specs/sample/a.md', null, 'specs/sample')
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
