import { beforeEach, describe, expect, it, vi } from 'vitest'
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
