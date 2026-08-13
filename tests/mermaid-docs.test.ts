import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import mermaid from 'mermaid'
import { sanitizeMermaidSvg } from '../src/security.ts'

const documents = [
  'README.md',
  'README.zh-CN.md',
  'specs/001-taco-bento-product/data-model.md',
  'specs/001-taco-bento-product/contracts/taco-document.md',
  'specs/001-taco-bento-product/interaction-design.md',
  'specs/001-taco-bento-product/plan.md',
]

describe('embedded technical diagrams', () => {
  it.each(documents)('parses every Mermaid fence in %s', async (path) => {
    const markdown = await readFile(path, 'utf8')
    const diagrams = Array.from(markdown.matchAll(/```mermaid\n([\s\S]*?)\n```/g), (match) => match[1])
    expect(diagrams.length).toBeGreaterThan(0)
    for (const diagram of diagrams) await expect(mermaid.parse(diagram)).resolves.toBeTruthy()
  })

  it('keeps class diagram labels after the SVG security boundary', async () => {
    const svgPrototype = SVGElement.prototype as unknown as {
      getBBox?: () => { x: number; y: number; width: number; height: number }
      getComputedTextLength?: () => number
    }
    const originalBox = svgPrototype.getBBox
    const originalLength = svgPrototype.getComputedTextLength
    Object.defineProperty(svgPrototype, 'getBBox', {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 100, height: 20 }),
    })
    Object.defineProperty(svgPrototype, 'getComputedTextLength', {
      configurable: true,
      value(this: SVGElement) { return (this.textContent?.length ?? 0) * 8 },
    })

    try {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        htmlLabels: false,
      })
      const { svg } = await mermaid.render('taco-class-regression', [
        'classDiagram',
        'class TacoBundle {',
        '+string format',
        '}',
        'class TacoFile {',
        '+string path',
        '}',
        'TacoBundle "1" *-- "1..*" TacoFile : files',
      ].join('\n'))
      const sanitized = sanitizeMermaidSvg(svg)

      expect(svg).not.toContain('<foreignObject')
      expect(sanitized).toContain('TacoBundle')
      expect(sanitized).toContain('TacoFile')
      expect(sanitized).toContain('files')
      const parsed = new DOMParser().parseFromString(sanitized, 'image/svg+xml')
      expect(parsed.querySelectorAll('text').length).toBeGreaterThan(0)
      expect(Array.from(parsed.querySelectorAll('text')).every((text) =>
        text.getAttribute('fill') === 'currentColor' && text.getAttribute('stroke') === 'none'))
        .toBe(true)
      expect(Array.from(parsed.querySelectorAll('marker.composition, marker.aggregation, marker.dependency, marker.lollipop')).every((marker) =>
        Number(marker.getAttribute('markerWidth')) <= 20 && Number(marker.getAttribute('markerHeight')) <= 28))
        .toBe(true)
      expect(Array.from(parsed.querySelectorAll('path.relation')).every((path) => path.getAttribute('fill') === 'none'))
        .toBe(true)
      expect(Array.from(parsed.querySelectorAll('.edgeLabel rect.background')).every((rect) => rect.getAttribute('fill') === 'none'))
        .toBe(true)
    } finally {
      if (originalBox) Object.defineProperty(svgPrototype, 'getBBox', { configurable: true, value: originalBox })
      else Reflect.deleteProperty(svgPrototype, 'getBBox')
      if (originalLength) Object.defineProperty(svgPrototype, 'getComputedTextLength', { configurable: true, value: originalLength })
      else Reflect.deleteProperty(svgPrototype, 'getComputedTextLength')
    }
  })
})
