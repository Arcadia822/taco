import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { blockHtml, blocksFromEditor, createTacoEditorExtensions, ensureTacoBlockIds } from '../src/tiptap-editor.ts'
import { MarkdownBlockReconstructor } from '../src/markdown-block-reconstructor.ts'

const labels = { source: 'S', hidePreview: 'H', zoom: 'Z', zoomIn: 'I', zoomOut: 'O', resetZoom: 'R', zoomLevel: 'L', close: 'C', previewTitle: 'P', copy: 'C', copied: 'C', copyFailed: 'F', comment: 'C', auto: 'A', plainText: 'T', loading: 'L', error: 'E' }
const ext = () => createTacoEditorExtensions(labels, { renderMermaid: false })

const embeds: Array<[string, string]> = [
  ['<video controls src="https://cdn.example/a.mp4"></video>', '<video'],
  ['<audio controls src="https://cdn.example/a.mp3"></audio>', '<audio'],
  ['<iframe src="https://www.youtube.com/embed/x"></iframe>', '<iframe'],
  ['<video controls>\n  <source src="a.mp4" type="video/mp4">\n</video>', '<source'],
]

describe('markdown media embed round trip', () => {
  it.each(embeds)('preserves %s through blocks and reconstruction', (embed, marker) => {
    const source = `${embed}\n\nTail text`
    const editor = new Editor({ extensions: ext(), content: source, contentType: 'markdown' })
    ensureTacoBlockIds(editor, 'media', true)
    expect(() => editor.state.doc.check()).not.toThrow()

    const blocks = blocksFromEditor(editor, ext())
    const html = blockHtml(blocks)
    expect(html).toContain(marker)

    const reopened = new Editor({ extensions: ext(), content: html, parseOptions: { preserveWhitespace: 'full' } })
    ensureTacoBlockIds(reopened, 'media', true)
    expect(() => reopened.state.doc.check()).not.toThrow()
    const hasEmbed = reopened.state.doc.toJSON().content?.some((node: { type: string; content?: Array<{ type: string }> }) =>
      node.type === 'mediaEmbed' || node.type === 'inlineMediaEmbed'
      || node.content?.some((child) => child.type === 'mediaEmbed' || child.type === 'inlineMediaEmbed'))
    expect(hasEmbed).toBe(true)

    const reconstructor = new MarkdownBlockReconstructor()
    reconstructor.init(source, reopened)
    const output = reconstructor.reconstruct(reopened)
    expect(output).toContain(marker)
    expect(output.endsWith('Tail text')).toBe(true)
    reopened.destroy()
    editor.destroy()
  })

  it('keeps a centered div, paragraphs, and an embed intact together', () => {
    const source = '<div align="center">\n<h1>T</h1>\n</div>\n\n<p>First</p>\n<p>Second</p>\n\n<video controls src="a.mp4"></video>\n\nText'
    const editor = new Editor({ extensions: ext(), content: source, contentType: 'markdown' })
    ensureTacoBlockIds(editor, 'mixed', true)
    expect(() => editor.state.doc.check()).not.toThrow()
    const names: string[] = []
    editor.state.doc.forEach((node) => names.push(node.type.name))
    expect(names[0]).toBe('centeredBlock')
    // The lone embed inside a paragraph context parses as an inline child,
    // never a top-level node, so assert on descendants.
    const nodeTypes: string[] = []
    editor.state.doc.descendants((node) => {
      nodeTypes.push(node.type.name)
    })
    expect(nodeTypes).toContain('inlineMediaEmbed')
    const reconstructor = new MarkdownBlockReconstructor()
    reconstructor.init(source, editor)
    expect(reconstructor.reconstruct(editor)).toBe(source)
    editor.destroy()
  })
})
