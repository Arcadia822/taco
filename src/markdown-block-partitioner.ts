import { marked } from 'marked'
import { splitFrontmatter } from './frontmatter.ts'

export interface PartitionedBlock {
  type: string
  raw: string
  spaceAfter: string
}

/**
 * Losslessly partitions a markdown document into top-level blocks.
 * `blocks.map(b => b.raw + b.spaceAfter).join('') === content` is strictly guaranteed.
 */
export function partitionMarkdownBlocks(content: string): PartitionedBlock[] {
  let frontmatter = ''
  let body = content
  const fm = splitFrontmatter(content)
  if (fm) {
    frontmatter = fm.raw
    body = content.slice(frontmatter.length)
  }

  const allTokens = marked.lexer(body)
  const blocks: PartitionedBlock[] = []

  if (frontmatter) {
    blocks.push({
      type: 'documentProperties',
      raw: frontmatter,
      spaceAfter: '',
    })
  }

  for (let i = 0; i < allTokens.length; i++) {
    const t = allTokens[i]
    if (t.type === 'space') {
      if (blocks.length > 0) {
        blocks[blocks.length - 1].spaceAfter += t.raw
      } else if (frontmatter) {
        // leading space before first token
        blocks[0].spaceAfter += t.raw
      }
      continue
    }
    blocks.push({
      type: t.type,
      raw: t.raw,
      spaceAfter: '',
    })
  }

  return blocks
}
