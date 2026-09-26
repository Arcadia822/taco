export type SourceLanguage = 'json' | 'yaml' | 'mermaid'

export type SourceHighlighter = (target: HTMLElement, language: SourceLanguage, value: string) => void

let defaultHighlighter: SourceHighlighter | undefined

export const setDefaultHighlighter = (highlighter: SourceHighlighter | undefined): void => {
  defaultHighlighter = highlighter
}

export const getDefaultHighlighter = (): SourceHighlighter | undefined => defaultHighlighter

export interface SourceCommentRange {
  start: number
  end: number
}

export interface SourceEditorOptions {
  value: string
  language?: SourceLanguage
  label: string
  readOnly?: boolean
  highlighter?: SourceHighlighter
  onChange: (value: string) => void
}

export interface SourceEditorController {
  element: HTMLElement
  input: HTMLTextAreaElement
  refreshHighlight: () => void
  setCommentRanges: (ranges: SourceCommentRange[]) => void
  activateRange: (range: SourceCommentRange | null) => void
  highlightRange: (range: SourceCommentRange | null) => void
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

export const createSourceEditor = ({
  value,
  language,
  label,
  readOnly = false,
  highlighter,
  onChange,
}: SourceEditorOptions): SourceEditorController => {
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
  let hoverRange: SourceCommentRange | null = null
  const renderHighlight = (): void => {
    const activeHighlighter = highlighter ?? defaultHighlighter
    if (language && activeHighlighter) {
      try {
        activeHighlighter(highlight, language, input.value)
      } catch {
        highlight.textContent = input.value
      }
    } else {
      highlight.textContent = input.value
    }
    for (const range of commentRanges) decorateTextRange(highlight, range, 'source-comment-highlight')
    if (activeRange) decorateTextRange(highlight, activeRange, 'source-comment-highlight is-active')
    if (hoverRange) decorateTextRange(highlight, hoverRange, 'source-comment-highlight')
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
    if (input.readOnly || event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
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
    refreshHighlight: renderHighlight,
    input,
    highlightRange: (range) => { hoverRange = range; renderHighlight() },
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
