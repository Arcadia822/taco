import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import mermaid from 'mermaid'

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
})
