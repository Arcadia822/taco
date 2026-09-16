import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { readFileSync } from 'node:fs'
import { blockHtml, createTacoEditorExtensions, ensureTacoBlockIds, migrateTacoBundleBlocks } from '../src/tiptap-editor.ts'
import { partitionMarkdownBlocks } from '../src/markdown-block-partitioner.ts'
import { MarkdownBlockReconstructor } from '../src/markdown-block-reconstructor.ts'
import type { TacoBundle } from '../src/model.ts'

const labels = {
  source: 'Source', hidePreview: 'Preview', zoom: 'Zoom', zoomIn: 'In', zoomOut: 'Out',
  resetZoom: 'Reset', zoomLevel: 'Level', close: 'Close', previewTitle: 'Diagram',
  copy: 'Copy', copied: 'Copied', copyFailed: 'Failed', comment: 'Comment',
  auto: 'Auto', plainText: 'Text', loading: 'Loading', error: 'Error',
}
const editors: Editor[] = []
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()) })

function mount(content: string) {
  const bundle: TacoBundle = { format: 'taco/files', version: 1, docId: 'markdown-review', title: 'Review', root: 'specs/review', files: [{ id: 'spec', path: 'specs/review/spec.md', mediaType: 'text/markdown', content }] }
  expect(migrateTacoBundleBlocks(bundle, labels)).toEqual([])
  const editor = new Editor({ extensions: createTacoEditorExtensions(labels, { renderMermaid: false }), content: blockHtml(bundle.files[0].blocks), parseOptions: { preserveWhitespace: 'full' } })
  editors.push(editor)
  ensureTacoBlockIds(editor, 'spec', false)
  const reconstructor = new MarkdownBlockReconstructor()
  reconstructor.init(content, editor)
  return { editor, reconstructor }
}
function replaceText(editor: Editor, before: string, after: string) {
  let position = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes(before)) position = pos + node.text.indexOf(before)
  })
  expect(position).toBeGreaterThanOrEqual(0)
  editor.commands.insertContentAt({ from: position, to: position + before.length }, after)
}

describe('lossless Markdown reconstruction', () => {
  it.each(['\n\n# Heading\r\n\r\nText\r\n', '\n\n', '[x][id]\n\n[id]: https://example.com\n', '---\r\ntitle: X\r\n---\r\n\r\nText'])('partitions original source bytes: %j', (content) => {
    expect(partitionMarkdownBlocks(content).map((block) => block.raw + block.spaceAfter).join('')).toBe(content)
  })

  it('keeps reference definitions when their preceding block is deleted', () => {
    const content = 'Delete me.\r\n\r\n[target]: https://example.com\r\n\r\n[Keep][target]\r\n'
    const { editor, reconstructor } = mount(content)
    editor.commands.deleteRange({ from: 0, to: editor.state.doc.firstChild!.nodeSize })
    const output = reconstructor.reconstruct(editor)
    expect(output).toBe('[target]: https://example.com\r\n\r\n[Keep][target]\r\n')
    const reopened = new Editor({ extensions: createTacoEditorExtensions(labels, { renderMermaid: false }), content: output, contentType: 'markdown' })
    editors.push(reopened)
    expect(reopened.getHTML()).toContain('href="https://example.com"')
    expect(reopened.state.doc.textContent).toBe('Keep')
    editor.commands.undo()
    expect(reconstructor.reconstruct(editor)).toBe(content)
  })

  it('retains leading and trailing definitions after replacing all visible content', () => {
    const content = '[first]: https://first.example\n\nOriginal\n\n[last]: https://last.example\n'
    const { editor, reconstructor } = mount(content)
    editor.commands.setContent('<p>Replacement</p>')
    ensureTacoBlockIds(editor, 'spec', false)
    const output = reconstructor.reconstruct(editor)
    expect(output).toContain('[first]: https://first.example')
    expect(output).toContain('[last]: https://last.example')
    expect(output).not.toContain('Original')
    const reopened = new Editor({ extensions: createTacoEditorExtensions(labels, { renderMermaid: false }), content: output, contentType: 'markdown' })
    editors.push(reopened)
    expect(reopened.state.doc.textContent).toBe('Replacement')
  })

  it.each(['# Heading\nText\n', 'Text\n# Heading\n'])('preserves paragraph boundaries on both sides of a converted heading: %j', (content) => {
    const { editor, reconstructor } = mount(content)
    let headingPosition = 0
    editor.state.doc.forEach((node, offset) => { if (node.type.name === 'heading') headingPosition = offset + 1 })
    editor.commands.setTextSelection(headingPosition)
    editor.commands.setParagraph()
    const output = reconstructor.reconstruct(editor)
    const reopened = new Editor({ extensions: createTacoEditorExtensions(labels, { renderMermaid: false }), content: output, contentType: 'markdown' })
    editors.push(reopened)
    const expected: string[][] = []
    const actual: string[][] = []
    editor.state.doc.forEach((node) => { expected.push([node.type.name, node.textContent]) })
    reopened.state.doc.forEach((node) => { actual.push([node.type.name, node.textContent]) })
    expect(actual).toEqual(expected)
    expect(reopened.state.doc.childCount).toBe(2)
    editor.commands.undo()
    expect(reconstructor.reconstruct(editor)).toBe(content)
  })

  it('keeps untouched blocks and line endings when editing and undoing', () => {
    const content = '\r\n# Heading\r\n\r\nText &amp; value\r\n\r\n```js\r\nconst x = 1\r\n```\r\n'
    const { editor, reconstructor } = mount(content)
    expect(reconstructor.reconstruct(editor)).toBe(content)
    replaceText(editor, 'Text', 'Edited')
    expect(reconstructor.reconstruct(editor)).toBe(content.replace('Text', 'Edited'))
    editor.commands.undo()
    expect(reconstructor.reconstruct(editor)).toBe(content)
  })

  it('keeps Markdown entities and inline code semantics after edits', () => {
    const content = 'Text &amp;amp; and ``**Key**: value``.\n\nUntouched & plain.'
    const { editor, reconstructor } = mount(content)
    replaceText(editor, 'Text', 'Changed')
    const output = reconstructor.reconstruct(editor)
    const reopened = new Editor({ extensions: createTacoEditorExtensions(labels, { renderMermaid: false }), content: output, contentType: 'markdown' })
    editors.push(reopened)
    expect(reopened.state.doc.textContent).toBe(editor.state.doc.textContent)
    expect(reopened.getJSON().content?.[0].content?.some((node) => node.marks?.some((mark) => mark.type === 'code'))).toBe(true)
    expect(output.endsWith('Untouched & plain.')).toBe(true)
  })

  it('separates an appended block from a previously unterminated final paragraph', () => {
    const { editor, reconstructor } = mount('Original')
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: 'Appended' }] })
    ensureTacoBlockIds(editor, 'spec', false)
    expect(reconstructor.reconstruct(editor)).toBe('Original\n\nAppended')
  })

  it('persists edits inside centered HTML without changing the rest of the document', () => {
    const original = '<div align="center">\n<h1>Original</h1>\n<p><a href="https://example.com">Link</a></p>\n</div>\n\nUntouched & plain.\n'
    const { editor, reconstructor } = mount(original)
    expect(reconstructor.reconstruct(editor)).toBe(original)
    replaceText(editor, 'Original', 'Changed')
    const output = reconstructor.reconstruct(editor)
    expect(output).toContain('Changed')
    expect(output).not.toContain('Original')
    expect(output.endsWith('\n\nUntouched & plain.\n')).toBe(true)
    const reopened = new Editor({ extensions: createTacoEditorExtensions(labels, { renderMermaid: false }), content: output, contentType: 'markdown' })
    editors.push(reopened)
    expect(reopened.state.doc.firstChild?.type.name).toBe('centeredBlock')
    expect(reopened.state.doc.firstChild?.firstChild?.type.name).toBe('heading')
    expect(reopened.state.doc.textContent).toBe(editor.state.doc.textContent)
    editor.commands.undo()
    expect(reconstructor.reconstruct(editor)).toBe(original)
  })

  it.each([
    '# Heading\nText\n\nOther & text\n',
    '# Heading\n\n\n\nText\n\n\n\nOther & text\n',
    '<p>First</p>\n<p>Second</p>\n\nText\n\nOther & text',
    '[Link][target]\n\nText\n\n[target]: https://example.com\n',
    '---\ntitle: Review\n---\n\nText\n\nOther & text',
  ])('retains unrelated syntax across source boundaries: %j', (content) => {
    const { editor, reconstructor } = mount(content)
    replaceText(editor, 'Text', 'Changed')
    expect(reconstructor.reconstruct(editor)).toBe(content.replace('Text', 'Changed'))
  })

  it('does not rewrite the real README when one paragraph is edited', () => {
    const content = readFileSync('specs/001-taco-bento-product/README.md', 'utf8')
    const { editor, reconstructor } = mount(content)
    expect(reconstructor.reconstruct(editor)).toBe(content)
    replaceText(editor, 'Taco turns', 'Taco now turns')
    expect(reconstructor.reconstruct(editor)).toBe(content.replace('Taco turns', 'Taco now turns'))
  })
  it('does not produce unexpected empty lines when visual-system.md is loaded or re-rendered', () => {
    const content = readFileSync('specs/001-taco-bento-product/visual-system.md', 'utf8')
    const { editor, reconstructor } = mount(content)
    expect(reconstructor.reconstruct(editor)).toBe(content)

    // 模拟任何 docChanged 或再次触发 reconstruct
    editor.commands.insertContentAt({ from: editor.state.doc.content.size - 1, to: editor.state.doc.content.size - 1 }, ' ')
    editor.commands.undo()
    const afterUndo = reconstructor.reconstruct(editor)
    expect(afterUndo).toBe(content)
  })
})
