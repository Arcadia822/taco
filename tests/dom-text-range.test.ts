import { describe, expect, it } from 'vitest'
import { domRange, textOffset } from '../src/dom-text-range.ts'

describe('DOM text range mapping', () => {
  it('maps a selection across nested text nodes to text offsets and back', () => {
    const root = document.createElement('article')
    root.innerHTML = '<p>Alpha <strong>bravo</strong></p><p> charlie</p>'
    const startNode = root.querySelector('strong')!.firstChild!
    const endNode = root.querySelectorAll('p')[1].firstChild!

    const start = textOffset(root, startNode, 1)
    const end = textOffset(root, endNode, 5)
    const restored = domRange(root, start, end)

    expect({ start, end }).toEqual({ start: 7, end: 16 })
    expect(restored?.toString()).toBe('ravo char')
  })

  it('preserves ranges whose boundary falls between adjacent text nodes', () => {
    const root = document.createElement('article')
    root.append('left', document.createElement('span'), 'right')
    root.querySelector('span')!.textContent = '-'

    expect(domRange(root, 4, 6)?.toString()).toBe('-r')
  })

  it('uses the same UTF-16 offsets as DOM Range for astral characters', () => {
    const root = document.createElement('article')
    root.innerHTML = '<p>A😀<em>B</em></p>'
    const paragraphText = root.querySelector('p')!.firstChild!
    const emphasizedText = root.querySelector('em')!.firstChild!

    const start = textOffset(root, paragraphText, 1)
    const end = textOffset(root, emphasizedText, 1)

    expect({ start, end }).toEqual({ start: 1, end: 4 })
    expect(domRange(root, start, end)?.toString()).toBe('😀B')
  })

  it('rejects invalid or stale offsets', () => {
    const root = document.createElement('article')
    root.textContent = 'short'

    expect(domRange(root, -1, 2)).toBeNull()
    expect(domRange(root, 4, 3)).toBeNull()
    expect(domRange(root, 0, 99)).toBeNull()
  })
})
