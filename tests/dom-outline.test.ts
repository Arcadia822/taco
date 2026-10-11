import { describe, expect, it } from 'vitest'
import { extractDomOutline } from '../.github/workflows/scripts/dom-outline.mjs'

describe('DOM Outline: real SVG tags and stable attributes', () => {
  it('extracts real SVG element tags (rect.actor, text.actor) without inventing g.actor or fictional classes', () => {
    // Use standard DOM in test environment (jsdom/happy-dom provided by vitest or simulated element tree)
    document.body.innerHTML = `
      <div class="taco-mermaid-render">
        <svg id="mermaid-seq" class="taco-mermaid-svg" width="600" height="400">
          <rect id="actor-alice" class="actor actor-box" x="10" y="10" width="100" height="50"></rect>
          <text class="actor" x="20" y="30">Alice</text>
          <rect class="actor actor-box" x="120" y="10" width="100" height="50"></rect>
          <text class="actor" x="130" y="30">Bob</text>
        </svg>
      </div>
    `

    const prevGetBoundingClientRect = window.Element.prototype.getBoundingClientRect
    const prevGetComputedStyle = window.getComputedStyle

    try {
      // @ts-ignore
      window.Element.prototype.getBoundingClientRect = () => ({
        width: 600,
        height: 400,
        top: 0,
        bottom: 400,
        left: 0,
        right: 600,
      })
      // @ts-ignore
      window.getComputedStyle = () => ({
        visibility: 'visible',
        display: 'block',
        opacity: '1',
        overflowY: 'visible',
      })
      const outlineResult = extractDomOutline()
      const { outline, interactiveElements } = outlineResult

      // Check outline lines
      expect(outline).toContain('rect#actor-alice.actor.actor-box')
      expect(outline).toContain('text.actor "Alice"')
      expect(outline).toContain('svg#mermaid-seq.taco-mermaid-svg[width="600"][height="400"] (Mermaid diagram)')

      // Crucial: Must NEVER contain fictional 'g.actor' or 'g.actor.actor-box'
      expect(outline).not.toContain('g.actor')
      expect(outline).not.toContain('g#actor-alice')
      expect(outline).not.toContain('svg#mermaid-seq.mermaid')
      expect(outline).not.toContain('[data-mermaid="diagram"]')
      // Check interactive elements selector accuracy
      const actorSelectors = interactiveElements.filter((el) => el.kind === 'sequence-actor')
      expect(actorSelectors.length).toBeGreaterThanOrEqual(2)
      expect(actorSelectors.some((el) => el.selector === '#actor-alice')).toBe(true)
      expect(actorSelectors.some((el) => el.selector === 'rect.actor' || el.selector === 'text.actor')).toBe(true)

      // Querying with the reported selector must match real elements
      const aliceEl = window.document.querySelector('#actor-alice')
      expect(aliceEl).not.toBeNull()
      expect(aliceEl?.tagName.toLowerCase()).toBe('rect')

      const rectActorEl = window.document.querySelector('rect.actor')
      expect(rectActorEl).not.toBeNull()

      // The fictional selector must find nothing
      expect(window.document.querySelector('g.actor.actor-box')).toBeNull()
    } finally {
      window.Element.prototype.getBoundingClientRect = prevGetBoundingClientRect
      window.getComputedStyle = prevGetComputedStyle
    }
  })
})
