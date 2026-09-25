import type { MermaidApi } from './mermaid.ts'
import type { RichEditorAdapter } from './rich-editor.ts'
import type { SourceHighlighter, SourceLanguage } from './source-editor.ts'

export const PINNED_VERSIONS = {
  tiptap: '3.29.2',
  lowlight: '3.3.0',
  highlight: '11.11.1',
  marked: '18.0.9',
  yaml: '2.9.0',
  dompurify: '3.4.13',
  mermaid: '12.0.0',
} as const

export type CdnProvider = 'jsdelivr' | 'esm_sh'

export const CDN_URLS = {
  jsdelivr: {
    mermaid: `https://cdn.jsdelivr.net/npm/mermaid@${PINNED_VERSIONS.mermaid}/dist/mermaid.esm.min.mjs`,
    lowlight: `https://cdn.jsdelivr.net/npm/lowlight@${PINNED_VERSIONS.lowlight}/lib/index.js/+esm`,
    json: `https://cdn.jsdelivr.net/npm/highlight.js@${PINNED_VERSIONS.highlight}/lib/languages/json.js/+esm`,
    yaml: `https://cdn.jsdelivr.net/npm/highlight.js@${PINNED_VERSIONS.highlight}/lib/languages/yaml.js/+esm`,
  },
  esm_sh: {
    mermaid: `https://esm.sh/mermaid@${PINNED_VERSIONS.mermaid}`,
    lowlight: `https://esm.sh/lowlight@${PINNED_VERSIONS.lowlight}/lib/index.js`,
    json: `https://esm.sh/highlight.js@${PINNED_VERSIONS.highlight}/lib/languages/json`,
    yaml: `https://esm.sh/highlight.js@${PINNED_VERSIONS.highlight}/lib/languages/yaml`,
  },
} as const

export function loadWithHedging<T>(
  loadCandidate: (provider: CdnProvider) => Promise<T>,
  timeoutMs = 8000,
  hedgeDelayMs = 750,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let failures = 0
    const deadlines: ReturnType<typeof setTimeout>[] = []
    const hedge = setTimeout(() => start('esm_sh'), hedgeDelayMs)

    const finish = (result: T): void => {
      if (settled) return
      settled = true
      clearTimeout(hedge)
      for (const deadline of deadlines) clearTimeout(deadline)
      resolve(result)
    }

    let secondaryStarted = false
    const fail = (provider: CdnProvider, reason: unknown): void => {
      if (settled) return
      failures += 1
      if (provider === 'jsdelivr' && !secondaryStarted) {
        clearTimeout(hedge)
        start('esm_sh')
      }
      if (failures === 2) {
        settled = true
        clearTimeout(hedge)
        for (const deadline of deadlines) clearTimeout(deadline)
        reject(reason instanceof Error ? reason : new Error(String(reason)))
      }
    }

    const start = (provider: CdnProvider): void => {
      if (settled || (provider === 'esm_sh' && secondaryStarted)) return
      if (provider === 'esm_sh') secondaryStarted = true
      let finished = false
      const deadline = setTimeout(() => {
        if (finished || settled) return
        finished = true
        fail(provider, new Error(`Timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      deadlines.push(deadline)
      Promise.resolve().then(() => loadCandidate(provider)).then(
        (result) => {
          if (finished) return
          finished = true
          clearTimeout(deadline)
          finish(result)
        },
        (error: unknown) => {
          if (finished) return
          finished = true
          clearTimeout(deadline)
          fail(provider, error)
        },
      )
    }

    start('jsdelivr')
  })
}

export const loadLiteMermaid = (): Promise<MermaidApi> => {
  return loadWithHedging(async (provider) => {
    const url = CDN_URLS[provider].mermaid
    const mod = await import(/* @vite-ignore */ url)
    const api = mod.default ?? mod
    if (!api || typeof api.render !== 'function') throw new Error('Invalid Mermaid API from CDN')
    return api
  })
}

interface HighlightNode {
  type: string
  value?: string
  tagName?: string
  properties?: { className?: string | string[] }
  children?: HighlightNode[]
}

const appendHighlightNode = (parent: Node, node: HighlightNode): void => {
  if (node.type === 'text') {
    parent.appendChild(document.createTextNode(node.value ?? ''))
    return
  }
  if (node.type !== 'element' || !node.tagName) return

  const element = document.createElement(node.tagName)
  const className = node.properties?.className
  if (className) element.className = Array.isArray(className) ? className.join(' ') : className
  for (const child of node.children ?? []) appendHighlightNode(element, child)
  parent.appendChild(element)
}

export const loadLiteHighlighter = (): Promise<SourceHighlighter> => {
  return loadWithHedging(async (provider) => {
    const urls = CDN_URLS[provider]
    const [lowlightMod, jsonMod, yamlMod] = await Promise.all([
      import(/* @vite-ignore */ urls.lowlight),
      import(/* @vite-ignore */ urls.json),
      import(/* @vite-ignore */ urls.yaml),
    ])

    const createLowlight = lowlightMod.createLowlight ?? lowlightMod.default?.createLowlight
    if (typeof createLowlight !== 'function') throw new Error('createLowlight not found in lowlight module')

    const json = jsonMod.default ?? jsonMod
    const yaml = yamlMod.default ?? yamlMod

    const lowlight = createLowlight({ json, yaml })

    const highlighter: SourceHighlighter = (
      target: HTMLElement,
      language: SourceLanguage,
      value: string,
    ): void => {
      try {
        const tree = lowlight.highlight(language, value) as unknown as HighlightNode
        target.replaceChildren()
        for (const child of tree.children ?? []) appendHighlightNode(target, child)
      } catch {
        target.textContent = value
      }
    }
    return highlighter
  })
}

const cdnModuleUrl = (specifier: string, provider: CdnProvider): string => {
  if (specifier === 'lowlight') {
    return provider === 'jsdelivr'
      ? `https://cdn.jsdelivr.net/npm/lowlight@${PINNED_VERSIONS.lowlight}/+esm`
      : `https://esm.sh/lowlight@${PINNED_VERSIONS.lowlight}`
  }
  let name: string
  let version: string
  let path = ''
  if (specifier.startsWith('@tiptap/')) {
    name = specifier
    version = PINNED_VERSIONS.tiptap
  } else if (specifier.startsWith('highlight.js/lib/languages/')) {
    name = 'highlight.js'
    version = PINNED_VERSIONS.highlight
    path = `/lib/languages/${specifier.slice('highlight.js/lib/languages/'.length)}`
  } else if (specifier === 'marked' || specifier === 'yaml' || specifier === 'dompurify') {
    name = specifier
    version = PINNED_VERSIONS[specifier]
  } else {
    throw new Error(`Unrecognized Lite editor dependency: ${specifier}`)
  }
  if (provider === 'esm_sh') return `https://esm.sh/${name}@${version}${path}`
  return `https://cdn.jsdelivr.net/npm/${name}@${version}${path ? `${path}.js` : ''}/+esm`
}

export const loadLiteRichEditorAdapter = (): Promise<RichEditorAdapter> => {
  const element = document.getElementById('taco-asset-rich-adapter')
  const encoded = element?.textContent?.trim()
  const sharedUrl = (document.getElementById('taco-rt-shared') as (HTMLElement & { tacoSharedModuleUrl?: string }) | null)?.tacoSharedModuleUrl
  if (!encoded || !sharedUrl) return Promise.reject(new Error('The Lite rich editor asset is missing'))
  return loadWithHedging(async (provider) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    const source = await new Response(stream).text()
    const rewritten = source.replace(/\b(from\s*|import\s*)["']([^"']+)["']/g, (_match, prefix: string, specifier: string) => {
      return `${prefix}"${specifier === './taco-shared.js' ? sharedUrl : cdnModuleUrl(specifier, provider)}"`
    })
    const url = URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }))
    try {
      const mod = await import(/* @vite-ignore */ url) as { TiptapRichEditorAdapter?: new () => RichEditorAdapter }
      if (!mod.TiptapRichEditorAdapter) throw new Error('Invalid embedded Lite editor adapter')
      return new mod.TiptapRichEditorAdapter()
    } finally {
      URL.revokeObjectURL(url)
    }
  })
}
