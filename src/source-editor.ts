import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import type { LanguageFn } from 'highlight.js'
import { createLowlight } from 'lowlight'

const mermaid: LanguageFn = (hljs) => ({
  name: 'Mermaid',
  aliases: ['mmd'],
  keywords: {
    keyword: [
      'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram-v2', 'erDiagram',
      'journey', 'gantt', 'pie', 'quadrantChart', 'requirementDiagram', 'gitGraph', 'mindmap',
      'timeline', 'sankey-beta', 'xychart-beta', 'block-beta', 'packet', 'architecture-beta', 'kanban',
      'subgraph', 'end', 'direction', 'participant', 'actor', 'autonumber', 'activate', 'deactivate',
      'loop', 'alt', 'else', 'opt', 'par', 'and', 'rect', 'critical', 'break', 'note', 'over',
      'left', 'right', 'of', 'as', 'classDef', 'class', 'click', 'style', 'linkStyle',
    ].join(' '),
  },
  contains: [
    hljs.COMMENT('%%', '$'),
    hljs.QUOTE_STRING_MODE,
    { scope: 'symbol', begin: /(?:<-->|<--|-->|---|-\.->|==>|~~~|--x|--o|o--|x--)/ },
    { scope: 'title', begin: /\b[A-Za-z_][\w-]*(?=\s*[[(\{])/ },
    { scope: 'number', begin: hljs.NUMBER_RE },
  ],
})

interface HighlightNode {
  type: string
  value?: string
  tagName?: string
  properties?: { className?: string | string[] }
  children?: HighlightNode[]
}

export interface SourceCommentRange {
  start: number
  end: number
}

interface SourceEditorOptions {
  value: string
  language?: 'json' | 'yaml' | 'mermaid'
  label: string
  readOnly?: boolean
  onChange: (value: string) => void
}

export interface SourceEditorController {
  element: HTMLElement
  input: HTMLTextAreaElement
  setCommentRanges: (ranges: SourceCommentRange[]) => void
  activateRange: (range: SourceCommentRange | null) => void
}

const lowlight = createLowlight({ json, yaml, mermaid })

const appendHighlightNode = (parent: Node, node: HighlightNode): void => {
  if (node.type === 'text') {
    parent.appendChild(document.createTextNode(node.value ?? ''))
    return
  }
  if (node.type !== 'element' || !node.tagName) return

  const element = document.createElement(node.tagName)
  const className = node.properties?.className
  if (className) element.className = Array.isArray(className) ? className.join(' ') : className
  for (const child of node.children ?? []) appendHighlightNode(element, child)
  parent.appendChild(element)
}

const renderLanguageHighlight = (target: HTMLElement, language: 'json' | 'yaml' | 'mermaid', value: string): void => {
  const tree = lowlight.highlight(language, value) as unknown as HighlightNode
  target.replaceChildren()
  for (const child of tree.children ?? []) appendHighlightNode(target, child)
}

const decorateTextRange = (root: HTMLElement, range: SourceCommentRange, className: string): void => {
  const nodes: Array<{ node: Text; start: number; end: number }> = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let position = 0
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    nodes.push({ node, start: position, end: position + node.data.length })
    position += node.data.length
  }

  for (const { node, start, end } of nodes) {
    const selectionStart = Math.max(range.start, start)
    const selectionEnd = Math.min(range.end, end)
    if (selectionEnd <= selectionStart) continue
    const before = node.data.slice(0, selectionStart - start)
    const selected = node.data.slice(selectionStart - start, selectionEnd - start)
    const after = node.data.slice(selectionEnd - start)
    const fragment = document.createDocumentFragment()
    if (before) fragment.append(document.createTextNode(before))
    const mark = document.createElement('span')
    mark.className = className
    mark.textContent = selected
    fragment.append(mark)
    if (after) fragment.append(document.createTextNode(after))
    node.replaceWith(fragment)
  }
}

export const createSourceEditor = ({ value, language, label, readOnly = false, onChange }: SourceEditorOptions): SourceEditorController => {
  const host = document.createElement('div')
  host.className = `source-editor${language ? ` source-editor-${language}` : ''}`

  const input = document.createElement('textarea')
  input.className = 'source-editor-input'
  input.value = value
  input.spellcheck = false
  input.wrap = 'off'
  input.setAttribute('aria-label', label)
  input.readOnly = readOnly
  const usesCrLf = value.includes('\r\n') && !value.replace(/\r\n/g, '').includes('\n')

  const highlightLayer = document.createElement('pre')
  highlightLayer.className = 'source-editor-highlight'
  highlightLayer.setAttribute('aria-hidden', 'true')
  const highlight = document.createElement('code')
  highlightLayer.append(highlight)
  input.classList.add('is-highlighted')
  host.append(highlightLayer)

  let commentRanges: SourceCommentRange[] = []
  let activeRange: SourceCommentRange | null = null
  const renderHighlight = (): void => {
    if (language) renderLanguageHighlight(highlight, language, input.value)
    else highlight.textContent = input.value
    for (const range of commentRanges) decorateTextRange(highlight, range, 'source-comment-highlight')
    if (activeRange) decorateTextRange(highlight, activeRange, 'source-comment-highlight is-active')
  }
  renderHighlight()

  const resize = (): void => {
    input.style.height = '0'
    input.style.height = `${input.scrollHeight}px`
  }

  input.addEventListener('input', () => {
    renderHighlight()
    onChange(usesCrLf ? input.value.replace(/\n/g, '\r\n') : input.value)
    resize()
  })
  input.addEventListener('scroll', () => {
    highlightLayer.scrollLeft = input.scrollLeft
    highlightLayer.scrollTop = input.scrollTop
  }, { passive: true })
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    const start = input.selectionStart
    const end = input.selectionEnd
    input.setRangeText('  ', start, end, 'end')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

  host.append(input)
  requestAnimationFrame(resize)
  return {
    element: host,
    input,
    setCommentRanges: (ranges) => {
      commentRanges = ranges
      renderHighlight()
    },
    activateRange: (range) => {
      activeRange = range
      renderHighlight()
      if (!range) return
      input.focus()
      input.setSelectionRange(range.start, range.end)
      const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight) || 21
      const line = input.value.slice(0, range.start).split('\n').length - 1
      const targetTop = Math.max(0, line * lineHeight - input.clientHeight / 2)
      input.scrollTop = targetTop
      highlightLayer.scrollTop = targetTop
    },
  }
}
