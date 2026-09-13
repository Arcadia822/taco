import { type Editor } from '@tiptap/core'
import { partitionMarkdownBlocks } from './markdown-block-partitioner.ts'

export interface BlockBaseline {
  id: string
  raw: string
  spaceAfter: string
  initialJson: string
}

export class MarkdownBlockReconstructor {
  private baselines = new Map<string, BlockBaseline>()

  /**
   * Initializes block baselines from the file's original text and the mounted editor.
   */
  init(content: string, editor: Editor): void {
    const partitioned = partitionMarkdownBlocks(content)
    this.baselines.clear()

    const doc = editor.state.doc
    if (doc.childCount === partitioned.length) {
      doc.forEach((node, _offset, index) => {
        const id = String(node.attrs.tacoBlockId ?? `block-${index}`)
        const p = partitioned[index]
        this.baselines.set(id, {
          id,
          raw: p.raw,
          spaceAfter: p.spaceAfter,
          initialJson: JSON.stringify(node.toJSON()),
        })
      })
    }
  }

  /**
   * Reconstructs the full markdown document by preserving the EXACT original raw text of
   * unchanged blocks, and only reserializing blocks that were actually modified or added.
   */
  reconstruct(editor: Editor): string {
    const doc = editor.state.doc
    const manager = (editor.storage as unknown as { markdown?: { manager?: { renderNodes: (nodes: unknown[]) => string } } })?.markdown?.manager

    if (!this.baselines.size || !manager) {
      return editor.getMarkdown()
    }

    const pieces: string[] = []
    doc.forEach((node, _offset, index) => {
      const id = String(node.attrs.tacoBlockId ?? '')
      const baseline = id ? this.baselines.get(id) : undefined
      const currentJson = JSON.stringify(node.toJSON())

      if (baseline && baseline.initialJson === currentJson) {
        // This block is 100% untouched by the user: use its exact original raw bytes!
        pieces.push(baseline.raw + baseline.spaceAfter)
        return
      }

      // Block was modified by user or is newly inserted:
      const rendered = manager.renderNodes([node.toJSON()])
      const separator = index < doc.childCount - 1 ? '\n\n' : ''
      pieces.push(rendered.trim() + separator)
    })

    return pieces.join('')
  }
}
