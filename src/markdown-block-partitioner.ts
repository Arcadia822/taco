import { marked } from 'marked'
import { splitFrontmatter } from './frontmatter.ts'

export interface PartitionedBlock {
  type: string
  raw: string
  spaceAfter: string
}

/** Partition source bytes, not marked's newline-normalized token strings. */
export function partitionMarkdownBlocks(content: string): PartitionedBlock[] {
  const frontmatter = splitFrontmatter(content)?.raw ?? ''
  const body = content.slice(frontmatter.length)
  const blocks: PartitionedBlock[] = frontmatter
    ? [{ type: 'documentProperties', raw: frontmatter, spaceAfter: '' }]
    : []
  let offset = 0
  let leading = ''

  for (const token of marked.lexer(body)) {
    const start = offset
    for (const character of token.raw) {
      if (character === '\n' && body[offset] === '\r') {
        offset += body[offset + 1] === '\n' ? 2 : 1
      } else {
        // A lexer transformation other than newline normalization cannot be mapped safely.
        if (!body.startsWith(character, offset)) return [{ type: 'unmapped', raw: content, spaceAfter: '' }]
        offset += character.length
      }
    }
    const raw = body.slice(start, offset)
    if (token.type === 'space') {
      if (blocks.length) blocks[blocks.length - 1].spaceAfter += raw
      else leading += raw
    } else {
      blocks.push({ type: token.type, raw: leading + raw, spaceAfter: '' })
      leading = ''
    }
  }
  if (offset !== body.length) return [{ type: 'unmapped', raw: content, spaceAfter: '' }]
  if (leading) blocks.push({ type: 'space', raw: leading, spaceAfter: '' })
  return blocks
}
