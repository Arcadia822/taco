import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import mermaid from 'mermaid'
import { sanitizeMermaidSvg } from '../src/security.ts'
import { ensureMermaidConfig, extractMermaidThemeFromCode, updateMermaidCodeTheme, updateMermaidDirection } from '../src/mermaid.ts'
import { parse as parseYaml } from 'yaml'

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

      const readme = await readFile('README.md', 'utf8')
      const flowSource = readme.match(/```mermaid\n([\s\S]*?)\n```/)?.[1]
      expect(flowSource).toBeTruthy()
      const { svg: flowSvg } = await mermaid.render('taco-flow-regression', flowSource!)
      const flow = new DOMParser().parseFromString(sanitizeMermaidSvg(flowSvg), 'image/svg+xml')

      const text = Array.from(flow.querySelectorAll('text')).map((node) => node.textContent).join(' ')
      expect(text).toContain('speckit.specify')
      expect(text).toContain('Conflicts?')
    } finally {
      if (originalBox) Object.defineProperty(svgPrototype, 'getBBox', { configurable: true, value: originalBox })
      else Reflect.deleteProperty(svgPrototype, 'getBBox')
      if (originalLength) Object.defineProperty(svgPrototype, 'getComputedTextLength', { configurable: true, value: originalLength })
      else Reflect.deleteProperty(svgPrototype, 'getComputedTextLength')
    }
  })

  it('changes the outer direction without rewriting nested diagram directions', () => {
    const flow = 'flowchart LR\nsubgraph Nested\n  direction BT\n  A --> B\nend\nB --> C'
    expect(updateMermaidDirection(flow, 'TB')).toBe(flow.replace('flowchart LR', 'flowchart TB'))
    const states = 'stateDiagram-v2\nstate Nested {\n  direction LR\n  A --> B\n}\nNested --> Done'
    expect(updateMermaidDirection(states, 'BT')).toMatch(/^stateDiagram-v2\n[ \t]*direction BT\nstate Nested \{\n  direction LR\n  A --> B\n\}\nNested --> Done$/)
    const sequence = 'sequenceDiagram\nAlice->>Bob: direction LR'
    expect(updateMermaidDirection(sequence, 'TB')).toBe(sequence)
  })

  it('preserves explicit layout and custom theme settings when changing themes', () => {
    const source = '%%{init: {"layout":"dagre","theme":"forest","themeVariables":{"primaryColor":"#ff00ff"}}}%%\nflowchart LR\nA --> B'
    const migrated = ensureMermaidConfig(source)
    expect(extractMermaidThemeFromCode(migrated)).toBe('forest')
    expect(ensureMermaidConfig(migrated)).toBe(migrated)
    const changed = updateMermaidCodeTheme(source, 'neutral')
    expect(extractMermaidThemeFromCode(changed)).toBe('neutral')
    const parts = changed.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)!
    expect(parseYaml(parts[1]).config).toMatchObject({ layout: 'dagre', themeVariables: { primaryColor: '#ff00ff' } })
    expect(parts[2]).toBe('flowchart LR\nA --> B')
  })

  it('does not replace a partially edited configuration with a second directive', () => {
    const source = '%%{init: {"theme": "forest", "themeVariables": } }%%\nflowchart LR\nA --> B'
    expect(ensureMermaidConfig(source)).toBe(source)
    expect(updateMermaidCodeTheme(source, 'dark')).toBe(source)
  })
})
