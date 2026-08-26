import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commentPrincipal } from '../src/identity.ts'

describe('comment principal', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('persists one opaque principal per document and separates documents', () => {
    const first = commentPrincipal('doc-a')
    expect(first.persistent).toBe(true)
    expect(commentPrincipal('doc-a')).toEqual(first)
    expect(commentPrincipal('doc-b').id).not.toBe(first.id)
    expect(first.id).not.toContain('Ada')
  })

  it('uses a stable session fallback when local persistence fails', () => {
    const originalSetItem = Storage.prototype.setItem
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (this === localStorage) throw new Error('blocked')
      return Reflect.apply(originalSetItem, this, [key, value])
    })
    const first = commentPrincipal('doc-fallback')
    expect(first.persistent).toBe(false)
    expect(commentPrincipal('doc-fallback')).toEqual(first)
    set.mockRestore()
  })
})
