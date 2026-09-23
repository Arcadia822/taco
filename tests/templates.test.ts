import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { parseBundle } from '../src/model.ts'

const canonicalTemplatesDir = resolve(__dirname, '../extensions/taco/templates')
const skillTemplatesDir = resolve(__dirname, '../skills/taco/templates')
const skillShellPath = resolve(__dirname, '../skills/taco/taco-shell.html')

const DATA_BLOCK = /<script\b[^>]*\bid=["']taco-document["'][^>]*>([\s\S]*?)<\/script>/i

const listFiles = (directory: string, base = directory): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return []
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) return listFiles(absolute, base)
    return entry.isFile() ? [relative(base, absolute).split(sep).join('/')] : []
  })

describe('Template Packs integrity and empty Taco files', () => {
  const packs = ['spec', 'architecture', 'api-reference', 'adr']

  it('ships only the supported document example packs', () => {
    const shipped = readdirSync(canonicalTemplatesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(shipped).toEqual([...packs].sort())
  })

  it('contains all required files for each template pack', () => {
    for (const pack of packs) {
      const dir = resolve(canonicalTemplatesDir, pack)
      expect(existsSync(resolve(dir, 'README.md')), `${pack}/README.md missing`).toBe(true)
      expect(existsSync(resolve(dir, 'template.md')), `${pack}/template.md missing`).toBe(true)
      expect(existsSync(resolve(dir, 'bundle.json')), `${pack}/bundle.json missing`).toBe(true)
      expect(existsSync(resolve(dir, 'empty.taco.html')), `${pack}/empty.taco.html missing`).toBe(
        true,
      )
    }
  })

  it('provides valid bundle.json data loadable by parseBundle', () => {
    for (const pack of packs) {
      const bundlePath = resolve(canonicalTemplatesDir, pack, 'bundle.json')
      const json = readFileSync(bundlePath, 'utf8')
      const parsed = parseBundle(json)
      expect(parsed.ok, `Failed to parse bundle.json for ${pack}`).toBe(true)
      if (parsed.ok) {
        expect(parsed.bundle.format).toBe('taco/files')
        expect(parsed.bundle.files.length).toBeGreaterThan(0)
      }
    }
  })

  it('embeds valid bundle in empty.taco.html', () => {
    for (const pack of packs) {
      const htmlPath = resolve(canonicalTemplatesDir, pack, 'empty.taco.html')
      const html = readFileSync(htmlPath, 'utf8')
      const match = html.match(DATA_BLOCK)
      expect(match, `empty.taco.html for ${pack} missing #taco-document`).not.toBeNull()
      const parsed = parseBundle(match![1])
      expect(parsed.ok, `Failed to parse bundle in empty.taco.html for ${pack}`).toBe(true)
    }
  })

  it('installs the same template files the checkout generates, with no local copies', () => {
    const canonical = listFiles(canonicalTemplatesDir).sort()
    expect(canonical.length).toBeGreaterThan(0)
    expect(listFiles(skillTemplatesDir).sort()).toEqual(canonical)
    for (const file of canonical) {
      const installed = readFileSync(join(skillTemplatesDir, file))
      expect(
        installed.equals(readFileSync(join(canonicalTemplatesDir, file))),
        `${file} differs from the generated template`,
      ).toBe(true)
    }
  })

  it('installs a shell whose document block is empty until an agent writes one', () => {
    const html = readFileSync(skillShellPath, 'utf8')
    const match = html.match(DATA_BLOCK)
    expect(match, 'skill shell is missing #taco-document').not.toBeNull()
    const parsed = parseBundle(match![1])
    expect(parsed.ok, 'skill shell must not ship an embedded document').toBe(false)
    if (!parsed.ok) expect(parsed.err).toBe('empty')
  })
})
