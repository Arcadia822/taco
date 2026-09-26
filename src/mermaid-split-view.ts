import {
  createMermaidPreview,
  defaultMermaidTheme,
  extractMermaidThemeFromCode,
  isMermaidDarkTheme,
  mermaidThemeForAppearance,
  parseMermaidLineMap,
  updateMermaidCodeTheme,
  updateMermaidDirection,
  type MermaidPluginLabels,
  type MermaidPreviewElement,
  type MermaidRuntime,
  type MermaidTheme,
} from './mermaid.ts'
import { createSourceEditor, type SourceEditorController, type SourceCommentRange } from './source-editor.ts'

export type CodeBlockIcon = 'check' | 'copy' | 'maximize' | 'message-square' | 'minus' | 'plus' | 'rotate-ccw' | 'x' | 'panel-left'

const iconPaths: Record<CodeBlockIcon, string> = {
  check: '<path d="m20 6-11 11-5-5"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  'message-square': '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  'panel-left': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
}

const codeBlockIcon = (name: CodeBlockIcon): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('tiptap-code-block-icon')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.75')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = iconPaths[name]
  return svg
}

export const setIcon = (button: HTMLButtonElement, name: CodeBlockIcon): void => {
  button.replaceChildren(codeBlockIcon(name))
}

export const iconButton = (name: CodeBlockIcon, label: string, className = ''): HTMLButtonElement => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `tiptap-code-block-button ${className}`.trim()
  button.contentEditable = 'false'
  button.setAttribute('aria-label', label)
  button.title = label
  button.addEventListener('mousedown', (event) => event.preventDefault())
  setIcon(button, name)
  return button
}

export interface TacoCodeBlockCommentTarget {
  blockId: string
  language: string
  content: HTMLElement
  nodeId?: string
  nodeLabel?: string
  lineNumber?: number
  lineText?: string
  selection?: SourceCommentRange
  selectionEvent?: MouseEvent
  sourceEditor?: SourceEditorController
}

export interface MermaidSplitViewController {
  element: HTMLElement
  previewHost: MermaidPreviewElement
  sourceEditor: SourceEditorController
  setTheme: (theme: MermaidTheme) => void
  setDirection: (direction: 'TB' | 'BT' | 'LR' | 'RL') => void
  toggleCodePanel: (force?: boolean) => boolean
  isCodePanelOpen: () => boolean
  setAllowCodePanel: (allowed: boolean) => void
  updateCode: (code: string) => void
}

export const bindMermaidCanvasDrag = (canvas: HTMLElement): void => {
  let pointer: number | undefined
  let startX = 0
  let startY = 0
  let panX = 0
  let panY = 0
  let moved = false
  let diagram: HTMLElement | null = null
  canvas.addEventListener('pointerdown', (event) => {
    const target = event.target as Element
    if (pointer !== undefined || event.button !== 0 || target.closest('button, textarea, input, select, .mermaid-node-toolbar')) return
    if (target.closest('.mermaid-zoom-canvas, .mermaid-diagram-stage') !== canvas) return
    diagram = canvas.querySelector<HTMLElement>('.taco-mermaid-render')
    if (!diagram) return
    pointer = event.pointerId
    startX = event.clientX
    startY = event.clientY
    const translation = diagram.style.translate.split(' ')
    panX = Number.parseFloat(translation[0]) || 0
    panY = Number.parseFloat(translation[1]) || 0
    moved = false
  })
  canvas.addEventListener('pointermove', (event) => {
    if (pointer !== event.pointerId || !diagram) return
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    if (!moved && Math.hypot(dx, dy) < 4) return
    if (!moved) {
      moved = true
      canvas.setPointerCapture?.(event.pointerId)
      canvas.classList.add('is-dragging')
    }
    diagram.style.translate = `${panX + dx}px ${panY + dy}px`
    event.preventDefault()
  })
  const stop = (event: PointerEvent): void => {
    if (pointer !== event.pointerId) return
    pointer = undefined
    canvas.classList.remove('is-dragging')
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  }
  canvas.addEventListener('pointerup', stop)
  canvas.addEventListener('pointercancel', stop)
  canvas.addEventListener('lostpointercapture', stop)
  canvas.addEventListener('click', (event) => {
    if (!moved) return
    moved = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)
}

export const createMermaidSplitView = (
  code: string,
  labels: MermaidPluginLabels,
  options: {
    runtime?: MermaidRuntime
    initialTheme?: MermaidTheme
    initialPanelOpen?: boolean
    allowCodePanel?: boolean
    sourceEditor?: SourceEditorController
    readOnly?: boolean
    onChange?: (code: string) => void
    onUnavailable?: (error?: unknown) => void
    onRenderError?: (error?: unknown) => void
    onRendered?: () => void
    onThemeChange?: (theme: MermaidTheme) => void
    onPanelToggle?: (open: boolean) => void
    onComment?: (target: { nodeId?: string; nodeLabel?: string; lineNumber?: number; lineText?: string; selection?: SourceCommentRange; selectionEvent?: MouseEvent; sourceEditor?: SourceEditorController }) => void
  } = {},
): MermaidSplitViewController => {
  let allowPanel = options.allowCodePanel ?? true
  let isPanelOpen = options.initialPanelOpen ?? false
  let liveUpdate = true
  let renderedCode = code
  const defaultTheme = options.initialTheme ?? defaultMermaidTheme()
  let activeTheme: MermaidTheme = extractMermaidThemeFromCode(code) ?? defaultTheme
  let lineMap = parseMermaidLineMap(code)
  const container = document.createElement('div')
  container.className = 'tiptap-mermaid-container'
  container.dataset.mermaidDark = String(isMermaidDarkTheme(activeTheme))
  container.dataset.mermaidTheme = activeTheme
  const codePanel = document.createElement('section')
  codePanel.className = 'mermaid-floating-code-panel'
  codePanel.setAttribute('aria-label', labels.codePanel || labels.source)
  const toggleCodePanel = (force = !isPanelOpen): boolean => {
    if (!allowPanel) {
      isPanelOpen = false
      codePanel.hidden = true
      options.onPanelToggle?.(false)
      return false
    }
    isPanelOpen = force
    codePanel.hidden = !force
    options.onPanelToggle?.(force)
    return force
  }
  const header = document.createElement('header')
  header.className = 'mermaid-code-panel-header'
  const title = document.createElement('span')
  title.textContent = labels.codePanel || labels.source
  const close = iconButton('x', labels.close, 'mermaid-code-panel-close')
  close.addEventListener('click', () => toggleCodePanel(false))
  const headerActions = document.createElement('div')
  headerActions.className = 'mermaid-code-panel-actions'
  const liveLabel = document.createElement('label')
  liveLabel.className = 'mermaid-live-update'
  const liveText = document.createElement('span')
  liveText.textContent = labels.liveUpdate || 'Live update'
  const liveSwitch = document.createElement('input')
  liveSwitch.type = 'checkbox'
  liveSwitch.setAttribute('role', 'switch')
  liveSwitch.checked = true
  const refresh = document.createElement('button')
  liveSwitch.setAttribute('aria-label', labels.liveUpdate || 'Live update')
  refresh.type = 'button'
  refresh.className = 'tiptap-code-block-button mermaid-refresh-preview'
  refresh.textContent = labels.updateDiagram || 'Update diagram'
  refresh.hidden = true
  refresh.disabled = true
  liveSwitch.addEventListener('change', () => {
    liveUpdate = liveSwitch.checked
    refresh.hidden = liveUpdate
    if (liveUpdate) renderLatest()
  })
  refresh.addEventListener('click', () => renderLatest())
  liveLabel.append(liveText, liveSwitch)
  headerActions.append(refresh, liveLabel, close)
  header.append(title, headerActions)
  const sourceEditor = options.sourceEditor ?? createSourceEditor({
    value: code,
    language: 'mermaid',
    label: labels.source,
    readOnly: options.readOnly,
    onChange: (next) => { updateCode(next); options.onChange?.(next) },
  })
  codePanel.append(header, sourceEditor.element)
  codePanel.hidden = !isPanelOpen
  const stage = document.createElement('div')
  stage.className = 'mermaid-diagram-stage'
  bindMermaidCanvasDrag(stage)
  let inlineZoom = 1
  stage.addEventListener('wheel', (event) => {
    if (!event.metaKey || (event.target as Element).closest('.mermaid-zoom-canvas')) return
    event.preventDefault()
    const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? stage.clientHeight : 1)
    const nextZoom = Math.min(2, Math.max(.5, inlineZoom * Math.exp(-delta * .0015)))
    if (nextZoom === inlineZoom) return
    const rect = previewHost.getBoundingClientRect()
    const ratio = nextZoom / inlineZoom
    const translation = previewHost.style.translate.split(' ')
    const x = Number.parseFloat(translation[0]) || 0
    const y = Number.parseFloat(translation[1]) || 0
    previewHost.style.transformOrigin = '0 0'
    previewHost.style.translate = `${x + (event.clientX - rect.left) * (1 - ratio)}px ${y + (event.clientY - rect.top) * (1 - ratio)}px`
    previewHost.style.scale = String(nextZoom)
    inlineZoom = nextZoom
  }, { passive: false })
  stage.addEventListener('click', (event) => {
    if ((event.target as Element).closest('.interactive-mermaid-node, .interactive-mermaid-edge, .mermaid-node-toolbar, button, textarea, input, select')) return
    selected = null
    selectedElement = null
    toolbar.hidden = true
    previewHost.focusNode(null)
    previewHost.focusEdge(null)
    previewHost.highlightNode(null)
    sourceEditor.highlightRange(null)
    sourceEditor.activateRange(null)
  })
  const toolbar = document.createElement('div')
  toolbar.className = 'mermaid-node-toolbar'
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', labels.nodeComment || labels.comment)
  toolbar.hidden = true
  const comment = iconButton('message-square', labels.comment)
  toolbar.append(comment)
  let selected: { nodeId: string; nodeLabel: string } | null = null
  let selectedElement: Element | null = null
  const positionToolbar = (): void => {
    if (!selectedElement || !selectedElement.isConnected) { toolbar.hidden = true; return }
    const rect = selectedElement.getBoundingClientRect()
    const parent = container.getBoundingClientRect()
    toolbar.style.left = `${rect.left + rect.width / 2 - parent.left}px`
    toolbar.style.top = `${Math.max(8, rect.top - parent.top - 40)}px`
  }
  comment.addEventListener('click', () => { if (selected) options.onComment?.(selected) })
  const lineRange = (line: number): SourceCommentRange => {
    const lines = sourceEditor.input.value.split('\n')
    const start = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0)
    return { start, end: start + (lines[line - 1]?.length ?? 0) }
  }
  const previewHost = createMermaidPreview(code, labels, undefined, options.onUnavailable, options.runtime, options.onRenderError, {
    theme: activeTheme,
    onRendered: () => {
      container.dataset.mermaidDark = previewHost.dataset.mermaidDark ?? 'false'
      container.dataset.mermaidTheme = previewHost.dataset.mermaidTheme ?? activeTheme
      options.onRendered?.()
    },
    onNodeHover: (nodeId) => {
      const line = nodeId && code === renderedCode ? lineMap.nodeToLines.get(nodeId)?.[0] : undefined
      sourceEditor.highlightRange(line ? lineRange(line) : null)
    },
    onThemeChange: (theme) => {
      activeTheme = theme
      options.onThemeChange?.(theme)
    },
    onEdgeClick: (_from, _to, line) => {
      selected = null
      selectedElement = null
      toolbar.hidden = true
      previewHost.focusNode(null)
      if (line && code === renderedCode) {
        sourceEditor.activateRange(lineRange(line))
      }
    },
    onNodeClick: (nodeId, nodeLabel, event) => {
      previewHost.focusEdge(null)
      selected = { nodeId, nodeLabel }
      selectedElement = event.currentTarget as Element
      if (allowPanel) {
        toggleCodePanel(true)
      }
      previewHost.focusNode(nodeId)
      const line = code === renderedCode ? lineMap.nodeToLines.get(nodeId)?.[0] : undefined
      sourceEditor.activateRange(line ? lineRange(line) : null)
      toolbar.hidden = !options.onComment || !line
      positionToolbar()
    },
  })
  stage.append(previewHost)
  container.append(stage, codePanel, toolbar)
  container.addEventListener('scroll', positionToolbar, true)
  const syncSelection = (event?: MouseEvent): void => {
    const input = sourceEditor.input
    const lineNumber = input.value.slice(0, input.selectionStart).split('\n').length
    const matchingNode = code === renderedCode ? lineMap.lineToNodes.get(lineNumber)?.[0] ?? null : null
    previewHost.focusNode(matchingNode)
    sourceEditor.activateRange(null)
    if (matchingNode) {
      sourceEditor.highlightRange(lineRange(lineNumber))
    } else {
      sourceEditor.highlightRange(null)
    }
    if (input.selectionEnd <= input.selectionStart) return
    options.onComment?.({
      lineNumber,
      lineText: input.value.slice(input.selectionStart, input.selectionEnd),
      selection: { start: input.selectionStart, end: input.selectionEnd },
      selectionEvent: event,
      sourceEditor,
    })
  }
  sourceEditor.input.addEventListener('mouseup', (event) => { event.stopPropagation(); syncSelection(event) })
  sourceEditor.input.addEventListener('keyup', (event) => { event.stopPropagation(); if (event.key !== 'Shift' && event.key !== 'Escape') syncSelection() })
  const renderLatest = (): void => {
    renderedCode = code
    refresh.disabled = true
    previewHost.updateCode(code)
  }
  const updateCode = (next: string): void => {
    code = next
    const nextTheme = extractMermaidThemeFromCode(next) ?? defaultTheme
    if (nextTheme !== activeTheme) {
      activeTheme = nextTheme
      options.onThemeChange?.(nextTheme)
    }
    lineMap = parseMermaidLineMap(next)
    toolbar.hidden = true
    if (sourceEditor.input.value !== next) {
      sourceEditor.input.value = next
      sourceEditor.setCommentRanges([])
    }
    refresh.disabled = code === renderedCode
    if (liveUpdate) renderLatest()
  }
  container.addEventListener('taco-appearance-change', (event) => {
    const dark = (event as CustomEvent<string>).detail === 'dark'
    const theme = mermaidThemeForAppearance(activeTheme, dark)
    const fullscreenTheme = container.closest('.mermaid-zoom-dialog')?.querySelector<HTMLSelectElement>('.tiptap-code-block-theme-select:not(.tiptap-code-block-direction-select)')
    if (fullscreenTheme) fullscreenTheme.value = theme
    if (options.readOnly) {
      activeTheme = theme
      previewHost.setTheme(theme)
      options.onThemeChange?.(theme)
      return
    }
    const next = updateMermaidCodeTheme(code, theme)
    const changed = next !== code
    if (!liveUpdate) {
      renderedCode = updateMermaidCodeTheme(renderedCode, mermaidThemeForAppearance(previewHost.getMermaidTheme(), dark))
      previewHost.updateCode(renderedCode)
    }
    updateCode(next)
    if (changed) options.onChange?.(next)
  })
  return {
    element: container,
    previewHost,
    sourceEditor,
    updateCode,
    setTheme: (theme) => {
      if (options.readOnly) return
      toolbar.hidden = true
      const updated = updateMermaidCodeTheme(code, theme)
      updateCode(updated)
      options.onChange?.(updated)
    },
    setDirection: (direction) => {
      if (options.readOnly) return
      toolbar.hidden = true
      const updated = updateMermaidDirection(code, direction)
      updateCode(updated)
      options.onChange?.(updated)
    },
    toggleCodePanel,
    isCodePanelOpen: () => isPanelOpen,
    setAllowCodePanel: (allowed: boolean) => {
      allowPanel = allowed
      if (!allowed && isPanelOpen) {
        toggleCodePanel(false)
      }
    },
  }
}
