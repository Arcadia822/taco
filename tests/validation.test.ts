import { describe, expect, it } from 'vitest'

import type { TacoBundle, TacoCommentThread, TacoFile } from '../src/model.ts'
import { validateDocument } from '../src/validation.ts'

const markdown = (path: string, content: string, extra: Partial<TacoFile> = {}): TacoFile => ({
  path,
  mediaType: 'text/markdown',
  content,
  ...extra,
})

const bundle = (overrides: Partial<TacoBundle> = {}): TacoBundle => ({
  format: 'taco/files',
  version: 1,
  docId: 'doc-1',
  title: 'Review',
  root: 'docs',
  files: [markdown('docs/spec.md', '# Spec\n\nSee [the plan](plan.md).\n')],
  ...overrides,
})

const thread = (overrides: Partial<TacoCommentThread> = {}): TacoCommentThread => ({
  id: 'thread-1',
  status: 'open',
  createdAt: '2026-09-26T10:00:00.000Z',
  updatedAt: '2026-09-26T10:00:00.000Z',
  anchor: {
    path: 'docs/spec.md',
    position: { start: 2, end: 6 },
    quote: { exact: 'Spec', prefix: '# ', suffix: '' },
  },
  messages: [
    { id: 'message-1', author: 'Arcadia', body: 'Please expand this.', createdAt: '2026-09-26T10:00:00.000Z' },
  ],
  ...overrides,
})

const codes = (target: TacoBundle, renderErrors: Array<{ path: string; message: string }> = []) =>
  validateDocument(target, renderErrors).findings.map((finding) => finding.code)

describe('validateDocument', () => {
  it('passes a bundle whose links, anchors and structure are intact', () => {
    const target = bundle({
      files: [
        markdown('docs/spec.md', '# Spec\n\nSee [the plan](plan.md).\n'),
        markdown('docs/plan.md', '# Plan\n'),
      ],
      comments: [thread()],
    })
    const result = validateDocument(target)

    expect(result.findings).toEqual([])
    expect(result.counts).toEqual({ error: 0, warning: 0, info: 0 })
    expect(result.ok).toBe(true)
    expect(result.securityVersion).toBeTruthy()
    expect(result.issues).toEqual([])
  })

  it('reports a comment whose quoted text no longer exists', () => {
    const target = bundle({
      files: [markdown('docs/spec.md', '# Rewritten\n')],
      comments: [thread()],
    })

    expect(codes(target)).toContain('comment-anchor-stale')
    expect(validateDocument(target).ok).toBe(true)
  })

  it('separates a moved quote from a deleted one', () => {
    const target = bundle({
      files: [markdown('docs/spec.md', '# Draft\n\nSome preamble.\n\n# Spec\n')],
      comments: [thread()],
    })

    expect(codes(target)).toContain('comment-anchor-drifted')
  })

  it('treats an anchor into a missing file as an error', () => {
    const target = bundle({
      files: [markdown('docs/plan.md', '# Plan\n')],
      comments: [thread()],
    })
    const result = validateDocument(target)

    expect(result.findings.map((finding) => finding.code)).toContain('comment-anchor-missing-file')
    expect(result.ok).toBe(false)
  })

  it('checks that relative links resolve inside the bundle', () => {
    const target = bundle({
      files: [markdown('docs/spec.md', '# Spec\n\n[a](plan.md) [b](missing.md) [c](../../etc/passwd) [d](https://example.com) [e](#anchor)\n')],
    })

    expect(codes(target)).toEqual(expect.arrayContaining(['markdown-link-missing', 'markdown-link-escapes-root']))
  })

  it('resolves links against the linking file, not the bundle root', () => {
    const target = bundle({
      root: 'repo',
      files: [
        markdown('repo/docs/spec.md', '# Spec\n\nSee [model](model.md).\n'),
        markdown('repo/docs/model.md', '# Model\n'),
      ],
    })

    expect(codes(target)).toEqual([])
  })

  it('flags navigation that points at files the bundle does not have', () => {
    const target = bundle({
      navigation: {
        version: 1,
        entry: 'gone.md',
        groups: [
          { id: 'group-1', title: 'Empty', paths: ['nowhere.md'] },
          { id: 'group-2', title: 'Real', paths: ['spec.md'] },
        ],
      },
    })

    expect(codes(target)).toEqual(
      expect.arrayContaining(['navigation-path-missing', 'navigation-group-empty', 'navigation-entry-missing']),
    )
  })

  it('surfaces transplanted Checkpoint documents as missing', () => {
    const target = bundle({
      checkpoints: {
        version: 1,
        nodes: [
          { id: 'spec', title: 'Specification', after: [], documents: [{ path: 'docs/spec.md' }] },
          { id: 'plan', title: 'Plan', after: ['spec'], documents: [{ path: 'docs/plan.md' }] },
        ],
        documents: [{ path: 'docs/gone.md', status: 'complete', updatedAt: '2026-09-26T10:00:00.000Z' }],
      },
    })
    const result = validateDocument(target)
    const reported = result.findings.map((finding) => finding.code)

    expect(reported).toContain('checkpoint-document-missing')
    expect(reported).toContain('checkpoint-status-unlinked')
  })

  it('keeps unknown fields informational, and render failures fatal', () => {
    const intact = bundle({
      files: [markdown('docs/spec.md', '# Spec\n\nSee [the plan](plan.md).\n'), markdown('docs/plan.md', '# Plan\n')],
    })
    const unknown = { ...intact, vendorField: { keep: true } } as unknown as TacoBundle
    const unknownResult = validateDocument(unknown)
    expect(unknownResult.findings.map((finding) => finding.code)).toEqual(['unknown-bundle-field'])
    expect(unknownResult.findings[0].severity).toBe('info')
    expect(unknownResult.ok).toBe(true)

    const broken = validateDocument(intact, [{ path: 'docs/spec.md', message: 'block migration failed' }])
    expect(broken.findings.map((finding) => finding.code)).toEqual(['render-failed'])
    expect(broken.ok).toBe(false)
  })

  it('reports duplicate file ids before the store repairs them', () => {
    const target = bundle({
      files: [
        markdown('docs/spec.md', '# Spec\n', { id: 'shared' }),
        markdown('docs/plan.md', '# Plan\n', { id: 'shared' }),
      ],
    })

    expect(codes(target)).toContain('duplicate-file-id')
  })
})
