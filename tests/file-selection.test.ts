import { describe, expect, it } from 'vitest'
import {
  filePathFromHash,
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
