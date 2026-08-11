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
import { createMermaidPreview, type MermaidPluginLabels, type MermaidRuntime } from './mermaid.ts'

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

type CodeBlockIcon = 'check' | 'copy' | 'maximize' | 'message-square' | 'minus' | 'pencil' | 'plus' | 'rotate-ccw' | 'x'

const iconPaths: Record<CodeBlockIcon, string> = {
  check: '<path d="m20 6-11 11-5-5"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  'message-square': '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
  minus: '<path d="M5 12h14"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
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
}

export const createTacoCodeBlock = (labels: MermaidPluginLabels, options: TacoCodeBlockOptions = {}) => CodeBlockLowlight.configure({
  lowlight,
  enableTabIndentation: true,
  tabSize: 2,
}).extend({
  addNodeView() {
    const { renderMermaid = true, mermaidRuntime, onComment } = options
    return ({ node }) => {
      let currentNode = node
      let sourceVisible = expandedMermaidNodes.has(node)
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
        const diagram = createMermaidPreview(currentNode.textContent, labels, undefined, undefined, mermaidRuntime)
        canvas.append(diagram)
        controls.append(zoomOut, zoomLevel, zoomIn, reset, close)
        header.append(title, controls)
        dialog.append(header, canvas)

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

        if (renderMermaid && isMermaid && !sourceVisible && !mermaidUnavailable && code !== renderedMermaid) {
          renderedMermaid = code
          preview.replaceChildren(createMermaidPreview(code, labels, undefined, () => {
            if (currentNode.textContent !== code) return
            mermaidUnavailable = true
            dom.classList.add('is-source-visible')
            editButton.hidden = true
            zoomButton.hidden = true
            preview.hidden = true
            source.hidden = false
          }, mermaidRuntime))
        } else if (!isMermaid) {
          renderedMermaid = ''
          mermaidUnavailable = false
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

      copyButton.addEventListener('click', (event) => {
        event.preventDefault()
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

      actions.append(editButton, zoomButton, commentButton, copyButton)
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
