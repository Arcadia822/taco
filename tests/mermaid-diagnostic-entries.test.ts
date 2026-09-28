import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createTacoEditorExtensions } from '../src/tiptap-editor.ts'
import { readFileSync } from 'node:fs'
import { completeHighlighter } from '../src/highlighter-lowlight.ts'
import { MermaidRuntime, type MermaidApi, type MermaidPluginLabels } from '../src/mermaid.ts'
import { setDefaultHighlighter } from '../src/source-editor.ts'
import { createStructuredFileViewer, structuredFileLabels } from '../src/structured-file-viewer.ts'
import type { TacoFile } from '../src/model.ts'

setDefaultHighlighter(completeHighlighter)

const labels: MermaidPluginLabels = {
  source: 'Source', hidePreview: 'Preview', zoom: 'Zoom', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
  resetZoom: 'Reset', zoomLevel: 'Zoom level', close: 'Close', previewTitle: 'Diagram', copy: 'Copy',
  copied: 'Copied', copyFailed: 'Copy failed', comment: 'Comment', auto: 'Auto', plainText: 'Plain text',
  loading: 'Loading', error: 'Invalid Mermaid',
  diagnostic: {
    syntax: 'Invalid Mermaid syntax', unknownType: 'No diagram type detected',
    render: 'The diagram could not be rendered', runtime: 'The Mermaid runtime is unavailable',
    noPosition: 'no position information',
    position: (line: number, column: number) => `line ${line}, column ${column}`,
    copyDetail: 'Copy original error', copied: 'Original error copied',
  },
}

const mmd = (content: string): TacoFile => ({ path: 'specs/013-lint/diagram.mmd', mediaType: 'text/plain', content })
const settle = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 30)) }

const viewer = (content: string, runtime: MermaidRuntime, onNodeComment = vi.fn()) => {
  const created = createStructuredFileViewer({
    file: mmd(content), kind: 'mermaid', labels: structuredFileLabels('en'), mermaidLabels: labels,
    mermaidRuntime: runtime, readOnly: false, sourceLabel: 'Mermaid source editor',
    onChange: vi.fn(), onNodeComment, onModeChange: vi.fn(),
  })
  document.body.append(created.element)
  return created
}

const renderingApi = (svgText: string): MermaidApi => ({
  initialize: vi.fn(),
  render: vi.fn().mockResolvedValue({ svg: `<svg xmlns="http://www.w3.org/2000/svg"><g id="taco-mermaid-1-flowchart-A-0" class="node"><text>${svgText}</text></g></svg>` }),
} as unknown as MermaidApi)

const diagnosticText = (): string => document.querySelector('.mermaid-diagnostic')?.textContent ?? ''
const diagnosticClass = (): string => document.querySelector<HTMLElement>('.mermaid-diagnostic')?.className ?? ''

describe('mermaid diagnostics in the document entries', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  })

  it('reports a syntax error with its position and the raw parser text', async () => {
    const api = {
      initialize: vi.fn(),
      // The pinned build exposes `parse`; a syntax failure is caught before render().
      parse: vi.fn().mockRejectedValue(Object.assign(new Error('Parse error on line 2:\n...t TD  A[Start] -->\n----------------^\nExpecting SQE'), {
        hash: { line: 2, loc: { first_line: 2, first_column: 10 }, token: 'EOF', expected: ["'SQE'"] },
      })),
      render: vi.fn().mockResolvedValue({ svg: '<svg><text>never</text></svg>' }),
    } as unknown as MermaidApi
    const view = viewer('flowchart TD\n  A[Start] -->\n', new MermaidRuntime(vi.fn().mockResolvedValue(api)))
    await settle()

    expect(diagnosticClass()).toContain('is-syntax')
    expect(diagnosticText()).toContain('line 2, column 10')
    expect(diagnosticText()).toContain('Invalid Mermaid syntax')
    expect(document.querySelector('.mermaid-diagnostic-detail')?.textContent).toContain('Parse error on line 2')
    // An invalid source must not reach render(); that is where leaked containers come from.
    expect(api.render).not.toHaveBeenCalled()
    expect(view.sourceEditor.input.value).toBe('flowchart TD\n  A[Start] -->\n')
  })

  it('separates an unknown diagram type from a syntax error', async () => {
    const api = {
      initialize: vi.fn(),
      parse: vi.fn().mockRejectedValue(Object.assign(new Error('No diagram type detected'), { name: 'UnknownDiagramError' })),
      render: vi.fn(),
    } as unknown as MermaidApi
    viewer('not a diagram', new MermaidRuntime(vi.fn().mockResolvedValue(api)))
    await settle()
    expect(diagnosticClass()).toContain('is-unknown-type')
    expect(diagnosticText()).toContain('No diagram type detected')
  })

  it('labels a render-stage failure as position-less instead of a syntax error', async () => {
    const api = {
      initialize: vi.fn(),
      parse: vi.fn().mockResolvedValue({ diagramType: 'flowchart-v2' }),
      render: vi.fn().mockRejectedValue(new TypeError('Cannot read properties of null')),
    } as unknown as MermaidApi
    viewer('flowchart TD\n  A --> B\n', new MermaidRuntime(vi.fn().mockResolvedValue(api)))
    await settle()
    expect(diagnosticClass()).toContain('is-render')
    expect(diagnosticText()).toContain('The diagram could not be rendered')
    expect(diagnosticText()).toContain('no position information')
    expect(diagnosticText()).not.toContain('Invalid Mermaid syntax')
  })

  it('reports an unavailable runtime as its own kind and keeps the source editable', async () => {
    viewer('flowchart TD\n  A --> B\n', new MermaidRuntime(vi.fn().mockRejectedValue(new Error('cdn offline'))))
    await settle()
    expect(diagnosticClass()).toContain('is-runtime')
    expect(diagnosticText()).toContain('The Mermaid runtime is unavailable')
    expect(diagnosticText()).not.toContain('Invalid Mermaid syntax')
    // The preview must not keep a fake progress message next to the reason.
    const surface = document.querySelector<HTMLElement>('.standalone-mermaid-preview .surface')
    expect(surface?.className).not.toContain('is-loading')
  })

  it('removes the container Mermaid leaks into document.body on every failure', async () => {
    const api = {
      initialize: vi.fn(),
      // The pinned build injects `div#d{id}` into document.body and leaves it there
      // when render() throws; the id is the one passed in.
      render: vi.fn().mockImplementation(async (id: string) => {
        const leaked = document.createElement('div')
        leaked.id = `d${id}`
        document.body.append(leaked)
        throw new Error('bad syntax')
      }),
    } as unknown as MermaidApi
    const runtime = new MermaidRuntime(vi.fn().mockResolvedValue(api))
    const view = viewer('flowchart TD\n  A[Start] -->\n', runtime)
    await settle()

    const input = view.sourceEditor.input
    for (let index = 0; index < 5; index += 1) {
      input.value = `flowchart TD\n  A[Start] --> ${index}\n`
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await settle()
    }
    expect(vi.mocked(api.render).mock.calls.length).toBeGreaterThanOrEqual(5)
    expect(
      document.querySelectorAll('body > div[id^="d"]').length,
      'five failed renders must not leave five error containers behind',
    ).toBe(0)
  })

  it('recovers the preview after the runtime comes back, without reloading', async () => {
    let online = false
    const runtime = new MermaidRuntime(vi.fn().mockImplementation(async () => {
      if (!online) throw new Error('cdn offline')
      return renderingApi('Repaired')
    }))
    const view = viewer('flowchart TD\n  A --> B\n', runtime)
    await settle()
    expect(diagnosticClass()).toContain('is-runtime')

    online = true
    // The recovery trigger is an edit / mode switch, not a new button.
    const input = view.sourceEditor.input
    input.value = 'flowchart TD\n  A --> B\n  B --> C\n'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(document.querySelector('.taco-mermaid-render svg')?.textContent).toBe('Repaired'))
    expect(document.querySelector('.mermaid-diagnostic')).toBeNull()
  })

  it('keeps the diagnostics module free of DOM-only assumptions the linter cannot make', () => {
    const kernel = readFileSync('extensions/taco/bin/mermaid-diagnostics.mjs', 'utf8')
    expect(kernel.includes('import '), 'the shared kernel must stay importable by the Node linter').toBe(false)
    expect(/\bdocument\b|\bwindow\b/.test(kernel), 'the shared kernel must not touch the DOM').toBe(false)
  })
})

describe('mermaid diagnostics in a Markdown code block', () => {
  const markdown = (diagram: string): string => `# doc\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n\ntail\n`

  const mount = (diagram: string, runtime: MermaidRuntime): Editor => {
    const element = document.createElement('div')
    element.className = 'tiptap-editor-host'
    document.body.append(element)
    return new Editor({
      element,
      extensions: createTacoEditorExtensions(labels, { renderMermaid: true, mermaidRuntime: runtime }),
      content: markdown(diagram),
      contentType: 'markdown',
    })
  }

  const block = (): HTMLElement => document.querySelector<HTMLElement>('.tiptap-code-block')!
  const state = () => ({
    diagnostic: document.querySelector('.mermaid-diagnostic')?.className ?? null,
    diagnosticText: document.querySelector('.mermaid-diagnostic')?.textContent ?? '',
    previewHidden: block().querySelector<HTMLElement>('.tiptap-code-block-preview')?.hidden,
    sourceHidden: block().querySelector<HTMLElement>('.tiptap-code-block-source')?.hidden,
    hasSvg: Boolean(block().querySelector('.surface svg')),
  })

  beforeEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  })

  it('falls back to the source with a runtime diagnostic, then draws again after an edit', async () => {
    let online = false
    const runtime = new MermaidRuntime(vi.fn().mockImplementation(async () => {
      if (!online) throw new Error('cdn offline')
      return renderingApi('Recovered')
    }))
    const editor = mount('flowchart TD\n  A --> B\n', runtime)
    await vi.waitFor(() => expect(state().diagnostic).not.toBeNull())

    expect(state().diagnostic).toContain('is-runtime')
    expect(state().previewHidden, 'an unavailable runtime falls back to the source').toBe(true)
    expect(state().sourceHidden).toBe(false)

    online = true
    // The recovery trigger is an edit, not a new control.
    editor.commands.setContent(markdown('flowchart TD\n  A --> B\n  B --> C\n'), { contentType: 'markdown' })
    await vi.waitFor(() => expect(state().hasSvg).toBe(true))
    expect(state().diagnostic, 'the diagnostic clears once the diagram draws').toBeNull()
    expect(state().previewHidden, 'the preview must become visible again').toBe(false)
    expect(state().sourceHidden, 'the source must go back to hidden').toBe(true)
    editor.destroy()
  })

  it('retries an unchanged source after a runtime failure instead of latching', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('cdn offline'))
    const runtime = new MermaidRuntime(loader)
    const editor = mount('flowchart TD\n  A --> B\n', runtime)
    await vi.waitFor(() => expect(loader.mock.calls.length).toBeGreaterThan(0))

    const callsBefore = loader.mock.calls.length
    // A repaint with the same text (an attribute touch) must ask for a redraw.
    let codeBlockPos = -1
    let codeBlockAttrs: Record<string, unknown> = {}
    editor.state.doc.forEach((child, offset) => {
      if (child.type.name !== 'codeBlock') return
      codeBlockPos = offset
      codeBlockAttrs = { ...child.attrs }
    })
    expect(codeBlockPos).toBeGreaterThanOrEqual(0)
    editor.view.dispatch(editor.state.tr.setNodeMarkup(codeBlockPos, undefined, { ...codeBlockAttrs, tacoBlockId: 'retry-probe' }))
    await vi.waitFor(() => expect(loader.mock.calls.length).toBeGreaterThan(callsBefore))
    editor.destroy()
  })

  it('drops the diagnostic when the block stops being Mermaid', async () => {
    const runtime = new MermaidRuntime(vi.fn().mockRejectedValue(new Error('cdn offline')))
    const editor = mount('flowchart TD\n  A --> B\n', runtime)
    await vi.waitFor(() => expect(state().diagnostic).not.toBeNull())

    editor.commands.setContent('# doc\n\n```js\nconst x = 1\n```\n', { contentType: 'markdown' })
    await vi.waitFor(() => expect(document.querySelector('.tiptap-code-block')).not.toBeNull())
    expect(document.querySelector('.mermaid-diagnostic')).toBeNull()
    editor.destroy()
  })

  it('lints the source the reader sees, not the theme-rewritten render input', async () => {
    const parse = vi.fn().mockResolvedValue({ diagramType: 'flowchart-v2' })
    const api = { initialize: vi.fn(), parse, render: vi.fn().mockResolvedValue({ svg: '<svg><text>ok</text></svg>' }) } as unknown as MermaidApi
    // An explicit theme that differs from the active one makes the render path rewrite
    // the preamble (one `%%{init}%%` line becomes multi-line frontmatter).
    const explicit = '%%{init: {"theme":"dark"}}%%\nflowchart TD\n  A --> B\n'
    const editor = mount(explicit, new MermaidRuntime(vi.fn().mockResolvedValue(api)))
    await vi.waitFor(() => expect(parse.mock.calls.length).toBeGreaterThan(0))
    const linted = String(parse.mock.calls[0][0])
    expect(linted, 'positions must map onto the reader’s own text').toContain('%%{init: {"theme":"dark"}}%%')
    editor.destroy()
  })
})
