import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { createLowlight } from 'lowlight'
import {
  createMermaidPreview,
  MERMAID_THEMES,
  parseMermaidLineMap,
  type MermaidPluginLabels,
  type MermaidPreviewElement,
  type MermaidRuntime,
  type MermaidTheme,
} from './mermaid.ts'
import { createSourceEditor, type SourceEditorController, type SourceCommentRange } from './source-editor.ts'

const lowlight = createLowlight({
  bash,
  css,
  javascript,
  json,
  markdown,
  plaintext,
  python,
  shell,
  sql,
  typescript,
  xml,
  yaml,
})
lowlight.registerAlias('plaintext', ['text', 'txt', 'mermaid'])
const expandedMermaidNodes = new WeakSet<object>()

type CodeBlockIcon = 'check' | 'copy' | 'maximize' | 'message-square' | 'minus' | 'pencil' | 'plus' | 'rotate-ccw' | 'x' | 'panel-left'

const iconPaths: Record<CodeBlockIcon, string> = {
  check: '<path d="m20 6-11 11-5-5"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  'message-square': '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
  minus: '<path d="M5 12h14"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
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

const setIcon = (button: HTMLButtonElement, name: CodeBlockIcon): void => {
  button.replaceChildren(codeBlockIcon(name))
}

const iconButton = (name: CodeBlockIcon, label: string, className = ''): HTMLButtonElement => {
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

const languageNames: Record<string, string> = {
  bash: 'Bash',
  css: 'CSS',
  html: 'HTML',
  javascript: 'JavaScript',
  js: 'JavaScript',
  json: 'JSON',
  markdown: 'Markdown',
  mermaid: 'Mermaid',
  python: 'Python',
  shell: 'Shell',
  sh: 'Shell',
  sql: 'SQL',
  text: 'Plain text',
  plaintext: 'Plain text',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML',
  yml: 'YAML',
}

const displayLanguage = (language: string): string => languageNames[language] ?? (
  language ? `${language.charAt(0).toLocaleUpperCase()}${language.slice(1)}` : ''
)

const copyText = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand?.('copy')
  textarea.remove()
  if (!copied) throw new Error('Clipboard is unavailable')
}

const showModal = (dialog: HTMLDialogElement): void => {
  document.body.append(dialog)
  if (typeof dialog.showModal === 'function') dialog.showModal()
  else dialog.setAttribute('open', '')
}

export interface TacoCodeBlockOptions {
  renderMermaid?: boolean
  mermaidRuntime?: MermaidRuntime
  onComment?: (target: TacoCodeBlockCommentTarget) => void
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
  setTheme: (theme: MermaidTheme) => void
  toggleCodePanel: (force?: boolean) => boolean
  isCodePanelOpen: () => boolean
  sourceEditor: SourceEditorController
  updateCode: (code: string) => void
}

export const createMermaidSplitView = (
  code: string,
  labels: MermaidPluginLabels,
  options: {
    runtime?: MermaidRuntime
    initialTheme?: MermaidTheme
    initialPanelOpen?: boolean
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
  let isPanelOpen = options.initialPanelOpen ?? false
  let lineMap = parseMermaidLineMap(code)
  const container = document.createElement('div')
  container.className = 'tiptap-mermaid-container'
  const codePanel = document.createElement('section')
  codePanel.className = 'mermaid-floating-code-panel'
  codePanel.setAttribute('aria-label', labels.codePanel || labels.source)
  const toggleCodePanel = (force = !isPanelOpen): boolean => {
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
  header.append(title, close)
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
    theme: options.initialTheme ?? 'redux',
    onRendered: options.onRendered,
    onNodeHover: (nodeId) => {
      const line = nodeId ? lineMap.nodeToLines.get(nodeId)?.[0] : undefined
      sourceEditor.highlightRange(line ? lineRange(line) : null)
    },
    onThemeChange: options.onThemeChange,
    onNodeClick: (nodeId, nodeLabel, event) => {
      selected = { nodeId, nodeLabel }
      selectedElement = event.currentTarget as Element
      toggleCodePanel(true)
      previewHost.focusNode(nodeId)
      const line = lineMap.nodeToLines.get(nodeId)?.[0]
      if (line) sourceEditor.activateRange(lineRange(line))
      toolbar.hidden = !options.onComment
      positionToolbar()
    },
  })
  stage.append(previewHost)
  container.append(stage, codePanel, toolbar)
  container.addEventListener('scroll', positionToolbar, true)
  const syncSelection = (event?: MouseEvent): void => {
    const input = sourceEditor.input
    const lineNumber = input.value.slice(0, input.selectionStart).split('\n').length
    previewHost.focusNode(lineMap.lineToNodes.get(lineNumber)?.[0] ?? null)
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
  sourceEditor.input.addEventListener('keyup', (event) => { event.stopPropagation(); if (event.key !== 'Shift') syncSelection() })
  const updateCode = (next: string): void => {
    code = next
    lineMap = parseMermaidLineMap(next)
    toolbar.hidden = true
    if (sourceEditor.input.value !== next) {
      sourceEditor.input.value = next
      sourceEditor.setCommentRanges([])
    }
    previewHost.updateCode(next)
  }
  return {
    element: container,
    previewHost,
    sourceEditor,
    updateCode,
    setTheme: (theme) => { toolbar.hidden = true; previewHost.setMermaidTheme(theme) },
    toggleCodePanel,
    isCodePanelOpen: () => isPanelOpen,
  }
}

export const createTacoCodeBlock = (labels: MermaidPluginLabels, options: TacoCodeBlockOptions = {}) => CodeBlockLowlight.configure({
  lowlight,
  enableTabIndentation: true,
  tabSize: 2,
}).extend({
  addNodeView() {
    const { renderMermaid = true, mermaidRuntime, onComment } = options
    return ({ node, editor, getPos }) => {
      let currentNode = node
      let sourceVisible = expandedMermaidNodes.has(node)
      let currentTheme: MermaidTheme = 'redux'
      let codePanelVisible = false
      let splitController: MermaidSplitViewController | null = null
      let renderedMermaid = ''
      let mermaidUnavailable = false
      let feedbackTimer: number | undefined

      const dom = document.createElement('div')
      dom.className = 'tiptap-code-block'

      const tools = document.createElement('div')
      tools.className = 'tiptap-code-block-tools'
      tools.contentEditable = 'false'

      const language = document.createElement('span')
      language.className = 'tiptap-code-block-language'

      const actions = document.createElement('div')
      actions.className = 'tiptap-code-block-actions'
      const themeSelect = document.createElement('select')
      themeSelect.className = 'tiptap-code-block-theme-select'
      themeSelect.setAttribute('aria-label', labels.theme || 'Theme')
      MERMAID_THEMES.forEach(({ id, label }) => {
        const option = document.createElement('option')
        option.value = id
        option.textContent = label
        if (id === currentTheme) option.selected = true
        themeSelect.append(option)
      })
      const handleThemeChange = () => {
        currentTheme = themeSelect.value as MermaidTheme
        splitController?.setTheme(currentTheme)
      }
      themeSelect.addEventListener('change', handleThemeChange)
      const panelButton = iconButton('panel-left', labels.codePanel || 'Code panel', 'tiptap-code-block-panel')
      panelButton.addEventListener('click', (event) => {
        event.preventDefault()
        if (splitController) {
          codePanelVisible = splitController.toggleCodePanel()
          panelButton.classList.toggle('is-active', codePanelVisible)
          panelButton.setAttribute('aria-pressed', String(codePanelVisible))
        }
      })

      const editButton = iconButton('pencil', labels.source, 'tiptap-code-block-edit')
      const zoomButton = iconButton('maximize', labels.zoom, 'tiptap-code-block-zoom')
      const commentButton = iconButton('message-square', labels.comment, 'tiptap-code-block-comment')
      const copyButton = iconButton('copy', labels.copy, 'tiptap-code-block-copy')
      const source = document.createElement('pre')
      source.className = 'tiptap-code-block-source'

      const lineNumbers = document.createElement('span')
      lineNumbers.className = 'tiptap-code-block-lines'
      lineNumbers.contentEditable = 'false'
      lineNumbers.setAttribute('aria-hidden', 'true')

      const content = document.createElement('code')
      source.append(lineNumbers, content)

      const preview = document.createElement('div')
      preview.className = 'tiptap-code-block-preview'
      preview.contentEditable = 'false'

      const languageLabel = (languageName: string, code: string): string => {
        if (languageName) return displayLanguage(languageName)
        const detected = String(lowlight.highlightAuto(code).data?.language ?? '')
        return detected ? `${labels.auto} · ${displayLanguage(detected)}` : labels.plainText
      }

      const paintLineNumbers = (code: string): void => {
        const count = code.split('\n').length
        lineNumbers.replaceChildren(...Array.from({ length: count }, (_, index) => {
          const number = document.createElement('span')
          number.textContent = String(index + 1)
          return number
        }))
      }
      const updateSource = (value: string): void => {
        if (!editor.isEditable) return
        const pos = getPos()
        if (typeof pos !== 'number') return
        const tr = editor.state.tr
        tr.replaceWith(pos + 1, pos + currentNode.nodeSize - 1, value ? editor.schema.text(value) : [])
        editor.view.dispatch(tr)
      }

      const openZoom = (): void => {
        const MIN_ZOOM = 0.5
        const MAX_ZOOM = 2
        const ZOOM_STEP = 0.25
        const WHEEL_ZOOM_SENSITIVITY = 0.0015
        let zoom = 1
        let dragPointerId: number | undefined
        let dragStartX = 0
        let dragStartY = 0
        let dragStartScrollLeft = 0
        let dragStartScrollTop = 0

        const dialog = document.createElement('dialog')
        dialog.className = 'mermaid-zoom-dialog'
        dialog.setAttribute('aria-label', labels.zoom)

        const header = document.createElement('header')
        header.className = 'mermaid-zoom-header'
        const title = document.createElement('span')
        title.textContent = labels.previewTitle
        const controls = document.createElement('div')
        controls.className = 'mermaid-zoom-controls'

        const zoomThemeSelect = document.createElement('select')
        zoomThemeSelect.className = 'tiptap-code-block-theme-select mermaid-zoom-theme-select'
        zoomThemeSelect.setAttribute('aria-label', labels.theme || 'Theme')
        MERMAID_THEMES.forEach(({ id, label }) => {
          const option = document.createElement('option')
          option.value = id
          option.textContent = label
          if (id === currentTheme) option.selected = true
          zoomThemeSelect.append(option)
        })

        const zoomPanelButton = iconButton('panel-left', labels.codePanel || 'Code panel', 'mermaid-zoom-panel')
        zoomPanelButton.classList.toggle('is-active', codePanelVisible)
        zoomPanelButton.setAttribute('aria-pressed', String(codePanelVisible))

        const zoomOut = iconButton('minus', labels.zoomOut, 'mermaid-zoom-out')
        const zoomLevel = document.createElement('output')
        zoomLevel.className = 'mermaid-zoom-level'
        zoomLevel.setAttribute('aria-label', labels.zoomLevel)
        zoomLevel.setAttribute('aria-live', 'polite')
        const zoomIn = iconButton('plus', labels.zoomIn, 'mermaid-zoom-in')
        const reset = iconButton('rotate-ccw', labels.resetZoom, 'mermaid-zoom-reset')
        const close = iconButton('x', labels.close, 'mermaid-zoom-close')

        const canvas = document.createElement('div')
        canvas.className = 'mermaid-zoom-canvas'

        const zoomSplit = createMermaidSplitView(currentNode.textContent, labels, {
          readOnly: !editor.isEditable,
          onChange: updateSource,
          runtime: mermaidRuntime,
          initialTheme: currentTheme,
          initialPanelOpen: codePanelVisible,
          onThemeChange: (newTheme) => {
            currentTheme = newTheme
            zoomThemeSelect.value = newTheme
            themeSelect.value = newTheme
            splitController?.setTheme(newTheme)
          },
          onPanelToggle: (open) => {
            codePanelVisible = open
            zoomPanelButton.classList.toggle('is-active', open)
            zoomPanelButton.setAttribute('aria-pressed', String(open))
            panelButton.classList.toggle('is-active', open)
            panelButton.setAttribute('aria-pressed', String(open))
          },
          onComment: (target) => {
            const currentBlockId = String(currentNode.attrs.tacoBlockId ?? '')
            onComment?.({
              blockId: currentBlockId,
              language: 'mermaid',
              content,
              ...target,
            })
          },
        })
        const diagram = zoomSplit.previewHost
        diagram.parentElement!.append(canvas)
        canvas.append(diagram)

        zoomThemeSelect.addEventListener('change', () => {
          const selected = zoomThemeSelect.value as MermaidTheme
          currentTheme = selected
          themeSelect.value = selected
          zoomSplit.setTheme(selected)
          splitController?.setTheme(selected)
        })

        zoomPanelButton.addEventListener('click', (event) => {
          event.preventDefault()
          const next = zoomSplit.toggleCodePanel()
          codePanelVisible = next
          zoomPanelButton.classList.toggle('is-active', next)
          zoomPanelButton.setAttribute('aria-pressed', String(next))
          panelButton.classList.toggle('is-active', next)
          panelButton.setAttribute('aria-pressed', String(next))
        })

        controls.append(zoomThemeSelect, zoomPanelButton, zoomOut, zoomLevel, zoomIn, reset, close)
        header.append(title, controls)
        dialog.append(header, zoomSplit.element)
        const paintZoom = (): void => {
          const percentage = Math.round(zoom * 100)
          diagram.style.setProperty('--mermaid-zoom-width', `${percentage}%`)
          diagram.style.setProperty('--mermaid-zoom-min-width', `${Math.round(960 * zoom)}px`)
          zoomLevel.value = `${percentage}%`
          zoomOut.disabled = zoom <= MIN_ZOOM
          zoomIn.disabled = zoom >= MAX_ZOOM
          reset.disabled = zoom === 1
        }

        const setZoom = (nextZoom: number, focalX = canvas.clientWidth / 2, focalY = canvas.clientHeight / 2): void => {
          const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
          if (clamped === zoom) return
          const ratio = clamped / zoom
          const contentX = canvas.scrollLeft + focalX
          const contentY = canvas.scrollTop + focalY
          zoom = clamped
          paintZoom()
          canvas.scrollLeft = contentX * ratio - focalX
          canvas.scrollTop = contentY * ratio - focalY
        }

        const resetZoom = (): void => {
          setZoom(1)
          canvas.scrollLeft = 0
          canvas.scrollTop = 0
        }

        zoomOut.addEventListener('click', () => setZoom(zoom - ZOOM_STEP))
        zoomIn.addEventListener('click', () => setZoom(zoom + ZOOM_STEP))
        reset.addEventListener('click', resetZoom)
        canvas.addEventListener('wheel', (event) => {
          event.preventDefault()
          const rect = canvas.getBoundingClientRect()
          const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? canvas.clientHeight : 1)
          setZoom(zoom * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY), event.clientX - rect.left, event.clientY - rect.top)
        }, { passive: false })
        canvas.addEventListener('pointerdown', (event) => {
          if (dragPointerId !== undefined || event.button !== 0) return
          if ((event.target as Element).closest('.interactive-mermaid-node, button')) return
          dragPointerId = event.pointerId
          dragStartX = event.clientX
          dragStartY = event.clientY
          dragStartScrollLeft = canvas.scrollLeft
          dragStartScrollTop = canvas.scrollTop
          canvas.setPointerCapture?.(event.pointerId)
          canvas.classList.add('is-dragging')
          event.preventDefault()
        })
        canvas.addEventListener('pointermove', (event) => {
          if (dragPointerId === undefined || event.pointerId !== dragPointerId) return
          canvas.scrollLeft = dragStartScrollLeft - (event.clientX - dragStartX)
          canvas.scrollTop = dragStartScrollTop - (event.clientY - dragStartY)
        })
        const stopDragging = (event: PointerEvent): void => {
          if (dragPointerId === undefined || event.pointerId !== dragPointerId) return
          if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
          dragPointerId = undefined
          canvas.classList.remove('is-dragging')
        }
        canvas.addEventListener('pointerup', stopDragging)
        canvas.addEventListener('pointercancel', stopDragging)
        dialog.addEventListener('keydown', (event) => {
          if ((event.target as Element).closest('textarea, input, select, button')) return
          if (event.key === '+' || event.key === '=') setZoom(zoom + ZOOM_STEP)
          else if (event.key === '-' || event.key === '_') setZoom(zoom - ZOOM_STEP)
          else if (event.key === '0') resetZoom()
          else return
          event.preventDefault()
        })
        paintZoom()

        const closeDialog = (): void => {
          if (dialog.classList.contains('is-closing')) return
          const finish = (): void => {
            if (typeof dialog.close === 'function') dialog.close()
            else {
              dialog.removeAttribute('open')
              dialog.remove()
            }
          }
          if (matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return }
          dialog.classList.add('is-closing')
          window.setTimeout(finish, 180)
        }
        close.addEventListener('click', closeDialog)
        dialog.addEventListener('click', (event) => {
          if (event.target === dialog) closeDialog()
        })
        dialog.addEventListener('cancel', (event) => {
          event.preventDefault()
          closeDialog()
        })
        dialog.addEventListener('close', () => dialog.remove(), { once: true })
        showModal(dialog)
      }

      const paint = (): void => {
        const languageName = String(currentNode.attrs.language ?? '').toLocaleLowerCase()
        const code = currentNode.textContent
        const blockId = String(currentNode.attrs.tacoBlockId ?? '')
        const isMermaid = languageName === 'mermaid'
        dom.dataset.tacoBlockId = blockId
        dom.classList.toggle('is-mermaid', isMermaid)
        dom.classList.toggle('is-source-visible', isMermaid && (sourceVisible || mermaidUnavailable))
        language.textContent = languageLabel(languageName, code)
        content.className = languageName ? `language-${languageName}` : ''
        const showMermaidTools = isMermaid && !sourceVisible && !mermaidUnavailable
        themeSelect.hidden = !showMermaidTools
        panelButton.hidden = !showMermaidTools
        panelButton.classList.toggle('is-active', codePanelVisible)
        panelButton.setAttribute('aria-pressed', String(codePanelVisible))
        editButton.hidden = !isMermaid || mermaidUnavailable
        editButton.classList.toggle('is-active', sourceVisible)
        editButton.setAttribute('aria-pressed', String(sourceVisible))
        editButton.setAttribute('aria-label', sourceVisible ? labels.hidePreview : labels.source)
        editButton.title = sourceVisible ? labels.hidePreview : labels.source
        zoomButton.hidden = !isMermaid || mermaidUnavailable
        commentButton.hidden = !onComment
        commentButton.disabled = !blockId || !code.trim()
        preview.hidden = !isMermaid || sourceVisible || mermaidUnavailable
        source.hidden = isMermaid && !sourceVisible && !mermaidUnavailable
        paintLineNumbers(code)

        if (renderMermaid && isMermaid && !sourceVisible && !mermaidUnavailable && (code !== renderedMermaid || !splitController)) {
          renderedMermaid = code
          if (splitController) {
            splitController.updateCode(code)
            return
          }
          splitController = createMermaidSplitView(code, labels, {
            readOnly: !editor.isEditable,
            onChange: updateSource,
            runtime: mermaidRuntime,
            initialTheme: currentTheme,
            initialPanelOpen: codePanelVisible,
            onUnavailable: () => {
              if (currentNode.textContent !== code) return
              mermaidUnavailable = true
              dom.classList.add('is-source-visible')
              themeSelect.hidden = true
              panelButton.hidden = true
              editButton.hidden = true
              zoomButton.hidden = true
              preview.hidden = true
              source.hidden = false
            },
            onThemeChange: (theme) => {
              currentTheme = theme
              themeSelect.value = theme
            },
            onPanelToggle: (open) => {
              codePanelVisible = open
              panelButton.classList.toggle('is-active', open)
              panelButton.setAttribute('aria-pressed', String(open))
            },
            onComment: (target) => {
              const currentBlockId = String(currentNode.attrs.tacoBlockId ?? '')
              onComment?.({
                blockId: currentBlockId,
                language: 'mermaid',
                content,
                ...target,
              })
            },
          })
          preview.replaceChildren(splitController.element)
        } else if (!isMermaid) {
          renderedMermaid = ''
          mermaidUnavailable = false
          splitController = null
          preview.replaceChildren()
        }
      }

      editButton.addEventListener('click', (event) => {
        event.preventDefault()
        sourceVisible = !sourceVisible
        if (sourceVisible) expandedMermaidNodes.add(currentNode)
        else expandedMermaidNodes.delete(currentNode)
        paint()
      })

      zoomButton.addEventListener('click', (event) => {
        event.preventDefault()
        openZoom()
      })

      preview.addEventListener('dblclick', openZoom)

      commentButton.addEventListener('click', (event) => {
        event.preventDefault()
        const blockId = String(currentNode.attrs.tacoBlockId ?? '')
        if (!blockId || !currentNode.textContent.trim()) return
        onComment?.({
          blockId,
          language: String(currentNode.attrs.language ?? '').toLocaleLowerCase(),
          content,
        })
      })

      copyButton.addEventListener('click', () => {
        window.clearTimeout(feedbackTimer)
        void copyText(currentNode.textContent).then(() => {
          setIcon(copyButton, 'check')
          copyButton.classList.add('is-success')
          copyButton.setAttribute('aria-label', labels.copied)
          copyButton.title = labels.copied
          feedbackTimer = window.setTimeout(() => {
            setIcon(copyButton, 'copy')
            copyButton.classList.remove('is-success')
            copyButton.setAttribute('aria-label', labels.copy)
            copyButton.title = labels.copy
          }, 1600)
        }).catch(() => {
          copyButton.classList.add('is-error')
          copyButton.setAttribute('aria-label', labels.copyFailed)
          copyButton.title = labels.copyFailed
          feedbackTimer = window.setTimeout(() => {
            copyButton.classList.remove('is-error')
            copyButton.setAttribute('aria-label', labels.copy)
            copyButton.title = labels.copy
          }, 1600)
        })
      })

      actions.append(themeSelect, panelButton, editButton, zoomButton, commentButton, copyButton)
      tools.append(language, actions)
      dom.append(tools, preview, source)
      paint()

      return {
        dom,
        contentDOM: content,
        update(updatedNode) {
          if (updatedNode.type !== currentNode.type) return false
          if (sourceVisible) expandedMermaidNodes.add(updatedNode)
          currentNode = updatedNode
          sourceVisible = expandedMermaidNodes.has(updatedNode)
          paint()
          return true
        },
        stopEvent(event) {
          const target = event.target
          return target instanceof Node && (tools.contains(target) || preview.contains(target))
        },
        ignoreMutation(mutation) {
          if (mutation.type === 'selection') return false
          return !content.contains(mutation.target)
        },
        destroy() {
          window.clearTimeout(feedbackTimer)
        },
      }
    }
  },
})

export { lowlight as tacoLowlight }
