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
  defaultMermaidTheme,
  extractMermaidDirectionFromCode,
  extractMermaidThemeFromCode,
  isMermaidDirectionSupported,
  MERMAID_DIRECTIONS,
  MERMAID_THEMES,
  type MermaidDirection,
  type MermaidPluginLabels,
  type MermaidRuntime,
  type MermaidTheme,
} from './mermaid.ts'
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

export {
  iconButton,
  setIcon,
  bindMermaidCanvasDrag,
  createMermaidSplitView,
  type CodeBlockIcon,
  type MermaidSplitViewController,
  type TacoCodeBlockCommentTarget,
} from './mermaid-split-view.ts'
import {
  bindMermaidCanvasDrag,
  iconButton,
  setIcon,
  createMermaidSplitView,
  type MermaidSplitViewController,
  type TacoCodeBlockCommentTarget,
} from './mermaid-split-view.ts'

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



export const createTacoCodeBlock = (labels: MermaidPluginLabels, options: TacoCodeBlockOptions = {}) => CodeBlockLowlight.configure({
  lowlight,
  enableTabIndentation: true,
  tabSize: 2,
}).extend({
  addNodeView() {
    const { renderMermaid = true, mermaidRuntime, onComment } = options
    return ({ node, editor, getPos }) => {
      let currentNode = node
      const defaultTheme = defaultMermaidTheme()
      let currentTheme: MermaidTheme = extractMermaidThemeFromCode(currentNode.textContent) ?? defaultTheme
      let currentDirection: MermaidDirection = extractMermaidDirectionFromCode(currentNode.textContent)
      let codePanelVisible = false
      let splitController: MermaidSplitViewController | null = null
      let renderedMermaid = ''
      let mermaidUnavailable = false
      let feedbackTimer: number | undefined
      let destroyed = false

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
      const directionSelect = document.createElement('select')
      directionSelect.className = 'tiptap-code-block-theme-select tiptap-code-block-direction-select'
      directionSelect.setAttribute('aria-label', labels.direction || 'Direction')
      MERMAID_DIRECTIONS.forEach(({ id, label }) => {
        const option = document.createElement('option')
        option.value = id
        option.textContent = label.split(' ')[0]
        if (id === currentDirection) option.selected = true
        directionSelect.append(option)
      })
      directionSelect.addEventListener('change', () => {
        currentDirection = directionSelect.value as MermaidDirection
        splitController?.setDirection(currentDirection)
      })
      const panelButton = iconButton('panel-left', labels.codePanel || 'Code panel', 'tiptap-code-block-panel')
      panelButton.addEventListener('click', (event) => {
        event.preventDefault()
        if (splitController) {
          codePanelVisible = splitController.toggleCodePanel()
          panelButton.classList.toggle('is-active', codePanelVisible)
          panelButton.setAttribute('aria-pressed', String(codePanelVisible))
        }
      })

      const zoomButton = iconButton('maximize', labels.zoom, 'tiptap-code-block-zoom')
      zoomButton.title = '全屏'
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
        const detectedZoomTheme = extractMermaidThemeFromCode(currentNode.textContent) ?? currentTheme
        MERMAID_THEMES.forEach(({ id, label }) => {
          const option = document.createElement('option')
          option.value = id
          option.textContent = label
          if (id === detectedZoomTheme) option.selected = true
          zoomThemeSelect.append(option)
        })
        const zoomDirectionSelect = document.createElement('select')
        zoomDirectionSelect.className = 'tiptap-code-block-theme-select tiptap-code-block-direction-select'
        zoomDirectionSelect.setAttribute('aria-label', labels.direction || 'Direction')
        const detectedZoomDir = extractMermaidDirectionFromCode(currentNode.textContent)
        zoomDirectionSelect.hidden = !isMermaidDirectionSupported(currentNode.textContent)
        zoomDirectionSelect.disabled = !editor.isEditable
        zoomThemeSelect.disabled = !editor.isEditable
        MERMAID_DIRECTIONS.forEach(({ id, label }) => {
          const option = document.createElement('option')
          option.value = id
          option.textContent = label.split(' ')[0]
          if (id === detectedZoomDir) option.selected = true
          zoomDirectionSelect.append(option)
        })
        zoomDirectionSelect.addEventListener('change', () => {
          currentDirection = zoomDirectionSelect.value as MermaidDirection
          directionSelect.value = currentDirection
          zoomSplit.setDirection(currentDirection)
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

        const zoomSplit = splitController ?? createMermaidSplitView(currentNode.textContent, labels, {
          readOnly: !editor.isEditable,
          allowCodePanel: true,
          onChange: (value) => {
            updateSource(value)
            zoomDirectionSelect.value = extractMermaidDirectionFromCode(value)
            zoomDirectionSelect.hidden = !isMermaidDirectionSupported(value)
          },
          runtime: mermaidRuntime,
          initialTheme: detectedZoomTheme,
          initialPanelOpen: codePanelVisible,
          onThemeChange: (newTheme) => {
            currentTheme = newTheme
            zoomThemeSelect.value = newTheme
            themeSelect.value = newTheme
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
        if (!splitController) {
          splitController = zoomSplit
          preview.replaceChildren(zoomSplit.element)
        }
        zoomSplit.setAllowCodePanel(true)
        const syncZoomControls = (): void => {
          const value = zoomSplit.sourceEditor.input.value
          zoomThemeSelect.value = extractMermaidThemeFromCode(value) ?? defaultTheme
          zoomDirectionSelect.value = extractMermaidDirectionFromCode(value)
          zoomDirectionSelect.hidden = !isMermaidDirectionSupported(value)
          zoomPanelButton.classList.toggle('is-active', zoomSplit.isCodePanelOpen())
          zoomPanelButton.setAttribute('aria-pressed', String(zoomSplit.isCodePanelOpen()))
        }
        zoomSplit.element.addEventListener('input', syncZoomControls)
        zoomSplit.element.addEventListener('click', syncZoomControls)
        const diagram = zoomSplit.previewHost
        const stage = diagram.parentElement!
        const inlineScale = diagram.style.scale
        const inlineTranslation = diagram.style.translate
        diagram.style.scale = ''
        diagram.style.translate = ''
        stage.append(canvas)
        canvas.append(diagram)

        zoomThemeSelect.addEventListener('change', () => {
          const selected = zoomThemeSelect.value as MermaidTheme
          currentTheme = selected
          themeSelect.value = selected
          zoomSplit.setTheme(selected)
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
        controls.append(zoomThemeSelect, zoomDirectionSelect, zoomPanelButton, zoomOut, zoomLevel, zoomIn, reset, close)
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
          diagram.style.translate = ''
          canvas.scrollTop = 0
        }

        zoomOut.addEventListener('click', () => setZoom(zoom - ZOOM_STEP))
        zoomIn.addEventListener('click', () => setZoom(zoom + ZOOM_STEP))
        reset.addEventListener('click', resetZoom)
        canvas.addEventListener('wheel', (event) => {
          if (!event.metaKey) return
          event.preventDefault()
          const rect = canvas.getBoundingClientRect()
          const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? canvas.clientHeight : 1)
          setZoom(zoom * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY), event.clientX - rect.left, event.clientY - rect.top)
        }, { passive: false })
        bindMermaidCanvasDrag(canvas)
        dialog.addEventListener('keydown', (event) => {
          if ((event.target as Element).closest('textarea, input, select, button')) return
          if (event.key === '+' || event.key === '=') setZoom(zoom + ZOOM_STEP)
          else if (event.key === '-' || event.key === '_') setZoom(zoom - ZOOM_STEP)
          else if (event.key === '0') resetZoom()
          else return
          event.preventDefault()
        })
        paintZoom()
        const restoreView = (): void => {
          if (!canvas.isConnected) return
          diagram.style.scale = inlineScale
          diagram.style.translate = inlineTranslation
          diagram.style.removeProperty('--mermaid-zoom-width')
          diagram.style.removeProperty('--mermaid-zoom-min-width')
          stage.append(diagram)
          canvas.remove()
          preview.append(zoomSplit.element)
          zoomSplit.setAllowCodePanel(false)
          zoomSplit.element.removeEventListener('input', syncZoomControls)
          zoomSplit.element.removeEventListener('click', syncZoomControls)
        }

        const closeDialog = (): void => {
          if (dialog.classList.contains('is-closing')) return
          const finish = (): void => {
            restoreView()
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
        dialog.addEventListener('close', () => { restoreView(); dialog.remove() }, { once: true })
        showModal(dialog)
      }

      const paint = (): void => {
        const languageName = String(currentNode.attrs.language ?? '').toLocaleLowerCase()
        const code = currentNode.textContent
        const blockId = String(currentNode.attrs.tacoBlockId ?? '')
        const isMermaid = languageName === 'mermaid'
        const codeTheme = isMermaid ? extractMermaidThemeFromCode(code) : undefined
        if (codeTheme && codeTheme !== currentTheme) {
          currentTheme = codeTheme
          themeSelect.value = codeTheme
        }
        dom.dataset.tacoBlockId = blockId
        dom.classList.toggle('is-mermaid', isMermaid)
        dom.classList.toggle('is-source-visible', isMermaid && mermaidUnavailable)
        language.textContent = languageLabel(languageName, code)
        content.className = languageName ? `language-${languageName}` : ''
        const showMermaidTools = isMermaid && !mermaidUnavailable
        themeSelect.hidden = !showMermaidTools
        directionSelect.hidden = !showMermaidTools || !isMermaidDirectionSupported(code)
        panelButton.hidden = true
        themeSelect.disabled = !editor.isEditable
        directionSelect.disabled = !editor.isEditable
        const codeDir = isMermaid ? extractMermaidDirectionFromCode(code) : undefined
        if (codeDir && codeDir !== currentDirection) {
          currentDirection = codeDir
          directionSelect.value = codeDir
        }
        panelButton.classList.toggle('is-active', codePanelVisible)
        panelButton.setAttribute('aria-pressed', String(codePanelVisible))
        zoomButton.hidden = !isMermaid || mermaidUnavailable
        commentButton.hidden = !onComment
        commentButton.disabled = !blockId || !code.trim()
        preview.hidden = !isMermaid || mermaidUnavailable
        source.hidden = isMermaid && !mermaidUnavailable
        paintLineNumbers(code)

        if (renderMermaid && isMermaid && !mermaidUnavailable && (code !== renderedMermaid || !splitController)) {
          renderedMermaid = code
          if (splitController) {
            splitController.updateCode(code)
            return
          }
          splitController = createMermaidSplitView(code, labels, {
            readOnly: !editor.isEditable,
            onChange: updateSource,
            runtime: mermaidRuntime,
            allowCodePanel: false,
            initialTheme: currentTheme,
            onUnavailable: () => {
              if (destroyed || String(currentNode.attrs.language).toLowerCase() !== 'mermaid') return
              mermaidUnavailable = true
              dom.classList.add('is-source-visible')
              themeSelect.hidden = true
              directionSelect.hidden = true
              panelButton.hidden = true
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

      actions.append(themeSelect, directionSelect, panelButton, zoomButton, commentButton, copyButton)
      tools.append(language, actions)
      dom.append(tools, preview, source)
      paint()

      return {
        dom,
        contentDOM: content,
        update(updatedNode) {
          if (updatedNode.type !== currentNode.type) return false
          currentNode = updatedNode
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
          destroyed = true
          window.clearTimeout(feedbackTimer)
        },
      }
    }
  },
})

export { lowlight as tacoLowlight }
