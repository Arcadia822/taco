import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createTacoEditorExtensions } from '../src/tiptap-editor.ts'

const labels = { source: 'S', hidePreview: 'H', zoom: 'Z', zoomIn: 'I', zoomOut: 'O', resetZoom: 'R', zoomLevel: 'L', close: 'C', previewTitle: 'P', copy: 'C', copied: 'C', copyFailed: 'F', comment: 'C', auto: 'A', plainText: 'T', loading: 'L', error: 'E' }
const ext = () => createTacoEditorExtensions(labels, { renderMermaid: false })

/**
 * Emphasis wrapping a code span is valid GFM, but the Markdown parser appends
 * marks without honouring `excludes`. When `code` excluded emphasis, the parsed
 * document carried `[bold, code]` on one text node, ProseMirror rejected it as
 * an invalid mark collection, and the editor fell back to the source view for
 * the whole file.
 */
describe('emphasis wrapping a code span', () => {
  it.each([
    ['**`root` bold code**', '<strong><code>root</code> bold code</strong>', '**`root` bold code**'],
    ['*`root` italic code*', '<em><code>root</code> italic code</em>', '*`root` italic code*'],
    ['~~`root` strike code~~', '<s><code>root</code> strike code</s>', '~~`root` strike code~~'],
    // The serializer canonicalizes underscore emphasis to asterisks; that is
    // pre-existing behavior, unrelated to the mark set being legal.
    ['_`root` underscore italic_', '<em><code>root</code> underscore italic</em>', '*`root` underscore italic*'],
    ['**bold with `code` inside**', '<strong>bold with <code>code</code> inside</strong>', '**bold with `code` inside**'],
    ['**bold `a` and `b` both**', '<strong>bold <code>a</code> and <code>b</code> both</strong>', '**bold `a` and `b` both**'],
  ])('loads and round-trips %s', (markdown, html, canonical) => {
    const editor = new Editor({ extensions: ext(), content: markdown, contentType: 'markdown' })
    expect(() => editor.state.doc.check()).not.toThrow()
    expect(editor.getHTML()).toBe(`<p>${html}</p>`)
    expect(editor.getMarkdown()).toBe(canonical)
    editor.destroy()
  })

  it('keeps code marks unique so a code span never carries two code marks', () => {
    const editor = new Editor({ extensions: ext(), content: '`a` and **`b`**', contentType: 'markdown' })
    const markCounts: number[] = []
    editor.state.doc.descendants((node) => {
      if (node.isText) markCounts.push(node.marks.filter((mark) => mark.type.name === 'code').length)
    })
    expect(markCounts.length).toBeGreaterThan(0)
    expect(markCounts.every((count) => count <= 1)).toBe(true)
    editor.destroy()
  })
})
