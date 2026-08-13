import { isMap, isScalar, isSeq, parseDocument, type Document, type Node as YamlNode, type Pair } from 'yaml'

export type FrontmatterValueKind = 'string' | 'number' | 'boolean' | 'null' | 'list' | 'complex'

export interface FrontmatterEntry {
  key: string
  value: unknown
  kind: FrontmatterValueKind
}

export interface FrontmatterBlock {
  bom: boolean
  closed: boolean
  eol: '\n' | '\r\n'
  yaml: string
  body: string
  raw: string
}

export type FrontmatterResult =
  | { kind: 'none'; body: string }
  | { kind: 'invalid'; block: FrontmatterBlock; message: string }
  | { kind: 'valid'; block: FrontmatterBlock; document: Document.Parsed; entries: FrontmatterEntry[] }

const openingDelimiter = /^---[ \t]*$/
const closingDelimiter = /^---[ \t]*$/

const splitLines = (value: string): Array<{ text: string; start: number; end: number; after: number }> => {
  const lines: Array<{ text: string; start: number; end: number; after: number }> = []
  let start = 0
  while (start <= value.length) {
    const newline = value.indexOf('\n', start)
    const after = newline === -1 ? value.length : newline + 1
    const end = newline === -1 ? value.length : (newline > start && value[newline - 1] === '\r' ? newline - 1 : newline)
    lines.push({ text: value.slice(start, end), start, end, after })
    if (newline === -1) break
    start = after
  }
  return lines
}

export const splitFrontmatter = (markdown: string): FrontmatterBlock | null => {
  const bom = markdown.startsWith('\uFEFF')
  const offset = bom ? 1 : 0
  const source = markdown.slice(offset)
  const lines = splitLines(source)
  if (!lines.length || !openingDelimiter.test(lines[0].text)) return null
  const eol: '\n' | '\r\n' = source.slice(lines[0].end, lines[0].after) === '\r\n' ? '\r\n' : '\n'
  const closing = lines.slice(1).find((line) => closingDelimiter.test(line.text))
  if (!closing) {
    const yaml = source.slice(lines[0].after)
    return { bom, closed: false, eol, yaml, body: '', raw: markdown }
  }
  const yaml = source.slice(lines[0].after, closing.start).replace(/\r?\n$/, '')
  const body = source.slice(closing.after)
  const raw = markdown.slice(0, offset + closing.after)
  return { bom, closed: true, eol, yaml, body, raw }
}

const valueKind = (node: YamlNode | null | undefined): FrontmatterValueKind => {
  if (isSeq(node)) return node.items.every((item) => isScalar(item)) ? 'list' : 'complex'
  if (!isScalar(node)) return 'complex'
  if (node.value === null) return 'null'
  if (typeof node.value === 'boolean') return 'boolean'
  if (typeof node.value === 'number') return 'number'
  return 'string'
}

const parseYaml = (yaml: string): { document: Document.Parsed; entries: FrontmatterEntry[] } | { message: string } => {
  const document = parseDocument(yaml, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  })
  if (document.errors.length) return { message: document.errors[0].message }
  if (document.contents !== null && !isMap(document.contents)) {
    return { message: 'Frontmatter must contain a YAML mapping.' }
  }
  const entries: FrontmatterEntry[] = []
  if (isMap(document.contents)) {
    let values: Map<unknown, unknown>
    try {
      values = document.toJS({ mapAsMap: true, maxAliasCount: 100 }) as Map<unknown, unknown>
    } catch (error) {
      return { message: error instanceof Error ? error.message : String(error) }
    }
    for (const item of document.contents.items as Pair[]) {
      if (!isScalar(item.key) || typeof item.key.value !== 'string') {
        return { message: 'Every frontmatter property key must be a string.' }
      }
      const node = item.value as YamlNode | null
      entries.push({
        key: item.key.value,
        value: values.get(item.key.value) ?? null,
        kind: valueKind(node),
      })
    }
  }
  return { document, entries }
}

export const parseFrontmatter = (markdown: string): FrontmatterResult => {
  const block = splitFrontmatter(markdown)
  if (!block) return { kind: 'none', body: markdown }
  if (!block.closed) return { kind: 'invalid', block, message: 'Frontmatter is missing a closing --- delimiter.' }
  const parsed = parseYaml(block.yaml)
  if ('message' in parsed) return { kind: 'invalid', block, message: parsed.message }
  return { kind: 'valid', block, ...parsed }
}

export const parseFrontmatterYaml = (yaml: string): Exclude<FrontmatterResult, { kind: 'none' }> => {
  const block: FrontmatterBlock = { bom: false, closed: true, eol: '\n', yaml, body: '', raw: `---\n${yaml}\n---\n` }
  const parsed = parseYaml(yaml)
  return 'message' in parsed
    ? { kind: 'invalid', block, message: parsed.message }
    : { kind: 'valid', block, ...parsed }
}

const documentYaml = (document: Document.Parsed): string => {
  if (document.contents === null || (isMap(document.contents) && document.contents.items.length === 0)) return ''
  return String(document).replace(/\r?\n$/, '')
}

const requireValidDocument = (yaml: string): Document.Parsed => {
  const parsed = parseYaml(yaml)
  if ('message' in parsed) throw new Error(parsed.message)
  return parsed.document
}

export const setFrontmatterProperty = (yaml: string, key: string, value: unknown): string => {
  const document = requireValidDocument(yaml)
  document.set(key, value)
  return documentYaml(document)
}

export const deleteFrontmatterProperty = (yaml: string, key: string): string => {
  const document = requireValidDocument(yaml)
  document.delete(key)
  return documentYaml(document)
}

export const renameFrontmatterProperty = (yaml: string, key: string, nextKey: string): string => {
  const document = requireValidDocument(yaml)
  if (!isMap(document.contents)) return yaml
  if (document.has(nextKey)) throw new Error(`Property “${nextKey}” already exists.`)
  const pair = document.contents.items.find((item) => isScalar(item.key) && item.key.value === key)
  if (!pair) return yaml
  pair.key = document.createNode(nextKey) as typeof pair.key
  return documentYaml(document)
}

export const serializeFrontmatter = (yaml: string, body: string, options: { bom?: boolean; eol?: '\n' | '\r\n' } = {}): string => {
  const eol = options.eol ?? '\n'
  const bom = options.bom ? '\uFEFF' : ''
  const normalizedYaml = yaml.replace(/\r?\n/g, eol).replace(new RegExp(`${eol}$`), '')
  return `${bom}---${eol}${normalizedYaml}${normalizedYaml ? eol : ''}---${eol}${body}`
}

export const frontmatterString = (markdown: string, key: string): string | null => {
  const parsed = parseFrontmatter(markdown)
  if (parsed.kind !== 'valid') return null
  const entry = parsed.entries.find((candidate) => candidate.key === key)
  return entry?.kind === 'string' ? String(entry.value) : null
}

export const frontmatterTitle = (markdown: string): string | null => {
  const title = frontmatterString(markdown, 'title')?.trim()
  return title || null
}

export const replaceFrontmatterProperty = (markdown: string, key: string, value: unknown | undefined): string => {
  const parsed = parseFrontmatter(markdown)
  if (parsed.kind === 'invalid') throw new Error(parsed.message)
  if (parsed.kind === 'none') {
    if (value === undefined) return markdown
    return serializeFrontmatter(setFrontmatterProperty('', key, value), markdown)
  }
  const yaml = value === undefined
    ? deleteFrontmatterProperty(parsed.block.yaml, key)
    : setFrontmatterProperty(parsed.block.yaml, key, value)
  if (!yaml.trim()) return parsed.block.body
  return serializeFrontmatter(yaml, parsed.block.body, parsed.block)
}
