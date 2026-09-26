import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { resolveCheckpoints } from '@taco/protocol'
import { FileBrowser } from '../src/file-browser.ts'
import { configureApp } from '../src/kernel/app.ts'
import { capturePristine } from '../src/kernel/save.ts'
import { extractMermaidThemeFromCode, MermaidRuntime, type MermaidApi } from '../src/mermaid.ts'
import { parseBundle, type TacoBundle, type TacoTextAnchor } from '../src/model.ts'
import { setDefaultHighlighter } from '../src/source-editor.ts'
import { completeHighlighter } from '../src/highlighter-lowlight.ts'
import { setDefaultRichEditorAdapter } from '../src/rich-editor.ts'
import { completeRichEditorAdapter } from '../src/rich-editor-tiptap.ts'

setDefaultHighlighter(completeHighlighter)
setDefaultRichEditorAdapter(completeRichEditorAdapter)
let mermaidLoader: ReturnType<typeof vi.fn>
let mermaidInitialize: ReturnType<typeof vi.fn>
let mermaidRuntime: MermaidRuntime

const testBundle: TacoBundle = {
  format: 'taco/files',
  version: 1,
  docId: 'browser-test',
  title: 'Browser test',
  root: 'specs/001-browser',
  files: [
    { title: 'Product specification', path: 'specs/001-browser/spec.md', mediaType: 'text/markdown', content: '# Product\n\n## Outcome\n\nReadable Markdown.' },
    { path: 'specs/001-browser/checklists/requirements.md', mediaType: 'text/markdown', content: '# Requirements checklist' },
    { path: 'specs/001-browser/plan.md', mediaType: 'text/markdown', content: '# Plan' },
    { path: 'specs/001-browser/interaction-design.md', mediaType: 'text/markdown', content: '# Interaction' },
    { path: 'specs/001-browser/tasks.md', mediaType: 'text/markdown', content: '# Tasks\n\n- [ ] T001 Browse files' },
    { path: 'specs/001-browser/contracts/api.yaml', mediaType: 'application/yaml', content: 'service:\n  name: Taco' },
  ],
}

const waitForEditor = async (): Promise<HTMLElement> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const editor = document.querySelector<HTMLElement>('.tiptap-editor-host .tiptap')
    if (editor) return editor
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
  throw new Error(`Tiptap editor did not initialize: ${document.querySelector('.tiptap-editor-host')?.getAttribute('data-editor-error') ?? 'unknown error'}`)
}
const deferredAdapter = (): {
  promise: Promise<typeof completeRichEditorAdapter>
  resolve: (adapter: typeof completeRichEditorAdapter) => void
} => {
  let resolve!: (adapter: typeof completeRichEditorAdapter) => void
  const promise = new Promise<typeof completeRichEditorAdapter>((ready) => { resolve = ready })
  return { promise, resolve }
}


describe('FileBrowser', () => {
  beforeEach(() => {
    mermaidInitialize = vi.fn()
    mermaidLoader = vi.fn().mockResolvedValue({
      initialize: mermaidInitialize,
      render: vi.fn().mockResolvedValue({ svg: '<svg data-test-mermaid="true"></svg>' }),
    } satisfies MermaidApi)
    mermaidRuntime = new MermaidRuntime(mermaidLoader)
    document.body.innerHTML = '<div id="app"></div>'
    document.documentElement.removeAttribute('style')
    history.replaceState(null, '', '/')
    localStorage.clear()
    sessionStorage.clear()
    sessionStorage.setItem('taco-session-author', 'Local user')
    Object.defineProperty(navigator, 'languages', { configurable: true, value: ['zh-CN'] })
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'zh-CN' })
    Object.defineProperty(window, 'prompt', {
      configurable: true,
      value: vi.fn().mockReturnValue('Local user'),
    })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    vi.stubGlobal('IntersectionObserver', class {
      private callback: IntersectionObserverCallback
      constructor(callback: IntersectionObserverCallback) { this.callback = callback }
      observe(target: Element): void { this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
      unobserve(): void {}
      disconnect(): void {}
    })
    if (!Range.prototype.getClientRects) {
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
      })
    }
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn().mockReturnValue(document.body),
    })
  })

  // FileBrowser sets the document language from the resolved locale; release it so another test
  // file cannot inherit this suite's zh-CN navigator stub.
  afterEach(() => {
    document.documentElement.lang = ''
    document.body.innerHTML = ''
  })

  it.each(['inline', 'zoom'] as const)('writes only the requested Mermaid direction from the %s control', async (surface) => {
    const bundle = structuredClone(testBundle)
    const source = 'flowchart LR\n  F["Save .taco.html"] --> G'
    const original = `# Review\n\n\`\`\`mermaid\n${source}\n\`\`\``
    bundle.files[0].content = original
    const browser = new FileBrowser(document.getElementById('app')!, bundle, { mermaidRuntime })
    await waitForEditor()
    await vi.waitFor(() => expect(document.querySelector('.taco-mermaid-render svg')).not.toBeNull())
    if (surface === 'zoom') document.querySelector<HTMLButtonElement>('.tiptap-code-block-zoom')!.click()
    const host = document.querySelector(surface === 'zoom' ? '.mermaid-zoom-dialog' : '.tiptap-code-block')!
    expect(host.querySelector<HTMLTextAreaElement>('.mermaid-floating-code-panel textarea')!.value).toBe(source)
    const direction = host.querySelector<HTMLSelectElement>('.tiptap-code-block-direction-select')!
    direction.value = 'TB'
    direction.dispatchEvent(new Event('change', { bubbles: true }))
    expect(bundle.files[0].content).toBe(original.replace('flowchart LR', 'flowchart TB'))
    const diff = browser.getModifiedReviewFiles()[0].diff!
    expect(diff).toContain('-flowchart LR\n+flowchart TB')
    expect(diff).not.toContain('config:')
    expect(diff).not.toContain('theme:')
    const editor = (browser as unknown as { markdownEditor: { commands: { undo: () => boolean } } }).markdownEditor
    editor.commands.undo()
    expect(bundle.files[0].content).toBe(original)
    expect(browser.getModifiedReviewFiles()).toEqual([])
    browser.destroy()
  })

  it('copies scoped Mermaid comment references without rewriting stored anchors or document content', async () => {
    const bundle = structuredClone(testBundle)
    const source = '---\nconfig:\n  layout: elk\n  theme: redux-color\n---\nflowchart TB\n  E --> F["Save .taco.html"]\n  F --> G["Agent review"]'
    const original = `# Review\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nReadable Markdown.`
    bundle.files[0].content = original
    const timestamp = '2026-09-14T00:00:00.000Z'
    const targets: Array<{ block?: TacoTextAnchor['block']; quote: string }> = [
      { block: { id: 'diagram', type: 'codeBlock', language: 'mermaid', nodeId: 'F', nodeLabel: 'Save .taco.html' }, quote: source },
      { block: { id: 'diagram', type: 'codeBlock', language: 'mermaid', nodeId: 'G' }, quote: source },
      { block: { id: 'diagram', type: 'codeBlock', language: 'mermaid', lineNumber: 9, lineText: '  F --> G["Agent review"]' }, quote: source },
      { block: { id: 'diagram', type: 'codeBlock', language: 'mermaid' }, quote: source },
      { block: undefined, quote: 'Readable Markdown.' },
    ]
    bundle.comments = targets.map((target, index) => ({
      id: `thread-${index}`,
      anchor: { path: bundle.files[0].path, quote: { exact: target.quote, prefix: '', suffix: '' }, position: { start: 0, end: target.quote.length }, ...(target.block ? { block: target.block } : {}) },
      status: 'open',
      messages: [{ id: `message-${index}`, author: 'Arcadia', body: '修改下文件名，改成x', createdAt: timestamp }],
      createdAt: timestamp,
      updatedAt: timestamp,
    }))
    const anchors = structuredClone(bundle.comments.map((comment) => comment.anchor))
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const browser = new FileBrowser(document.getElementById('app')!, bundle, { mermaidRuntime })
    await waitForEditor()
    document.querySelector<HTMLButtonElement>('.copy-review-main')!.click()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const prompt = writeText.mock.calls[0][0] as string
    expect(prompt).toContain('引用: "Save .taco.html [F]"')
    expect(prompt).toContain('引用: "G"')
    expect(prompt).toContain('引用: "  F --> G["Agent review"]"')
    expect(prompt).toContain('引用: "Mermaid 图表"')
    expect(prompt).toContain('引用: "Readable Markdown."')
    expect(prompt).toContain('**Arcadia**: 修改下文件名，改成x')
    expect(prompt).not.toContain('flowchart TB')
    expect(prompt).not.toContain('layout: elk')
    expect(bundle.comments.map((comment) => comment.anchor)).toEqual(anchors)
    expect(bundle.files[0].content).toBe(original)
    expect(browser.getModifiedReviewFiles()).toEqual([])
    browser.destroy()
  })

  it('hands off only open requests and preserves deleted-message history', async () => {
    const bundle = structuredClone(testBundle)
    const timestamp = '2026-09-14T00:00:00.000Z'
    bundle.comments = ['open', 'resolved'].map((status, index) => ({
      id: `thread-${index}`,
      status: status as 'open' | 'resolved',
      anchor: { path: bundle.files[0].path, quote: { exact: 'Product', prefix: '', suffix: '' }, position: { start: 0, end: 7 } },
      messages: [{ id: `message-${index}`, author: 'Reviewer', body: index ? 'Already handled request' : 'Pending request', createdAt: timestamp }],
      createdAt: timestamp, updatedAt: timestamp,
    }))
    bundle.comments[0].messages.unshift({ id: 'deleted', author: 'Reviewer', body: 'Withdrawn request', createdAt: timestamp, deletedAt: timestamp })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const browser = new FileBrowser(document.getElementById('app')!, bundle)
    await waitForEditor()
    document.querySelector<HTMLButtonElement>('.copy-review-main')!.click()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const prompt = writeText.mock.calls[0][0] as string
    expect(prompt).toContain('Pending request')
    expect(prompt).toContain('消息已删除')
    expect(prompt).not.toContain('Already handled request')
    expect(prompt).not.toContain('Withdrawn request')
    expect(bundle.comments[1].status).toBe('resolved')
    bundle.comments = [bundle.comments[1]]
    document.querySelector<HTMLButtonElement>('.copy-review-main')!.click()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.taco-toast')?.textContent).toBe('暂无改动可复制')
    browser.destroy()
  })

  it('prints a real line range for a comment captured from rendered text', async () => {
    const bundle = structuredClone(testBundle)
    bundle.files[0].content = '# Title\n\nThe **spec** is ready for review.\n'
    const timestamp = '2026-09-14T00:00:00.000Z'
    bundle.comments = [{
      id: 'thread-rendered',
      status: 'open',
      anchor: { path: bundle.files[0].path, position: { start: 9, end: 38 }, quote: { exact: 'The spec is ready for review.', prefix: '', suffix: '' } },
      messages: [{ id: 'message-rendered', author: 'Reviewer', body: 'Needs a citation', createdAt: timestamp }],
      createdAt: timestamp,
      updatedAt: timestamp,
    }]
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const browser = new FileBrowser(document.getElementById('app')!, bundle)
    try {
      await waitForEditor()
      document.querySelector<HTMLButtonElement>('.copy-review-main')!.click()
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
      const prompt = writeText.mock.calls[0][0] as string
      // The quote came from the reading surface, which hides the emphasis markers; the reference still
      // points at the canonical source line instead of reporting a lost position.
      expect(prompt).toContain(`${bundle.files[0].path}:3`)
      expect(prompt).toContain('The spec is ready for review.')
      expect(prompt).not.toContain('位置已失效')
    } finally {
      browser.destroy()
    }
  })

  it.each(['full', 'inspect'] as const)('reports unavailable or rejected clipboard writes for %s handoff', async (mode) => {
    const bundle = structuredClone(testBundle)
    const browser = new FileBrowser(document.getElementById('app')!, bundle)
    await waitForEditor()
    const title = document.querySelector<HTMLInputElement>('.bundle-title')!
    title.value = 'Changed title'
    title.dispatchEvent(new Event('input', { bubbles: true }))
    const clickHandoff = () => {
      if (mode === 'full') document.querySelector<HTMLButtonElement>('.copy-review-main')!.click()
      else {
        document.querySelector<HTMLButtonElement>('.copy-review-more')!.click()
        document.querySelectorAll<HTMLButtonElement>('.copy-review-menu .popover-action')[1].click()
      }
    }
    clickHandoff()
    expect(document.querySelector('.copy-review-main [data-icon="check"]')).toBeNull()
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    clickHandoff()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(document.querySelector('.copy-review-main [data-icon="check"]')).toBeNull()
    writeText.mockResolvedValue(undefined)
    clickHandoff()
    await vi.waitFor(() => expect(document.querySelector('.copy-review-main [data-icon="check"]')).not.toBeNull())
    expect(writeText).toHaveBeenCalledTimes(2)
    browser.destroy()
  })

  it('renders linked README badges after selecting that document', async () => {
    const bundle = structuredClone(testBundle)
    bundle.files[0].content = 'text ![x](image.png) text'
    bundle.files.push({
      path: `${bundle.root}/README.md`, mediaType: 'text/markdown',
      content: '[![Badge](badge.svg)](https://example.invalid)\n[![Other](other.svg)](https://example.invalid)',
    })
    const browser = new FileBrowser(document.getElementById('app')!, bundle)
    document.querySelector<HTMLButtonElement>('[data-path$="/README.md"]')!.click()
    const editor = await waitForEditor()
    expect(editor.querySelectorAll('a[href="https://example.invalid"] img[data-taco-source]')).toHaveLength(2)
    expect(bundle.files[0].blocks?.[0].html).toContain('data-taco-source="image.png"')
    expect(document.querySelector('.editor-error')).toBeNull()
    browser.destroy()
  })

  it('isolates a non-selected migration failure and exposes its original source', async () => {
    const bundle = structuredClone(testBundle)
    const failingFile = bundle.files[1]
    const originalCheck = ProseMirrorNode.prototype.check
    const check = vi.spyOn(ProseMirrorNode.prototype, 'check').mockImplementation(function (this: ProseMirrorNode) {
      if (this.textContent.includes('Requirements checklist')) throw new Error('unsupported document')
      return originalCheck.call(this)
    })
    const browser = new FileBrowser(document.getElementById('app')!, bundle)
    check.mockRestore()
    expect((await waitForEditor()).textContent).toContain('Outcome')
    expect(bundle.files[0].blocks?.length).toBeGreaterThan(0)
    expect(failingFile.blocks).toBeUndefined()
    const link = document.querySelector<HTMLElement>(`[data-path="${failingFile.path}"]`)
    expect(link).not.toBeNull()
    link!.click()
    expect(document.querySelector('.editor-error')?.textContent).toContain(failingFile.path)
    expect(document.querySelector('.editor-error')?.textContent).toContain('unsupported document')
    const source = document.querySelector<HTMLTextAreaElement>('textarea')
    expect(source?.value).toBe(failingFile.content)
    expect(source?.readOnly).toBe(false)
    browser.destroy()
  })

  it('uses the three-color chart-bubble mark in expanded and collapsed headers', () => {
    new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))

    const marks = document.querySelectorAll('.brand-mark-icon')
    expect(marks).toHaveLength(2)
    for (const mark of marks) {
      expect(mark.querySelectorAll('circle')).toHaveLength(3)
      expect(mark.querySelector('.brand-bubble-primary')).not.toBeNull()
      expect(mark.querySelector('.brand-bubble-secondary')).not.toBeNull()
      expect(mark.querySelector('.brand-bubble-tertiary')).not.toBeNull()
    }
  })

  it('restores trusted marketing README images after block sanitization', async () => {
    const logo = 'https://raw.githubusercontent.com/Arcadia822/taco/main/src/assets/taco-logo.svg'
    const screenshot = 'https://raw.githubusercontent.com/Arcadia822/taco/main/docs/assets/taco-overview.png'
    const marketingBundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId: 'taco-product-spec',
      title: 'Taco',
      root: 'specs/001-taco-bento-product',
      files: [{
        path: 'specs/001-taco-bento-product/README.md',
        mediaType: 'text/markdown',
        content: `<div align="center"><img src="${logo}" alt="Taco logo"></div>\n\n![Taco overview](${screenshot})`,
      }],
    }

    new FileBrowser(document.getElementById('app')!, marketingBundle)
    await waitForEditor()
    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(Array.from(document.querySelectorAll<HTMLImageElement>('.tiptap img[data-taco-source]')).map((image) => image.getAttribute('src')))
      .toEqual([logo, screenshot])
  })

  it('does not route README or spec/plan/tasks filenames into built-in stages', () => {
    const bundle = structuredClone(testBundle)
    bundle.files.push({ path: `${bundle.root}/README.md`, mediaType: 'text/markdown', content: '# Guide' })
    new FileBrowser(document.getElementById('app')!, bundle)

    for (const stage of ['spec', 'plan', 'tasks']) {
      expect(document.querySelector(`[data-stage="${stage}"]`)).toBeNull()
    }
    for (const name of ['README.md', 'spec.md', 'plan.md', 'tasks.md']) {
      expect(document.querySelector(`.other-files-group .file-row[data-path$="/${name}"]`)).not.toBeNull()
    }
    expect(document.querySelectorAll('.file-row')).toHaveLength(bundle.files.length)
  })

  it('renders every bundled file exactly once, including nested explicitly Unassigned files', () => {
    const completeBundle = structuredClone(testBundle)
    completeBundle.files.push(
      { path: 'specs/001-browser/notes/readme.txt', mediaType: 'text/plain', content: 'Review note' },
      { path: 'specs/001-browser/diagrams/data-model.mmd', mediaType: 'text/plain', content: 'flowchart LR\nA --> B' },
      { path: 'specs/001-browser/notes/custom.xyz', mediaType: 'text/plain', content: 'Unknown but readable' },
    )
    completeBundle.navigation = { version: 1, groups: [] }
    new FileBrowser(document.getElementById('app')!, completeBundle, { mermaidRuntime })

    const rows = Array.from(document.querySelectorAll<HTMLElement>('.file-row')).map((row) => row.dataset.path)
    expect(rows).toHaveLength(completeBundle.files.length)
    expect(new Set(rows).size).toBe(completeBundle.files.length)
    expect(new Set(rows)).toEqual(new Set(completeBundle.files.map(({ path }) => path)))
    expect(document.querySelector('[data-stage="other"]')).not.toBeNull()
    expect(document.querySelector('[data-stage="other"] [data-path$="data-model.mmd"]')).not.toBeNull()
    expect(Array.from(document.querySelectorAll('[data-stage="other"] .folder-name')).map((node) => node.textContent)).toEqual(['checklists', 'contracts', 'diagrams', 'notes'])
    const unknown = document.querySelector<HTMLButtonElement>('[data-stage="other"] [data-path$="custom.xyz"]')!
    unknown.click()
    expect(document.querySelector<HTMLTextAreaElement>('.source-editor-input')?.value).toBe('Unknown but readable')
  })

  it('edits YAML in the generic source editor', () => {
    const editableBundle = structuredClone(testBundle)
    new FileBrowser(document.getElementById('app')!, editableBundle)
    const yaml = document.querySelector<HTMLButtonElement>('[data-path$="api.yaml"]')!
    yaml.click()
    expect(document.querySelector('[data-segmented-value="structure"]')).toBeNull()
    const editor = document.querySelector<HTMLTextAreaElement>('.source-editor-input')!
    expect(document.querySelector('.source-notice')).toBeNull()
    expect(document.querySelector('.source-editor-highlight')?.textContent).toBe('service:\n  name: Taco')
    expect(document.querySelector('.file-viewer')?.classList.contains('is-source-file')).toBe(false)
    expect(yaml.querySelector('[data-icon="file-code"]')).not.toBeNull()
    expect(editor.value).toContain('name: Taco')
    editor.value = 'service:\n  name: Bento'
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    expect(editableBundle.files.at(-1)?.content).toBe('service:\n  name: Bento')
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(true)
    expect(document.querySelector('.tiptap')).toBeNull()
    expect(document.querySelector('.workspace-header .mode-control')).toBeNull()
    expect(document.querySelector('.workspace-path')?.textContent).toBe('contracts/api.yaml')
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.right-panel-tabs [role="tab"]')).map((tab) => [tab.textContent, tab.hidden])).toEqual([
      ['大纲', true],
      ['评论', false],
    ])
  })

  it('opens OpenAPI in an overview and returns anchored comments to canonical source', () => {
    const content = [
      'openapi: 3.1.0',
      'info:',
      '  title: Inventory API',
      '  version: 1.0.0',
      'paths:',
      '  /items:',
      '    get:',
      '      summary: List items',
      '      responses:',
      "        '200':",
      '          description: OK',
    ].join('\n')
    const openapiBundle = structuredClone(testBundle)
    const path = 'specs/001-browser/contracts/openapi.yaml'
    openapiBundle.files.push({ path, mediaType: 'application/yaml', content })
    openapiBundle.comments = [{
      id: 'thread-openapi',
      anchor: {
        path,
        position: { start: 0, end: 7 },
        quote: { exact: 'openapi', prefix: '', suffix: ': 3.1.0\ninfo:' },
      },
      status: 'open',
      messages: [{ id: 'message-openapi', author: 'Reviewer', body: 'Confirm the contract version.', createdAt: '2026-08-26T00:00:00.000Z' }],
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z',
    }]
    new FileBrowser(document.getElementById('app')!, openapiBundle)
    document.querySelector<HTMLButtonElement>('[data-path$="openapi.yaml"]')!.click()

    expect(document.querySelector('.openapi-overview')).not.toBeNull()
    expect(document.querySelector('[data-segmented-value="structure"]')).toBeNull()
    expect(document.querySelector('.openapi-overview')?.textContent).toContain('Inventory API')
    expect(document.querySelector('.openapi-overview')?.textContent).toContain('GET')
    expect(document.querySelector<HTMLElement>('.source-editor-yaml')?.hidden).toBe(true)
    expect(document.querySelector<HTMLTextAreaElement>('.source-editor-input')?.isConnected).toBe(true)
    document.querySelector<HTMLButtonElement>('.comment-quote-button')!.click()
    const source = document.querySelector<HTMLTextAreaElement>('.source-editor-yaml .source-editor-input')!
    expect(source).not.toBeNull()
    expect(source.selectionStart).toBe(0)
    expect(source.selectionEnd).toBe(7)
    expect(source.value).toBe(content)
    expect(openapiBundle.files.at(-1)?.content).toBe(content)
  })

  it('syntax-highlights JSON while preserving source editing', () => {
    const jsonBundle = structuredClone(testBundle)
    jsonBundle.files.push({
      path: 'specs/001-browser/contracts/schema.json',
      mediaType: 'application/json',
      content: '{\n  "enabled": true,\n  "count": 2\n}',
    })
    new FileBrowser(document.getElementById('app')!, jsonBundle)
    document.querySelector<HTMLButtonElement>('[data-path$="schema.json"]')!.click()

    const editor = document.querySelector<HTMLTextAreaElement>('.source-editor-json .source-editor-input')!
    expect(document.querySelector('[data-path$="schema.json"] [data-icon="braces"]')).not.toBeNull()
    expect(editor.getAttribute('aria-label')).toBe('JSON 源码编辑器')
    expect(document.querySelector('.source-editor-highlight .hljs-attr')?.textContent).toBe('"enabled"')
    expect(document.querySelector('.source-editor-highlight .hljs-literal')?.textContent).toBe('true')
    expect(document.querySelector('.source-editor-highlight .hljs-number')?.textContent).toBe('2')

    editor.value = '{"enabled":false,"count":3}'
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    expect(jsonBundle.files.at(-1)?.content).toBe('{"enabled":false,"count":3}')
    expect(document.querySelector('.source-editor-highlight .hljs-literal')?.textContent).toBe('false')
    expect(document.querySelector('.source-editor-highlight .hljs-number')?.textContent).toBe('3')
  })

  it('uses the Complete highlighter for JSON and YAML without an initialized global default', () => {
    setDefaultHighlighter(undefined)
    try {
      const bundle = structuredClone(testBundle)
      bundle.files.push({
        path: 'specs/001-browser/contracts/schema.json',
        mediaType: 'application/json',
        content: '{"enabled":true}',
      })
      new FileBrowser(document.getElementById('app')!, bundle, { highlighter: completeHighlighter })
      document.querySelector<HTMLButtonElement>('[data-path$="api.yaml"]')!.click()
      expect(document.querySelector('.source-editor-yaml .hljs-attr')?.textContent).toContain('service')
      document.querySelector<HTMLButtonElement>('[data-path$="schema.json"]')!.click()
      expect(document.querySelector('.source-editor-json .hljs-literal')?.textContent).toBe('true')
    } finally {
      setDefaultHighlighter(completeHighlighter)
    }
  })

  it.each([
    {
      label: 'JSON previewer',
      path: 'specs/001-browser/contracts/commentable.json',
      mediaType: 'application/json',
      content: '{\n  "enabled": true,\n  "count": 2\n}',
      quote: '"enabled": true',
    },
    {
      label: 'generic CSV previewer',
      path: 'specs/001-browser/contracts/commentable.csv',
      mediaType: 'text/csv',
      content: 'name,status\nTaco,ready\nBento,pending',
      quote: 'Taco,ready',
    },
  ])('creates, highlights and reselects comments in the $label', ({ path, mediaType, content, quote }) => {
    const commentableBundle = structuredClone(testBundle)
    commentableBundle.files.push({ path, mediaType, content })
    new FileBrowser(document.getElementById('app')!, commentableBundle)
    document.querySelector<HTMLButtonElement>(`[data-path="${path}"]`)!.click()

    const editor = document.querySelector<HTMLTextAreaElement>('.source-editor-input')!
    const start = content.indexOf(quote)
    editor.setSelectionRange(start, start + quote.length)
    editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 24, clientY: 24 }))

    const selectionAction = document.querySelector<HTMLButtonElement>('.selection-comment-button')!
    expect(selectionAction.textContent).toBe('评论')
    selectionAction.click()
    const comment = document.querySelector<HTMLTextAreaElement>('.comment-composer .comment-input')!
    comment.value = 'Review this value.'
    comment.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    expect(commentableBundle.comments).toHaveLength(1)
    expect(commentableBundle.comments?.[0].anchor.path).toBe(path)
    expect(commentableBundle.comments?.[0].anchor.quote.exact).toBe(quote)
    expect(Array.from(document.querySelectorAll('.source-comment-highlight')).map((node) => node.textContent).join('')).toBe(quote)

    const quoteButton = document.querySelector<HTMLButtonElement>('.comment-quote-button')!
    expect(quoteButton.tagName).toBe('BUTTON')
    expect(quoteButton.getAttribute('role')).toBeNull()
    expect(quoteButton.getAttribute('tabindex')).toBeNull()
    quoteButton.click()
    expect(editor.selectionStart).toBe(start)
    expect(editor.selectionEnd).toBe(start + quote.length)
    expect(document.querySelector('.source-comment-highlight.is-active')).not.toBeNull()
  })

  it('uses a plain file icon for generic files', () => {
    const genericBundle = structuredClone(testBundle)
    genericBundle.files.push({
      path: 'specs/001-browser/contracts/example.txt',
      mediaType: 'text/plain',
      content: 'plain text',
    })
    new FileBrowser(document.getElementById('app')!, genericBundle)

    const generic = document.querySelector<HTMLButtonElement>('[data-path$="example.txt"]')!
    expect(generic.querySelector('[data-icon="file"]')).not.toBeNull()
    generic.click()
    expect(document.querySelector<HTMLTextAreaElement>('.source-editor-input')?.value).toBe('plain text')
  })

  it('opens hostile initial Markdown without active HTML or passive remote images', async () => {
    const hostile = structuredClone(testBundle)
    hostile.files[0].content = '# Hostile\n\n<script>window.pwned=true</script>\n\n<img src="https://attacker.test/pixel" onerror="window.pwned=true">'
    delete hostile.files[0].blocks

    const browser = new FileBrowser(document.getElementById('app')!, hostile)
    await waitForEditor()

    expect(document.querySelector('.tiptap script')).toBeNull()
    expect(document.querySelector('.tiptap [onerror]')).toBeNull()
    const image = document.querySelector<HTMLImageElement>('.tiptap img')
    if (image) {
      expect(image.src).toMatch(/^data:image\/gif;base64,/)
      expect(image.dataset.tacoSource).toBe('https://attacker.test/pixel')
    }
    browser.destroy()
  })


  it('derives an H1–H3 outline from the Markdown document', async () => {
    new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))
    await waitForEditor()
    await vi.waitFor(() => expect(document.querySelectorAll('.outline-link')).toHaveLength(2))

    const viewer = document.querySelector<HTMLElement>('.file-viewer')!
    const product = Array.from(viewer.querySelectorAll<HTMLElement>('h1')).find((heading) => heading.textContent === 'Product')!
    const outcome = Array.from(viewer.querySelectorAll<HTMLElement>('h2')).find((heading) => heading.textContent === 'Outcome')!
    expect(product.textContent).toBe('Product')
    expect(outcome.textContent).toBe('Outcome')
    expect(Array.from(document.querySelectorAll('.outline-link')).map((node) => node.textContent)).toEqual(['Product', 'Outcome'])
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.outline-link')).map((node) => node.dataset.headingId)).toEqual(['product', 'outcome'])
    expect(document.querySelector('.outline-level-1 .outline-link')?.textContent).toBe('Product')
    expect(document.querySelector('.outline-level-2 .outline-link')?.textContent).toBe('Outcome')
  })

  it('keeps Markdown editing in WYSIWYG and omits the mode switcher', async () => {
    new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))
    const editor = await waitForEditor()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(document.querySelector('.workspace-header .mode-control')).toBeNull()
    expect(document.querySelector('.file-header')).toBeNull()
    expect(document.querySelector('.markdown-document-shell')?.classList.contains('is-source-mode')).toBe(false)
    expect(editor.querySelector('h2')?.textContent).toBe('Outcome')
    expect(editor.getAttribute('contenteditable')).toBe('true')
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(false)
  })

  it('renders leading YAML properties without changing their canonical source', async () => {
    const propertiesBundle = structuredClone(testBundle)
    propertiesBundle.files[0].content = '---\ncreated: 2026-08-10\nstatus: Draft\n---\n\n## Outcome\n\nReadable Markdown.'
    const original = propertiesBundle.files[0].content

    new FileBrowser(document.getElementById('app')!, propertiesBundle)
    await waitForEditor()
    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(document.querySelectorAll('.document-properties')).toHaveLength(1)
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('.document-property-key')).map((node) => node.value)).toEqual(['created', 'status'])
    expect(propertiesBundle.files[0].content).toBe(original)
    expect(document.querySelector('.tiptap h2')?.textContent).toBe('Outcome')
    expect(Array.from(document.querySelectorAll('.outline-link')).map((node) => node.textContent)).toEqual(['Outcome'])
  })

  it('keeps zoom source visibility and theme controls synchronized without opening-time edits', async () => {
    const bundle = structuredClone(testBundle)
    const original = '# Architecture\n\n```mermaid\nflowchart LR\n  A --> B\n```'
    bundle.files[0].content = original
    const browser = new FileBrowser(document.getElementById('app')!, bundle, { mermaidRuntime })
    await waitForEditor()
    await vi.waitFor(() => expect(document.querySelector('.taco-mermaid-render svg')).not.toBeNull())
    expect(browser.getModifiedReviewFiles()).toEqual([])
    document.querySelector<HTMLButtonElement>('.tiptap-code-block-zoom')!.click()
    const toggle = document.querySelector<HTMLButtonElement>('.mermaid-zoom-panel')!
    const panel = document.querySelector<HTMLElement>('.mermaid-zoom-dialog .mermaid-floating-code-panel')!
    toggle.click()
    expect(panel.hidden).toBe(false)
    panel.click()
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    toggle.click()
    expect(panel.hidden).toBe(true)
    toggle.click()
    panel.querySelector<HTMLButtonElement>('.mermaid-code-panel-close')!.click()
    expect(panel.hidden).toBe(true)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(bundle.files[0].content).toBe(original)
    expect(browser.getModifiedReviewFiles()).toEqual([])

    const theme = document.querySelector<HTMLSelectElement>('.mermaid-zoom-theme-select')!
    theme.value = 'neo'
    theme.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(mermaidInitialize.mock.calls.some((call) => call[0]?.theme === 'neo')).toBe(true))
    expect(browser.getModifiedReviewFiles()[0].diff).toContain('+  theme: neo')
    const changed = bundle.files[0].content
    toggle.click()
    document.querySelector<HTMLButtonElement>('.mermaid-zoom-close')!.click()
    await vi.waitFor(() => expect(document.querySelector('.mermaid-zoom-dialog')).toBeNull())
    expect(document.querySelector<HTMLElement>('.mermaid-floating-code-panel')?.hidden).toBe(true)
    document.querySelector<HTMLButtonElement>('.tiptap-code-block-zoom')!.click()
    expect(document.querySelector<HTMLElement>('.mermaid-zoom-dialog .mermaid-floating-code-panel')?.hidden).toBe(true)
    expect(bundle.files[0].content).toBe(changed)
    browser.destroy()
  })

  it('renders Mermaid fences as diagrams while preserving editable source', async () => {
    document.documentElement.style.setProperty('--accent', '#00875a')
    document.documentElement.style.setProperty('--doc-soft', '#f1f5f3')
    const mermaidBundle = structuredClone(testBundle)
    mermaidBundle.files[0].content = '# Architecture\n\n```mermaid\nflowchart LR\n  Brief --> Plan\n```'
    new FileBrowser(document.getElementById('app')!, mermaidBundle, { mermaidRuntime })
    await waitForEditor()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const diagram = document.querySelector<HTMLElement>('.tiptap-code-block .taco-mermaid-render')
    expect(diagram).not.toBeNull()
    expect(diagram?.querySelector('.surface')).not.toBeNull()
    await vi.waitFor(() => expect(diagram?.querySelector('svg')).not.toBeNull())
    expect(diagram?.querySelector('svg')?.hasAttribute('data-test-mermaid')).toBe(false)
    expect(mermaidLoader).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.tiptap-code-block-source code')?.textContent).toContain('Brief --> Plan')
    const zoom = document.querySelector<HTMLButtonElement>('.tiptap-code-block-zoom')!
    const codeBlock = zoom.closest<HTMLElement>('.tiptap-code-block')!
    expect(zoom.textContent).toBe('')
    expect(zoom.getAttribute('aria-label')).toBe('放大 Mermaid 图表')
    const comment = codeBlock.querySelector<HTMLButtonElement>('.tiptap-code-block-comment')!
    expect(comment.textContent).toBe('')
    expect(comment.getAttribute('aria-label')).toBe('评论整个代码块')

    comment.click()
    expect(document.querySelector('.comment-composer .comment-quote')?.textContent).toBe('Mermaid 图表')
    expect(document.querySelector('.comment-composer')?.textContent).not.toContain('Brief --> Plan')
    const commentInput = document.querySelector<HTMLTextAreaElement>('.comment-composer .comment-input')!
    commentInput.value = 'Clarify this flow.'
    commentInput.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(mermaidBundle.comments?.[0].anchor.block).toMatchObject({ type: 'codeBlock', language: 'mermaid' })
    expect(document.querySelector('.comment-thread .comment-quote')?.textContent).toBe('Mermaid 图表')
    expect(document.querySelector('.comment-thread')?.textContent).not.toContain('Brief --> Plan')
    expect(codeBlock.classList.contains('has-comment')).toBe(true)
    document.querySelector<HTMLButtonElement>('.comment-thread .comment-quote-button')!.click()
    expect(codeBlock.classList.contains('is-active-comment')).toBe(true)

    expect(document.querySelector<HTMLElement>('.tiptap-code-block-source')?.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('.tiptap-code-block-preview')?.hidden).toBe(false)

    const activeBlock = document.querySelector<HTMLElement>('.tiptap-code-block')!
    const themeSelect = activeBlock.querySelector<HTMLSelectElement>('.tiptap-code-block-theme-select')!
    expect(themeSelect).not.toBeNull()
    themeSelect.value = 'neo'
    themeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(mermaidInitialize.mock.calls.some((c) => c[0]?.theme === 'neo')).toBe(true))

    const panelToggle = activeBlock.querySelector<HTMLButtonElement>('.tiptap-code-block-panel')!
    expect(panelToggle).not.toBeNull()
    expect(panelToggle.hidden).toBe(true)
    expect(activeBlock.querySelector<HTMLElement>('.mermaid-floating-code-panel')?.hidden).toBe(true)
    zoom.click()
    expect(document.querySelector('.mermaid-zoom-dialog[open]')).not.toBeNull()
    const zoomPanelToggle = document.querySelector<HTMLButtonElement>('.mermaid-zoom-panel')!
    expect(zoomPanelToggle).not.toBeNull()
    zoomPanelToggle.click()
    expect(document.querySelector<HTMLElement>('.mermaid-zoom-dialog .mermaid-floating-code-panel')?.hidden).toBe(false)
    const floatingSource = document.querySelector<HTMLTextAreaElement>('.mermaid-zoom-dialog .mermaid-floating-code-panel textarea')!
    const lineStart = floatingSource.value.indexOf('  Brief --> Plan')
    floatingSource.focus()
    floatingSource.setSelectionRange(lineStart, floatingSource.value.indexOf('\n', lineStart) === -1 ? floatingSource.value.length : floatingSource.value.indexOf('\n', lineStart))
    floatingSource.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('.selection-comment-button')!.click()
    const lineCommentInput = document.querySelector<HTMLTextAreaElement>('.comment-composer .comment-input')!
    expect(lineCommentInput).not.toBeNull()
    lineCommentInput.value = 'Comment on Brief to Plan edge'
    lineCommentInput.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    const expectedLine = floatingSource.value.slice(0, lineStart).split('\n').length
    expect(mermaidBundle.comments?.some((c) => c.anchor.block?.lineNumber === expectedLine)).toBe(true)
    expect(document.querySelector('.mermaid-zoom-dialog[open]')).not.toBeNull()
    const zoomedDiagram = document.querySelector<HTMLElement>('.mermaid-zoom-canvas .taco-mermaid-render')!
    const zoomIn = document.querySelector<HTMLButtonElement>('.mermaid-zoom-in')!
    const zoomOut = document.querySelector<HTMLButtonElement>('.mermaid-zoom-out')!
    const resetZoom = document.querySelector<HTMLButtonElement>('.mermaid-zoom-reset')!
    const zoomLevel = document.querySelector<HTMLOutputElement>('.mermaid-zoom-level')!
    expect(zoomedDiagram).not.toBeNull()
    expect(zoomLevel.value).toBe('100%')
    expect(resetZoom.disabled).toBe(true)

    zoomIn.click()
    expect(zoomLevel.value).toBe('125%')
    expect(resetZoom.disabled).toBe(false)

    resetZoom.click()
    expect(zoomLevel.value).toBe('100%')
    expect(resetZoom.disabled).toBe(true)

    zoomOut.click()
    expect(zoomLevel.value).toBe('75%')

    resetZoom.click()
    const canvas = document.querySelector<HTMLElement>('.mermaid-zoom-canvas')!
    const scrollWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 })
    canvas.dispatchEvent(scrollWheel)
    expect(scrollWheel.defaultPrevented).toBe(false)
    expect(zoomLevel.value).toBe('100%')
    const controlWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100, ctrlKey: true })
    canvas.dispatchEvent(controlWheel)
    expect(controlWheel.defaultPrevented).toBe(false)
    expect(zoomLevel.value).toBe('100%')
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 100, clientY: 100, deltaY: -100, metaKey: true } as WheelEventInit)
    canvas.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(Number.parseInt(zoomLevel.value, 10)).toBeGreaterThan(100)

    const canvasClick = vi.fn()
    canvas.addEventListener('click', canvasClick)
    const pointerEvent = (type: string, clientX: number, clientY: number): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperties(event, {
        button: { value: 0 },
        clientX: { value: clientX },
        clientY: { value: clientY },
        pointerId: { value: 1 },
      })
      return event
    }
    canvas.dispatchEvent(pointerEvent('pointerdown', 200, 200))
    canvas.dispatchEvent(pointerEvent('pointermove', 150, 170))
    expect(canvas.classList.contains('is-dragging')).toBe(true)
    canvas.dispatchEvent(pointerEvent('pointerup', 150, 170))
    expect(canvas.classList.contains('is-dragging')).toBe(false)
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(canvasClick).not.toHaveBeenCalled()
    canvas.dispatchEvent(pointerEvent('pointerdown', 150, 170))
    canvas.dispatchEvent(pointerEvent('pointerup', 150, 170))
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(canvasClick).toHaveBeenCalledTimes(1)
  })

  it.each(['embedded', 'standalone'] as const)('pauses %s previews without losing edits across fullscreen', async (surface) => {
    localStorage.setItem('taco-theme', 'light')
    const source = '---\nconfig:\n  layout: elk\n  theme: neo\n---\nflowchart LR\nOld --> End'
    const bundle = structuredClone(testBundle)
    mermaidLoader.mockResolvedValue({
      initialize: vi.fn(),
      render: vi.fn(async (_id: string, code: string) => ({
        svg: `<svg><text>${code.includes('Latest') ? 'Latest' : code.includes('New') ? 'New' : 'Old'}</text></svg>`,
      })),
    })
    if (surface === 'embedded') bundle.files[0].content = `## Diagram\n\n\`\`\`mermaid\n${source}\n\`\`\``
    else bundle.files.push({ path: `${bundle.root}/diagram.mmd`, mediaType: 'text/plain', content: source })
    const app = new FileBrowser(document.getElementById('app')!, bundle, { mermaidRuntime })
    if (surface === 'standalone') document.querySelector<HTMLButtonElement>('[data-path$="diagram.mmd"]')!.click()
    else await waitForEditor()
    await vi.waitFor(() => expect(document.querySelector('.taco-mermaid-render svg')?.textContent).toBe('Old'))
    if (surface === 'embedded') {
      document.querySelector<HTMLButtonElement>('.tiptap-code-block-zoom')!.click()
      document.querySelector<HTMLButtonElement>('.mermaid-zoom-panel')!.click()
    } else {
      document.querySelector<HTMLButtonElement>('.standalone-mermaid-source')!.click()
    }
    const toggle = document.querySelector<HTMLInputElement>('.mermaid-live-update input')!
    toggle.click()
    const editor = document.querySelector<HTMLTextAreaElement>('.mermaid-floating-code-panel textarea')!
    editor.value = source.replace('Old', 'New').replace('theme: neo', 'theme: neo-dark')
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect((surface === 'embedded' ? bundle.files[0] : bundle.files.at(-1))!.content).toContain('New --> End'))
    expect(document.querySelector('.taco-mermaid-render svg')?.textContent).toBe('Old')
    document.querySelector<HTMLButtonElement>('.theme-toggle')!.click()
    Array.from(document.querySelectorAll<HTMLButtonElement>('.theme-menu button')).find((button) => button.textContent?.includes('深色'))!.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.taco-mermaid-render')?.dataset.mermaidTheme).toBe('neo-dark'))
    expect(document.querySelector('.taco-mermaid-render svg')?.textContent).toBe('Old')
    expect(editor.value).toContain('New --> End')
    expect(toggle.checked).toBe(false)
    if (surface === 'standalone') {
      document.querySelector<HTMLButtonElement>('.standalone-mermaid-zoom')!.click()
    }
    expect(document.querySelector<HTMLInputElement>('.mermaid-zoom-dialog .mermaid-live-update input')?.checked).toBe(false)
    expect(document.querySelector('.mermaid-zoom-canvas svg')?.textContent).toBe('Old')
    document.querySelector<HTMLButtonElement>('.mermaid-zoom-dialog .mermaid-refresh-preview')!.click()
    await vi.waitFor(() => expect(document.querySelector('.mermaid-zoom-canvas svg')?.textContent).toBe('New'))
    editor.value = source.replace('Old', 'Latest')
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector<HTMLInputElement>('.mermaid-zoom-dialog .mermaid-live-update input')!.click()
    await vi.waitFor(() => expect(document.querySelector('.mermaid-zoom-canvas svg')?.textContent).toBe('Latest'))
    document.querySelector<HTMLButtonElement>('.mermaid-zoom-close')!.click()
    await vi.waitFor(() => expect(document.querySelector('.mermaid-zoom-dialog')).toBeNull())
    expect(document.querySelector('.taco-mermaid-render svg')?.textContent).toBe('Latest')
    expect((surface === 'embedded' ? bundle.files[0] : bundle.files.at(-1))!.content).toContain('Latest --> End')
    app.destroy()
  })

  it('renders standalone Mermaid files and saves only their raw source', async () => {
    const source = 'flowchart LR\n  Brief --> Plan'
    const standaloneBundle = structuredClone(testBundle)
    standaloneBundle.files.push({ path: 'specs/001-browser/diagrams/architecture.mmd', mediaType: 'text/plain', content: source })
    new FileBrowser(document.getElementById('app')!, standaloneBundle, { mermaidRuntime })
    document.querySelector<HTMLButtonElement>('[data-path$="architecture.mmd"]')!.click()

    await vi.waitFor(() => expect(document.querySelector('.standalone-mermaid-preview svg')).not.toBeNull())
    expect(document.querySelector('[data-path$="architecture.mmd"] [data-icon="presentation"]')).not.toBeNull()
    const standaloneZoom = document.querySelector<HTMLButtonElement>('.standalone-mermaid-zoom')!
    expect(standaloneZoom.textContent).toBe('')
    expect(standaloneZoom.getAttribute('aria-label')).toBe('放大 Mermaid 图表')
    expect(standaloneZoom.querySelector('[data-icon="zoom-in"]')).not.toBeNull()
    expect(standaloneBundle.files.at(-1)?.content).toContain(source)
    expect(standaloneBundle.files.at(-1)?.blocks).toBeUndefined()

    document.querySelector<HTMLButtonElement>('.standalone-mermaid-source')!.click()
    const editor = document.querySelector<HTMLTextAreaElement>('.source-editor-input')!
    expect(document.querySelector('.source-editor-mermaid .hljs-keyword')?.textContent).toBe('flowchart')
    expect(document.querySelector('.source-editor-mermaid .hljs-symbol')?.textContent).toBe('-->')
    expect(editor.value).toContain(source)
    const theme = document.querySelector<HTMLSelectElement>('.tiptap-code-block-theme-select:not(.tiptap-code-block-direction-select)')!
    theme.value = 'forest'
    theme.dispatchEvent(new Event('change', { bubbles: true }))
    expect(extractMermaidThemeFromCode(standaloneBundle.files.at(-1)!.content)).toBe('forest')
    expect(editor.value).toBe(standaloneBundle.files.at(-1)!.content)
    editor.value = `${source}\n  Plan --> Done`
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    expect(standaloneBundle.files.at(-1)?.content).toBe(`${source}\n  Plan --> Done`)
    expect(standaloneBundle.files.at(-1)?.blocks).toBeUndefined()
  })

  it('waits for the initially selected Mermaid preview to render or fail', async () => {
    const bundle = structuredClone(testBundle)
    bundle.files.push({
      path: `${bundle.root}/flow.mmd`,
      mediaType: 'text/plain',
      content: 'flowchart LR\n  Draft --> Review',
    })
    bundle.navigation = { version: 1, entry: 'flow.mmd', groups: [] }
    let finishRender!: (result: { svg: string }) => void
    const rendering = new Promise<{ svg: string }>((resolve) => { finishRender = resolve })
    mermaidLoader.mockResolvedValue({
      initialize: vi.fn(),
      render: vi.fn().mockReturnValueOnce(rendering).mockResolvedValue({ svg: '<svg><text>Ready</text></svg>' }),
    })
    const browser = new FileBrowser(document.getElementById('app')!, bundle, { mermaidRuntime })
    let settled = false
    void browser.initialPreviewReady.then(() => { settled = true })
    await vi.waitFor(() => expect(mermaidLoader).toHaveBeenCalled())
    expect(settled).toBe(false)
    expect(document.querySelector('.standalone-mermaid-preview .taco-mermaid-render .surface svg')).toBeNull()
    finishRender({ svg: '<svg><text>Ready</text></svg>' })
    await browser.initialPreviewReady
    expect(document.querySelector('.standalone-mermaid-preview .taco-mermaid-render .surface svg')?.textContent).toBe('Ready')
    browser.destroy()

    document.getElementById('app')!.replaceChildren()
    const invalidBundle = structuredClone(bundle)
    invalidBundle.docId = 'invalid-preview'
    invalidBundle.files.at(-1)!.content = 'not a diagram'
    const unavailable = new FileBrowser(document.getElementById('app')!, invalidBundle, {
      mermaidRuntime: new MermaidRuntime(() => Promise.reject(new Error('offline'))),
    })
    await unavailable.initialPreviewReady
    expect(document.querySelector('.structured-diagnostic')?.textContent).toContain('Mermaid')
    unavailable.destroy()
  })

  it('falls back standalone Mermaid render failures to editable source', async () => {
    mermaidLoader.mockResolvedValue({
      initialize: vi.fn(),
      render: vi.fn().mockRejectedValue(new Error('invalid syntax')),
    })
    const standaloneBundle = structuredClone(testBundle)
    standaloneBundle.files.push({ path: 'specs/001-browser/diagram.mmd', mediaType: 'text/plain', content: 'not a diagram' })
    new FileBrowser(document.getElementById('app')!, standaloneBundle, { mermaidRuntime })
    document.querySelector<HTMLButtonElement>('[data-path$="diagram.mmd"]')!.click()

    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.mermaid-floating-code-panel')?.hidden).toBe(false))
    expect(document.querySelector('.structured-diagnostic')?.textContent).toContain('Mermaid')
    expect(document.querySelector<HTMLTextAreaElement>('.source-editor-input')?.value).toBe('not a diagram')
  })

  it('falls back to the editable Mermaid code block when the cloud module is unavailable', async () => {
    mermaidLoader.mockRejectedValue(new Error('offline'))
    const mermaidBundle = structuredClone(testBundle)
    mermaidBundle.files[0].content = '# Architecture\n\n```mermaid\nflowchart LR\n  Brief --> Plan\n```'
    new FileBrowser(document.getElementById('app')!, mermaidBundle, { mermaidRuntime })
    await waitForEditor()

    const block = document.querySelector<HTMLElement>('.tiptap-code-block')!
    await vi.waitFor(() => expect(block.querySelector<HTMLElement>('.tiptap-code-block-source')?.hidden).toBe(false))
    expect(block.querySelector<HTMLElement>('.tiptap-code-block-preview')?.hidden).toBe(true)
    expect(block.querySelector<HTMLButtonElement>('.tiptap-code-block-zoom')?.hidden).toBe(true)
    expect(block.querySelector('code')?.textContent).toContain('flowchart LR\n  Brief --> Plan')
    expect(mermaidLoader).toHaveBeenCalledTimes(1)
  })

  it('adds language, syntax highlighting, line numbers and copy to code blocks', async () => {
    const bashBundle = structuredClone(testBundle)
    bashBundle.files[0].content = '# Setup\n\n```bash\nif test -f package.json; then\n  npm install\nfi\n```'
    new FileBrowser(document.getElementById('app')!, bashBundle, { mermaidRuntime })
    await waitForEditor()

    const block = document.querySelector<HTMLElement>('.tiptap-code-block')!
    expect(block.classList.contains('is-mermaid')).toBe(false)
    expect(block.querySelector('.tiptap-code-block-language')?.textContent).toBe('Bash')
    expect(block.querySelectorAll('.tiptap-code-block-lines span')).toHaveLength(3)
    expect(block.querySelector('.hljs-keyword')).not.toBeNull()
    expect(block.querySelector<HTMLButtonElement>('.tiptap-code-block-zoom')?.hidden).toBe(true)
    expect(block.querySelector('.taco-mermaid-render')).toBeNull()
    expect(block.querySelector('code')?.textContent).toContain('npm install')
    expect(mermaidLoader).not.toHaveBeenCalled()

    const comment = block.querySelector<HTMLButtonElement>('.tiptap-code-block-comment')!
    comment.click()
    expect(document.querySelector('.comment-composer .comment-quote')?.textContent).toBe('Bash 代码块')
    expect(document.querySelector('.comment-composer')?.textContent).not.toContain('npm install')

    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const copy = block.querySelector<HTMLButtonElement>('.tiptap-code-block-copy')!
    copy.click()
    expect(writeText).toHaveBeenCalledWith('if test -f package.json; then\n  npm install\nfi')
    await vi.waitFor(() => expect(copy.getAttribute('aria-label')).toBe('代码已复制'))
  })

  it('auto-detects an unlabeled fenced code block', async () => {
    const codeBundle = structuredClone(testBundle)
    codeBundle.files[0].content = '# Example\n\n```\nconst answer = 42\nconsole.log(answer)\n```'
    new FileBrowser(document.getElementById('app')!, codeBundle)
    await waitForEditor()

    const block = document.querySelector<HTMLElement>('.tiptap-code-block')!
    expect(block.querySelector('.tiptap-code-block-language')?.textContent).toMatch(/^(自动识别 · .+|纯文本)$/)
    expect(block.querySelectorAll('.tiptap-code-block-lines span')).toHaveLength(2)
    expect(block.querySelector('.tiptap-code-block-tools')).not.toBeNull()
  })

  it('shows the selected relative path in the workspace header instead of a document title row', () => {
    new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))
    expect(document.querySelector('.workspace-path')?.textContent).toBe('spec.md')
    expect(document.querySelector('.file-header')).toBeNull()
    document.querySelector<HTMLButtonElement>('[data-path$="checklists/requirements.md"]')!.click()
    expect(document.querySelector('.workspace-path')?.textContent).toBe('checklists/requirements.md')
  })

  it('edits the Taco title in the header and keeps the document state in sync', () => {
    const editableBundle = structuredClone(testBundle)
    new FileBrowser(document.getElementById('app')!, editableBundle)
    const title = document.querySelector<HTMLInputElement>('.workspace-header .bundle-title')!

    expect(title.value).toBe('Browser test')
    title.value = 'Renamed Taco'
    title.dispatchEvent(new Event('input', { bubbles: true }))

    expect(editableBundle.title).toBe('Renamed Taco')
    expect(document.title).toBe('Renamed Taco — Taco')
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(true)
  })

  it('edits file title metadata without renaming the file or adding it to the outline', async () => {
    const editableBundle = structuredClone(testBundle)
    new FileBrowser(document.getElementById('app')!, editableBundle)
    await waitForEditor()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const originalPath = editableBundle.files[0].path
    const title = document.querySelector<HTMLElement>('.document-inline-title-text')!

    title.textContent = 'Renamed document title'
    title.dispatchEvent(new Event('input', { bubbles: true }))

    expect(editableBundle.files[0].title).toBe('Renamed document title')
    expect(editableBundle.files[0].content).toMatch(/^---\ntitle: Renamed document title\n---/)
    expect(editableBundle.files[0].path).toBe(originalPath)
    expect(document.querySelector(`[data-path="${originalPath}"]`)).not.toBeNull()
    expect(Array.from(document.querySelectorAll('.tiptap h1, .tiptap h2')).map((node) => node.textContent)).toEqual(['Product', 'Outcome'])
    expect(Array.from(document.querySelectorAll('.outline-link')).map((node) => node.textContent)).toEqual(['Product', 'Outcome'])
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(true)

    const propertyTitle = document.querySelector<HTMLInputElement>('.document-properties [name="title"]')!
    expect(propertyTitle.value).toBe('Renamed document title')
    propertyTitle.value = 'Title from properties'
    propertyTitle.dispatchEvent(new Event('input', { bubbles: true }))

    expect(editableBundle.files[0].title).toBe('Title from properties')
    expect(title.textContent).toBe('Title from properties')
    expect(editableBundle.files[0].content).toContain('title: Title from properties')
  })



  it('clears the modified marker after an editor change is undone', async () => {
    const editableBundle = structuredClone(testBundle)
    const browser = new FileBrowser(document.getElementById('app')!, editableBundle)
    await waitForEditor()
    const editor = (browser as unknown as {
      markdownEditor: { commands: { insertContent: (content: string) => boolean; undo: () => boolean } }
    }).markdownEditor

    expect(editor.commands.insertContent('Changed ')).toBe(true)
    expect(browser.getModifiedReviewFiles()[0].diff).toContain('+')
    expect(editableBundle.files[0].content).not.toBe(testBundle.files[0].content)
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(true)

    expect(editor.commands.undo()).toBe(true)
    expect(editableBundle.files[0].content).toBe(testBundle.files[0].content)
    expect(browser.getModifiedReviewFiles()).toEqual([])
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(false)
    expect(document.querySelector('.save-button')?.getAttribute('aria-label')).toBe('保存')
  })

  it('confirms the download fallback and reports only that the download started', async () => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn().mockReturnValue('blob:taco-download') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    configureApp({ appId: 'taco-test', appName: 'Taco' })
    capturePristine()

    const editableBundle = structuredClone(testBundle)
    const browser = new FileBrowser(document.getElementById('app')!, editableBundle)
    await waitForEditor()
    const editor = (browser as unknown as { markdownEditor: { commands: { insertContent: (content: string) => boolean } } }).markdownEditor
    editor.commands.insertContent('Review edit ')
    expect(browser.getModifiedReviewFiles()[0].content).toContain('Review edit ')
    const title = document.querySelector<HTMLInputElement>('.workspace-header .bundle-title')!
    title.value = 'Download fallback'
    title.dispatchEvent(new Event('input', { bubbles: true }))

    document.querySelector<HTMLButtonElement>('.save-button')!.click()
    const firstDialog = document.querySelector<HTMLDialogElement>('.confirmation-dialog')!
    expect(firstDialog.open).toBe(true)
    expect(firstDialog.getAttribute('aria-labelledby')).toBe('taco-confirmation-title')
    expect(firstDialog.querySelector('.confirmation-dialog-title')?.textContent).toBe('下载此 Taco？')
    expect(firstDialog.querySelector('.confirmation-dialog-body')?.textContent).toContain('保存位置由浏览器设置决定')
    expect(document.activeElement).toBe(firstDialog.querySelector('button[aria-label="取消"]'))

    firstDialog.querySelector<HTMLButtonElement>('button[aria-label="取消"]')!.click()
    await Promise.resolve()
    expect(downloadClick).not.toHaveBeenCalled()
    expect(document.querySelector('.confirmation-dialog')).toBeNull()
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(true)

    document.querySelector<HTMLButtonElement>('.save-button')!.click()
    document.querySelector<HTMLButtonElement>('.confirmation-dialog button[aria-label="下载"]')!.click()
    await vi.waitFor(() => expect(document.querySelector('.taco-toast')).not.toBeNull())

    expect(document.querySelector('.taco-toast')?.textContent).toBe('已开始下载 Taco 文件')
    expect(downloadClick).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.save-button .button-label')?.textContent).toBe('保存')
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(false)
    expect(browser.getModifiedReviewFiles()).toEqual([])
  })

  it('collapses the desktop right panel independently and preserves its active tab', () => {
    const browser = new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))
    const left = document.querySelector<HTMLButtonElement>('.file-sidebar .left-panel-toggle')!
    const toggle = document.querySelector<HTMLButtonElement>('.comment-toggle')!
    const panel = document.querySelector<HTMLElement>('.comment-panel')!
    toggle.click()
    expect(panel.getAttribute('aria-hidden')).toBe('true')
    expect(panel.hasAttribute('inert')).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(left.getAttribute('aria-expanded')).toBe('true')
    left.click()
    toggle.click()
    expect(panel.getAttribute('aria-hidden')).toBe('false')
    expect(panel.hasAttribute('inert')).toBe(false)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(left.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector<HTMLElement>('.document-outline')?.hidden).toBe(false)
    const commentsTab = Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((tab) => tab.textContent === '评论')!
    commentsTab.click()
    commentsTab.focus()
    commentsTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(panel.getAttribute('aria-hidden')).toBe('true')
    expect(document.activeElement).toBe(toggle)
    toggle.click()
    expect(document.querySelector<HTMLElement>('.comment-list')?.hidden).toBe(false)
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(false)
    browser.destroy()
  })

  it('opens an existing inline highlight without creating a comment or changing the document', async () => {
    const bundle = structuredClone(testBundle)
    const timestamp = '2026-09-15T00:00:00.000Z'
    bundle.access = 'reader'
    bundle.comments = [{
      id: 'inline-request',
      anchor: { path: bundle.files[0].path, position: { start: 14, end: 22 }, quote: { exact: 'Readable', prefix: '', suffix: ' Markdown.' } },
      status: 'open',
      messages: [{ id: 'request-message', author: 'Reviewer', body: 'Clarify this outcome.', createdAt: timestamp }],
      createdAt: timestamp,
      updatedAt: timestamp,
    }]
    const browser = new FileBrowser(document.getElementById('app')!, bundle)
    const editor = await waitForEditor()
    const paragraph = Array.from(editor.querySelectorAll('p')).find((node) => node.textContent === 'Readable Markdown.')!
    const toggle = document.querySelector<HTMLButtonElement>('.comment-toggle')!
    const rects = vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([
      { left: 10, right: 90, top: 10, bottom: 30 },
    ] as unknown as DOMRectList)
    try {
      window.getSelection()?.removeAllRanges()
      toggle.click()
      paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 120, clientY: 20 }))
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 30, clientY: 20 }))
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(document.querySelector<HTMLElement>('.comment-list')?.hidden).toBe(false)
      expect(document.activeElement?.closest<HTMLElement>('.comment-thread')?.dataset.threadId).toBe('inline-request')
      expect(document.querySelector('.comment-composer')).toBeNull()
      expect(browser.getModifiedReviewFiles()).toEqual([])
      expect(bundle.comments).toHaveLength(1)
    } finally {
      rects.mockRestore()
      browser.destroy()
    }
  })

  it('restores the desktop preference across narrow layouts and session reloads', () => {
    const media = Object.assign(new EventTarget(), { matches: false })
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(media))
    const app = document.getElementById('app')!
    let browser = new FileBrowser(app, structuredClone(testBundle))
    const toggle = document.querySelector<HTMLButtonElement>('.comment-toggle')!
    toggle.click()
    media.matches = true
    media.dispatchEvent(Object.assign(new Event('change'), { matches: true }))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    toggle.click()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    media.matches = false
    media.dispatchEvent(Object.assign(new Event('change'), { matches: false }))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    browser.destroy()
    browser = new FileBrowser(app, structuredClone(testBundle))
    expect(document.querySelector('.comment-toggle')?.getAttribute('aria-expanded')).toBe('false')
    browser.destroy()
    browser = new FileBrowser(app, { ...structuredClone(testBundle), docId: 'another-document' })
    expect(document.querySelector('.comment-toggle')?.getAttribute('aria-expanded')).toBe('true')
    browser.destroy()
  })

  it('leaves Escape to overlays and consumed editor events before closing the panel', () => {
    const browser = new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))
    const toggle = document.querySelector<HTMLButtonElement>('.comment-toggle')!
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.append(dialog)
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    dialog.remove()
    const consumed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    consumed.preventDefault()
    document.dispatchEvent(consumed)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
    browser.destroy()
  })

  it('keeps sidebar UI state independent from language and file selection', () => {
    const bundle = structuredClone(testBundle)
    bundle.navigation = { version: 1, groups: [{ id: 'review', title: 'Review', paths: ['spec.md'] }] }
    new FileBrowser(document.getElementById('app')!, bundle)
    const app = document.getElementById('app')!
    const sidebarScroll = document.querySelector<HTMLElement>('.sidebar-scroll')!
    const unassigned = document.querySelector<HTMLDetailsElement>('[data-stage="other"]')!
    const folder = document.querySelector<HTMLDetailsElement>('.tree-folder[data-path$="/checklists"]')!

    unassigned.open = false
    unassigned.dispatchEvent(new Event('toggle'))
    folder.open = false
    folder.dispatchEvent(new Event('toggle'))
    sidebarScroll.scrollTop = 48
    sidebarScroll.dispatchEvent(new Event('scroll'))

    document.querySelector<HTMLButtonElement>('[data-path$="tasks.md"]')!.click()
    expect(document.querySelector<HTMLElement>('.sidebar-scroll')).toBe(sidebarScroll)
    expect(document.querySelector<HTMLDetailsElement>('[data-stage="other"]')?.open).toBe(false)
    expect(document.querySelector<HTMLDetailsElement>('.tree-folder[data-path$="/checklists"]')?.open).toBe(false)
    expect(document.querySelector<HTMLElement>('.sidebar-scroll')?.scrollTop).toBe(48)

    document.querySelector<HTMLButtonElement>('.file-sidebar .left-panel-toggle')!.click()
    expect(app.classList.contains('sidebar-closed')).toBe(true)
    document.querySelector<HTMLButtonElement>('.workspace-header [aria-label="语言"]')!.click()
    const english = Array.from(document.querySelectorAll<HTMLButtonElement>('.language-menu .popover-action'))
      .find((button) => button.textContent?.includes('English'))!
    english.click()

    expect(app.classList.contains('sidebar-closed')).toBe(true)
    expect(document.querySelector('.file-sidebar')?.hasAttribute('inert')).toBe(true)
    expect(document.querySelector<HTMLDetailsElement>('[data-stage="other"]')?.open).toBe(false)
    expect(document.querySelector<HTMLDetailsElement>('.tree-folder[data-path$="/checklists"]')?.open).toBe(false)
    expect(document.querySelector<HTMLElement>('.sidebar-scroll')?.scrollTop).toBe(48)
  })

  it('reserves sidebar group actions for explicit Groups, not directory Categories', async () => {
    const bundle = structuredClone(testBundle)
    bundle.files.push({ path: 'specs/001-browser/docs/intro.md', mediaType: 'text/markdown', content: '# Intro' })
    bundle.navigation = { version: 1, groups: [
      { id: 'category-docs', title: 'docs', paths: ['docs/intro.md'] },
      { id: 'g1', title: 'Review group', paths: ['interaction-design.md'] },
    ] }
    const browser = new FileBrowser(document.getElementById('app')!, bundle)

    expect(document.querySelector('.manage-categories-btn')).toBeNull()
    expect(document.querySelector('[data-stage="category-docs"] .group-menu-btn')).toBeNull()
    const menu = document.querySelector<HTMLButtonElement>('[data-stage="g1"] .group-menu-btn')!
    expect(menu).not.toBeNull()
    menu.click()
    expect(document.querySelector('.navigation-popover')?.textContent).toContain('重命名分组')
    expect(document.querySelector('.navigation-popover')?.textContent).not.toContain('重命名分类')

    document.querySelector<HTMLButtonElement>('.navigation-popover .popover-action')!.click()
    const prompt = document.querySelector<HTMLDialogElement>('.prompt-dialog')!
    prompt.querySelector<HTMLInputElement>('input')!.value = 'Team review'
    prompt.querySelector<HTMLButtonElement>('.confirmation-dialog-actions button:last-child')!.click()
    await vi.waitFor(() => expect(bundle.navigation?.groups.find(({ id }) => id === 'g1')?.title).toBe('Team review'))
    expect(bundle.navigation.groups.find(({ id }) => id === 'category-docs')?.title).toBe('docs')
    browser.destroy()
  })

  it('creates from Unassigned without selecting the first category or enabling drag', async () => {
    const bundle = structuredClone(testBundle)
    bundle.navigation = { version: 1, groups: [{ id: 'group-docs', title: 'Docs', paths: ['spec.md'] }] }
    const browser = new FileBrowser(document.getElementById('app')!, bundle)
    const unassigned = document.querySelector<HTMLElement>('.other-files-group')!
    expect(unassigned).not.toBeNull()
    expect(document.querySelector('.file-row[draggable]')).toBeNull()
    unassigned.querySelector<HTMLButtonElement>('.add-file-to-group-btn')!.click()
    const dialog = document.querySelector<HTMLDialogElement>('.new-file-dialog')!
    expect(dialog.querySelector<HTMLSelectElement>('.new-file-category')!.value).toBe('')
    dialog.querySelector<HTMLInputElement>('.new-file-input')!.value = 'unassigned-proof'
    dialog.querySelector<HTMLButtonElement>('.new-file-confirm')!.click()
    await vi.waitFor(() => expect(bundle.files.some(({ path }) => path.endsWith('/unassigned-proof.md'))).toBe(true))
    expect(bundle.navigation.groups[0].paths).not.toContain('unassigned-proof.md')
    expect(document.querySelector('.other-files-group .file-row[data-path$="unassigned-proof.md"]')).not.toBeNull()
    browser.destroy()
  })

  it('creates ordinary files without changing checkpoint membership and keeps category switching available', async () => {
    const bundle = structuredClone(testBundle)
    bundle.checkpoints = {
      version: 1,
      nodes: [{ id: 'gate', title: 'Gate', after: [], documents: [{ path: 'specs/001-browser/spec.md', optional: true }] }],
      documents: [],
    }
    bundle.navigation = { version: 1, groups: [{ id: 'custom', title: 'Custom', paths: ['plan.md'] }] }
    const browser = new FileBrowser(document.getElementById('app')!, bundle)

    document.querySelector<HTMLButtonElement>('[data-stage="checkpoint-gate"] .add-file-to-group-btn')!.click()
    const dialog = document.querySelector<HTMLDialogElement>('.new-file-dialog')!
    expect(dialog.textContent).toContain('文件类型')
    expect(dialog.textContent).toContain('分类')
    expect(dialog.querySelector('.new-file-confirm.control-button-primary')).not.toBeNull()
    const category = dialog.querySelector<HTMLSelectElement>('.new-file-category')!
    expect(Array.from(category.options, ({ value }) => value)).toEqual(['', 'checkpoint-gate', 'custom'])
    expect(category.options[1].textContent).toContain('Gate · 检查点')
    category.value = 'custom'
    dialog.querySelector<HTMLInputElement>('.new-file-input')!.value = 'extra-proof'
    dialog.querySelector<HTMLButtonElement>('.new-file-confirm')!.click()
    await vi.waitFor(() => expect(bundle.files.some((file) => file.path.endsWith('/extra-proof.md'))).toBe(true))

    expect(bundle.checkpoints).toEqual({
      version: 1,
      nodes: [{ id: 'gate', title: 'Gate', after: [], documents: [{ path: 'specs/001-browser/spec.md', optional: true }] }],
      documents: [],
    })
    expect(browser.getCheckpointDocumentAdditions()).toEqual([])
    expect(bundle.navigation.groups[0].paths).toContain('extra-proof.md')
    const badge = document.querySelector<HTMLButtonElement>('.workspace-category-badge')!
    expect(badge.disabled).toBe(false)
    expect(badge.textContent).toBe('Custom')
    badge.click()
    expect(document.querySelector('.group-selector-popover')).not.toBeNull()
    browser.destroy()
  })

  it('lets an ordinary file use a Checkpoint category without acquiring a document status', async () => {
    const bundle = structuredClone(testBundle)
    bundle.checkpoints = {
      version: 1,
      nodes: [{ id: 'gate', title: 'Gate', after: [], documents: [{ path: 'specs/001-browser/spec.md' }] }],
      documents: [],
    }
    bundle.navigation = { version: 1, groups: [{ id: 'custom', title: 'Custom', paths: ['plan.md'] }] }
    const original = structuredClone(bundle.checkpoints)
    const browser = new FileBrowser(document.getElementById('app')!, bundle)

    document.querySelector<HTMLButtonElement>('.file-row[data-path$="plan.md"]')!.click()
    const badge = document.querySelector<HTMLButtonElement>('.workspace-category-badge')!
    badge.click()
    const gate = Array.from(document.querySelectorAll<HTMLButtonElement>('.group-selector-popover .popover-action'))
      .find((button) => button.textContent?.trim() === 'Gate · 检查点')!
    gate.click()

    const categoryFile = document.querySelector<HTMLElement>('.checkpoint-group .file-row[data-path$="plan.md"]')!
    expect(categoryFile).not.toBeNull()
    expect(categoryFile.closest('.checkpoint-file-row')).toBeNull()
    expect(categoryFile.querySelector('.checkpoint-status-button')).toBeNull()
    expect(badge.disabled).toBe(false)
    expect(badge.textContent).toBe('Gate')
    expect(bundle.checkpoints).toEqual(original)
    expect(browser.getCheckpointDocumentAdditions()).toEqual([])

    badge.click()
    Array.from(document.querySelectorAll<HTMLButtonElement>('.group-selector-popover .popover-action'))
      .find((button) => button.textContent?.trim() === 'Custom')!.click()
    expect(document.querySelector('.checkpoint-group .file-row[data-path$="plan.md"]')).toBeNull()
    expect(badge.textContent).toBe('Custom')
    expect(bundle.checkpoints).toEqual(original)

    document.querySelector<HTMLButtonElement>('[data-stage="checkpoint-gate"] .add-file-to-group-btn')!.click()
    const dialog = document.querySelector<HTMLDialogElement>('.new-file-dialog')!
    expect(dialog.querySelector<HTMLSelectElement>('.new-file-category')!.value).toBe('checkpoint-gate')
    dialog.querySelector<HTMLInputElement>('.new-file-input')!.value = 'category-only'
    dialog.querySelector<HTMLButtonElement>('.new-file-confirm')!.click()
    await vi.waitFor(() => expect(document.querySelector('.checkpoint-group .file-row[data-path$="category-only.md"]')).not.toBeNull())
    expect(bundle.files.find(({ path }) => path.endsWith('/category-only.md'))?.path).toBe(`${bundle.root}/category-only.md`)
    expect(bundle.checkpoints).toEqual(original)
    expect(browser.getCheckpointDocumentAdditions()).toEqual([])
    browser.destroy()
  })
  it('reassigns a file without moving its virtual path or comment anchor', () => {
    const bundle = structuredClone(testBundle)
    const file = bundle.files.find(({ path }) => path.endsWith('/plan.md'))!
    const originalPath = file.path
    bundle.files.push({ path: 'specs/001-browser/docs/guide.md', mediaType: 'text/markdown', content: '# Guide' })
    bundle.navigation = { version: 1, groups: [{ id: 'category-docs', title: 'docs', paths: ['docs/guide.md'] }] }
    bundle.comments = [{
      id: 'thread-category',
      anchor: { path: originalPath, position: { start: 0, end: 4 },
        quote: { exact: file.content.slice(0, 4), prefix: '', suffix: '' } },
      status: 'open',
      messages: [{ id: 'message-category', author: 'Ada', body: 'Check this', createdAt: '2026-09-24T00:00:00.000Z' }],
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
    }]
    const browser = new FileBrowser(document.getElementById('app')!, bundle)
    document.querySelector<HTMLButtonElement>('.file-row[data-path$="plan.md"]')!.click()
    document.querySelector<HTMLButtonElement>('.workspace-category-badge')!.click()
    Array.from(document.querySelectorAll<HTMLButtonElement>('.group-selector-popover .popover-action'))
      .find((button) => button.textContent?.trim() === 'docs')!.click()

    expect(file.path).toBe(originalPath)
    expect(bundle.comments[0].anchor.path).toBe(originalPath)
    expect(bundle.navigation.groups.find(({ id }) => id === 'category-docs')?.paths).toContain('plan.md')
    expect(document.querySelector('[data-stage="category-docs"] .file-row[data-path$="plan.md"]')).not.toBeNull()
    expect(parseBundle(JSON.stringify(bundle)).ok).toBe(true)
    browser.destroy()
  })


  it('orders the same file actions for ordinary and Checkpoint files and uses the entry key', () => {
    const bundle = structuredClone(testBundle)
    bundle.checkpoints = {
      version: 1,
      nodes: [{ id: 'gate', title: 'Gate', after: [], documents: [{ path: 'specs/001-browser/spec.md' }] }],
      documents: [],
    }
    const browser = new FileBrowser(document.getElementById('app')!, bundle)
    for (const selector of ['.checkpoint-file-menu', '.file-row[data-path$="plan.md"] .file-action-btn']) {
      document.querySelector<HTMLButtonElement>(selector)!.click()
      const menu = document.querySelector<HTMLElement>('.navigation-popover')!
      expect(Array.from(menu.querySelectorAll('.popover-action'), (button) => button.textContent?.trim()))
        .toEqual(['重命名文件', '删除文件', '设为主入口'])
      expect(Array.from(menu.children, (child) => child.getAttribute('role'))).toEqual([null, null, 'separator', null])
      expect(menu.querySelector('.popover-action:last-child svg')?.getAttribute('data-icon')).toBe('key')
    }
    document.querySelector<HTMLButtonElement>('.navigation-popover .popover-action:last-child')!.click()
    expect(bundle.navigation?.entry).toBe('plan.md')
    expect(document.querySelector('.file-row[data-path$="plan.md"] .entry-label')).not.toBeNull()
    browser.destroy()
  })

  it('renames a required Checkpoint file while leaving its original requirement uncreated', async () => {
    const bundle = structuredClone(testBundle)
    const path = 'specs/001-browser/spec.md'
    bundle.checkpoints = {
      version: 1,
      nodes: [{ id: 'gate', title: 'Gate', after: [], documents: [{ path }] }],
      documents: [{ path, status: 'complete', updatedAt: '2026-09-25T12:00:00Z' }],
    }
    bundle.navigation = { version: 1, entry: 'spec.md', groups: [{ id: 'review', title: 'Review', paths: ['spec.md'] }] }
    const browser = new FileBrowser(document.getElementById('app')!, bundle)
    document.querySelector<HTMLButtonElement>('.checkpoint-file-menu')!.click()
    document.querySelector<HTMLButtonElement>('.navigation-popover .popover-action:first-child')!.click()
    const prompt = document.querySelector<HTMLDialogElement>('.prompt-dialog')!
    prompt.querySelector<HTMLInputElement>('input')!.value = 'revised'
    prompt.querySelector<HTMLButtonElement>('.confirmation-dialog-actions button:last-child')!.click()
    await vi.waitFor(() => expect(bundle.files[0].path).toBe('specs/001-browser/revised.md'))
    expect(bundle.navigation.entry).toBe('revised.md')
    expect(bundle.navigation.groups[0].paths).toEqual(['revised.md'])
    expect(bundle.checkpoints).toMatchObject({ nodes: [{ documents: [{ path }] }], documents: [] })
    expect(browser.getCheckpointChanges()).toEqual([{ path, from: 'complete', to: 'todo' }])
    expect(document.querySelector('.checkpoint-placeholder-row [data-path$="spec.md"]')).not.toBeNull()
    expect(document.querySelector('.checkpoint-placeholder-row .checkpoint-status-button')).toBeNull()
    expect(document.querySelector('.file-row[data-path$="revised.md"]')).not.toBeNull()
    expect(resolveCheckpoints(bundle).nodes[0]).toMatchObject({ aggregate: 'todo', documents: [{ path, exists: false, status: 'todo' }] })
    expect(parseBundle(JSON.stringify(bundle)).ok).toBe(true)
    browser.destroy()
  })

  it('deletes a required Checkpoint file into an uncreated requirement', async () => {
    const bundle = structuredClone(testBundle)
    const path = 'specs/001-browser/spec.md'
    bundle.checkpoints = {
      version: 1,
      nodes: [{ id: 'gate', title: 'Gate', after: [], documents: [{ path }] }],
      documents: [{ path, status: 'freeze', updatedAt: '2026-09-25T12:00:00Z' }],
    }
    bundle.navigation = { version: 1, entry: 'spec.md', groups: [{ id: 'review', title: 'Review', paths: ['spec.md'] }] }
    const browser = new FileBrowser(document.getElementById('app')!, bundle)
    document.querySelector<HTMLButtonElement>('.checkpoint-file-menu')!.click()
    document.querySelector<HTMLButtonElement>('.navigation-popover .popover-action:nth-child(2)')!.click()
    document.querySelector<HTMLButtonElement>('.confirmation-dialog-actions button:last-child')!.click()
    await vi.waitFor(() => expect(bundle.files.some((file) => file.path === path)).toBe(false))
    expect(bundle.checkpoints).toMatchObject({ nodes: [{ documents: [{ path }] }], documents: [] })
    expect(browser.getCheckpointChanges()).toEqual([{ path, from: 'freeze', to: 'todo' }])
    expect(bundle.navigation.entry).toBeUndefined()
    expect(bundle.navigation.groups[0].paths).toEqual([])
    expect(resolveCheckpoints(bundle).nodes[0]).toMatchObject({ aggregate: 'todo', documents: [{ path, exists: false, status: 'todo' }] })
    expect(document.querySelector('.checkpoint-placeholder-row [data-path$="spec.md"]')).not.toBeNull()
    expect(document.querySelector('.checkpoint-placeholder .checkpoint-create-button')).not.toBeNull()
    expect(document.querySelector('.checkpoint-placeholder-row .checkpoint-status-button')).toBeNull()
    expect(parseBundle(JSON.stringify(bundle)).ok).toBe(true)
    browser.destroy()
  })

  it('clears the document header and viewer after deleting the last ordinary file', async () => {
    const bundle = structuredClone(testBundle)
    bundle.files = [bundle.files[0]]
    const browser = new FileBrowser(document.getElementById('app')!, bundle)
    document.querySelector<HTMLButtonElement>('.file-row .file-action-btn')!.click()
    document.querySelector<HTMLButtonElement>('.navigation-popover .popover-action:nth-child(2)')!.click()
    document.querySelector<HTMLButtonElement>('.confirmation-dialog-actions button:last-child')!.click()
    await vi.waitFor(() => expect(bundle.files).toEqual([]))
    expect(document.querySelector('.workspace-path')?.textContent).toBe('')
    expect(document.querySelector<HTMLElement>('.workspace-category-badge')?.style.display).toBe('none')
    expect(document.querySelector('.file-viewer .empty-state')).not.toBeNull()
    browser.destroy()
  })

  it('loads malformed local Checkpoints with a warning and preserves their raw value', () => {
    const bundle = structuredClone(testBundle)
    bundle.checkpoints = { version: 1, nodes: 'invalid', documents: [] }
    bundle.collab = { room: 'offline-room', on: true }
    const browser = new FileBrowser(document.getElementById('app')!, bundle)
    expect(document.querySelector('.checkpoint-warning-row')?.textContent).toContain('checkpoints.nodes')
    expect(bundle.checkpoints).toEqual({ version: 1, nodes: 'invalid', documents: [] })
    browser.destroy()
  })

  it('shows missing Checkpoint documents without status controls until created', () => {
    const bundle = structuredClone(testBundle)
    bundle.checkpoints = {
      version: 1,
      nodes: [{ id: 'gate', title: 'Gate', after: [], documents: [{ path: 'specs/001-browser/missing.md' }] }],
      documents: [],
    }
    const browser = new FileBrowser(document.getElementById('app')!, bundle)
    const missing = document.querySelector<HTMLButtonElement>('.checkpoint-placeholder-row [data-path$="missing.md"]')!
    expect(missing.closest('.checkpoint-file-row')?.querySelector('.checkpoint-status-button')).toBeNull()
    missing.click()
    expect(document.querySelector('.checkpoint-placeholder .checkpoint-document-status')).toBeNull()
    expect(document.querySelector('.checkpoint-placeholder .checkpoint-create-hint')).toBeNull()
    expect(document.querySelector<HTMLButtonElement>('.checkpoint-create-button')).not.toBeNull()
    document.querySelector<HTMLButtonElement>('.checkpoint-nav-item')!.click()
    const graphRow = document.querySelector('.checkpoint-view .checkpoint-document')!
    expect(graphRow.textContent).toContain('missing.md')
    expect(graphRow.querySelector('.checkpoint-document-status')).toBeNull()
    expect(document.querySelector<HTMLButtonElement>('.checkpoint-nav-item')?.textContent).toContain('检查点')
    expect(document.querySelector<HTMLElement>('.checkpoint-page-title')?.textContent).toContain('检查点')
    browser.destroy()
  })

  it('uses the first supported browser language when no choice was saved', () => {
    Object.defineProperty(navigator, 'languages', { configurable: true, value: ['nl-NL', 'fr-CA', 'zh-CN', 'en-US'] })
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'nl-NL' })

    new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))

    expect(document.documentElement.lang).toBe('zh-Hans')
    expect(document.querySelector('.workspace-header .save-button')?.textContent).toContain('保存')
    expect(localStorage.getItem('taco-locale')).toBeNull()
  })

  it('keeps a saved language choice ahead of browser preferences', () => {
    localStorage.setItem('taco-locale', 'en-GB')
    Object.defineProperty(navigator, 'languages', { configurable: true, value: ['zh-CN'] })
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'zh-CN' })

    new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))

    expect(document.documentElement.lang).toBe('en')
    expect(document.querySelector('.workspace-header .save-button')?.textContent).toContain('Save')
  })

  it('lets an embedding page own theme, language and sharing and opens comments first', () => {
    localStorage.setItem('taco-locale', 'zh-Hans')
    localStorage.setItem('taco-theme', 'light')
    const previousUrl = location.href
    history.replaceState(null, '', '?embed&lang=en&theme=dark')
    try {
      new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))

      expect(document.documentElement.lang).toBe('en')
      expect(document.documentElement.dataset.theme).toBe('dark')
      for (const selector of ['.theme-toggle', '[aria-label="Language"]']) {
        const button = document.querySelector<HTMLButtonElement>(`.workspace-header ${selector}`)!
        expect(button.disabled).toBe(false)
        button.click()
      }
      expect(document.querySelector('.theme-menu, .language-menu')).toBeNull()
      expect(document.querySelector('[aria-controls="taco-comment-list"]')?.getAttribute('aria-selected')).toBe('true')
      expect(localStorage.getItem('taco-locale')).toBe('zh-Hans')
      expect(localStorage.getItem('taco-theme')).toBe('light')
    } finally {
      history.replaceState(null, '', previousUrl)
    }
  })

  it('shows an embedded pending review as unsaved, handoff-ready work', () => {
    const bundle = structuredClone(testBundle)
    bundle.comments = [{
      id: 'thread-pending',
      anchor: { path: 'specs/001-browser/spec.md', position: { start: 20, end: 28 }, quote: { exact: 'Readable', prefix: '', suffix: '' } },
      status: 'open',
      messages: [{ id: 'message-pending', author: 'Ada', body: 'Make this measurable.', createdAt: '2026-08-26T00:00:00.000Z' }],
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z',
    }]
    const previousUrl = location.href
    try {
      history.replaceState(null, '', '?embed')
      new FileBrowser(document.getElementById('app')!, structuredClone(bundle))
      expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(false)
      expect(document.querySelector('.copy-review-main')?.classList.contains('is-dirty')).toBe(false)

      document.getElementById('app')!.replaceChildren()
      history.replaceState(null, '', '?embed&pending')
      new FileBrowser(document.getElementById('app')!, structuredClone(bundle))
      expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(true)
      expect(document.querySelector('.copy-review-main')?.classList.contains('is-dirty')).toBe(true)
    } finally {
      history.replaceState(null, '', previousUrl)
    }
  })

  it('provides save and language actions in the header', () => {
    new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))
    expect(document.querySelector('.workspace-header .share-button')).toBeNull()
    expect(document.querySelector('.workspace-header .save-group.v2-button-group')).not.toBeNull()
    expect(document.querySelector('.workspace-header .copy-review-group.v2-button-group')).not.toBeNull()
    expect(document.querySelector('.workspace-header .save-button')?.textContent).toContain('保存')
    expect(document.querySelector('.workspace-header [data-icon="globe"]')).not.toBeNull()
    expect(document.querySelector('.workspace-header [aria-label="帮助"]')).toBeNull()
    expect(document.querySelector('.workspace-title-divider')).toBeNull()
    document.querySelector<HTMLButtonElement>('.workspace-header .save-more')!.click()
    expect(Array.from(document.querySelectorAll('.save-menu .popover-action')).map((node) => node.textContent)).toEqual([
      '保存',
      '保存副本…',
      '解包到文件夹…',
    ])
    expect(document.querySelectorAll('.save-menu .popover-action.sidebar-row')).toHaveLength(3)
    expect(document.querySelectorAll('.save-menu .popover-action-label.sidebar-row-label')).toHaveLength(3)
    const language = document.querySelector<HTMLButtonElement>('.workspace-header [aria-label="语言"]')!
    language.click()
    expect(Array.from(document.querySelectorAll('.language-menu .popover-action-label')).map((node) => node.textContent)).toEqual([
      '简体中文', 'English',
    ])
    expect(document.querySelectorAll('.language-menu .popover-action.sidebar-row')).toHaveLength(2)
    expect(document.querySelectorAll('.language-menu .popover-action-label.sidebar-row-label')).toHaveLength(2)
    expect(document.querySelectorAll('.language-menu .popover-check')).toHaveLength(1)
  })



  it('keeps sealed reader copies read-only in every editing surface', async () => {
    const reader = structuredClone(testBundle)
    reader.access = 'reader'
    new FileBrowser(document.getElementById('app')!, reader)

    const editor = await waitForEditor()
    expect(document.getElementById('app')?.classList.contains('is-readonly')).toBe(true)
    expect(document.querySelector<HTMLInputElement>('.bundle-title')?.disabled).toBe(true)
    expect(document.querySelector<HTMLElement>('.document-inline-title-text')?.contentEditable).toBe('false')
    expect(editor.getAttribute('contenteditable')).toBe('false')



    document.querySelector<HTMLButtonElement>('.file-row[data-path$="api.yaml"]')!.click()
    expect(document.querySelector('[data-segmented-value="structure"]')).toBeNull()
    expect(document.querySelector<HTMLTextAreaElement>('.source-editor-input')?.readOnly).toBe(true)
  })

  it('keeps directory metadata and keyboard search out of the chrome', () => {
    new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))
    expect(document.querySelector('.sidebar-head')).toBeNull()
    expect(document.querySelector('.local-badge')).toBeNull()
    expect(document.querySelector('.file-status')).toBeNull()
    expect(document.querySelector('.workspace-header [aria-label^="搜索"]')).toBeNull()
    expect(document.querySelector('.file-header')).toBeNull()
  })

  it('keeps the document outline and comments in the shared workspace panel', () => {
    new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))
    const panels = document.querySelectorAll('.panel-layout > .file-sidebar, .panel-layout > .file-workspace')
    expect(panels).toHaveLength(2)
    expect(document.querySelector('.file-sidebar > .sidebar-header')).not.toBeNull()
    expect(document.querySelector('.file-sidebar > .sidebar-scroll')).not.toBeNull()
    expect(document.querySelector('.file-workspace > .workspace-header')).not.toBeNull()
    expect(document.querySelector('.file-workspace > .workspace-body')).not.toBeNull()
    expect(document.querySelector('.workspace-body > .file-viewer')).not.toBeNull()
    expect(document.querySelector('.workspace-body > .comment-panel')).not.toBeNull()
    const shell = document.querySelector('.file-viewer .markdown-document-shell')!
    expect(shell.firstElementChild?.classList.contains('document-inline-title')).toBe(true)
    expect(shell.lastElementChild?.classList.contains('tiptap-editor-host')).toBe(true)
    expect(shell.children).toHaveLength(2)
    expect(document.querySelector('.comment-panel > .document-outline')).not.toBeNull()
    expect(Array.from(document.querySelectorAll('.comment-panel > .comment-panel-header [role="tab"]')).map((node) => node.textContent)).toEqual(['大纲', '评论'])
    expect(document.querySelector('.comment-panel > .comment-list')).not.toBeNull()
    expect(document.querySelector('.file-viewer')?.id).toBe('taco-main')
  })

  it('uses a dismissible comments drawer in the narrow layout', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    const browser = new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))
    const app = document.getElementById('app')!
    const toggle = document.querySelector<HTMLButtonElement>('.comment-toggle')!
    const panel = document.querySelector<HTMLElement>('.comment-panel')!

    expect(app.classList.contains('comment-panel-open')).toBe(false)
    expect(panel.getAttribute('aria-hidden')).toBe('true')
    expect(panel.hasAttribute('inert')).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    toggle.click()
    expect(app.classList.contains('comment-panel-open')).toBe(true)
    expect(panel.getAttribute('aria-hidden')).toBe('false')
    expect(panel.hasAttribute('inert')).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(app.classList.contains('comment-panel-open')).toBe(false)
    expect(document.activeElement).toBe(toggle)
    browser.destroy()
  })

  it.each(['outside', 'escape', 'scroll', 'blur', 'selection'] as const)('dismisses the selection action on %s without opening a draft', async (reason) => {
    const browser = new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))
    try {
      const editor = await waitForEditor()
      const paragraph = Array.from(editor.querySelectorAll('p')).find((node) => node.textContent?.includes('Readable'))!
      const range = document.createRange()
      range.selectNodeContents(paragraph)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      expect(document.querySelector('.selection-comment-button')).not.toBeNull()
      // A delayed notification for the same selection must not dismiss a fresh action.
      document.dispatchEvent(new Event('selectionchange'))
      expect(document.querySelector('.selection-comment-button')).not.toBeNull()
      if (reason === 'outside') document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      if (reason === 'escape') {
        editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))
      }
      if (reason === 'scroll') document.querySelector('.file-viewer')!.dispatchEvent(new Event('scroll'))
      if (reason === 'blur') window.dispatchEvent(new Event('blur'))
      if (reason === 'selection') {
        selection.removeAllRanges()
        document.dispatchEvent(new Event('selectionchange'))
      }
      expect(document.querySelector('.selection-comment-button')).toBeNull()
      expect(document.querySelector('.comment-composer')).toBeNull()
    } finally {
      browser.destroy()
    }
  })

  it('creates a persisted comment thread from selected Markdown text', async () => {
    const editableBundle = structuredClone(testBundle)
    new FileBrowser(document.getElementById('app')!, editableBundle)
    await waitForEditor()
    document.querySelector<HTMLButtonElement>('.comment-toggle')!.click()
    const paragraph = Array.from(document.querySelectorAll('.tiptap-editor-host .tiptap p'))
      .find((node) => node.textContent?.includes('Readable Markdown.'))!
    const text = paragraph.firstChild!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 8)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    const selectionComment = document.querySelector<HTMLButtonElement>('.selection-comment-button')!
    expect(selectionComment.textContent).toBe('评论')
    selectionComment.click()
    expect(document.querySelector('.selection-comment-button')).toBeNull()
    expect(document.querySelector('.comment-panel')?.getAttribute('aria-hidden')).toBe('false')
    expect(document.querySelector('.right-panel-tabs')).not.toBeNull()
    expect(document.querySelector<HTMLButtonElement>('.right-panel-tabs [aria-selected="true"]')?.textContent).toBe('评论')
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(false)
    expect(editableBundle.comments).toBeUndefined()
    expect(document.querySelector('.comment-empty-banner')).toBeNull()
    const input = document.querySelector<HTMLTextAreaElement>('.comment-composer .comment-input')!
    input.value = 'Make this measurable.'
    const toggle = document.querySelector<HTMLButtonElement>('.comment-toggle')!
    toggle.click()
    toggle.click()
    expect(document.querySelector<HTMLTextAreaElement>('.comment-composer .comment-input')?.value).toBe('Make this measurable.')
    input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(editableBundle.comments).toHaveLength(1)
    expect(editableBundle.comments?.[0]).toMatchObject({
      status: 'open',
      anchor: { path: 'specs/001-browser/spec.md', quote: { exact: 'Readable' } },
      messages: [{ body: 'Make this measurable.' }],
    })
    expect(document.querySelector('.comment-thread')?.textContent).toContain('Make this measurable.')
    expect(document.querySelector('.comment-count')?.textContent).toBe('1')
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(true)
  })

  it('collects a missing comment author in an application dialog without losing the pending submission', async () => {
    sessionStorage.clear()
    const editableBundle = structuredClone(testBundle)
    new FileBrowser(document.getElementById('app')!, editableBundle)
    await waitForEditor()
    const paragraph = Array.from(document.querySelectorAll('.tiptap-editor-host .tiptap p'))
      .find((node) => node.textContent?.includes('Readable Markdown.'))!
    const text = paragraph.firstChild!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 8)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('.selection-comment-button')!.click()

    const comment = document.querySelector<HTMLTextAreaElement>('.comment-composer .comment-input')!
    comment.value = 'Keep this pending.'
    comment.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(window.prompt).not.toHaveBeenCalled()
    expect(editableBundle.comments).toBeUndefined()
    expect(document.querySelector('.author-name-dialog[open]')).not.toBeNull()

    document.querySelector<HTMLButtonElement>('.author-name-dialog button[aria-label="取消"]')!.click()
    expect(document.querySelector('.author-name-dialog')).toBeNull()
    expect(document.querySelector<HTMLTextAreaElement>('.comment-composer .comment-input')?.value).toBe('Keep this pending.')

    comment.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    const name = document.querySelector<HTMLInputElement>('.author-name-input')!
    const confirm = document.querySelector<HTMLButtonElement>('.author-name-dialog button[aria-label="添加评论"]')!
    expect(confirm.disabled).toBe(true)
    name.value = 'Ada'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    expect(confirm.disabled).toBe(false)
    name.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    expect(editableBundle.comments?.[0]).toMatchObject({
      anchor: { quote: { exact: 'Readable' } },
      messages: [{ author: 'Ada', body: 'Keep this pending.' }],
    })
    expect(sessionStorage.getItem('taco-session-author')).toBe('Ada')

  })

  it('uses the same application-owned identity step for a first reply', () => {
    sessionStorage.clear()
    const timestamp = '2026-08-26T00:00:00.000Z'
    const replyBundle = structuredClone(testBundle)
    replyBundle.comments = [{
      id: 'thread-existing',
      anchor: {
        path: 'specs/001-browser/spec.md',
        position: { start: 20, end: 28 },
        quote: { exact: 'Readable', prefix: 'Outcome\n', suffix: ' Markdown.' },
      },
      status: 'open',
      messages: [{ id: 'message-existing', author: 'Ada', body: 'Initial note.', createdAt: timestamp }],
      createdAt: timestamp,
      updatedAt: timestamp,
    }]
    new FileBrowser(document.getElementById('app')!, replyBundle)
    document.querySelector<HTMLButtonElement>('.comment-toggle')!.click()
    document.querySelector<HTMLButtonElement>('.comment-thread-actions .comment-action')!.click()
    const reply = document.querySelector<HTMLTextAreaElement>('.comment-reply-form .comment-input')!
    reply.value = 'First reply.'
    reply.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    expect(replyBundle.comments[0].messages).toHaveLength(1)
    expect(document.querySelector('.author-name-dialog[open]')).not.toBeNull()
    const name = document.querySelector<HTMLInputElement>('.author-name-input')!
    name.value = 'Grace'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    name.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    expect(replyBundle.comments[0].messages).toHaveLength(2)
    expect(replyBundle.comments[0].messages[1]).toMatchObject({ author: 'Grace', body: 'First reply.' })
    expect(window.prompt).not.toHaveBeenCalled()
  })

  it('keeps an unsubmitted comment draft out of the saved document state', async () => {
    const editableBundle = structuredClone(testBundle)
    new FileBrowser(document.getElementById('app')!, editableBundle)
    await waitForEditor()
    const paragraph = Array.from(document.querySelectorAll('.tiptap-editor-host .tiptap p'))
      .find((node) => node.textContent?.includes('Readable Markdown.'))!
    const text = paragraph.firstChild!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 8)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('.selection-comment-button')!.click()

    const input = document.querySelector<HTMLTextAreaElement>('.comment-composer .comment-input')!
    input.value = 'Unsubmitted draft'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(editableBundle.comments).toBeUndefined()
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(false)

    document.querySelector<HTMLButtonElement>('.comment-composer .comment-action')!.click()
    expect(document.querySelector('.comment-composer')).toBeNull()
    expect(editableBundle.comments).toBeUndefined()
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(false)
  })

  it('keeps open comment drafts when a document edit makes a thread stale and rebuilds the panel', async () => {
    localStorage.setItem('taco-comment-principal:browser-test', 'principal-a')
    const editableBundle = structuredClone(testBundle)
    editableBundle.comments = [{
      id: 'thread-live',
      anchor: { path: 'specs/001-browser/spec.md', position: { start: 0, end: 8 }, quote: { exact: 'Readable', prefix: '', suffix: '' } },
      status: 'open',
      messages: [{ id: 'message-live', author: 'Ada', authorId: 'principal-a', body: 'Keep this', createdAt: '2026-08-26T00:00:00.000Z' }],
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z',
    }]
    const browser = new FileBrowser(document.getElementById('app')!, editableBundle)
    try {
      await waitForEditor()
      document.querySelector<HTMLButtonElement>('.comment-toggle')!.click()

      // An open reply form on the existing thread.
      document.querySelector<HTMLButtonElement>('.comment-thread-actions .comment-action')!.click()
      const reply = document.querySelector<HTMLTextAreaElement>('.comment-reply-form .comment-input')!
      reply.value = 'Reply in progress'
      expect(document.activeElement).toBe(reply)

      // An open in-place editor on the existing message.
      document.querySelector<HTMLButtonElement>('.comment-message-actions .comment-action')!.click()
      const edit = document.querySelector<HTMLTextAreaElement>('.comment-message-editor .comment-input')!
      edit.value = 'Edit in progress'
      await vi.waitFor(() => expect(document.activeElement).toBe(edit))

      // And an open composer on a fresh selection.
      const paragraph = Array.from(document.querySelectorAll('.tiptap-editor-host .tiptap p'))
        .find((node) => node.textContent?.includes('Readable Markdown.'))!
      const text = paragraph.firstChild!
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 8)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      document.querySelector<HTMLButtonElement>('.selection-comment-button')!.click()
      document.querySelector<HTMLTextAreaElement>('.comment-composer .comment-input')!.value = 'Comment in progress'

      // Rewriting the body drops the anchored text, so the threaded comment turns stale and the panel rebuilds.
      const editor = (browser as unknown as {
        markdownEditor: { commands: { selectAll: () => boolean; insertContent: (content: string) => boolean } }
      }).markdownEditor
      editor.commands.selectAll()
      expect(editor.commands.insertContent('Rewritten body.')).toBe(true)
      await vi.waitFor(() => expect(document.querySelector('.comment-stale-group')).not.toBeNull())

      expect(document.querySelector<HTMLTextAreaElement>('.comment-composer .comment-input')?.value).toBe('Comment in progress')
      expect(document.querySelector<HTMLTextAreaElement>('.comment-reply-form .comment-input')?.value).toBe('Reply in progress')
      const restoredEdit = document.querySelector<HTMLTextAreaElement>('.comment-message-editor .comment-input')
      expect(restoredEdit?.value).toBe('Edit in progress')
      // The rebuilt form the reviewer was typing in keeps focus.
      expect(document.activeElement).toBe(restoredEdit)
      expect(editableBundle.comments[0].messages).toHaveLength(1)
    } finally {
      browser.destroy()
    }
  })

  it('edits only principal-owned messages in place with validation, no-op and cancel semantics', () => {
    localStorage.setItem('taco-comment-principal:browser-test', 'principal-local')
    const timestamp = '2026-08-26T00:00:00.000Z'
    const editableBundle = structuredClone(testBundle)
    editableBundle.comments = [{
      id: 'thread-actions',
      anchor: { path: 'specs/001-browser/spec.md', position: { start: 20, end: 28 }, quote: { exact: 'Readable', prefix: 'Outcome\n', suffix: ' Markdown.' } },
      status: 'open',
      messages: [
        { id: 'message-own', author: 'Same name', authorId: 'principal-local', body: 'Original', createdAt: timestamp },
        { id: 'message-other', author: 'Same name', authorId: 'principal-other', body: 'Other', createdAt: '2026-08-26T00:00:01.000Z' },
      ],
      createdAt: timestamp,
      updatedAt: '2026-08-26T00:00:01.000Z',
    }]
    new FileBrowser(document.getElementById('app')!, editableBundle)

    expect(document.querySelectorAll('[data-message-id="message-own"] .comment-message-actions button')).toHaveLength(2)
    expect(document.querySelectorAll('[data-message-id="message-other"] .comment-message-actions button')).toHaveLength(1)
    expect(document.querySelector('[data-message-id="message-own"] .comment-action')?.getAttribute('aria-label')).toBe('编辑 Same name 的消息')
    expect(document.querySelector('[data-message-id="message-other"] .comment-message-delete')?.getAttribute('aria-label')).toBe('删除 Same name 的消息')
    document.querySelector<HTMLButtonElement>('[data-message-id="message-own"] .comment-action')!.click()
    let editor = document.querySelector<HTMLTextAreaElement>('.comment-message-editor .comment-input')!
    editor.value = '   '
    editor.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(editor.getAttribute('aria-invalid')).toBe('true')
    expect(document.querySelector('.comment-validation')?.textContent).toBe('评论内容不能为空。')
    expect(editableBundle.comments[0].messages[0].body).toBe('Original')

    editor.value = 'Original'
    editor.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(editableBundle.comments[0].messages[0].updatedAt).toBeUndefined()
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(false)

    document.querySelector<HTMLButtonElement>('[data-message-id="message-own"] .comment-action')!.click()
    editor = document.querySelector<HTMLTextAreaElement>('.comment-message-editor .comment-input')!
    editor.value = 'Changed'
    editor.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(editableBundle.comments[0].messages[0]).toMatchObject({ body: 'Changed', updatedAt: expect.any(String) })
    expect(document.querySelector('[data-message-id="message-own"] .comment-edited')?.textContent).toBe('已编辑')

    document.querySelector<HTMLButtonElement>('[data-message-id="message-own"] .comment-action')!.click()
    editor = document.querySelector<HTMLTextAreaElement>('.comment-message-editor .comment-input')!
    editor.value = 'Cancelled'
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(editableBundle.comments[0].messages[0].body).toBe('Changed')
  })

  it('deletes a selected root message as a tombstone and preserves replies and thread actions', () => {
    localStorage.setItem('taco-comment-principal:browser-test', 'principal-local')
    const confirm = vi.fn().mockReturnValue(true)
    Object.defineProperty(window, 'confirm', { configurable: true, value: confirm })
    const timestamp = '2026-08-26T00:00:00.000Z'
    const editableBundle = structuredClone(testBundle)
    editableBundle.comments = [{
      id: 'thread-delete-message',
      anchor: { path: 'specs/001-browser/spec.md', position: { start: 20, end: 28 }, quote: { exact: 'Readable', prefix: 'Outcome\n', suffix: ' Markdown.' } },
      status: 'resolved',
      messages: [
        { id: 'message-root', author: 'Ada', authorId: 'principal-other', body: 'Root', createdAt: timestamp },
        { id: 'message-reply', author: 'Grace', body: 'Reply remains', createdAt: '2026-08-26T00:00:01.000Z' },
      ],
      createdAt: timestamp,
      updatedAt: '2026-08-26T00:00:01.000Z',
    }]
    new FileBrowser(document.getElementById('app')!, editableBundle)
    document.querySelector<HTMLButtonElement>('[data-message-id="message-root"] .comment-message-delete')!.click()

    expect(confirm).toHaveBeenCalledWith('删除此消息？评论线程和其他回复将保留。')
    expect(editableBundle.comments).toHaveLength(1)
    expect(editableBundle.comments[0].messages).toHaveLength(2)
    expect(editableBundle.comments[0].messages[0]).toMatchObject({ body: '[Deleted message]', deletedAt: expect.any(String) })
    expect(document.querySelector('[data-message-id="message-root"]')?.textContent).toContain('消息已删除')
    expect(document.querySelector('[data-message-id="message-root"]')?.textContent).not.toContain('[Deleted message]')
    expect(document.querySelector('[data-message-id="message-root"] .comment-message-actions')).toBeNull()
    expect(document.querySelector('[data-message-id="message-reply"]')?.textContent).toContain('Reply remains')
    expect(document.querySelectorAll('.comment-thread-actions button')).toHaveLength(3)
    expect(editableBundle.comments[0].status).toBe('resolved')
  })

  it('counts active messages across open threads instead of counting threads', () => {
    const timestamp = '2026-08-26T00:00:00.000Z'
    const counterBundle = structuredClone(testBundle)
    counterBundle.comments = [{
      id: 'thread-counter',
      anchor: { path: 'specs/001-browser/spec.md', position: { start: 20, end: 28 }, quote: { exact: 'Readable', prefix: '', suffix: '' } },
      status: 'open',
      messages: [
        { id: 'message-one', author: 'Ada', body: 'One', createdAt: timestamp },
        { id: 'message-two', author: 'Grace', body: 'Two', createdAt: '2026-08-26T00:00:01.000Z' },
        { id: 'message-deleted', author: 'Lin', body: '[Deleted message]', createdAt: '2026-08-26T00:00:02.000Z', deletedAt: '2026-08-26T00:00:03.000Z' },
      ],
      createdAt: timestamp,
      updatedAt: '2026-08-26T00:00:03.000Z',
    }, {
      id: 'thread-resolved-counter',
      anchor: { path: 'specs/001-browser/spec.md', position: { start: 20, end: 28 }, quote: { exact: 'Readable', prefix: '', suffix: '' } },
      status: 'resolved',
      messages: [{ id: 'message-resolved', author: 'Ada', body: 'Resolved', createdAt: timestamp }],
      createdAt: timestamp,
      updatedAt: timestamp,
    }]
    new FileBrowser(document.getElementById('app')!, counterBundle)
    expect(document.querySelector('.comment-count')?.textContent).toBe('2')
  })

  it('refuses a stale in-place save after the underlying message changes', () => {
    localStorage.setItem('taco-comment-principal:browser-test', 'principal-local')
    const timestamp = '2026-08-26T00:00:00.000Z'
    const editableBundle = structuredClone(testBundle)
    editableBundle.comments = [{
      id: 'thread-stale-edit',
      anchor: { path: 'specs/001-browser/spec.md', position: { start: 20, end: 28 }, quote: { exact: 'Readable', prefix: '', suffix: '' } },
      status: 'open',
      messages: [{ id: 'message-stale', author: 'Ada', authorId: 'principal-local', body: 'Initial', createdAt: timestamp }],
      createdAt: timestamp, updatedAt: timestamp,
    }]
    new FileBrowser(document.getElementById('app')!, editableBundle)
    document.querySelector<HTMLButtonElement>('[data-message-id="message-stale"] .comment-action')!.click()
    const editor = document.querySelector<HTMLTextAreaElement>('.comment-message-editor .comment-input')!
    editor.value = 'Local stale edit'
    editableBundle.comments[0].messages[0].body = 'Remote edit'
    editableBundle.comments[0].messages[0].updatedAt = '2026-08-26T00:00:01.000Z'
    editor.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(editableBundle.comments[0].messages[0].body).toBe('Remote edit')
    expect(document.querySelector('.taco-toast')?.textContent).toContain('此消息已在其他位置发生变化')
  })

  it('removes all message and thread mutation controls from reader copies', () => {
    const reader = structuredClone(testBundle)
    reader.access = 'reader'
    reader.comments = [{
      id: 'thread-reader',
      anchor: { path: 'specs/001-browser/spec.md', position: { start: 20, end: 28 }, quote: { exact: 'Readable', prefix: '', suffix: '' } },
      status: 'open',
      messages: [{ id: 'message-reader', author: 'Ada', authorId: 'principal-local', body: 'Read only', createdAt: '2026-08-26T00:00:00.000Z' }],
      createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z',
    }]
    localStorage.setItem('taco-comment-principal:browser-test', 'principal-local')
    new FileBrowser(document.getElementById('app')!, reader)
    expect(document.querySelector('.comment-message-actions')).toBeNull()
    expect(document.querySelector('.comment-thread-actions')).toBeNull()
  })

  it('mounts writable markdown source editor when rich adapter is absent, with frontmatter title derivation, dirty tracking, and handoff', () => {
    const bundle = structuredClone(testBundle)
    setDefaultRichEditorAdapter(undefined)
    try {
      const browser = new FileBrowser(document.getElementById('app')!, bundle, { richEditorAdapter: undefined })
      const source = document.querySelector<HTMLTextAreaElement>('.source-editor-input')!
      expect(source).not.toBeNull()
      expect(source.readOnly).toBe(false)
      expect(document.querySelector('.document-inline-title-text')).toBeNull()

      source.value = '---\ntitle: "Fallback Title"\n---\n\n# Fallback\n\nFallback content.'
      source.dispatchEvent(new Event('input', { bubbles: true }))

      expect(bundle.files[0].title).toBe('Fallback Title')
      const modified = browser.getModifiedReviewFiles()
      expect(modified).toHaveLength(1)
      expect(modified[0].diff).toContain('+Fallback content.')
      browser.destroy()
    } finally {
      setDefaultRichEditorAdapter(completeRichEditorAdapter)
    }
  })

  it('keeps Markdown in loading state until the rich editor is ready, without exposing raw source', async () => {
    const bundle = structuredClone(testBundle)
    const { promise, resolve } = deferredAdapter()
    setDefaultRichEditorAdapter(undefined)
    try {
      const browser = new FileBrowser(document.getElementById('app')!, bundle, { richEditorAdapter: promise })
      expect(document.querySelector('.file-viewer[aria-busy="true"] [role="status"]')).not.toBeNull()
      expect(document.querySelector('.source-editor-input')).toBeNull()
      const initiallySelected = document.querySelector<HTMLButtonElement>('.file-row.is-selected')
      expect(initiallySelected?.dataset.path).toBe(bundle.files[0].path)
      expect(initiallySelected?.closest('details')?.open).toBe(true)
      expect(document.querySelector('.tiptap-editor-host .tiptap')).toBeNull()

      resolve(completeRichEditorAdapter)
      await vi.waitFor(() => expect(document.querySelector('.tiptap-editor-host .tiptap')).not.toBeNull())
      expect(document.querySelector('.source-editor-input')).toBeNull()
      expect(document.querySelector('.file-viewer')?.hasAttribute('aria-busy')).toBe(false)
      expect(document.querySelector('.file-viewer [role="status"]')).toBeNull()
      expect(document.querySelectorAll('.markdown-document-shell')).toHaveLength(1)
      const selected = document.querySelector<HTMLButtonElement>('.file-row.is-selected')
      expect(selected?.dataset.path).toBe(bundle.files[0].path)
      expect(selected?.closest('details')?.open).toBe(true)
      browser.destroy()
    } finally {
      setDefaultRichEditorAdapter(completeRichEditorAdapter)
    }
  })

  it('keeps a different selected file visible while the rich editor finishes loading', async () => {
    const bundle = structuredClone(testBundle)
    const { promise, resolve } = deferredAdapter()
    setDefaultRichEditorAdapter(undefined)
    try {
      const browser = new FileBrowser(document.getElementById('app')!, bundle, { richEditorAdapter: promise })
      document.querySelector<HTMLButtonElement>('[data-path$="api.yaml"]')!.click()
      expect(document.querySelector<HTMLTextAreaElement>('.source-editor-input')?.getAttribute('aria-label')).toContain('YAML')

      resolve(completeRichEditorAdapter)
      await promise
      await vi.waitFor(() => expect(document.querySelector('.file-row.is-selected')?.getAttribute('data-path')).toContain('api.yaml'))
      expect(document.querySelector('.tiptap-editor-host .tiptap')).toBeNull()

      document.querySelector<HTMLButtonElement>('[data-path$="plan.md"]')!.click()
      await vi.waitFor(() => expect(document.querySelector('.tiptap-editor-host .tiptap')).not.toBeNull())
      expect(document.querySelector('.source-editor-input')).toBeNull()
      browser.destroy()
    } finally {
      setDefaultRichEditorAdapter(completeRichEditorAdapter)
    }
  })

  it('migrates legacy Markdown blocks even when the selected file changes before the adapter loads', async () => {
    const bundle = structuredClone(testBundle)
    bundle.files[0].content = '---\ntitle: Preserved\n---\n\n# Current body'
    bundle.files[0].blocks = [{ id: 'old-heading', type: 'heading', html: '<h1>Stale body</h1>', source: '# Stale body' }]
    const { promise, resolve } = deferredAdapter()
    setDefaultRichEditorAdapter(undefined)
    try {
      const browser = new FileBrowser(document.getElementById('app')!, bundle, { richEditorAdapter: promise })
      document.querySelector<HTMLButtonElement>('[data-path$="api.yaml"]')!.click()
      resolve(completeRichEditorAdapter)
      await promise
      await vi.waitFor(() => expect(bundle.files[0].blocks?.[0]?.type).toBe('documentProperties'))
      document.querySelector<HTMLButtonElement>('[data-path$="spec.md"]')!.click()
      const editor = await waitForEditor()
      expect(editor.textContent).toContain('Current body')
      expect(editor.textContent).not.toContain('Stale body')
      browser.destroy()
    } finally {
      setDefaultRichEditorAdapter(completeRichEditorAdapter)
    }
  })
  it('opens writable Markdown source and preserves handoff only after rich editor loading fails', async () => {
    const bundle = structuredClone(testBundle)
    let rejectAdapter!: (reason: Error) => void
    const adapter = new Promise<typeof completeRichEditorAdapter>((_resolve, reject) => { rejectAdapter = reject })
    setDefaultRichEditorAdapter(undefined)
    try {
      const browser = new FileBrowser(document.getElementById('app')!, bundle, { richEditorAdapter: adapter })
      expect(document.querySelector('.file-viewer[aria-busy="true"] [role="status"]')).not.toBeNull()
      expect(document.querySelector('.source-editor-input')).toBeNull()
      rejectAdapter(new Error('Both CDN providers failed'))
      await vi.waitFor(() => expect(document.querySelector('.editor-error')?.textContent).toContain('Both CDN providers failed'))
      const source = document.querySelector<HTMLTextAreaElement>('.source-editor-input')!
      expect(source.readOnly).toBe(false)
      expect(document.querySelector('.file-viewer')?.hasAttribute('aria-busy')).toBe(false)
      source.value = '# Unsent draft'
      source.dispatchEvent(new Event('input', { bubbles: true }))
      expect(browser.getModifiedReviewFiles()[0].content).toBe('# Unsent draft')
      browser.destroy()
    } finally {
      setDefaultRichEditorAdapter(completeRichEditorAdapter)
    }
  })

})
