import { describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { createTacoEditorExtensions, normalizeNodeMarks } from '../src/tiptap-editor.ts'
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

describe('redundant nested emphasis normalization (TACO-47)', () => {
  it.each([
    ['**__x__**', 'x', '<strong>x</strong>', ['bold']],
    ['****x****', 'x', '<strong>x</strong>', ['bold']],
    ['*_x_*', 'x', '<em>x</em>', ['italic']],
    ['~~a ~~b~~ c~~', 'a b c', '<s>a b c</s>', ['strike']],
    ['**a **b** c**', 'a b c', '<strong>a b c</strong>', ['bold']],
    ['**_x_**', 'x', '<strong><em>x</em></strong>', ['bold', 'italic']],
    ['**__`x`__**', 'x', '<strong><code>x</code></strong>', ['bold', 'code']],
  ])('normalizes %s cleanly', (markdown, expectedText, expectedInnerHtml, expectedMarks) => {
    const editor = new Editor({ extensions: ext(), content: markdown, contentType: 'markdown' })
    expect(() => editor.state.doc.check()).not.toThrow()
    expect(editor.getText().trim()).toBe(expectedText)
    expect(editor.getHTML()).toBe(`<p>${expectedInnerHtml}</p>`)

    editor.state.doc.descendants((node) => {
      if (node.isText) {
        const markTypes = node.marks.map((m) => m.type.name)
        // Each mark type must occur at most once
        const uniqueMarkTypes = new Set(markTypes)
        expect(markTypes.length).toBe(uniqueMarkTypes.size)
        for (const expectedMark of expectedMarks) {
          expect(markTypes).toContain(expectedMark)
        }
      }
    })
    editor.destroy()
  })

  it('normalizer unit test: exact deduplication, ranking sort, and idempotency', () => {
    const editor = new Editor({ extensions: ext() })
    const schema = editor.schema

    // Double and triple JSON marks: bold, italic, strike, code, link with same attrs
    const sampleNode: JSONContent = {
      type: 'text',
      text: 'hello',
      marks: [
        { type: 'bold' },
        { type: 'italic' },
        { type: 'bold' },
        { type: 'strike' },
        { type: 'italic' },
        { type: 'link', attrs: { href: 'https://example.com', title: 'Example' } },
        { type: 'link', attrs: { href: 'https://example.com', title: 'Example' } },
      ],
    }

    const normalized = normalizeNodeMarks(structuredClone(sampleNode), schema)
    const types = normalized.marks?.map((m) => m.type)
    expect(types).toEqual(['link', 'bold', 'italic', 'strike'])

    // Idempotent: normalize(normalize(x)) == normalize(x)
    const normalizedAgain = normalizeNodeMarks(structuredClone(normalized), schema)
    expect(normalizedAgain).toEqual(normalized)

    // Conflicting links with different hrefs are preserved and will fail schema validation (not silently discarded)
    const conflictingLinksNode: JSONContent = {
      type: 'text',
      text: 'conflict',
      marks: [
        { type: 'link', attrs: { href: 'https://a.com', title: null } },
        { type: 'link', attrs: { href: 'https://b.com', title: null } },
      ],
    }
    const normalizedConflict = normalizeNodeMarks(structuredClone(conflictingLinksNode), schema)
    expect(normalizedConflict.marks).toHaveLength(2)

    // Unknown mark throws error in schema resolution (does not swallow error)
    const unknownMarkNode: JSONContent = {
      type: 'text',
      text: 'unknown',
      marks: [{ type: 'nonExistentMark' }],
    }
    expect(() => normalizeNodeMarks(structuredClone(unknownMarkNode), schema)).toThrow()

    editor.destroy()
  })

  it('parser integration across setContent, insertContent, insertContentAt and parse methods', () => {
    const editor = new Editor({
      extensions: ext(),
      content: '# Initial',
      contentType: 'markdown',
    })

    // 1. setContent
    editor.commands.setContent('**__set-content-bold__**', { contentType: 'markdown' })
    expect(() => editor.state.doc.check()).not.toThrow()
    expect(editor.getHTML()).toContain('<strong>set-content-bold</strong>')

    // 2. insertContent
    editor.commands.insertContent(' ****insert-bold****', { contentType: 'markdown' })
    expect(() => editor.state.doc.check()).not.toThrow()
    expect(editor.getText()).toContain('insert-bold')

    // 3. insertContentAt
    editor.commands.insertContentAt(editor.state.doc.content.size, ' *_insert-at-italic_*', { contentType: 'markdown' })
    expect(() => editor.state.doc.check()).not.toThrow()
    expect(editor.getText()).toContain('insert-at-italic')

    // 4. public editor.markdown.parse and storage.markdown.manager.parse
    const parsedPublic = editor.markdown!.parse('**__public-parse__**')
    const textNodePublic = parsedPublic.content?.[0]?.content?.[0]
    expect(textNodePublic?.marks).toEqual([{ type: 'bold' }])

    const parsedStorage = editor.storage.markdown.manager.parse('**__storage-parse__**')
    const textNodeStorage = parsedStorage.content?.[0]?.content?.[0]
    expect(textNodeStorage?.marks).toEqual([{ type: 'bold' }])

    // 5. Nested containers: blockquote, list, table
    const nestedMarkdown = `
> **__nested blockquote__**

- **__nested list item__**

| Col 1 |
| --- |
| **__nested table cell__** |
`.trim()

    editor.commands.setContent(nestedMarkdown, { contentType: 'markdown' })
    expect(() => editor.state.doc.check()).not.toThrow()
    expect(editor.getText()).toContain('nested blockquote')
    expect(editor.getText()).toContain('nested list item')
    expect(editor.getText()).toContain('nested table cell')

    // 6. Linked image: linked-image href/title and image semantics preserved
    const linkedImageMarkdown = '[![Alt text](image.png "Image Title")](https://example.com "Link Title")'
    editor.commands.setContent(linkedImageMarkdown, { contentType: 'markdown' })
    expect(() => editor.state.doc.check()).not.toThrow()
    const html = editor.getHTML()
    expect(html).toContain('data-taco-source="image.png"')
    expect(html).toContain('href="https://example.com"')

    editor.destroy()
  })
})
