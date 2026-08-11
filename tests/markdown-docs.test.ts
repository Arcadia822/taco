import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const featureRoot = join(process.cwd(), 'specs/001-taco-bento-product')
const projectReadme = join(process.cwd(), 'README.md')
const bundledReadme = join(featureRoot, 'README.md')
const bundledHtmlPreview = join(featureRoot, 'prototypes/taco-preview.html')

const markdownFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name)
  if (entry.isDirectory()) return markdownFiles(path)
  return entry.isFile() && entry.name.endsWith('.md') ? [path] : []
})

describe('bundled Markdown documents', () => {
  it('uses document metadata and H2 sections instead of in-body H1 titles', () => {
    const files = markdownFiles(featureRoot)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/^# /m)
    }
  })

  it('keeps only Taco scope in each leading property block', () => {
    for (const file of markdownFiles(featureRoot)) {
      const properties: string[] = []
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue
        const match = line.match(/^\*\*([^*]+)\*\*:/)
        if (match) properties.push(match[1])
        break
      }
      expect(properties.every((key) => key === 'Taco scope'), file).toBe(true)
    }
  })

  it('uses one identical open-source README in the repository and default Taco', () => {
    expect(readFileSync(bundledReadme, 'utf8')).toBe(readFileSync(projectReadme, 'utf8'))
  })

  it('ships a self-contained HTML file in the default Taco preview', () => {
    const html = readFileSync(bundledHtmlPreview, 'utf8')
    expect(html).toContain('<title>Taco HTML Preview Demo</title>')
    expect(html).toContain('<style>')
    expect(html).not.toMatch(/<(?:script|link)\b/i)
    expect(html).not.toMatch(/(?:src|href)=["']https?:/i)
  })
})
