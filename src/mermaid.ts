import { sanitizeMermaidSvg } from './security.ts'

const MERMAID_CDN_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.esm.min.mjs'

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
}

let diagramSerial = 0

type ApplyPreview = (preview: HTMLElement) => void
type MermaidFailure = (error?: unknown) => void

const cssToken = (styles: CSSStyleDeclaration, name: string, fallback: string): string =>
  styles.getPropertyValue(name).trim() || fallback

const diagramTheme = (): { theme: 'base'; themeVariables: Record<string, string | boolean> } => {
  const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  const styles = typeof getComputedStyle === 'function'
    ? getComputedStyle(document.documentElement)
    : {} as CSSStyleDeclaration
  const fallback = dark ? {
    paper: '#171717', surface: '#1c1c1c', soft: '#222222', ink: '#f5f5f5',
    muted: '#d4d4d4', subtle: '#a3a3a3', accent: '#3ecf8e', accentSoft: '#173b2b',
  } : {
    paper: '#ffffff', surface: '#ffffff', soft: '#f7f7f7', ink: '#111111',
    muted: '#3f3f3f', subtle: '#666666', accent: '#3ecf8e', accentSoft: '#e6f8ef',
  }
  const paper = cssToken(styles, '--paper', fallback.paper)
  const surface = cssToken(styles, '--surface', fallback.surface)
  const soft = cssToken(styles, '--doc-soft', fallback.soft)
  const ink = cssToken(styles, '--doc-ink', fallback.ink)
  const muted = cssToken(styles, '--doc-muted', fallback.muted)
  const subtle = cssToken(styles, '--doc-subtle', fallback.subtle)
  const accent = cssToken(styles, '--accent', fallback.accent)
  const accentSoft = cssToken(styles, '--accent-soft', fallback.accentSoft)

  return {
    theme: 'base',
    themeVariables: {
      darkMode: dark,
      background: paper,
      primaryColor: soft,
      primaryTextColor: ink,
      primaryBorderColor: accent,
      lineColor: subtle,
      secondaryColor: accentSoft,
      tertiaryColor: surface,
      noteBkgColor: accentSoft,
      noteBorderColor: accent,
      noteTextColor: ink,
      actorBkg: soft,
      actorBorder: accent,
      actorTextColor: ink,
      signalColor: muted,
      signalTextColor: ink,
    },
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
): void => {
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

    const { theme, themeVariables } = diagramTheme()
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme,
      themeVariables,
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
): HTMLElement => {
  const host = document.createElement('div')
  host.className = 'taco-mermaid-render'
  host.setAttribute('role', 'img')
  host.setAttribute('aria-label', 'Mermaid diagram')

  const surface = document.createElement('div')
  surface.className = 'surface'
  host.append(surface)
  renderDiagram(host, surface, source, labels, applyPreview, onUnavailable, runtime, onRenderError)
  return host
}

export { MERMAID_CDN_URL }
