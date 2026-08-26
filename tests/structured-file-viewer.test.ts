import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TacoFile } from '../src/model.ts'
import { MermaidRuntime, type MermaidApi, type MermaidPluginLabels } from '../src/mermaid.ts'
import {
  analyzeJsonSource,
  analyzeYamlSource,
  createStructuredFileViewer,
  renderOpenApiOverview,
  structuredFileLabels,
} from '../src/structured-file-viewer.ts'

const file = (path: string, content: string, mediaType = 'application/yaml'): TacoFile => ({
  path: `specs/006-renderers/${path}`,
  mediaType,
  content,
})

const mermaidLabels: MermaidPluginLabels = {
  source: 'Source', hidePreview: 'Preview', zoom: 'Zoom', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
  resetZoom: 'Reset', zoomLevel: 'Zoom level', close: 'Close', previewTitle: 'Diagram', copy: 'Copy',
  copied: 'Copied', copyFailed: 'Copy failed', comment: 'Comment', auto: 'Auto', plainText: 'Plain text',
  loading: 'Loading', error: 'Invalid Mermaid',
}

describe('structured file analysis and rendering', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  })

  it('recognizes supported OpenAPI content without trusting the filename', () => {
    const yaml = analyzeYamlSource(file('contract.yaml', 'openapi: 3.1.1\ninfo:\n  title: Inventory\n  version: 1.0.0'))
    expect(yaml.openapi).toMatchObject({ openapi: '3.1.1', info: { title: 'Inventory' } })

    const json = analyzeJsonSource(file('contract.json', '{"openapi":"3.0.3","info":{"title":"Inventory","version":"1"}}', 'application/json'))
    expect(json.openapi).toMatchObject({ openapi: '3.0.3' })

    expect(analyzeYamlSource(file('openapi.yaml', 'metadata:\n  openapi: 3.1.0')).openapi).toBeUndefined()
    expect(analyzeYamlSource(file('openapi.yaml', 'openapi: 2.0.0')).openapiDiagnostic).toContain('3.0.x or 3.1.x')
    expect(analyzeYamlSource(file('openapi.yaml', 'openapi: 3.1.01')).openapi).toBeUndefined()
    expect(analyzeJsonSource(file('openapi.json', '{"swagger":"2.0"}', 'application/json')).openapi).toBeUndefined()
  })

  it('keeps malformed and multi-document YAML available with diagnostics', () => {
    const invalid = analyzeYamlSource(file('openapi.yaml', 'openapi: [3.1.0\npaths: {}'))
    expect(invalid.openapi).toBeUndefined()
    expect(invalid.diagnostics.some(({ level }) => level === 'error')).toBe(true)
    expect(invalid.diagnostics.map(({ message }) => message).join(' ')).toMatch(/line 1|line 2/i)

    const multi = analyzeYamlSource(file('openapi.yaml', 'openapi: 3.1.0\n---\ninfo: {}'))
    expect(multi.documents).toHaveLength(2)
    expect(multi.openapi).toBeUndefined()
    expect(multi.openapiDiagnostic).toContain('exactly one')
  })

  it('renders OpenAPI values as inert text and exposes review sections', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const overview = renderOpenApiOverview({
      openapi: '3.1.0',
      info: { title: '<img src=x onerror=alert(1)>', version: '1.0.0', description: '<script>bad()</script>' },
      servers: [{ url: 'https://api.example.test', description: 'Production' }],
      tags: [{ name: 'pets', description: 'Pet operations' }],
      paths: {
        '/pets': {
          get: {
            summary: 'List pets', operationId: 'listPets', tags: ['pets'],
            parameters: [{ name: 'limit', in: 'query', required: true }],
            responses: { 200: { description: 'OK', content: { 'application/json': {} } } },
            security: [{ bearerAuth: [] }],
          },
        },
      },
      components: {
        schemas: { Pet: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      },
      security: [{ bearerAuth: [] }],
    }, structuredFileLabels('en'))

    expect(overview.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(overview.textContent).toContain('<script>bad()</script>')
    expect(overview.querySelector('img')).toBeNull()
    expect(overview.querySelector('script')).toBeNull()
    expect(overview.querySelector('style, link, iframe, object, embed')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(overview.querySelector('.openapi-metadata.document-properties')).not.toBeNull()
    expect(Array.from(overview.querySelectorAll('.openapi-metadata-table .openapi-kv-key')).map((node) => node.textContent)).toEqual([
      'OpenAPI', 'Title', 'Version', 'Description',
    ])
    expect(overview.querySelector('.openapi-servers-table .openapi-kv-key')?.textContent).toBe('https://api.example.test')
    expect(overview.querySelector('.openapi-tags-table .openapi-tag')?.textContent).toBe('pets')
    expect(overview.querySelector('.openapi-tags-table .openapi-kv-value')?.textContent).toBe('Pet operations')
    expect(overview.querySelector('.method-get')?.textContent).toBe('GET')
    expect(overview.querySelector('.openapi-path-name')?.textContent).toBe('/pets')
    expect(overview.querySelector('.openapi-operation-identity')?.textContent).toBe('pets/listPets')
    expect(overview.querySelector('.openapi-operation-api-path')?.textContent).toBe('pets/listPets')
    expect(overview.querySelector('.openapi-operation-tags .openapi-tag')?.textContent).toBe('pets')
    expect(Array.from(overview.querySelectorAll('.openapi-parameters-table th')).map((node) => node.textContent)).toEqual([
      'Name', 'Location', 'Type', 'Required', 'Description',
    ])
    expect(Array.from(overview.querySelectorAll('.openapi-parameters-table td')).map((node) => node.textContent)).toEqual([
      'limit', 'query', '—', '✓', '—',
    ])
    expect(Array.from(overview.querySelectorAll('.openapi-responses-table th')).map((node) => node.textContent)).toEqual([
      'Status', 'Description', 'Content type', '$ref',
    ])
    expect(Array.from(overview.querySelectorAll('.openapi-responses-table td')).map((node) => node.textContent)).toEqual([
      '200', 'OK', 'application/json', '—',
    ])
    expect(overview.textContent).toContain('application/json')
    expect(overview.querySelector('.openapi-schemas-table .openapi-kv-key')?.textContent).toBe('Pet')
    expect(overview.querySelector('.openapi-schemas-table .openapi-kv-value')?.textContent).toContain('Properties: id')
    expect(Array.from(overview.querySelectorAll('.openapi-security-table .openapi-kv-key')).map((node) => node.textContent)).toEqual([
      'Required', 'bearerAuth',
    ])
  })

  it('opens generic YAML directly in source without a Structure mode', () => {
    const original = '# keep\r\nroot:\r\n  enabled: true\r\n  block: |\r\n    exact text\r\n  items: &items\r\n    - one\r\nalias: *items\r\n'
    const yaml = file('settings.yaml', original)
    const onChange = vi.fn()
    const controller = createStructuredFileViewer({
      file: yaml,
      kind: 'yaml',
      labels: structuredFileLabels('en'),
      mermaidLabels,
      readOnly: false,
      sourceLabel: 'YAML source editor',
      onChange,
      onModeChange: vi.fn(),
    })
    document.body.append(controller.element)

    expect(document.querySelector('[data-segmented-value="structure"]')).toBeNull()
    expect(document.querySelector('.structured-file-toolbar')?.hasAttribute('hidden')).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    const input = document.querySelector<HTMLTextAreaElement>('.source-editor-yaml .source-editor-input')!
    expect(input.value).toBe(original.replace(/\r\n/g, '\n'))
    expect(document.querySelector('.source-editor-highlight .hljs-attr')?.textContent).toContain('root')
    expect(onChange).not.toHaveBeenCalled()
    expect(yaml.content).toBe(original)

    input.focus()
    input.setSelectionRange(8, 8)
    input.value = input.value.replace('enabled: true', 'enabled: false')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(document.activeElement).toBe(input)
    expect(document.querySelector('.source-editor-input')).toBe(input)
    expect(onChange).toHaveBeenLastCalledWith(original.replace('enabled: true', 'enabled: false'))

    input.value = 'root: [broken'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(onChange).toHaveBeenCalledWith('root: [broken')
    expect(document.querySelector('.structured-diagnostic.is-error')?.textContent).toContain('parsed')
    expect(document.querySelector('.source-editor-input')).not.toBeNull()
  })

  it('defaults valid OpenAPI to overview and activates source for comment ranges', () => {
    const contract = file('api.yaml', 'openapi: 3.1.0\ninfo:\n  title: API\n  version: 1.0.0\npaths: {}')
    const controller = createStructuredFileViewer({
      file: contract, kind: 'yaml', labels: structuredFileLabels('en'), mermaidLabels,
      readOnly: false, sourceLabel: 'YAML source editor', onChange: vi.fn(), onModeChange: vi.fn(),
    })
    document.body.append(controller.element)
    expect(document.querySelector('.openapi-overview')).not.toBeNull()
    expect(controller.element.querySelector('.structured-file-toolbar .right-panel-tabs')?.getAttribute('role')).toBe('tablist')
    expect(document.querySelector('[data-segmented-value="structure"]')).toBeNull()
    expect(controller.sourceEditor.element.hidden).toBe(true)
    expect(controller.sourceEditor.input.isConnected).toBe(true)
    controller.sourceEditor.activateRange({ start: 0, end: 7 })
    expect(controller.sourceEditor.element.hidden).toBe(false)
    expect(controller.sourceEditor.input.selectionStart).toBe(0)
    expect(controller.sourceEditor.input.selectionEnd).toBe(7)
    controller.sourceEditor.input.value += '\n# retained history node'
    controller.sourceEditor.input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('[data-segmented-value="overview"]')!.click()
    expect(controller.sourceEditor.element.hidden).toBe(true)
    expect(controller.sourceEditor.input.isConnected).toBe(true)
    document.querySelector<HTMLButtonElement>('[data-segmented-value="source"]')!.click()
    expect(controller.sourceEditor.element.hidden).toBe(false)
    expect(controller.sourceEditor.input.value).toContain('# retained history node')
  })

  it('renders JSON OpenAPI by content and falls invalid candidates back to JSON source', () => {
    const contract = file('contract.json', JSON.stringify({
      openapi: '3.0.3', info: { title: 'JSON API', version: '1.0.0' }, paths: {},
    }), 'application/json')
    const valid = createStructuredFileViewer({
      file: contract, kind: 'json', labels: structuredFileLabels('en'), mermaidLabels,
      readOnly: false, sourceLabel: 'JSON source editor', onChange: vi.fn(), onModeChange: vi.fn(),
    })
    document.body.append(valid.element)
    expect(document.querySelector('.openapi-overview')?.textContent).toContain('JSON API')
    document.querySelector<HTMLButtonElement>('[data-segmented-value="source"]')!.click()
    expect(document.querySelector('.source-editor-json .hljs-attr')?.textContent).toBe('"openapi"')

    document.body.innerHTML = ''
    const invalidFile = file('openapi.json', '{"openapi":"2.0.0","info":{}}', 'application/json')
    const invalid = createStructuredFileViewer({
      file: invalidFile, kind: 'json', labels: structuredFileLabels('en'), mermaidLabels,
      readOnly: false, sourceLabel: 'JSON source editor', onChange: vi.fn(), onModeChange: vi.fn(),
    })
    document.body.append(invalid.element)
    expect(document.querySelector('.openapi-overview')).toBeNull()
    expect(document.querySelector('.source-editor-json')).not.toBeNull()
    expect(document.querySelector('.structured-diagnostic.is-warning')?.textContent).toContain('3.0.x or 3.1.x')
  })

  it('opens generic YAML source read-only when the bundle is sealed', () => {
    const yaml = file('reader.yaml', 'root:\n  value: preserved')
    const controller = createStructuredFileViewer({
      file: yaml, kind: 'yaml', labels: structuredFileLabels('en'), mermaidLabels,
      readOnly: true, sourceLabel: 'YAML source editor', onChange: vi.fn(), onModeChange: vi.fn(),
    })
    document.body.append(controller.element)
    expect(document.querySelector('[data-segmented-value="structure"]')).toBeNull()
    expect(controller.sourceEditor.input.readOnly).toBe(true)
    expect(controller.sourceEditor.input.value).toBe(yaml.content)
  })

  it('previews standalone Mermaid and falls back to source on load or render failure', async () => {
    const successfulApi: MermaidApi = {
      initialize: vi.fn(),
      render: vi.fn().mockResolvedValue({ svg: '<svg><text>Safe</text></svg>' }),
    }
    const diagram = file('diagram.mmd', 'flowchart LR\n  A --> B', 'text/plain')
    const success = createStructuredFileViewer({
      file: diagram, kind: 'mermaid', labels: structuredFileLabels('en'), mermaidLabels,
      mermaidRuntime: new MermaidRuntime(vi.fn().mockResolvedValue(successfulApi)),
      readOnly: false, sourceLabel: 'Mermaid source editor', onChange: vi.fn(), onModeChange: vi.fn(),
    })
    document.body.append(success.element)
    await vi.waitFor(() => expect(document.querySelector('.standalone-mermaid-preview svg')).not.toBeNull())
    const standaloneZoom = document.querySelector<HTMLButtonElement>('.standalone-mermaid-zoom')!
    expect(standaloneZoom.textContent).toBe('')
    expect(standaloneZoom.getAttribute('aria-label')).toBe('Zoom')
    expect(standaloneZoom.querySelector('[data-icon="zoom-in"]')).not.toBeNull()
    document.querySelector<HTMLButtonElement>('[data-segmented-value="source"]')!.click()
    expect(document.querySelector('.source-editor-mermaid .hljs-keyword')?.textContent).toBe('flowchart')
    expect(document.querySelector('.source-editor-mermaid .hljs-symbol')?.textContent).toBe('-->')
    success.sourceEditor.input.focus()
    success.sourceEditor.input.setSelectionRange(10, 10)
    success.sourceEditor.input.setRangeText(' TB', 10, 10, 'end')
    success.sourceEditor.input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(document.activeElement).toBe(success.sourceEditor.input)
    expect(document.querySelector('.source-editor-input')).toBe(success.sourceEditor.input)
    document.querySelector<HTMLButtonElement>('[data-segmented-value="preview"]')!.click()
    expect(success.sourceEditor.element.hidden).toBe(true)
    expect(success.sourceEditor.input.isConnected).toBe(true)
    document.querySelector<HTMLButtonElement>('[data-segmented-value="source"]')!.click()
    expect(success.sourceEditor.element.hidden).toBe(false)

    document.body.innerHTML = ''
    const failed = createStructuredFileViewer({
      file: diagram, kind: 'mermaid', labels: structuredFileLabels('en'), mermaidLabels,
      mermaidRuntime: new MermaidRuntime(vi.fn().mockRejectedValue(new Error('offline'))),
      readOnly: false, sourceLabel: 'Mermaid source editor', onChange: vi.fn(), onModeChange: vi.fn(),
    })
    document.body.append(failed.element)
    await vi.waitFor(() => expect(failed.sourceEditor.element.hidden).toBe(false))
    expect(document.querySelector('.structured-diagnostic')?.textContent).toContain('unavailable')
    expect(failed.sourceEditor.input.value).toBe(diagram.content)

    document.body.innerHTML = ''
    const renderFailureApi: MermaidApi = { initialize: vi.fn(), render: vi.fn().mockRejectedValue(new Error('bad syntax')) }
    const renderFailed = createStructuredFileViewer({
      file: diagram, kind: 'mermaid', labels: structuredFileLabels('en'), mermaidLabels,
      mermaidRuntime: new MermaidRuntime(vi.fn().mockResolvedValue(renderFailureApi)),
      readOnly: false, sourceLabel: 'Mermaid source editor', onChange: vi.fn(), onModeChange: vi.fn(),
    })
    document.body.append(renderFailed.element)
    await vi.waitFor(() => expect(renderFailed.sourceEditor.element.hidden).toBe(false))
    expect(document.querySelector('.structured-diagnostic')?.textContent).toContain('Invalid Mermaid')
  })

  it('allows a failed Mermaid module load to be retried', async () => {
    const api: MermaidApi = { initialize: vi.fn(), render: vi.fn().mockResolvedValue({ svg: '<svg></svg>' }) }
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(api)
    const runtime = new MermaidRuntime(loader)

    await expect(runtime.load()).rejects.toThrow('offline')
    await expect(runtime.load()).resolves.toBe(api)
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
