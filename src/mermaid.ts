import { sanitizeMermaidSvg } from './security.ts'
import { Document, isMap, isScalar, parseDocument, visit } from 'yaml'

const MERMAID_CDN_URL = 'https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.esm.min.mjs'

export const MERMAID_THEMES = [
  { id: 'redux', label: 'Redux' },
  { id: 'redux-color', label: 'Redux Color' },
  { id: 'neo', label: 'Neo' },
  { id: 'neutral', label: 'Neutral' },
  { id: 'default', label: 'Classic' },
  { id: 'forest', label: 'Forest' },
  { id: 'base', label: 'Base' },
  { id: 'dark', label: 'Dark' },
  { id: 'redux-dark', label: 'Redux Dark' },
  { id: 'redux-dark-color', label: 'Redux Dark Color' },
  { id: 'neo-dark', label: 'Neo Dark' },
] as const

export type MermaidTheme = (typeof MERMAID_THEMES)[number]['id']
export const isMermaidDarkTheme = (theme: MermaidTheme | string): boolean => /dark/i.test(theme)
export const defaultMermaidTheme = (): MermaidTheme =>
  document.documentElement.dataset.theme === 'dark' ? 'redux-dark' : 'redux'
export const mermaidThemeForAppearance = (theme: MermaidTheme, dark: boolean): MermaidTheme => {
  if (theme === 'neo' || theme === 'neo-dark') return dark ? 'neo-dark' : 'neo'
  if (theme === 'redux-color' || theme === 'redux-dark-color') return dark ? 'redux-dark-color' : 'redux-color'
  return dark ? 'redux-dark' : 'redux'
}

const configRegion = (source: string): { start: number; end: number; blockStart: number; blockEnd: number; yaml: string; frontmatter: boolean } | undefined => {
  const frontmatter = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source)
  if (frontmatter) {
    const start = frontmatter[0].indexOf('\n') + 1
    return { start, end: start + frontmatter[1].length, blockStart: 0, blockEnd: frontmatter[0].length, yaml: frontmatter[1], frontmatter: true }
  }
  const directive = /^[ \t]*%%\{[ \t]*(?:init|initialize)[ \t]*:[ \t]*([\s\S]*?)\}%%/m.exec(source)
  if (!directive) return undefined
  const start = directive.index + directive[0].indexOf(':') + 1
  return { start, end: directive.index + directive[0].length - 3, blockStart: directive.index, blockEnd: directive.index + directive[0].length, yaml: source.slice(start, directive.index + directive[0].length - 3), frontmatter: false }
}

const readConfig = (source: string) => {
  const region = configRegion(source)
  if (!region) return undefined
  const document = parseDocument(region.yaml, { uniqueKeys: true })
  if (document.errors.length || !isMap(document.contents)) return undefined
  let incomplete = false
  if (!region.frontmatter) visit(document, (_, node) => {
    if (isScalar(node) && node.value === null && !node.source) incomplete = true
  })
  if (incomplete) return undefined
  const path = region.frontmatter ? ['config'] : []
  if (region.frontmatter && document.has('config') && !isMap(document.get('config', true))) return undefined
  return { region, document, path }
}

export const extractMermaidThemeFromCode = (source: string): MermaidTheme | undefined => {
  const config = readConfig(source)
  const theme = config?.document.getIn([...config.path, 'theme'])
  return typeof theme === 'string' && MERMAID_THEMES.some((entry) => entry.id === theme) ? theme as MermaidTheme : undefined
}

export const MERMAID_DIRECTIONS = [
  { id: 'TB', label: 'TB (Top to Bottom)' },
  { id: 'BT', label: 'BT (Bottom to Top)' },
  { id: 'LR', label: 'LR (Left to Right)' },
  { id: 'RL', label: 'RL (Right to Left)' },
] as const

export type MermaidDirection = (typeof MERMAID_DIRECTIONS)[number]['id']

const diagramHeader = (source: string): { kind: string; start: number; end: number; text: string } | undefined => {
  const masked = source
    .replace(/^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, (text) => text.replace(/[^\r\n]/g, ' '))
    .replace(/%%\{[\s\S]*?\}%%/g, (text) => text.replace(/[^\r\n]/g, ' '))
    .replace(/%%[^\r\n]*/g, (text) => ' '.repeat(text.length))
  const first = /^[ \t]*\S[^\r\n]*/m.exec(masked)
  if (!first) return undefined
  const kind = /^[ \t]*(flowchart|graph|classDiagram|stateDiagram(?:-v2)?)(?=[ \t;]|$)/.exec(first[0])?.[1]
  return kind ? { kind, start: first.index, end: first.index + first[0].length, text: source.slice(first.index, first.index + first[0].length) } : undefined
}

export const isMermaidDirectionSupported = (source: string): boolean => diagramHeader(source) !== undefined

const outerDirection = (source: string, start: number): { start: number; value: string } | undefined => {
  let depth = 0
  let offset = start
  for (const line of source.slice(start).split('\n')) {
    const clean = line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '').replace(/%%.*$/, '')
    const match = /^[ \t]*direction[ \t]+(TB|TD|BT|LR|RL)\b/.exec(clean)
    if (depth === 0 && match) return { start: offset + match[0].lastIndexOf(match[1]), value: match[1] }
    for (const character of clean) {
      if (character === '{') depth += 1
      else if (character === '}') depth = Math.max(0, depth - 1)
    }
    offset += line.length + 1
  }
  return undefined
}

export const extractMermaidDirectionFromCode = (source: string): MermaidDirection => {
  const header = diagramHeader(source)
  if (!header) return 'TB'
  const value = /^(?:flowchart|graph)$/.test(header.kind)
    ? /^[ \t]*(?:flowchart|graph)[ \t]+(TB|TD|BT|LR|RL)\b/.exec(header.text)?.[1]
    : outerDirection(source, header.end)?.value
  return !value || value === 'TD' ? 'TB' : value as MermaidDirection
}

export const updateMermaidDirection = (source: string, direction: MermaidDirection): string => {
  const header = diagramHeader(source)
  if (!header) return source
  if (/^(?:flowchart|graph)$/.test(header.kind)) {
    const text = /^[ \t]*(?:flowchart|graph)[ \t]+(?:TB|TD|BT|LR|RL)\b/.test(header.text)
      ? header.text.replace(/^([ \t]*(?:flowchart|graph)[ \t]+)(?:TB|TD|BT|LR|RL)\b/, (_, prefix: string) => prefix + direction)
      : header.text.replace(/^([ \t]*(?:flowchart|graph))/, (_, prefix: string) => `${prefix} ${direction}`)
    return source.slice(0, header.start) + text + source.slice(header.end)
  }
  const current = outerDirection(source, header.end)
  if (current) return source.slice(0, current.start) + direction + source.slice(current.start + current.value.length)
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  return source.slice(0, header.end) + newline + `  direction ${direction}` + source.slice(header.end)
}

const writeConfig = (source: string, theme: MermaidTheme, replaceTheme: boolean): string => {
  const existing = configRegion(source)
  const config = readConfig(source)
  if (existing && !config) return source
  if (!config) {
    if (/%%\{[ \t]*(?:init|initialize)\s*:/.test(source)) return source
    return `---\nconfig:\n  layout: elk\n  theme: ${theme}\n---\n${source}`
  }
  const { document, path, region } = config
  let changed = false
  if (!document.hasIn([...path, 'layout'])) {
    document.setIn([...path, 'layout'], 'elk')
    changed = true
  }
  if (replaceTheme || !document.hasIn([...path, 'theme'])) {
    if (document.getIn([...path, 'theme']) !== theme) {
      document.setIn([...path, 'theme'], theme)
      changed = true
    }
  }
  if (!region.frontmatter) {
    const frontmatter = new Document({ config: document.toJS() }).toString()
    const body = source.slice(0, region.blockStart) + source.slice(region.blockEnd).replace(/^\r?\n/, '')
    return `---\n${frontmatter}---\n${body}`
  }
  if (!changed) return source
  const serialized = document.toString().trimEnd()
  return source.slice(0, region.start) + serialized + source.slice(region.end)
}

export const ensureMermaidConfig = (source: string, defaultTheme: MermaidTheme = defaultMermaidTheme()): string =>
  writeConfig(source, defaultTheme, false)

export const updateMermaidCodeTheme = (source: string, theme: MermaidTheme): string =>
  writeConfig(source, theme, true)
export interface MermaidApi {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, source: string) => Promise<{ svg: string }>
  mermaidAPI?: { getConfig: () => { themeVariables?: Record<string, unknown> } }
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
  direction?: string
  codePanel?: string
  liveUpdate?: string
  updateDiagram?: string
  lineComment?: string
  nodeComment?: string
}

export interface MermaidEdgeInfo {
  from: string
  to: string
  line: number
}

export interface MermaidLineMap {
  lineToNodes: Map<number, string[]>
  nodeToLines: Map<string, number[]>
  nodeLabels: Map<string, string>
  edges: MermaidEdgeInfo[]
}

export const parseMermaidLineMap = (source: string): MermaidLineMap => {
  const lines = source.split('\n')
  const lineToNodes = new Map<number, string[]>()
  const nodeToLines = new Map<string, number[]>()
  const nodeLabels = new Map<string, string>()
  const edges: MermaidEdgeInfo[] = []

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
      const fromId = match[1]
      const toId = match[2]
      if (!['subgraph', 'direction', 'end'].includes(fromId)) matchedNodes.add(fromId)
      if (!['subgraph', 'direction', 'end'].includes(toId)) matchedNodes.add(toId)
      if (!['subgraph', 'direction', 'end'].includes(fromId) && !['subgraph', 'direction', 'end'].includes(toId)) {
        edges.push({ from: fromId, to: toId, line: lineNum })
      }
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

  return { lineToNodes, nodeToLines, nodeLabels, edges }
}

export interface MermaidRenderOptions {
  theme?: MermaidTheme
  onNodeClick?: (nodeId: string, nodeLabel: string, event: MouseEvent) => void
  onEdgeClick?: (from: string, to: string, line: number | undefined, event: MouseEvent) => void
  onNodeHover?: (nodeId: string | null) => void
  onThemeChange?: (theme: MermaidTheme) => void
  onRendered?: () => void
}

export interface MermaidPreviewElement extends HTMLElement {
  highlightNode: (nodeId: string | null) => void
  focusNode: (nodeId: string | null) => void
  focusEdge: (edgeId: string | null, fromNodeId?: string | null, toNodeId?: string | null) => void
  getMermaidTheme: () => MermaidTheme
  updateCode: (source: string) => void
  setTheme: (theme: MermaidTheme) => void
}
let diagramSerial = 0

type ApplyPreview = (preview: HTMLElement) => void
type MermaidFailure = (error?: unknown) => void

const cssToken = (styles: CSSStyleDeclaration, name: string, fallback: string): string =>
  styles.getPropertyValue(name).trim() || fallback


const resolveLook = (theme: MermaidTheme): 'neo' | 'classic' =>
  /^(redux|neo)/.test(theme) ? 'neo' : 'classic'

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

export const focusEdge = (host: HTMLElement, edgeSelector: string | null, fromNodeId?: string | null, toNodeId?: string | null): void => {
  const allEdges = host.querySelectorAll<SVGElement>('.interactive-mermaid-edge, .flowchart-link, path.relation')
  allEdges.forEach((edge) => {
    if (!edgeSelector) {
      edge.classList.remove('is-edge-active')
    } else if (edge.getAttribute('data-edge-id') === edgeSelector || edge.id === edgeSelector) {
      edge.classList.add('is-edge-active')
    } else {
      edge.classList.remove('is-edge-active')
    }
  })
  const allNodes = host.querySelectorAll<SVGElement>('.interactive-mermaid-node')
  allNodes.forEach((node) => {
    const id = node.getAttribute('data-node-id')
    if (fromNodeId && (id === fromNodeId || id === toNodeId)) {
      node.classList.add('is-node-endpoint')
    } else {
      node.classList.remove('is-node-endpoint')
    }
  })
}
const bindSvgNodeInteractions = (
  svgRoot: SVGSVGElement,
  lineMap: MermaidLineMap,
  host: HTMLElement,
  options?: MermaidRenderOptions,
  themeVariables?: Record<string, unknown>,
): void => {
  svgRoot.addEventListener('mousedown', (event) => {
    if ((event.target as Element).closest('.interactive-mermaid-node, .interactive-mermaid-edge, .mermaid-edge-hit-area')) event.preventDefault()
  })
  const nodeElements = Array.from(svgRoot.querySelectorAll<SVGGElement>('.node, .classGroup, g.node'))
  const borders = themeVariables?.borderColorArray
  const backgrounds = themeVariables?.bkgColorArray
  const colorTheme = /^(?:redux-color|redux-dark-color)$/.test(host.dataset.mermaidTheme ?? '')
  let paletteIndex = 0
  for (const nodeEl of nodeElements) {
    if (colorTheme && Array.isArray(borders) && borders.length) {
      const nativeIndex = /^color-(\d+)$/.exec(nodeEl.getAttribute('data-color-id') ?? '')?.[1]
      const index = nativeIndex === undefined ? paletteIndex++ % borders.length : Number(nativeIndex) % borders.length
      const border = borders[index]
      const background = Array.isArray(backgrounds) ? backgrounds[index] : undefined
      if (typeof border === 'string') {
        nodeEl.querySelectorAll<SVGElement>('rect, polygon, circle, ellipse, path.outer-path').forEach((shape) => {
          if (!shape.style.stroke) shape.style.stroke = border.trim()
          if (!shape.style.fill) shape.style.fill = typeof background === 'string'
            ? background
            : `color-mix(in srgb, ${border.trim()} 18%, ${typeof themeVariables?.background === 'string' ? themeVariables.background : '#111113'})`
        })
      }
    }
    const shape = nodeEl.querySelector<SVGElement>('rect, polygon, circle, ellipse, path')
    if (shape) {
      const color = getComputedStyle(shape).stroke
      if (color && color !== 'none') nodeEl.style.setProperty('--mermaid-node-color', color)
    }
    const rawId = nodeEl.id.replace(/^taco-mermaid-\d+-/, '')
    const candidate = rawId.match(/^(?:flowchart|classId|state)-(.+)-\d+$/)?.[1] ?? rawId
    const matchedId = candidate || undefined

    if (matchedId) {
      nodeEl.setAttribute('data-node-id', matchedId)
      nodeEl.classList.add('interactive-mermaid-node')

      const finalId = matchedId
      const finalLabel = lineMap.nodeLabels.get(finalId) || finalId
      nodeEl.setAttribute('tabindex', '0')
      nodeEl.setAttribute('role', 'button')
      nodeEl.setAttribute('aria-label', finalLabel)
      nodeEl.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        nodeEl.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

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

  const edgeElements = Array.from(svgRoot.querySelectorAll<SVGElement>('path.flowchart-link, path.relation, .edgePath path'))
  const nodeIds = nodeElements.map((node) => node.getAttribute('data-node-id')).filter((id): id is string => !!id)
  const nodeIdSet = new Set(nodeIds)
  for (const edgeEl of edgeElements) {
    const rawEdgeId = edgeEl.id
    const pair = rawEdgeId.replace(/^taco-mermaid-\d+-/, '').replace(/^(?:L|id)_/, '').replace(/_\d+$/, '')
    const candidates = nodeIds.flatMap((from) => {
      if (!pair.startsWith(`${from}_`)) return []
      const to = pair.slice(from.length + 1)
      return nodeIdSet.has(to) ? [{ from, to }] : []
    })
    const endpoints = candidates.find(({ from, to }) => lineMap.edges.some((edge) => edge.from === from && edge.to === to)) ?? (candidates.length === 1 ? candidates[0] : undefined)
    const fromNode = endpoints?.from ?? ''
    const toNode = endpoints?.to ?? ''
    const matchedEdge = lineMap.edges.find((edge) => edge.from === fromNode && edge.to === toNode)
    edgeEl.setAttribute('data-edge-id', rawEdgeId)
    edgeEl.setAttribute('aria-label', `${lineMap.nodeLabels.get(fromNode) || fromNode} → ${lineMap.nodeLabels.get(toNode) || toNode}`)
    edgeEl.classList.add('interactive-mermaid-edge')
    edgeEl.setAttribute('role', 'button')
    edgeEl.setAttribute('tabindex', '0')
    edgeEl.style.cursor = 'pointer'
    edgeEl.style.setProperty('--mermaid-edge-color', getComputedStyle(edgeEl).stroke)
    const activate = (event: MouseEvent): void => {
      event.stopPropagation()
      focusNode(host, null)
      focusEdge(host, rawEdgeId, fromNode, toNode)
      options?.onEdgeClick?.(fromNode, toNode, matchedEdge?.line, event)
    }
    edgeEl.addEventListener('click', activate)
    edgeEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      edgeEl.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const hitArea = edgeEl.cloneNode(false) as SVGElement
    hitArea.removeAttribute('id')
    hitArea.removeAttribute('data-edge-id')
    hitArea.removeAttribute('role')
    hitArea.removeAttribute('tabindex')
    hitArea.removeAttribute('aria-label')
    hitArea.setAttribute('aria-hidden', 'true')
    hitArea.setAttribute('class', 'mermaid-edge-hit-area')
    hitArea.removeAttribute('marker-start')
    hitArea.removeAttribute('marker-end')
    hitArea.style.setProperty('stroke', 'transparent', 'important')
    hitArea.style.setProperty('stroke-width', '14px', 'important')
    hitArea.style.setProperty('fill', 'none', 'important')
    hitArea.style.pointerEvents = 'stroke'
    hitArea.addEventListener('click', activate)
    hitArea.addEventListener('mouseenter', () => edgeEl.classList.add('is-edge-hovered'))
    hitArea.addEventListener('mouseleave', () => edgeEl.classList.remove('is-edge-hovered'))
    edgeEl.before(hitArea)
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
  const explicitTheme = extractMermaidThemeFromCode(source)
  const currentTheme = options?.theme ?? explicitTheme ?? defaultMermaidTheme()
  const id = `taco-mermaid-${++diagramSerial}`
  surface.className = 'surface is-loading'
  surface.textContent = labels.loading
  surface.dataset.renderId = id

  const draw = async (): Promise<void> => {
    if (surface.dataset.renderId !== id) return
    let mermaid: MermaidApi
    try {
      mermaid = await runtime.load()
    } catch (error) {
      if (surface.dataset.renderId !== id) return
      host.dataset.mermaidUnavailable = 'true'
      onUnavailable?.(error)
      return
    }

    const isDark = isMermaidDarkTheme(currentTheme)
    const effectiveLook = resolveLook(currentTheme)
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      layout: 'elk',
      look: effectiveLook,
      theme: currentTheme,
      htmlLabels: false,
      fontFamily: cssToken(
        typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : {} as CSSStyleDeclaration,
        '--sans',
        'ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif',
      ),
      flowchart: { curve: 'basis' },
    })
    try {
      const renderSource = explicitTheme && explicitTheme !== currentTheme ? updateMermaidCodeTheme(source, currentTheme) : source
      const { svg } = await mermaid.render(id, renderSource)
      if (surface.dataset.renderId !== id) return
      surface.className = 'surface'
      surface.innerHTML = sanitizeMermaidSvg(svg)
      host.dataset.mermaidTheme = currentTheme
      host.dataset.mermaidLook = effectiveLook
      host.dataset.mermaidDark = String(isDark)

      const lineMap = parseMermaidLineMap(source)
      const svgRoot = surface.querySelector('svg')
      if (svgRoot) {
        bindSvgNodeInteractions(svgRoot, lineMap, host, options, mermaid.mermaidAPI?.getConfig().themeVariables)
      }
      options?.onRendered?.()
    } catch (error) {
      if (surface.dataset.renderId !== id) return
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
  host.setAttribute('role', 'group')
  host.setAttribute('aria-label', labels.previewTitle || 'Mermaid diagram')

  const defaultTheme = options?.theme ?? defaultMermaidTheme()
  let activeTheme = extractMermaidThemeFromCode(source) ?? defaultTheme
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
  host.focusEdge = (edgeId: string | null, fromNodeId?: string | null, toNodeId?: string | null) => focusEdge(host, edgeId, fromNodeId, toNodeId)
  host.getMermaidTheme = () => activeTheme
  host.setTheme = (theme) => {
    if (theme === activeTheme) return
    redraw(theme)
  }
  host.updateCode = (nextSource) => {
    if (source === nextSource) return
    source = nextSource
    const nextTheme = extractMermaidThemeFromCode(nextSource) ?? defaultTheme
    if (nextTheme !== activeTheme) {
      activeTheme = nextTheme
      options?.onThemeChange?.(nextTheme)
    }
    redraw(activeTheme)
  }

  return host
}

export { MERMAID_CDN_URL }
