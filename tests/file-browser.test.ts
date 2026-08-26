import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileBrowser } from '../src/file-browser.ts'
import { configureApp } from '../src/kernel/app.ts'
import { capturePristine } from '../src/kernel/save.ts'
import { MermaidRuntime, type MermaidApi } from '../src/mermaid.ts'
import type { TacoBundle } from '../src/model.ts'

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
    { path: 'specs/001-browser/interaction-design.md', mediaType: 'text/markdown', content: '**Taco scope**: plan\n\n# Interaction' },
    { path: 'specs/001-browser/tasks.md', mediaType: 'text/markdown', content: '# Tasks\n\n- [ ] T001 Browse files' },
    { path: 'specs/001-browser/contracts/api.yaml', mediaType: 'application/yaml', content: 'openapi: 3.1.0' },
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

    expect(Array.from(document.querySelectorAll<HTMLImageElement>('.tiptap img')).map((image) => image.getAttribute('src')))
      .toEqual([logo, screenshot])
  })

  it('places files directly in the three default stages', async () => {
    const readmeBundle = structuredClone(testBundle)
    readmeBundle.files.push({ title: 'Project overview', path: 'specs/001-browser/README.md', mediaType: 'text/markdown', content: '# Guide' })
    new FileBrowser(document.getElementById('app')!, readmeBundle)
    const editor = await waitForEditor()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(document.querySelectorAll('.file-row')).toHaveLength(7)
    expect(Array.from(document.querySelectorAll('.stage-name')).map((node) => node.textContent)).toEqual(['需求定义', '技术规划', '任务拆解'])
    const specRows = document.querySelectorAll('[data-stage="spec"] .file-row')
    expect(Array.from(specRows).map((node) => node.getAttribute('data-role'))).toEqual([null, null])
    expect(specRows[0].getAttribute('data-path')).toMatch(/spec\.md$/)
    expect(document.querySelector('[data-stage="plan"] [data-path$="checklists/requirements.md"]')).not.toBeNull()
    expect(Array.from(document.querySelectorAll('[data-stage="plan"] .tree-folder .folder-name')).map((node) => node.textContent)).toEqual(['checklists', 'contracts'])
    expect(document.querySelector('[data-stage="spec"] [data-path$="README.md"]')).not.toBeNull()
    expect(document.querySelector('[data-stage="plan"] [data-path$="interaction-design.md"]')).not.toBeNull()
    expect(document.querySelector('[data-stage="custom"]')).toBeNull()
    expect(document.querySelector('[data-role]')).toBeNull()
    expect(document.querySelectorAll('.stage-summary .sidebar-row-icon')).toHaveLength(0)
    expect(document.querySelectorAll('.stage-summary .stage-caret [data-icon="chevron-right"]')).toHaveLength(3)
    expect(document.querySelector('.tree-folder[open] > .folder-row [data-icon="folder-open"]')).not.toBeNull()
    expect(document.querySelectorAll('.sidebar-row')).toHaveLength(13)
    expect(editor.querySelector('h1')?.textContent).toBe('Guide')
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(Array.from(document.querySelectorAll('.outline-link')).map((node) => node.textContent)).toEqual(['Guide'])
    expect(document.querySelector('.right-panel-tabs')).not.toBeNull()
    expect(document.querySelector<HTMLButtonElement>('.right-panel-tabs [aria-selected="true"]')?.textContent).toBe('大纲')
    expect(document.querySelector('.tiptap-editor-host')).not.toBeNull()
    expect(document.querySelector('.document-inline-title-text')?.textContent).toBe('Project overview')
    expect(document.querySelector('.document-inline-title [data-icon="file-text"]')).not.toBeNull()
  })

  it('edits YAML in the generic source editor', () => {
    const editableBundle = structuredClone(testBundle)
    new FileBrowser(document.getElementById('app')!, editableBundle)
    const yaml = document.querySelector<HTMLButtonElement>('[data-path$="api.yaml"]')!
    yaml.click()
    const editor = document.querySelector<HTMLTextAreaElement>('.source-editor-input')!
    expect(document.querySelector('.source-notice')).toBeNull()
    expect(document.querySelector('.source-editor-highlight')?.textContent).toBe('openapi: 3.1.0')
    expect(document.querySelector('.file-viewer')?.classList.contains('is-source-file')).toBe(false)
    expect(yaml.querySelector('[data-icon="file-code"]')).not.toBeNull()
    expect(editor.value).toContain('openapi: 3.1.0')
    editor.value = 'openapi: 3.1.1'
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    expect(editableBundle.files.at(-1)?.content).toBe('openapi: 3.1.1')
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(true)
    expect(document.querySelector('.tiptap')).toBeNull()
    expect(document.querySelector('.workspace-header .mode-control')).toBeNull()
    expect(document.querySelector('.workspace-path')?.textContent).toBe('contracts/api.yaml')
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.right-panel-tabs [role="tab"]')).map((tab) => [tab.textContent, tab.hidden])).toEqual([
      ['大纲', true],
      ['评论', false],
    ])
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

  it('shows HTML prototypes as cards that open standalone in a new page', () => {
    const prototypeBundle = structuredClone(testBundle)
    const content = '<!doctype html><html><head><title>Checkout</title></head><body>Prototype</body></html>'
    prototypeBundle.files.push({
      title: 'Checkout prototype',
      path: 'specs/001-browser/prototypes/checkout.html',
      mediaType: 'text/html',
      content,
      sourceUrl: 'file:///Users/example/project/specs/001-browser/prototypes/checkout.html',
    })
    const browser = new FileBrowser(document.getElementById('app')!, prototypeBundle)

    const row = document.querySelector<HTMLButtonElement>('[data-path$="prototypes/checkout.html"]')!
    expect(row.closest('[data-stage]')?.getAttribute('data-stage')).toBe('spec')
    expect(row.querySelector('[data-icon="file-code"]')).not.toBeNull()
    row.click()

    const preview = document.querySelector<HTMLAnchorElement>('.html-preview-action')!
    expect(document.querySelector('.html-preview-title')?.textContent).toBe('Checkout prototype')
    expect(document.querySelector('.html-preview-path')).toBeNull()
    expect(document.querySelector('.html-preview-kind')).toBeNull()
    expect(document.querySelector('.html-preview-hint')).toBeNull()
    expect(preview.textContent).toContain('打开预览')
    expect(preview.href).toBe('file:///Users/example/project/specs/001-browser/prototypes/checkout.html')
    expect(preview.target).toBe('_blank')
    expect(preview.rel).toBe('noopener noreferrer')
    expect(preview.referrerPolicy).toBe('no-referrer')
    expect(document.querySelector('.html-preview-card iframe')).toBeNull()
    expect(document.querySelector('.source-editor-input')).toBeNull()
    expect(document.querySelector<HTMLButtonElement>('.right-panel-tabs [role="tab"]')?.hidden).toBe(true)
    browser.destroy()
  })

  it('refuses HTML without a canonical file URL and exposes inert source', () => {
    const prototypeBundle = structuredClone(testBundle)
    const content = '<script>window.pwned = true</script>'
    prototypeBundle.files.push({
      title: 'Oversized prototype',
      path: 'specs/001-browser/prototypes/oversized.html',
      mediaType: 'text/html',
      content,
    })
    const browser = new FileBrowser(document.getElementById('app')!, prototypeBundle)

    document.querySelector<HTMLButtonElement>('[data-path$="prototypes/oversized.html"]')!.click()

    const preview = document.querySelector<HTMLAnchorElement>('.html-preview-action')!
    const source = document.querySelector<HTMLElement>('.html-preview-source-fallback')!
    expect(preview.hasAttribute('href')).toBe(false)
    expect(preview.getAttribute('aria-disabled')).toBe('true')
    expect(source.textContent).toBe(content)
    expect(source.querySelector('script')).toBeNull()
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
    expect(mermaidInitialize).toHaveBeenCalledWith(expect.objectContaining({
      theme: 'base',
      htmlLabels: false,
      flowchart: { curve: 'basis' },
      themeVariables: expect.objectContaining({
        primaryBorderColor: '#00875a',
        primaryColor: '#f1f5f3',
      }),
    }))
    expect(document.querySelector('.tiptap-code-block-source code')?.textContent).toContain('Brief --> Plan')
    const edit = document.querySelector<HTMLButtonElement>('.tiptap-code-block-edit')!
    const zoom = document.querySelector<HTMLButtonElement>('.tiptap-code-block-zoom')!
    const codeBlock = edit.closest<HTMLElement>('.tiptap-code-block')!
    expect(edit.textContent).toBe('')
    expect(edit.getAttribute('aria-label')).toBe('编辑 Mermaid 源码')
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

    edit.click()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(codeBlock.querySelector<HTMLElement>('.tiptap-code-block-source')?.hidden).toBe(false)
    expect(codeBlock.querySelector<HTMLElement>('.tiptap-code-block-preview')?.hidden).toBe(true)
    expect(edit.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelectorAll('.tiptap-code-block-lines span')).toHaveLength(2)

    edit.click()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(codeBlock.querySelector<HTMLElement>('.tiptap-code-block-source')?.hidden).toBe(true)
    expect(codeBlock.querySelector<HTMLElement>('.tiptap-code-block-preview')?.hidden).toBe(false)

    zoom.click()
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
    expect(zoomedDiagram.style.getPropertyValue('--mermaid-zoom-width')).toBe('125%')
    expect(resetZoom.disabled).toBe(false)

    resetZoom.click()
    expect(zoomLevel.value).toBe('100%')
    expect(zoomedDiagram.style.getPropertyValue('--mermaid-zoom-width')).toBe('100%')
    expect(resetZoom.disabled).toBe(true)

    zoomOut.click()
    expect(zoomLevel.value).toBe('75%')

    resetZoom.click()
    const canvas = document.querySelector<HTMLElement>('.mermaid-zoom-canvas')!
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 100, clientY: 100, deltaY: -100 })
    canvas.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(Number.parseInt(zoomLevel.value, 10)).toBeGreaterThan(100)

    canvas.scrollLeft = 100
    canvas.scrollTop = 80
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
    expect(canvas.classList.contains('is-dragging')).toBe(true)
    canvas.dispatchEvent(pointerEvent('pointermove', 150, 170))
    expect(canvas.scrollLeft).toBe(150)
    expect(canvas.scrollTop).toBe(110)
    canvas.dispatchEvent(pointerEvent('pointerup', 150, 170))
    expect(canvas.classList.contains('is-dragging')).toBe(false)
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
    expect(block.querySelector<HTMLButtonElement>('.tiptap-code-block-edit')?.hidden).toBe(true)
    expect(block.querySelector<HTMLButtonElement>('.tiptap-code-block-zoom')?.hidden).toBe(true)
    expect(block.querySelector('code')?.textContent).toBe('flowchart LR\n  Brief --> Plan')
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
    expect(block.querySelector<HTMLButtonElement>('.tiptap-code-block-edit')?.hidden).toBe(true)
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
    expect(editableBundle.files[0].content).not.toBe(testBundle.files[0].content)
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(true)

    expect(editor.commands.undo()).toBe(true)
    expect(editableBundle.files[0].content).toBe(testBundle.files[0].content)
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
    new FileBrowser(document.getElementById('app')!, editableBundle)
    const title = document.querySelector<HTMLInputElement>('.workspace-header .bundle-title')!
    title.value = 'Download fallback'
    title.dispatchEvent(new Event('input', { bubbles: true }))

    document.querySelector<HTMLButtonElement>('.save-button')!.click()
    const firstDialog = document.querySelector<HTMLDialogElement>('.confirmation-dialog')!
    expect(firstDialog.open).toBe(true)
    expect(firstDialog.getAttribute('aria-labelledby')).toBe('taco-confirmation-title')
    expect(firstDialog.querySelector('.confirmation-dialog-title')?.textContent).toBe('下载此 Taco？')
    expect(firstDialog.querySelector('.confirmation-dialog-body')?.textContent).toContain('保存位置由浏览器设置决定')
    expect(document.activeElement).toBe(firstDialog.querySelector('.confirmation-dialog-cancel'))

    firstDialog.querySelector<HTMLButtonElement>('.confirmation-dialog-cancel')!.click()
    await Promise.resolve()
    expect(downloadClick).not.toHaveBeenCalled()
    expect(document.querySelector('.confirmation-dialog')).toBeNull()
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(true)

    document.querySelector<HTMLButtonElement>('.save-button')!.click()
    document.querySelector<HTMLButtonElement>('.confirmation-dialog-confirm')!.click()
    await vi.waitFor(() => expect(document.querySelector('.taco-toast')).not.toBeNull())

    expect(document.querySelector('.taco-toast')?.textContent).toBe('已开始下载 Taco 文件')
    expect(downloadClick).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.save-button .button-label')?.textContent).toBe('保存')
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(false)
  })

  it('keeps file collapse separate and makes the right panel permanent', () => {
    new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))
    const left = document.querySelector<HTMLButtonElement>('.file-sidebar .left-panel-toggle')!
    expect(left).not.toBeNull()
    expect(document.querySelector('.comment-panel')).not.toBeNull()
    expect(document.getElementById('app')?.classList.contains('right-panel-closed')).toBe(false)
    expect(document.querySelector('[aria-label="关闭右侧面板"]')).toBeNull()
    expect(document.querySelector('.right-panel-tabs')).not.toBeNull()
    expect(document.querySelector<HTMLElement>('.document-outline')?.hidden).toBe(false)
    expect(document.querySelector<HTMLElement>('.comment-list')?.hidden).toBe(true)
    const comments = document.querySelector<HTMLButtonElement>('.workspace-header .comment-toggle')!
    comments.click()
    expect(document.querySelector('.comment-panel')?.getAttribute('aria-hidden')).toBe('false')
    expect(comments.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector<HTMLButtonElement>('.right-panel-tabs [aria-selected="true"]')?.textContent).toBe('评论')
    expect(document.querySelector<HTMLElement>('.comment-list')?.hidden).toBe(false)
    expect(document.querySelector('.comment-empty-banner')?.textContent).toContain('选中正文内容')
    expect(document.querySelector('.comment-empty')).toBeNull()
    left.click()
    expect(document.getElementById('app')?.classList.contains('sidebar-closed')).toBe(true)
    expect(left.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.workspace-left-toggle')).not.toBeNull()
    expect(document.querySelector('.file-sidebar')?.hasAttribute('inert')).toBe(true)
  })

  it('keeps sidebar UI state independent from language and file selection', () => {
    new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))
    const app = document.getElementById('app')!
    const sidebarScroll = document.querySelector<HTMLElement>('.sidebar-scroll')!
    const plan = document.querySelector<HTMLDetailsElement>('[data-stage="plan"]')!
    const folder = document.querySelector<HTMLDetailsElement>('.tree-folder[data-path$="/checklists"]')!

    plan.open = false
    plan.dispatchEvent(new Event('toggle'))
    folder.open = false
    folder.dispatchEvent(new Event('toggle'))
    sidebarScroll.scrollTop = 48
    sidebarScroll.dispatchEvent(new Event('scroll'))

    document.querySelector<HTMLButtonElement>('[data-path$="tasks.md"]')!.click()
    expect(document.querySelector<HTMLElement>('.sidebar-scroll')).toBe(sidebarScroll)
    expect(document.querySelector<HTMLDetailsElement>('[data-stage="plan"]')?.open).toBe(false)
    expect(document.querySelector<HTMLDetailsElement>('.tree-folder[data-path$="/checklists"]')?.open).toBe(false)
    expect(document.querySelector<HTMLElement>('.sidebar-scroll')?.scrollTop).toBe(48)

    document.querySelector<HTMLButtonElement>('.file-sidebar .left-panel-toggle')!.click()
    expect(app.classList.contains('sidebar-closed')).toBe(true)
    document.querySelector<HTMLButtonElement>('.workspace-header [aria-label="语言"]')!.click()
    const english = Array.from(document.querySelectorAll<HTMLButtonElement>('.language-menu .popover-action'))
      .find((button) => button.textContent === 'English')!
    english.click()

    expect(app.classList.contains('sidebar-closed')).toBe(true)
    expect(document.querySelector('.file-sidebar')?.hasAttribute('inert')).toBe(true)
    expect(document.querySelector<HTMLDetailsElement>('[data-stage="plan"]')?.open).toBe(false)
    expect(document.querySelector<HTMLDetailsElement>('.tree-folder[data-path$="/checklists"]')?.open).toBe(false)
    expect(document.querySelector<HTMLElement>('.sidebar-scroll')?.scrollTop).toBe(48)
  })

  it('uses the first supported browser language when no choice was saved', () => {
    Object.defineProperty(navigator, 'languages', { configurable: true, value: ['nl-NL', 'fr-CA', 'de-DE'] })
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'nl-NL' })

    new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))

    expect(document.documentElement.lang).toBe('fr')
    expect(document.querySelector('.workspace-header .save-button')?.textContent).toContain('Enregistrer')
    expect(localStorage.getItem('taco-locale')).toBeNull()
  })

  it('keeps a saved language choice ahead of browser preferences', () => {
    localStorage.setItem('taco-locale', 'de')
    Object.defineProperty(navigator, 'languages', { configurable: true, value: ['fr-FR'] })
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'fr-FR' })

    new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))

    expect(document.documentElement.lang).toBe('de')
    expect(document.querySelector('.workspace-header .save-button')?.textContent).toContain('Speichern')
  })

  it('provides share, save and language actions in the header', () => {
    new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))
    expect(document.querySelector('.workspace-header .share-button')).not.toBeNull()
    expect(document.querySelector('.workspace-header .save-group.v2-button-group')).not.toBeNull()
    expect(document.querySelector('.workspace-header .save-button')?.textContent).toContain('保存')
    expect(document.querySelector('.workspace-header [data-icon="globe"]')).not.toBeNull()
    expect(document.querySelectorAll('.workspace-header .ui-icon').length).toBeGreaterThanOrEqual(4)
    expect(document.querySelector('.workspace-header [aria-label="帮助"]')).toBeNull()
    expect(document.querySelectorAll('.workspace-header > .control-button, .workspace-header > .v2-button-group')).toHaveLength(5)
    expect(document.querySelector('.workspace-title-divider')).toBeNull()
    document.querySelector<HTMLButtonElement>('.workspace-header .save-more')!.click()
    expect(Array.from(document.querySelectorAll('.save-menu .popover-action')).map((node) => node.textContent)).toEqual([
      '保存',
      '保存副本…',
      '保存并解包到文件夹…',
    ])
    expect(document.querySelectorAll('.save-menu .popover-action.sidebar-row')).toHaveLength(3)
    expect(document.querySelectorAll('.save-menu .popover-action-label.sidebar-row-label')).toHaveLength(3)
    const language = document.querySelector<HTMLButtonElement>('.workspace-header [aria-label="语言"]')!
    language.click()
    expect(Array.from(document.querySelectorAll('.language-menu .popover-action-label')).map((node) => node.textContent)).toEqual([
      '简体中文', 'English', '繁體中文', '日本語', 'Español', 'Français', 'Deutsch', 'Italiano', 'Português',
    ])
    expect(document.querySelectorAll('.language-menu .popover-action.sidebar-row')).toHaveLength(9)
    expect(document.querySelectorAll('.language-menu .popover-action-label.sidebar-row-label')).toHaveLength(9)
    expect(document.querySelectorAll('.language-menu .popover-check')).toHaveLength(1)
  })

  it('opens the Bento-style sharing panel with standard menu rows', () => {
    const browser = new FileBrowser(document.getElementById('app')!, structuredClone(testBundle))
    const sync = (browser as unknown as { sync: { isActive(): boolean } }).sync

    expect(sync.isActive()).toBe(false)
    expect(document.querySelector<HTMLElement>('.presence-strip')?.hidden).toBe(true)

    document.querySelector<HTMLButtonElement>('.workspace-header .share-button')!.click()
    expect(document.querySelector('.share-live-status')?.textContent).toContain('尚未实时共享 — 分享时开启')
    const nameLabel = document.querySelector<HTMLLabelElement>('.collab-name-label')!
    const nameInput = document.querySelector<HTMLInputElement>('.collab-name-input')!
    expect(nameInput.id).not.toBe('')
    expect(nameLabel.htmlFor).toBe(nameInput.id)
    const actions = document.querySelectorAll('.share-menu .popover-action.sidebar-row')
    expect(Array.from(actions).map((node) => node.textContent)).toEqual([
      '邀请编辑…',
      '只读副本…',
      '开始实时共享',
      '重置访问权限…',
    ])
    expect(Array.from(actions).map((node) => node.querySelector('.ui-icon')?.getAttribute('data-icon'))).toEqual([
      'share', 'presentation', 'radio', 'key',
    ])
    expect(document.querySelector('.share-menu input[type="url"]')).toBeNull()
    expect(document.querySelector('.share-menu')?.textContent).not.toContain('Relay')
    expect(document.querySelector('.share-menu')?.getAttribute('role')).toBe('dialog')
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

    document.querySelector<HTMLButtonElement>('.workspace-header .share-button')!.click()
    expect(document.querySelectorAll('.share-menu .popover-action')).toHaveLength(0)
    expect(document.querySelector('.share-readonly-note')?.textContent).toContain('只读副本')

    document.querySelector<HTMLButtonElement>('.file-row[data-path$="api.yaml"]')!.click()
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

  it('creates a persisted comment thread from selected Markdown text', async () => {
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
    const selectionComment = document.querySelector<HTMLButtonElement>('.selection-comment-button')!
    expect(selectionComment.textContent).toBe('评论')
    selectionComment.click()
    expect(document.querySelector('.comment-panel')?.getAttribute('aria-hidden')).toBe('false')
    expect(document.querySelector('.right-panel-tabs')).not.toBeNull()
    expect(document.querySelector<HTMLButtonElement>('.right-panel-tabs [aria-selected="true"]')?.textContent).toBe('评论')
    expect(document.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(false)
    expect(editableBundle.comments).toBeUndefined()
    expect(document.querySelector('.comment-empty-banner')).toBeNull()
    const input = document.querySelector<HTMLTextAreaElement>('.comment-composer .comment-input')!
    input.value = 'Make this measurable.'
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

    document.querySelector<HTMLButtonElement>('.author-name-dialog .comment-action')!.click()
    expect(document.querySelector('.author-name-dialog')).toBeNull()
    expect(document.querySelector<HTMLTextAreaElement>('.comment-composer .comment-input')?.value).toBe('Keep this pending.')

    comment.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    const name = document.querySelector<HTMLInputElement>('.author-name-input')!
    const confirm = document.querySelector<HTMLButtonElement>('.author-name-dialog .comment-submit')!
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
    document.querySelector<HTMLButtonElement>('.workspace-header .share-button')!.click()
    expect(document.querySelector<HTMLInputElement>('.collab-name-input')?.value).toBe('Ada')
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
})
