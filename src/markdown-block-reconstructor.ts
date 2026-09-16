import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { partitionMarkdownBlocks } from './markdown-block-partitioner.ts'

interface BlockBaseline {
  nodes: ProseMirrorNode[]
  index: number
  raw: string
  spaceAfter: string
  nextId: string | undefined
}

export class MarkdownBlockReconstructor {
  private baselines = new Map<string, BlockBaseline>()
  private definitions: Array<{ raw: string; index: number }> = []
  private original = ''
  private initialDoc: ProseMirrorNode | null = null
  private eol = '\n'

  init(content: string, editor: Editor): void {
    this.original = content
    this.initialDoc = editor.state.doc
    this.eol = content.match(/\r\n|\r|\n/)?.[0] ?? '\n'
    this.baselines.clear()
    this.definitions = []
    const partitioned = partitionMarkdownBlocks(content)
    const nodes: ProseMirrorNode[] = []
    editor.state.doc.forEach((node) => { nodes.push(node) })
    let index = 0

    for (const block of partitioned) {
      if (block.type === 'def') {
        this.definitions.push({ raw: block.raw + block.spaceAfter, index })
        continue
      }
      if (block.type === 'unmapped') { this.baselines.clear(); return }
      // HTML and implicit blank paragraphs may produce more than one editor node.
      const parsed = editor.storage.markdown.manager.parse(block.raw.replace(/(?:\r\n|\r|\n)+$/, '')).content ?? []
      let count = parsed.length
      const group = nodes.slice(index, index + count)
      if (!count || group.length !== count || group.some((node, i) => node.type.name !== parsed[i].type)) {
        this.baselines.clear()
        return
      }
      while (nodes[index + count]?.type.name === 'paragraph' && nodes[index + count].childCount === 0) {
        group.push(nodes[index + count])
        count++
      }
      const baseline = { nodes: group, index, raw: block.raw, spaceAfter: block.spaceAfter, nextId: nodes[index + count]?.attrs.tacoBlockId as string | undefined }
      for (const node of group) {
        const id = node.attrs.tacoBlockId
        if (id) this.baselines.set(String(id), baseline)
      }
      index += count
    }
    if (index !== nodes.length) this.baselines.clear()
  }

  reconstruct(editor: Editor): string {
    const doc = editor.state.doc
    // Even an unsupported block mapping must not create a diff on no-op or undo.
    if (this.initialDoc?.eq(doc)) return this.original
    if (!this.baselines.size) {
      const markdown = editor.getMarkdown()
      return this.definitions.length
        ? markdown.replace(/(?:\r\n|\r|\n)+$/, '') + this.eol.repeat(2) + this.definitions.map((definition) => definition.raw).join('')
        : markdown
    }

    const nodes: ProseMirrorNode[] = []
    doc.forEach((node) => { nodes.push(node) })
    const pieces: string[] = []
    let index = 0
    let definitionIndex = 0
    let previousBaseline: BlockBaseline | undefined
    let previousShapeChanged = false
    const separate = (): void => {
      if (!pieces.length) return
      const last = pieces.length - 1
      // 如果上一块的末尾已有换行（例如 baseline.spaceAfter），则不再多加
      const endings = pieces[last].match(/(?:\r\n|\r|\n)+$/)?.[0] ?? ''
      const count = endings.match(/\r\n|\r|\n/g)?.length ?? 0
      if (count === 0) pieces[last] += this.eol.repeat(2)
      else if (count === 1) pieces[last] += this.eol
    }
    while (index < nodes.length) {
      const baseline = this.baselines.get(String(nodes[index].attrs.tacoBlockId ?? ''))
      const group = [nodes[index++]]
      if (baseline) {
        while (index < nodes.length && this.baselines.get(String(nodes[index].attrs.tacoBlockId ?? '')) === baseline) {
          group.push(nodes[index++])
        }
      }
      // Reference definitions have no editor node and must outlive adjacent deletions.
      while (definitionIndex < this.definitions.length && baseline
        && this.definitions[definitionIndex].index <= baseline.index) {
        separate()
        pieces.push(this.definitions[definitionIndex++].raw)
      }
      const shapeChanged = !baseline || baseline.nodes.length !== group.length
        || group.some((node, i) => node.type !== baseline.nodes[i].type)
      if (pieces.length && (shapeChanged || previousShapeChanged
        || previousBaseline?.nextId !== group[0].attrs.tacoBlockId)) separate()
      const unchanged = baseline && baseline.nodes.length === group.length
        && group.every((node, i) => node.eq(baseline.nodes[i]))
      let piece: string
      if (unchanged) {
        piece = baseline.raw + baseline.spaceAfter
      } else {
        const rendered = editor.storage.markdown.manager.serialize({ type: 'doc', content: group.map((node) => node.toJSON()) })
        const prefix = baseline?.raw.match(/^(?:[ \t]*(?:\r\n|\r|\n))+/)?.[0] ?? ''
        const trailing = baseline?.raw.match(/(?:\r\n|\r|\n)+$/)?.[0] ?? ''
        piece = prefix + rendered.replace(/\n+$/, '').replace(/\r\n|\r|\n/g, this.eol)
          + trailing + (baseline?.spaceAfter ?? '')
      }
      previousBaseline = baseline
      previousShapeChanged = shapeChanged
      pieces.push(piece)
    }
    while (definitionIndex < this.definitions.length) {
      separate()
      pieces.push(this.definitions[definitionIndex++].raw)
    }
    return pieces.join('')
  }
}
