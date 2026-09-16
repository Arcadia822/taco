import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseBundle } from '../src/model.ts'

const templatesDir = resolve(__dirname, '../extensions/taco/templates')

describe('Template Packs integrity and empty Taco files', () => {
  const packs = ['spec', 'architecture', 'api-reference', 'adr']

  it('contains all required files for each template pack', () => {
    for (const pack of packs) {
      const dir = resolve(templatesDir, pack)
      expect(existsSync(resolve(dir, 'README.md')), `${pack}/README.md missing`).toBe(true)
      expect(existsSync(resolve(dir, 'template.md')), `${pack}/template.md missing`).toBe(true)
      expect(existsSync(resolve(dir, 'bundle.json')), `${pack}/bundle.json missing`).toBe(true)
      expect(existsSync(resolve(dir, 'empty.taco.html')), `${pack}/empty.taco.html missing`).toBe(true)
    }
  })

  it('provides valid bundle.json data loadable by parseBundle', () => {
    for (const pack of packs) {
      const bundlePath = resolve(templatesDir, pack, 'bundle.json')
      const json = readFileSync(bundlePath, 'utf8')
      const parsed = parseBundle(json)
      expect(parsed.ok, `Failed to parse bundle.json for ${pack}`).toBe(true)
      if (parsed.ok) {
        expect(parsed.bundle.format).toBe('taco/files')
        expect(parsed.bundle.files.length).toBeGreaterThan(0)
        expect(parsed.bundle.navigation?.version).toBe(1)
        expect(parsed.bundle.navigation?.groups.length).toBeGreaterThan(0)
      }
    }
  })

  it('embeds valid bundle in empty.taco.html', () => {
    const DATA_BLOCK = /<script\b[^>]*\bid=["']taco-document["'][^>]*>([\s\S]*?)<\/script>/i
    for (const pack of packs) {
      const htmlPath = resolve(templatesDir, pack, 'empty.taco.html')
      const html = readFileSync(htmlPath, 'utf8')
      const match = html.match(DATA_BLOCK)
      expect(match, `empty.taco.html for ${pack} missing #taco-document`).not.toBeNull()
      const parsed = parseBundle(match![1])
      expect(parsed.ok, `Failed to parse bundle in empty.taco.html for ${pack}`).toBe(true)
    }
  })
})
