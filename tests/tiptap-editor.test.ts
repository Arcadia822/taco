import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { blockHtml, createTacoEditorExtensions, migrateTacoBundleBlocks } from '../src/tiptap-editor.ts'
import { setEditorFrontmatterProperty } from '../src/tiptap-document-properties.ts'
import type { TacoBundle } from '../src/model.ts'

const labels = {
  source: 'Edit Mermaid source',
  hidePreview: 'Return to Mermaid preview',
  zoom: 'Enlarge Mermaid diagram',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetZoom: 'Reset zoom',
  zoomLevel: 'Current zoom level',
  close: 'Close',
  previewTitle: 'Mermaid diagram',
  copy: 'Copy code',
  copied: 'Code copied',
  copyFailed: 'Could not copy code',
  comment: 'Comment on entire code block',
  auto: 'Auto',
  plainText: 'Plain text',
  loading: 'Rendering diagram…',
  error: 'Invalid Mermaid syntax.',
}

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('Tiptap Markdown integration', () => {
  it('renders YAML frontmatter as an editable property component', () => {
    const markdown = [
      '---',
      'title: Property editor',
      'created: 2026-08-10',
      'status: Draft',
      'tags: [taco, editor]',
      '---',
      '## Outcome',
      '',
      'Readable Markdown.',
      '',
      '- **FR-001**: This list item is not document metadata.',
    ].join('\n')

    editor = new Editor({
      extensions: createTacoEditorExtensions(labels),
      content: markdown,
      contentType: 'markdown',
    })

    expect(editor.view.dom.querySelectorAll('.document-properties')).toHaveLength(1)
    expect(Array.from(editor.view.dom.querySelectorAll<HTMLInputElement>('.document-property-key')).map((node) => node.value)).toEqual([
      'title', 'created', 'status', 'tags',
    ])
    expect(editor.getMarkdown()).toContain('title: Property editor')
    expect(editor.getMarkdown()).toContain('created: 2026-08-10')
    expect(editor.getMarkdown()).toContain('## Outcome')
    expect(editor.view.dom.querySelectorAll('.document-properties .document-property-key')).toHaveLength(4)
    expect(editor.view.dom.querySelectorAll('.document-property-chip')).toHaveLength(2)
    expect(editor.view.dom.querySelector('li')?.textContent).toContain('FR-001')
  })

  it('keeps an invalid open-enum scope and exposes accessible validation', () => {
    editor = new Editor({
      extensions: createTacoEditorExtensions(labels),
      content: '---\ntaco_scope: design\n---\n## Design\n\n**Decision**: Keep Markdown canonical.',
      contentType: 'markdown',
    })

    expect(editor.view.dom.querySelectorAll('.document-properties')).toHaveLength(1)
    expect(editor.view.dom.querySelector('.document-property.is-invalid')).not.toBeNull()
    expect(editor.view.dom.querySelector('[name="taco_scope"]')?.getAttribute('aria-invalid')).toBe('true')
    expect(editor.getMarkdown()).toContain('taco_scope: design')
    expect(Array.from(editor.view.dom.querySelectorAll('p strong')).map((node) => node.textContent)).toContain('Decision')
  })

  it('preserves a non-text title while refusing to use it as a display title', () => {
    editor = new Editor({
      extensions: createTacoEditorExtensions(labels),
      content: '---\ntitle: 42\n---\n## Body',
      contentType: 'markdown',
    })

    expect(editor.view.dom.querySelector('.document-property.is-invalid')).not.toBeNull()
    expect(editor.view.dom.querySelector('[name="title"]')?.getAttribute('aria-invalid')).toBe('true')
    expect(editor.getMarkdown()).toContain('title: 42')
  })

  it('synchronizes title through the editor frontmatter transaction', () => {
    editor = new Editor({
      extensions: createTacoEditorExtensions(labels),
      content: '## Body',
      contentType: 'markdown',
    })

    expect(setEditorFrontmatterProperty(editor, 'title', 'Created title')).toBe(true)
    expect(editor.getMarkdown()).toMatch(/^---\ntitle: Created title\n---\n\n## Body/)
    expect((editor.view.dom.querySelector('[name="title"]') as HTMLInputElement).value).toBe('Created title')

    expect(setEditorFrontmatterProperty(editor, 'title', 'Updated title')).toBe(true)
    expect(editor.getMarkdown()).toContain('title: Updated title')
    expect(setEditorFrontmatterProperty(editor, 'title', undefined)).toBe(true)
    expect(editor.getMarkdown().trimEnd()).toBe('## Body')
  })

  it('adds properties and removes empty frontmatter through undoable editor transactions', () => {
    editor = new Editor({
      extensions: createTacoEditorExtensions(labels),
      content: '---\ntitle: Only property\n---\n## Body',
      contentType: 'markdown',
    })

    const add = editor.view.dom.querySelector<HTMLButtonElement>('.document-properties-add')!
    add.click()
    expect(editor.getMarkdown()).toContain('property: ""')
    expect(editor.view.dom.querySelectorAll('.document-property')).toHaveLength(2)

    editor.view.dom.querySelector<HTMLButtonElement>('[aria-label="Remove property"]')!.click()
    editor.view.dom.querySelector<HTMLButtonElement>('[aria-label="Remove title"]')!.click()
    expect(editor.getMarkdown().trimEnd()).toBe('## Body')
    expect(editor.view.dom.querySelector('.document-properties')).toBeNull()

    expect(editor.commands.undo()).toBe(true)
    expect(editor.getMarkdown()).toContain('title: Only property')
  })

  it('preserves legacy bold metadata as ordinary editable Markdown', () => {
    editor = new Editor({
      extensions: createTacoEditorExtensions(labels),
      content: '**Status**: Draft\n\n## Body',
      contentType: 'markdown',
    })

    expect(editor.view.dom.querySelector('.document-properties')).toBeNull()
    expect(editor.getMarkdown()).toContain('**Status**: Draft')
  })

  it('warns when YAML and leading legacy metadata both define a reserved property', () => {
    editor = new Editor({
      extensions: createTacoEditorExtensions(labels),
      content: '---\ntitle: YAML title\n---\n\n**Title**: Legacy title\n\n## Body',
      contentType: 'markdown',
    })

    const warning = editor.view.dom.querySelector('.document-properties-duplicate-warning')
    expect(warning?.textContent).toContain('title')
    expect(warning?.textContent).toContain('YAML')
    expect(editor.getMarkdown()).toContain('**Title**: Legacy title')

  })

  it('round-trips headings, task lists, tables and Mermaid fences as Markdown', () => {
    const markdown = [
      '# Product',
      '',
      '- [x] Ship the editor',
      '',
      '| Item | State |',
      '| --- | --- |',
      '| Editor | Ready |',
      '',
      '```mermaid',
      'flowchart LR',
      '  Brief --> Plan',
      '```',
    ].join('\n')

    editor = new Editor({ extensions: createTacoEditorExtensions(labels) })
    const parsed = editor.markdown!.parse(markdown)
    const serialized = editor.markdown!.serialize(parsed)

    expect(serialized).toContain('# Product')
    expect(serialized).toContain('- [x] Ship the editor')
    expect(serialized).toContain('| Editor | Ready |')
    expect(serialized).toContain('```mermaid\nflowchart LR\n  Brief --> Plan\n```')
    expect(serialized).not.toContain('<h1')
  })

  it('keeps Markdown images valid while migrating a bundle to blocks', () => {
    const markdown = '![Taco overview](docs/assets/taco-overview.png)'
    const bundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId: 'image-migration',
      title: 'Image migration',
      root: 'specs/image-migration',
      files: [{
        id: 'file-readme',
        path: 'specs/image-migration/README.md',
        mediaType: 'text/markdown',
        content: markdown,
      }],
    }

    expect(() => migrateTacoBundleBlocks(bundle, labels)).not.toThrow()
    expect(bundle.files[0].blocks).toHaveLength(1)
    expect(bundle.files[0].blocks?.[0].type).toBe('image')
    expect(bundle.files[0].blocks?.[0].html).toContain('data-taco-source="docs/assets/taco-overview.png"')
    expect(bundle.files[0].blocks?.[0].html).not.toContain('src="docs/assets/taco-overview.png"')
  })

  it('keeps frontmatter source in the collaboration block HTML', () => {
    const bundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId: 'frontmatter-migration',
      title: 'Frontmatter migration',
      root: 'specs/frontmatter-migration',
      files: [{
        id: 'file-spec',
        path: 'specs/frontmatter-migration/spec.md',
        mediaType: 'text/markdown',
        content: '---\ntitle: Preserved\nstatus: Draft\n---\n## Body',
      }],
    }

    migrateTacoBundleBlocks(bundle, labels)

    expect(bundle.files[0].blocks?.[0].type).toBe('documentProperties')
    expect(bundle.files[0].blocks?.[0].html).toContain('data-yaml="title%3A%20Preserved%0Astatus%3A%20Draft"')
    expect(blockHtml(bundle.files[0].blocks)).toContain('data-yaml="title%3A%20Preserved%0Astatus%3A%20Draft"')
  })

  it('preserves a centered HTML README header as one editable block', () => {
    const markdown = [
      '<div align="center">',
      '  <img src="src/assets/taco-logo.svg" alt="Taco logo" width="96">',
      '  <h1>Taco</h1>',
      '  <p><strong>Review specs in one file.</strong></p>',
      '</div>',
    ].join('\n')

    editor = new Editor({
      extensions: createTacoEditorExtensions(labels),
      content: markdown,
      contentType: 'markdown',
    })

    expect(editor.state.doc.firstChild?.type.name).toBe('centeredBlock')
    expect(editor.view.dom.querySelector('.taco-centered-block')?.getAttribute('align')).toBe('center')
    expect(editor.view.dom.querySelector('.taco-centered-block img')?.getAttribute('src')).toMatch(/^data:image\/gif;base64,/)
    expect(editor.view.dom.querySelector('.taco-centered-block img')?.getAttribute('data-taco-source')).toBe('src/assets/taco-logo.svg')
    expect(editor.getMarkdown()).toContain('<div align="center">')
    expect(editor.getMarkdown()).toContain('</div>')
  })

  it('migrates legacy Markdown to identical unique blocks before peers connect', () => {
    const original: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId: 'block-migration',
      title: 'Block migration',
      root: 'specs/block-migration',
      files: [{
        id: 'file-spec',
        path: 'specs/block-migration/spec.md',
        mediaType: 'text/markdown',
        content: 'Same paragraph.\n\nSame paragraph.',
      }],
    }
    const left = structuredClone(original)
    const right = structuredClone(original)

    migrateTacoBundleBlocks(left, labels)
    migrateTacoBundleBlocks(right, labels)

    const leftIds = left.files[0].blocks!.map((block) => block.id)
    const rightIds = right.files[0].blocks!.map((block) => block.id)
    expect(leftIds).toEqual(rightIds)
    expect(new Set(leftIds).size).toBe(leftIds.length)
    expect(left.files[0].blocks).toEqual(right.files[0].blocks)
  })
})
