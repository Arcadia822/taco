import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bootCommon } from '../src/main-common.ts'
import type { TacoBundle } from '../src/model.ts'

const document_ = (title: string, paths: string[]): TacoBundle => ({
  format: 'taco/files',
  version: 1,
  docId: `doc-${title}`,
  title,
  root: 'docs',
  files: paths.map((path) => ({ path: `docs/${path}`, mediaType: 'text/markdown', content: `# ${path}\n` })),
})

const paths = () => window.taco.listFiles().map((file) => file.path)

describe('window.taco document API', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    )
    document.body.innerHTML = '<div id="app"></div>'
    window.taco = undefined as never
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('leaves the open review untouched when a load is rejected', () => {
    bootCommon(document_('Review', ['spec.md']))

    expect(window.taco.loadBundle('{ not json').ok).toBe(false)
    expect(paths()).toEqual(['spec.md'])

    // A structurally invalid document must not replace one that loads.
    const escaped = document_('Broken', ['spec.md'])
    escaped.files[0].path = 'elsewhere/spec.md'
    expect(window.taco.loadBundle(escaped).ok).toBe(false)
    expect(paths()).toEqual(['spec.md'])
    expect(window.taco.undoLoad()).toBe(false)
  })

  it('swaps the document and undoes the swap in one call', () => {
    bootCommon(document_('Review', ['spec.md']))

    const replacement = document_('Replacement', ['spec.md', 'plan.md'])
    replacement.comments = []
    expect(window.taco.loadBundle(replacement)).toEqual({ ok: true, files: 2, undoable: true })
    expect(paths()).toEqual(['spec.md', 'plan.md'])
    expect(window.taco.validate().findings).toEqual([])

    expect(window.taco.undoLoad()).toBe(true)
    expect(paths()).toEqual(['spec.md'])
    expect(window.taco.undoLoad()).toBe(false)
  })

  it('rejects a document that would silently lose its navigation', () => {
    bootCommon(document_('Review', ['spec.md']))

    // Deliberately invalid: a group without `paths`, which parseBundle silently drops.
    const broken = {
      ...document_('Broken', ['spec.md', 'plan.md']),
      navigation: { version: 1, groups: [{ id: 'group-1', title: 'No paths' }] },
    }

    const result = window.taco.loadBundle(broken)
    expect(result.ok).toBe(false)
    expect(paths()).toEqual(['spec.md'])
    expect(window.taco.undoLoad()).toBe(false)
  })

  it('reports an unserializable write-back instead of throwing', () => {
    bootCommon(document_('Review', ['spec.md']))

    const cyclic: Record<string, unknown> = { format: 'taco/files' }
    cyclic.self = cyclic
    expect(window.taco.loadBundle(cyclic).ok).toBe(false)
    expect(paths()).toEqual(['spec.md'])
  })

  it('reports document findings and security issues from one call', () => {
    const target = document_('Review', ['spec.md'])
    target.comments = [
      {
        id: 'thread-1',
        status: 'open',
        createdAt: '2026-09-26T10:00:00.000Z',
        updatedAt: '2026-09-26T10:00:00.000Z',
        anchor: {
          path: 'docs/spec.md',
          position: { start: 0, end: 5 },
          quote: { exact: 'GONE', prefix: '', suffix: '' },
        },
        messages: [{ id: 'm1', author: 'Arcadia', body: 'check', createdAt: '2026-09-26T10:00:00.000Z' }],
      },
    ]
    target.collab = { key: 'secret', ownerPriv: 'secret' }
    bootCommon(target)

    const result = window.taco.validate()
    expect(result.findings.map((finding) => finding.code)).toEqual(['comment-anchor-stale'])
    expect(result.issues).toContain('collab-secrets-present')
    expect(result.ok).toBe(false)
  })
})
