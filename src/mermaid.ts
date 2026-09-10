import { sanitizeMermaidSvg } from './security.ts'

const MERMAID_CDN_URL = 'https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.esm.min.mjs'

export const MERMAID_THEMES = [
  { id: 'redux', label: 'Redux' },
  { id: 'redux-color', label: 'Redux Color' },
  { id: 'neo', label: 'Neo' },
  { id: 'neutral', label: 'Neutral' },
  { id: 'default', label: 'Classic' },
] as const

export type MermaidTheme = (typeof MERMAID_THEMES)[number]['id']

export interface MermaidApi {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, source: string) => Promise<{ svg: string }>
}

interface MermaidModule {
  default: MermaidApi
}

export type MermaidLoader = () => Promise<MermaidApi>

const defaultMermaidLoader: MermaidLoader = () => import(/* @vite-ignore */ MERMAID_CDN_URL)
  .then((module) => (module as MermaidModule).default)

export class MermaidRuntime {
  private mermaidPromise: Promise<MermaidApi> | undefined
  private renderQueue = Promise.resolve()

  constructor(private readonly loader: MermaidLoader = defaultMermaidLoader) {}

  load(): Promise<MermaidApi> {
    this.mermaidPromise ??= this.loader().catch((error) => {
      this.mermaidPromise = undefined
      throw error
    })
    return this.mermaidPromise
  }

  enqueue(draw: () => Promise<void>): void {
    this.renderQueue = this.renderQueue.then(draw, draw)
  }
}

const defaultMermaidRuntime = new MermaidRuntime()

export interface MermaidPluginLabels {
  source: string
  hidePreview: string
  zoom: string
  zoomIn: string
  zoomOut: string
  resetZoom: string
  zoomLevel: string
  close: string
  previewTitle: string
  copy: string
  copied: string
  copyFailed: string
  comment: string
  auto: string
  plainText: string
  loading: string
  error: string
  theme?: string
  codePanel?: string
  lineComment?: string
  nodeComment?: string
}

export interface MermaidLineMap {
  lineToNodes: Map<number, string[]>
  nodeToLines: Map<string, number[]>
  nodeLabels: Map<string, string>
}

export const parseMermaidLineMap = (source: string): MermaidLineMap => {
  const lines = source.split('\n')
  const lineToNodes = new Map<number, string[]>()
  const nodeToLines = new Map<string, number[]>()
  const nodeLabels = new Map<string, string>()

  const nodeDefRegex = /\b([a-zA-Z0-9_-]+)\s*(?:\[\[?([^[\]]+)\]?\]|\(\(?([^()]+)\)?\)|\{\{?([^{}]+)\}?\}|\[\/([^[\]]+)\/\])/g
  const linkRegex = /\b([a-zA-Z0-9_-]+)\s*(?:-->|---|--|-\.->|==>|--\s*>\s*)\s*(?:\|[^|]*\|\s*)?([a-zA-Z0-9_-]+)\b/g
  const classDefRegex = /class\s+([a-zA-Z0-9_-]+)/g
  const seqParticipantRegex = /(?:participant|actor)\s+([a-zA-Z0-9_-]+)(?:\s+as\s+["']?([^"'\n]+)["']?)?/g
  const seqMsgRegex = /\b([a-zA-Z0-9_-]+)\s*(?:->>|-->>|->|-->)\s*([a-zA-Z0-9_-]+)\s*:/g

  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1
    const trimmed = lineText.trim()
    if (!trimmed || trimmed.startsWith('%%') || trimmed.startsWith('---')) return

    const matchedNodes = new Set<string>()

    let match: RegExpExecArray | null
    nodeDefRegex.lastIndex = 0
    while ((match = nodeDefRegex.exec(lineText)) !== null) {
      const id = match[1]
      const label = match[2] || match[3] || match[4] || match[5] || id
      matchedNodes.add(id)
      if (!nodeLabels.has(id)) nodeLabels.set(id, label.replace(/^["'\s]+|["'\s]+$/g, '').replace(/<[^>]*>/g, ''))
    }

    linkRegex.lastIndex = 0
    while ((match = linkRegex.exec(lineText)) !== null) {
      if (!['subgraph', 'direction', 'end'].includes(match[1])) matchedNodes.add(match[1])
      if (!['subgraph', 'direction', 'end'].includes(match[2])) matchedNodes.add(match[2])
    }

    classDefRegex.lastIndex = 0
    while ((match = classDefRegex.exec(lineText)) !== null) {
      matchedNodes.add(match[1])
    }

    seqParticipantRegex.lastIndex = 0
    while ((match = seqParticipantRegex.exec(lineText)) !== null) {
      const id = match[1]
      const label = match[2] || id
      matchedNodes.add(id)
      if (!nodeLabels.has(id)) nodeLabels.set(id, label.trim())
    }

    seqMsgRegex.lastIndex = 0
    while ((match = seqMsgRegex.exec(lineText)) !== null) {
      matchedNodes.add(match[1])
      matchedNodes.add(match[2])
    }

    if (matchedNodes.size > 0) {
      lineToNodes.set(lineNum, Array.from(matchedNodes))
      for (const id of matchedNodes) {
        if (!nodeToLines.has(id)) nodeToLines.set(id, [])
        nodeToLines.get(id)!.push(lineNum)
      }
    }
  })

  return { lineToNodes, nodeToLines, nodeLabels }
}

export interface MermaidRenderOptions {
  theme?: MermaidTheme
  onNodeClick?: (nodeId: string, nodeLabel: string, event: MouseEvent) => void
  onNodeHover?: (nodeId: string | null) => void
  onThemeChange?: (theme: MermaidTheme) => void
}

export interface MermaidPreviewElement extends HTMLElement {
  highlightNode: (nodeId: string | null) => void
  focusNode: (nodeId: string | null) => void
  setMermaidTheme: (theme: MermaidTheme) => void
  getMermaidTheme: () => MermaidTheme
}

let diagramSerial = 0

type ApplyPreview = (preview: HTMLElement) => void
type MermaidFailure = (error?: unknown) => void

const cssToken = (styles: CSSStyleDeclaration, name: string, fallback: string): string =>
  styles.getPropertyValue(name).trim() || fallback

const resolveEffectiveTheme = (theme: MermaidTheme, dark: boolean): string => {
  if (theme === 'redux') return dark ? 'redux-dark' : 'redux'
  if (theme === 'redux-color') return dark ? 'redux-dark-color' : 'redux-color'
  if (theme === 'neo') return dark ? 'neo-dark' : 'neo'
  if (theme === 'default') return dark ? 'dark' : 'default'
  if (theme === 'neutral') return 'neutral'
  return theme
}

const resolveLook = (theme: MermaidTheme): 'neo' | 'classic' =>
  ['redux', 'redux-color', 'neo'].includes(theme) ? 'neo' : 'classic'

export const highlightNode = (host: HTMLElement, nodeId: string | null): void => {
  const allNodes = host.querySelectorAll<SVGElement>('.interactive-mermaid-node')
  allNodes.forEach((node) => {
    if (!nodeId) {
      node.classList.remove('is-node-hovered')
    } else if (node.getAttribute('data-node-id') === nodeId) {
      node.classList.add('is-node-hovered')
    } else {
      node.classList.remove('is-node-hovered')
    }
  })
}

export const focusNode = (host: HTMLElement, nodeId: string | null): void => {
  const allNodes = host.querySelectorAll<SVGElement>('.interactive-mermaid-node')
  allNodes.forEach((node) => {
    if (!nodeId) {
      node.classList.remove('is-node-active')
    } else if (node.getAttribute('data-node-id') === nodeId) {
      node.classList.add('is-node-active')
      node.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    } else {
      node.classList.remove('is-node-active')
    }
  })
}

const bindSvgNodeInteractions = (
  svgRoot: SVGSVGElement,
  lineMap: MermaidLineMap,
  host: HTMLElement,
  options?: MermaidRenderOptions,
): void => {
  const nodeElements = Array.from(svgRoot.querySelectorAll<SVGGElement>('.node, .classGroup, g.node'))
  for (const nodeEl of nodeElements) {
    const rawId = nodeEl.id || ''
    let matchedId: string | null = null
    const flowMatch = rawId.match(/(?:flowchart|classId|state)-([A-Za-z0-9_-]+)(?:-\d+)?$/)
    if (flowMatch && lineMap.nodeToLines.has(flowMatch[1])) {
      matchedId = flowMatch[1]
    } else {
      for (const candidate of lineMap.nodeToLines.keys()) {
        if (rawId.includes(candidate)) {
          matchedId = candidate
          break
        }
      }
    }

    if (!matchedId) {
      const text = nodeEl.textContent?.trim() || ''
      for (const [id, label] of lineMap.nodeLabels.entries()) {
        if (text === label || text.includes(label)) {
          matchedId = id
          break
        }
      }
    }

    if (matchedId) {
      nodeEl.setAttribute('data-node-id', matchedId)
      nodeEl.classList.add('interactive-mermaid-node')

      const finalId = matchedId
      const finalLabel = lineMap.nodeLabels.get(finalId) || finalId

      nodeEl.addEventListener('mouseenter', () => {
        highlightNode(host, finalId)
        options?.onNodeHover?.(finalId)
      })

      nodeEl.addEventListener('mouseleave', () => {
        highlightNode(host, null)
        options?.onNodeHover?.(null)
      })

      nodeEl.addEventListener('click', (event) => {
        event.stopPropagation()
        options?.onNodeClick?.(finalId, finalLabel, event)
      })
    }
  }
}

const renderDiagram = (
  host: HTMLElement,
  surface: HTMLElement,
  source: string,
  labels: MermaidPluginLabels,
  applyPreview?: ApplyPreview,
  onUnavailable?: MermaidFailure,
  runtime: MermaidRuntime = defaultMermaidRuntime,
  onRenderError?: MermaidFailure,
  options?: MermaidRenderOptions,
): void => {
  const currentTheme = options?.theme ?? 'redux'
  const id = `taco-mermaid-${++diagramSerial}`
  surface.className = 'surface is-loading'
  surface.textContent = labels.loading

  const draw = async (): Promise<void> => {
    let mermaid: MermaidApi
    try {
      mermaid = await runtime.load()
    } catch (error) {
      host.dataset.mermaidUnavailable = 'true'
      onUnavailable?.(error)
      return
    }

    const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    const effectiveTheme = resolveEffectiveTheme(currentTheme, dark)
    const effectiveLook = resolveLook(currentTheme)

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      layout: 'elk',
      look: effectiveLook,
      theme: effectiveTheme,
      htmlLabels: false,
      fontFamily: cssToken(
        typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : {} as CSSStyleDeclaration,
        '--sans',
        'ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif',
      ),
      flowchart: { curve: 'basis' },
    })
    try {
      const { svg } = await mermaid.render(id, source)
      surface.className = 'surface'
      surface.innerHTML = sanitizeMermaidSvg(svg)
      host.dataset.mermaidTheme = currentTheme
      host.dataset.mermaidLook = effectiveLook

      const lineMap = parseMermaidLineMap(source)
      const svgRoot = surface.querySelector('svg')
      if (svgRoot) {
        bindSvgNodeInteractions(svgRoot, lineMap, host, options)
      }
    } catch (error) {
      surface.className = 'surface is-error'
      surface.textContent = labels.error
      onRenderError?.(error)
    }
    applyPreview?.(host.cloneNode(true) as HTMLElement)
  }

  runtime.enqueue(draw)
}

export const createMermaidPreview = (
  source: string,
  labels: MermaidPluginLabels,
  applyPreview?: ApplyPreview,
  onUnavailable?: MermaidFailure,
  runtime: MermaidRuntime = defaultMermaidRuntime,
  onRenderError?: MermaidFailure,
  options?: MermaidRenderOptions,
): MermaidPreviewElement => {
  const host = document.createElement('div') as unknown as MermaidPreviewElement
  host.className = 'taco-mermaid-render'
  host.setAttribute('role', 'img')
  host.setAttribute('aria-label', labels.previewTitle || 'Mermaid diagram')

  let activeTheme = options?.theme ?? 'redux'

  const surface = document.createElement('div')
  surface.className = 'surface'
  host.append(surface)

  const redraw = (newTheme = activeTheme) => {
    activeTheme = newTheme
    renderDiagram(
      host,
      surface,
      source,
      labels,
      applyPreview,
      onUnavailable,
      runtime,
      onRenderError,
      { ...options, theme: activeTheme },
    )
  }

  redraw(activeTheme)

  host.highlightNode = (nodeId: string | null) => highlightNode(host, nodeId)
  host.focusNode = (nodeId: string | null) => focusNode(host, nodeId)
  host.setMermaidTheme = (newTheme: MermaidTheme) => {
    if (newTheme !== activeTheme) {
      redraw(newTheme)
      options?.onThemeChange?.(newTheme)
    }
  }
  host.getMermaidTheme = () => activeTheme

  return host
}

export { MERMAID_CDN_URL }
