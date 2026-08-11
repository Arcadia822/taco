import { describe, expect, it } from 'vitest'
import { createTextAnchor, resolveTextAnchor } from '../src/comments.ts'

describe('local comment anchors', () => {
  it('stores exact text with surrounding context', () => {
    const text = 'Alpha repeated phrase omega'
    const anchor = createTextAnchor('spec/spec.md', text, 6, 21)
    expect(anchor.quote).toEqual({ exact: 'repeated phrase', prefix: 'Alpha ', suffix: ' omega' })
  })

  it('reanchors a quote after text is inserted before it', () => {
    const anchor = createTextAnchor('spec/spec.md', 'Before target text after', 7, 18)
    expect(resolveTextAnchor('Inserted. Before target text after', anchor)).toEqual({ start: 17, end: 28 })
  })

  it('uses quote context to disambiguate repeated text', () => {
    const text = 'first target end. second target finish.'
    const anchor = createTextAnchor('spec/spec.md', text, 25, 31)
    const changed = `prefix ${text}`
    expect(resolveTextAnchor(changed, anchor)).toEqual({ start: 32, end: 38 })
  })

  it('returns null when the quoted text was removed', () => {
    const anchor = createTextAnchor('spec/spec.md', 'Before target after', 7, 13)
    expect(resolveTextAnchor('Before replacement after', anchor)).toBeNull()
  })
})
