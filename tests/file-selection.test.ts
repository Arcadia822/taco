import { describe, expect, it } from 'vitest'
import {
  filePathFromHash,
  fileSelectionHash,
  headingFromHash,
  resolveDocumentLink,
  selectedPathForLoad,
  serializeFileSelection,
  storedFileSelection,
  usesUrlHashForFileSelection,
} from '../src/file-selection.ts'

describe('file selection navigation', () => {
  it('keeps URL hashes for served Taco pages', () => {
    const stored = serializeFileSelection('specs/demo/tasks.md', '#specs%2Fdemo%2Fspec.md')

    expect(selectedPathForLoad('https:', '#specs%2Fdemo%2Fplan.md', stored)).toBe('specs/demo/plan.md')
    expect(usesUrlHashForFileSelection('https:')).toBe(true)
  })

  it('restores offline selection without changing the file URL', () => {
    const hash = '#specs%2Fdemo%2Fspec.md'
    const stored = serializeFileSelection('specs/demo/tasks.md', hash)

    expect(selectedPathForLoad('file:', hash, stored)).toBe('specs/demo/tasks.md')
    expect(usesUrlHashForFileSelection('file:')).toBe(false)
  })

  it('honors a newly opened offline deep link instead of stale session state', () => {
    const stored = serializeFileSelection('specs/demo/tasks.md', '#specs%2Fdemo%2Fspec.md')

    expect(selectedPathForLoad('file:', '#specs%2Fdemo%2Fplan.md', stored)).toBe('specs/demo/plan.md')
  })

  it('parses heading hashes and rejects malformed state safely', () => {
    expect(filePathFromHash('#specs%2Fdemo%2Fspec.md::outcome')).toBe('specs/demo/spec.md')
    expect(filePathFromHash('#%E0%A4%A')).toBe('')
    expect(storedFileSelection('{broken')).toBeNull()
  })
})

describe('document links', () => {
  const root = 'taco'
  const from = 'taco/功能/01-Taco.md'

  it('resolves repository-style relative links against the linking file', () => {
    expect(resolveDocumentLink(root, from, '02-Taco-Skill.md')).toEqual({ kind: 'internal', path: 'taco/功能/02-Taco-Skill.md', heading: '' })
    expect(resolveDocumentLink(root, from, '../指南/03-检查点.md#2-四种状态')).toEqual({ kind: 'internal', path: 'taco/指南/03-检查点.md', heading: '2-四种状态' })
    expect(resolveDocumentLink(root, from, './%E8%B7%AF%E7%BA%BF%E5%9B%BE.md')).toEqual({ kind: 'internal', path: 'taco/功能/路线图.md', heading: '' })
  })

  it('treats a leading slash as the bundle root and a bare hash as the current file', () => {
    expect(resolveDocumentLink(root, from, '/路线图.md')).toEqual({ kind: 'internal', path: 'taco/路线图.md', heading: '' })
    expect(resolveDocumentLink(root, from, '#渲染')).toEqual({ kind: 'internal', path: from, heading: '渲染' })
  })

  it('keeps web links external and never resolves outside the bundle', () => {
    expect(resolveDocumentLink(root, from, 'https://example.com/a.md')).toEqual({ kind: 'external', href: 'https://example.com/a.md' })
    expect(resolveDocumentLink(root, from, '../../outside.md')).toEqual({ kind: 'unsupported' })
    expect(resolveDocumentLink(root, from, '../../../../etc/passwd')).toEqual({ kind: 'unsupported' })
    expect(resolveDocumentLink(root, from, 'file:///tmp/a.md')).toEqual({ kind: 'unsupported' })
    expect(resolveDocumentLink(root, from, 'javascript:alert(1)')).toEqual({ kind: 'unsupported' })
    // A malformed escape is kept literally: it stays inside the bundle as a name nothing matches.
    expect(resolveDocumentLink(root, from, '%E0%A4%A.md')).toEqual({ kind: 'internal', path: 'taco/功能/%E0%A4%A.md', heading: '' })
  })
})

describe('hash heading contract', () => {
  it('decodes the fragment exactly once, in either direction', () => {
    // A link to a heading that literally contains '%' must survive the round trip.
    const hash = fileSelectionHash('taco/指南/02-在线评审.md', '50%-done')
    expect(headingFromHash(hash)).toBe('50%-done')
    expect(filePathFromHash(hash)).toBe('taco/指南/02-在线评审.md')
    // Encoded percent (`%25`) decodes to the literal heading text.
    expect(headingFromHash('#taco%2Fentry.md::%25')).toBe('%')
  })

  it('never throws on malformed or missing fragments', () => {
    expect(headingFromHash('#taco/entry.md')).toBe('')
    expect(headingFromHash('#taco/entry.md::%E0%A4%A')).toBe('%E0%A4%A')
    expect(headingFromHash('')).toBe('')
  })

  it('decodes link fragments once to the same heading text', () => {
    expect(resolveDocumentLink('taco', 'taco/entry.md', '#50%-done')).toEqual({ kind: 'internal', path: 'taco/entry.md', heading: '50%-done' })
    expect(resolveDocumentLink('taco', 'taco/entry.md', '#%25')).toEqual({ kind: 'internal', path: 'taco/entry.md', heading: '%' })
  })
})
