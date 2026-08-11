import type { Editor } from '@tiptap/core'
import { displayAuthorName } from './identity.ts'
import type { TacoFile } from './model.ts'
import type { TacoSyncSession } from './sync/session.ts'
import { el } from './ui-primitives.ts'

interface PresenceLabels {
  collabOff: string
  localCollab: string
  guest: string
  connected: (count: number) => string
}

export interface PresenceControllerOptions {
  sync: TacoSyncSession
  getEditor: () => Editor | null
  getSelected: () => TacoFile | null
  getViewer: () => HTMLElement
  getLabels: () => PresenceLabels
}

export class PresenceController {
  private strip: HTMLElement | null = null

  constructor(private readonly options: PresenceControllerOptions) {}

  mount(strip: HTMLElement): void {
    this.strip = strip
  }

  destroy(): void {
    this.options.getViewer().querySelector('[data-remote-cursor-layer]')?.remove()
    this.strip = null
  }

  publish(editor: Editor, focused = editor.isFocused, hasCursor = true): void {
    const selected = this.options.getSelected()
    if (editor !== this.options.getEditor() || !selected) return
    const { from, to } = editor.state.selection
    this.options.sync.setPresence({
      name: displayAuthorName(),
      fileId: selected.id ?? '',
      from,
      to,
      focused,
      hasCursor,
    })
  }

  paint(): void {
    if (!this.strip) return
    this.strip.innerHTML = ''
    const active = this.options.sync.isActive()
    this.strip.hidden = !active
    this.strip.toggleAttribute('data-collab-active', active)
    if (!active) {
      this.strip.title = this.options.getLabels().collabOff
      this.strip.removeAttribute('data-has-peers')
      return
    }
    const collaborators = this.options.sync.collaborators()
    for (const peer of collaborators.slice(0, 4)) {
      const avatar = el('span', 'presence-avatar', (peer.name || '?').trim().charAt(0).toLocaleUpperCase() || '?')
      avatar.style.background = peer.color
      avatar.title = peer.name
      this.strip.append(avatar)
    }
    const total = collaborators.length + 1
    const labels = this.options.getLabels()
    this.strip.title = `${labels.localCollab} · ${labels.connected(total)}`
    this.strip.toggleAttribute('data-has-peers', total > 1)
  }

  paintRemoteCursors(): void {
    const editor = this.options.getEditor()
    const viewer = this.options.getViewer()
    const host = viewer.querySelector<HTMLElement>('.tiptap-editor-host')
    const selected = this.options.getSelected()
    if (!editor || !host || !selected) return
    host.querySelector('[data-remote-cursor-layer]')?.remove()
    if (!this.options.sync.isActive()) return
    const layer = el('div', 'remote-cursor-layer')
    layer.dataset.remoteCursorLayer = ''
    layer.setAttribute('data-taco-transient', '')
    const hostRect = host.getBoundingClientRect()
    const maximum = editor.state.doc.content.size

    for (const peer of this.options.sync.peers()) {
      if (!peer.hasCursor || peer.fileId !== selected.id) continue
      const from = Math.max(0, Math.min(peer.from, maximum))
      const to = Math.max(0, Math.min(peer.to, maximum))
      if (from !== to) {
        try {
          const start = editor.view.domAtPos(Math.min(from, to))
          const end = editor.view.domAtPos(Math.max(from, to))
          const range = document.createRange()
          range.setStart(start.node, start.offset)
          range.setEnd(end.node, end.offset)
          for (const rect of Array.from(range.getClientRects())) {
            if (!rect.width || !rect.height) continue
            const mark = el('span', 'remote-selection')
            mark.style.left = `${rect.left - hostRect.left}px`
            mark.style.top = `${rect.top - hostRect.top}px`
            mark.style.width = `${rect.width}px`
            mark.style.height = `${rect.height}px`
            mark.style.background = `${peer.color}33`
            layer.append(mark)
          }
        } catch { /* stale selection while a remote transaction rematerializes */ }
      }
      try {
        const coords = editor.view.coordsAtPos(to)
        const caret = el('span', 'remote-caret')
        caret.style.left = `${coords.left - hostRect.left}px`
        caret.style.top = `${coords.top - hostRect.top}px`
        caret.style.height = `${Math.max(16, coords.bottom - coords.top)}px`
        caret.style.background = peer.color
        caret.classList.toggle('is-near-top', coords.top - hostRect.top < 22)
        caret.classList.toggle('is-idle', !peer.focused)
        const name = el('span', 'remote-caret-name', peer.name || this.options.getLabels().guest)
        name.style.background = peer.color
        caret.append(name)
        layer.append(caret)
      } catch { /* position disappeared between presence and render */ }
    }
    host.append(layer)
  }
}
