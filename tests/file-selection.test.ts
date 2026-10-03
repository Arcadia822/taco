import { describe, expect, it } from 'vitest'
import {
  filePathFromHash,
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
    expect(resolveDocumentLink(root, from, '%E0%A4%A.md')).toEqual({ kind: 'unsupported' })
  })
})
