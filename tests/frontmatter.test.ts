import { describe, expect, it } from 'vitest'
import {
  deleteFrontmatterProperty,
  frontmatterString,
  frontmatterTitle,
  parseFrontmatter,
  renameFrontmatterProperty,
  replaceFrontmatterProperty,
  serializeFrontmatter,
  setFrontmatterProperty,
  splitFrontmatter,
} from '../src/frontmatter.ts'

describe('YAML frontmatter', () => {
  it('parses a leading mapping without treating later rules as frontmatter', () => {
    const markdown = [
      '---',
      'title: "YAML properties"',
      'status: Draft',
      'tags:',
      '  - taco',
      '  - editor',
      'nested:',
      '  owner: Arcadia',
      '---',
      '## Objective',
      '',
      '---',
    ].join('\n')

    const parsed = parseFrontmatter(markdown)
    expect(parsed.kind).toBe('valid')
    if (parsed.kind !== 'valid') return
    expect(parsed.entries.map(({ key, kind }) => [key, kind])).toEqual([
      ['title', 'string'],
      ['status', 'string'],
      ['tags', 'list'],
      ['nested', 'complex'],
    ])
    expect(parsed.block.body).toBe('## Objective\n\n---')
    expect(frontmatterTitle(markdown)).toBe('YAML properties')
  })

  it('requires frontmatter to start at byte zero except for a BOM', () => {
    expect(parseFrontmatter('\n---\ntitle: Late\n---\nBody').kind).toBe('none')
    expect(frontmatterTitle('\uFEFF---\r\ntitle: BOM\r\n---\r\nBody')).toBe('BOM')
    expect(splitFrontmatter('\uFEFF---\r\ntitle: BOM\r\n---\r\nBody')?.eol).toBe('\r\n')
  })

  it('reports invalid and unterminated YAML without discarding source', () => {
    const duplicate = parseFrontmatter('---\ntitle: One\ntitle: Two\n---\nBody')
    expect(duplicate.kind).toBe('invalid')
    expect(duplicate.kind === 'invalid' ? duplicate.block.body : '').toBe('Body')

    const unterminated = parseFrontmatter('---\ntitle: Missing close\nBody')
    expect(unterminated.kind).toBe('invalid')
    expect(unterminated.kind === 'invalid' ? unterminated.block.raw : '').toContain('Missing close')

    const aliases = parseFrontmatter([
      '---',
      'a: &a [x, x]',
      'b: &b [*a, *a]',
      'c: &c [*b, *b]',
      'd: &d [*c, *c]',
      'e: &e [*d, *d]',
      'f: &f [*e, *e]',
      'g: [*f, *f]',
      '---',
    ].join('\n'))
    expect(aliases.kind).toBe('invalid')
  })

  it('preserves comments and order while setting, renaming, and deleting properties', () => {
    const original = 'title: "Quoted" # keep\nstatus: Draft\ntags: [one, two]'
    const titled = setFrontmatterProperty(original, 'title', 'Changed')
    expect(titled).toContain('title: "Changed" # keep')
    expect(titled.indexOf('title:')).toBeLessThan(titled.indexOf('status:'))

    const renamed = renameFrontmatterProperty(titled, 'status', 'state')
    expect(renamed).toContain('state: Draft')
    expect(() => renameFrontmatterProperty(renamed, 'state', 'title')).toThrow(/already exists/)

    const deleted = deleteFrontmatterProperty(renamed, 'tags')
    expect(deleted).not.toContain('tags:')
    expect(deleted).toContain('# keep')
  })

  it('adds, updates, and removes canonical frontmatter around an unchanged body', () => {
    const body = '## Body\n\nExact trailing spaces.  '
    const added = replaceFrontmatterProperty(body, 'title', 'Document')
    expect(added).toBe('---\ntitle: Document\n---\n' + body)
    expect(frontmatterString(added, 'title')).toBe('Document')

    const scoped = replaceFrontmatterProperty(added, 'taco_scope', 'plan')
    expect(scoped).toContain('taco_scope: plan')
    expect(scoped.endsWith(body)).toBe(true)

    const withoutTitle = replaceFrontmatterProperty(scoped, 'title', undefined)
    expect(withoutTitle).not.toContain('title:')
    const empty = replaceFrontmatterProperty(withoutTitle, 'taco_scope', undefined)
    expect(empty).toBe(body)
  })

  it('serializes BOM and CRLF intentionally', () => {
    expect(serializeFrontmatter('title: CRLF', 'Body\r\n', { bom: true, eol: '\r\n' }))
      .toBe('\uFEFF---\r\ntitle: CRLF\r\n---\r\nBody\r\n')
  })
})
