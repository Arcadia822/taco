import type { DocumentStatus, ResolvedCheckpoints, ResolvedCheckpointNode } from '@taco/protocol'
import { createFileAttribute, createStatusIcon, el, svgIcon } from './ui-primitives.ts'

export interface CheckpointLabels {
  checkpoint: string
  checkpoints: string
  checkpointsInvalid: string
  checkpointTemplateName: string
  checkpointUnnamed: string
  statusTodo: string
  statusInProgress: string
  statusComplete: string
  statusFreeze: string
  checkpointOptional: string
  checkpointRequired: string
  checkpointMissingFile: string
  checkpointOpenView: string
  checkpointCreateFile: string
  checkpointNotCreatedRead: string
  checkpointGroupHint: string
  checkpointOverridden: (category: string) => string
}

const statuses: DocumentStatus[] = ['todo', 'in_progress', 'complete', 'freeze']
export const statusLabel = (status: DocumentStatus, labels: CheckpointLabels): string => ({
  todo: labels.statusTodo,
  in_progress: labels.statusInProgress,
  complete: labels.statusComplete,
  freeze: labels.statusFreeze,
})[status]

export function openCheckpointStatusMenu(anchor: HTMLElement, options: {
  path: string
  title: string
  optional: boolean
  status: DocumentStatus
  labels: CheckpointLabels
  readOnly: boolean
  onSet: (status: DocumentStatus) => void
  onOpenView: () => void
}): void {
  document.querySelector('.checkpoint-status-menu')?.remove()
  const menu = el('div', 'topbar-popover checkpoint-status-menu')
  menu.setAttribute('role', 'menu')
  menu.append(el('div', 'checkpoint-menu-heading', `${options.title} · ${options.optional ? options.labels.checkpointOptional : options.labels.checkpointRequired}`))
  for (const status of statuses) {
    const label = statusLabel(status, options.labels)
    const item = el('button', 'popover-action checkpoint-status-option') as HTMLButtonElement
    item.type = 'button'
    item.setAttribute('role', 'menuitemradio')
    item.setAttribute('aria-checked', String(status === options.status))
    item.disabled = options.readOnly
    const icon = createStatusIcon(status, label)
    icon.setAttribute('aria-hidden', 'true')
    icon.removeAttribute('role')
    icon.removeAttribute('aria-label')
    item.append(icon, el('span', '', label))
    if (status === options.status) item.append(el('span', 'checkpoint-menu-check', '✓'))
    item.addEventListener('click', () => { dismiss(); options.onSet(status) })
    menu.append(item)
  }
  const divider = el('div', 'checkpoint-menu-divider')
  const open = el('button', 'popover-action') as HTMLButtonElement
  open.type = 'button'
  open.append(svgIcon('presentation'), el('span', '', options.labels.checkpointOpenView))
  open.addEventListener('click', () => { dismiss(); options.onOpenView() })
  menu.append(divider, open)
  document.body.append(menu)
  const rect = anchor.getBoundingClientRect()
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, rect.left))}px`
  menu.style.top = `${Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4))}px`
  const dismiss = (): void => {
    menu.remove()
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('keydown', onKey, true)
  }
  const outside = (event: PointerEvent): void => {
    if (!menu.contains(event.target as Node) && !anchor.contains(event.target as Node)) dismiss()
  }
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); anchor.focus() }
  }
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', onKey, true)
}

export function createCheckpointView(result: ResolvedCheckpoints, labels: CheckpointLabels, options: {
  readOnly: boolean
  onSelect: (path: string) => void
  onSet: (path: string, status: DocumentStatus) => void
  onOpenView: () => void
}): HTMLElement {
  const surface = el('section', 'checkpoint-view')
  surface.setAttribute('aria-label', labels.checkpoints)
  if (!result.valid) {
    surface.append(el('p', 'checkpoint-error', `${labels.checkpointsInvalid}: ${result.error ?? ''}`))
    return surface
  }
  const graph = el('div', 'checkpoint-graph')
  const nodes = new Map(result.nodes.map((node) => [node.id, node]))
  const cards = new Map<string, HTMLElement>()
  for (const layer of result.layout) {
    const row = el('div', 'checkpoint-layer')
    for (const id of layer) {
      const node = nodes.get(id)!
      const card = checkpointCard(node, labels, options)
      row.append(card)
      cards.set(id, card)
    }
    graph.append(row)
  }
  surface.append(graph)
  const edges = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  edges.classList.add('checkpoint-edges')
  edges.setAttribute('aria-hidden', 'true')
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
  for (const kind of ['available', 'waiting'] as const) {
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker')
    marker.id = `checkpoint-arrow-${kind}`
    marker.setAttribute('viewBox', '0 0 7 7')
    marker.setAttribute('refX', '6')
    marker.setAttribute('refY', '3.5')
    marker.setAttribute('markerWidth', '7')
    marker.setAttribute('markerHeight', '7')
    marker.setAttribute('markerUnits', 'userSpaceOnUse')
    marker.setAttribute('orient', 'auto')
    const tip = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    tip.classList.add('checkpoint-arrowhead')
    if (kind === 'available') tip.classList.add('is-available')
    tip.setAttribute('d', 'M0 0L6 3.5L0 7Z')
    marker.append(tip)
    defs.append(marker)
  }
  graph.prepend(edges)
  const draw = (): void => {
    if (!graph.isConnected) return
    const bounds = graph.getBoundingClientRect()
    edges.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`)
    edges.setAttribute('width', String(bounds.width))
    edges.setAttribute('height', String(bounds.height))
    const segments: SVGElement[] = []
    for (const node of result.nodes) for (const dependency of node.after) {
      const from = cards.get(dependency)!.getBoundingClientRect()
      const to = cards.get(node.id)!.getBoundingClientRect()
      const x1 = from.left + from.width / 2 - bounds.left
      const y1 = from.bottom - bounds.top
      const x2 = to.left + to.width / 2 - bounds.left
      const y2 = to.top - bounds.top
      const mid = (y1 + y2) / 2
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.classList.add('checkpoint-edge', node.available ? 'is-available' : 'is-waiting')
      path.setAttribute('d', `M${x1} ${y1 + 4}V${mid}H${x2}V${y2 - 6}`)
      path.setAttribute('marker-end', `url(#checkpoint-arrow-${node.available ? 'available' : 'waiting'})`)
      segments.push(path)
      const port = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      port.classList.add('checkpoint-edge-port', node.available ? 'is-available' : 'is-waiting')
      port.setAttribute('cx', String(x1))
      port.setAttribute('cy', String(y1 + 4))
      port.setAttribute('r', '2.5')
      segments.push(port)
    }
    edges.replaceChildren(defs, ...segments)
  }
  requestAnimationFrame(() => {
    draw()
    if (!graph.isConnected || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(draw)
    observer.observe(graph)
    const parent = surface.parentElement
    if (!parent) return
    const removal = new MutationObserver(() => {
      if (!surface.isConnected) { observer.disconnect(); removal.disconnect() }
    })
    removal.observe(parent, { childList: true })
  })
  return surface
}

function checkpointCard(node: ResolvedCheckpointNode, labels: CheckpointLabels, options: {
  readOnly: boolean
  onSelect: (path: string) => void
  onSet: (path: string, status: DocumentStatus) => void
  onOpenView: () => void
}): HTMLElement {
  const card = el('article', 'checkpoint-card')
  if (!node.available) card.classList.add('is-waiting')
  else if (node.aggregate !== 'freeze') card.classList.add('is-frontier')
  const heading = el('div', 'checkpoint-card-heading')
  const aggregate = el('span', 'checkpoint-card-status')
  aggregate.append(createStatusIcon(node.aggregate, statusLabel(node.aggregate, labels)))
  heading.append(el('h2', '', node.title), aggregate)
  card.append(heading)
  for (const doc of node.documents) {
    const row = el('div', 'checkpoint-document')
    const filename = el('button', 'checkpoint-document-name', doc.path.split('/').at(-1)) as HTMLButtonElement
    filename.type = 'button'
    filename.title = doc.path
    filename.addEventListener('click', () => options.onSelect(doc.path))
    row.append(filename)
    if (doc.optional) row.append(createFileAttribute('optional', labels.checkpointOptional, 'checkpoint-document-attribute is-optional'))
    if (!doc.exists) {
      row.append(el('span', 'checkpoint-document-attribute', labels.checkpointMissingFile))
    } else {
      const status = el('button', 'checkpoint-document-status') as HTMLButtonElement
      status.type = 'button'
      const title = statusLabel(doc.status, labels)
      status.title = title
      status.setAttribute('aria-label', `${filename.textContent}: ${title}`)
      status.append(createStatusIcon(doc.status, title))
      status.addEventListener('click', () => openCheckpointStatusMenu(status, {
        path: doc.path,
        title: node.title,
        optional: doc.optional,
        status: doc.status,
        labels,
        readOnly: options.readOnly,
        onSet: (value) => options.onSet(doc.path, value),
        onOpenView: options.onOpenView,
      }))
      row.append(status)
    }
    card.append(row)
  }
  return card
}
