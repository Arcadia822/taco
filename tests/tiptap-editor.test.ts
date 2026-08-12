import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createTacoEditorExtensions, migrateTacoBundleBlocks } from '../src/tiptap-editor.ts'
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
  it('renders leading Markdown properties as an editable two-column component', () => {
    const markdown = [
      '**Feature Directory**: `specs/001-product`',
      '',
      '**Created**: 2026-08-10',
      '',
      '**Status**: Draft',
      '',
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
    expect(Array.from(editor.view.dom.querySelectorAll('.document-property-key')).map((node) => node.textContent)).toEqual([
      'Feature Directory', 'Created', 'Status',
    ])
    expect(editor.getMarkdown()).toContain('**Feature Directory**: `specs/001-product`')
    expect(editor.getMarkdown()).toContain('**Created**: 2026-08-10')
    expect(editor.getMarkdown()).toContain('## Outcome')
    expect(editor.view.dom.querySelectorAll('.document-properties .document-property-key')).toHaveLength(3)
    expect(editor.view.dom.querySelector('li')?.textContent).toContain('FR-001')
  })

  it('keeps the scope enum in Markdown while hiding it from the document view', () => {
    editor = new Editor({
      extensions: createTacoEditorExtensions(labels),
      content: '**Taco scope**: plan\n\n## Design\n\n**Decision**: Keep Markdown canonical.',
      contentType: 'markdown',
    })

    expect(editor.view.dom.querySelectorAll('.document-properties')).toHaveLength(1)
    expect(editor.view.dom.querySelector('.document-property[data-internal="true"]')?.hasAttribute('hidden')).toBe(true)
    expect(editor.getMarkdown()).toContain('**Taco scope**: plan')
    expect(Array.from(editor.view.dom.querySelectorAll('p strong')).map((node) => node.textContent)).toContain('Decision')
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
    expect(bundle.files[0].blocks?.[0].html).toContain('src="docs/assets/taco-overview.png"')
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
    expect(editor.view.dom.querySelector('.taco-centered-block img')?.getAttribute('src')).toBe('src/assets/taco-logo.svg')
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
