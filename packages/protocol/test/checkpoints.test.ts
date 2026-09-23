import { describe, expect, it } from 'vitest'
import {
  resolveCheckpoints,
  setDocumentStatus,
  validateCheckpoints,
  type CheckpointsState,
} from '../src/index.ts'

const root = 'specs/demo'
const path = (name: string) => `${root}/${name}.md`
const timestamp = '2026-09-23T09:00:00Z'

const state = (): CheckpointsState => ({
  version: 1,
  nodes: [
    { id: 'first', title: 'First', after: [], documents: [{ path: path('a') }] },
    { id: 'second', title: 'Second', after: ['first'], documents: [{ path: path('b') }] },
  ],
  documents: [],
})

describe('checkpoint invariants', () => {
  it('rejects a dependency cycle without attempting to resolve malformed state', () => {
    const value = state()
    value.nodes[0].after = ['second']
    const result = validateCheckpoints(value, root)
    expect(result).toMatchObject({ ok: false, path: expect.stringMatching(/\.after$/) })
    expect(resolveCheckpoints({ root, files: [], checkpoints: value })).toMatchObject({
      valid: false,
      error: expect.stringContaining('cycle'),
      nodes: [],
    })
  })

  it('rejects duplicate member paths both within and across checkpoints', () => {
    const across = state()
    across.nodes[1].documents = [{ path: path('a') }]
    expect(validateCheckpoints(across, root)).toMatchObject({
      ok: false,
      path: 'checkpoints.nodes[1].documents[0].path',
    })

    const within = state()
    within.nodes[0].documents.push({ path: path('a'), optional: true })
    expect(validateCheckpoints(within, root)).toMatchObject({
      ok: false,
      path: 'checkpoints.nodes[0].documents[1].path',
    })
  })

  it('ignores optional documents when aggregating with a required document, but uses them when all are optional', () => {
    const value = state()
    value.nodes[0].documents.push({ path: path('optional'), optional: true })
    value.nodes[1].documents = [{ path: path('b'), optional: true }]
    value.documents.push(
      { path: path('a'), status: 'freeze', updatedAt: timestamp },
      { path: path('b'), status: 'in_progress', updatedAt: timestamp },
    )
    const bundle = { root, files: [{ path: path('a') }], checkpoints: value }
    const result = resolveCheckpoints(bundle)
    expect(result.valid).toBe(true)
    expect(result.nodes.map((node) => ({ id: node.id, status: node.aggregate, available: node.available, missing: node.missing }))).toEqual([
      { id: 'first', status: 'freeze', available: true, missing: [] },
      { id: 'second', status: 'in_progress', available: true, missing: [path('b')] },
    ])
    expect(result.frontier).toEqual(['second'])

    const next = setDocumentStatus(value, path('optional'), 'freeze', timestamp)
    expect(value.documents).toHaveLength(2)
    expect(next.nodes).toBe(value.nodes)
    expect(resolveCheckpoints({ ...bundle, checkpoints: next }).nodes[0].aggregate).toBe('freeze')
    expect(setDocumentStatus(next, path('optional'), 'freeze', timestamp)).toBe(next)
  })
})
