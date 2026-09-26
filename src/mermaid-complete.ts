import type { MermaidApi } from './mermaid.ts'

interface MermaidModule {
  default: MermaidApi
}

export const loadEmbeddedMermaid = async (): Promise<MermaidApi> => {
  const el = document.getElementById('taco-asset-mermaid')
  if (el?.textContent?.trim()) {
    const bytes = Uint8Array.from(atob(el.textContent.trim()), (character) => character.charCodeAt(0))
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    const js = await new Response(stream).text()
    const url = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }))
    try {
      const mod = await import(/* @vite-ignore */ url)
      return (mod as MermaidModule).default ?? (mod as unknown as MermaidApi)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  if (import.meta.env.DEV) {
    const mod = await import('mermaid')
    return (mod as MermaidModule).default ?? (mod as unknown as MermaidApi)
  }
  throw new Error('Offline Mermaid asset is missing from the Complete shell')
}
