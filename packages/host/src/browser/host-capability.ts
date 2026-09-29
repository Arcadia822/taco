import type { IconName } from '../../../../src/ui-primitives.ts'

/**
 * A same-origin Host capability is declared by the page that serves the shell, never by the Taco
 * bundle. `packages/host/src/app/t/[id]/route.ts` writes one inert block into the document `<head>`;
 * the runtime only ever reads that block, so uploaded file content can never enable network writes
 * or redirect them to another origin.
 */
export interface HostCapability {
  tacoId: string
  /** Same-origin API prefix for this Taco, e.g. `/v1/tacos/<id>`. */
  apiBase: string
}

export const HOST_CAPABILITY_ELEMENT_ID = 'taco-host-capability'
export const HOST_CAPABILITY_MEDIA_TYPE = 'application/taco+host'
export const HOST_CAPABILITY_VERSION = 1

const SAFE_TACO_ID = /^[A-Za-z0-9._~-]{1,128}$/

/**
 * Resolve a candidate API base to the hosting page's own origin. Any absolute or protocol-relative
 * value that points elsewhere is refused instead of being followed.
 */
const sameOriginApiBase = (candidate: unknown, tacoId: string, origin: string): string | null => {
  const fallback = `/v1/tacos/${encodeURIComponent(tacoId)}`
  if (typeof candidate !== 'string' || !candidate) return fallback
  let resolved: URL
  try {
    resolved = new URL(candidate, origin)
  } catch {
    return null
  }
  if (resolved.origin !== origin) return null
  const path = resolved.pathname.replace(/\/+$/, '')
  return path.startsWith('/') && !path.includes('//') ? path : null
}

/**
 * Read the Host capability from the served document. Returns null when this page carries no
 * capability, when it is opened from a non-HTTP origin (`file:`, opaque origin), or when the
 * declared API base is not same-origin — in which case the shell keeps its offline copy behaviour.
 */
export function readHostCapability(doc: Document = document, loc: Location = location): HostCapability | null {
  if ((loc.protocol !== 'http:' && loc.protocol !== 'https:') || loc.origin === 'null') return null

  const element = doc.getElementById(HOST_CAPABILITY_ELEMENT_ID)
  if (!element) return null

  // The capability must be part of the shell document's head. Bundle-rendered content never lands
  // there, so this also rejects any attempt to smuggle a capability through file content.
  if (element.parentElement !== doc.head) return null
  if ((element.getAttribute('type') ?? '').toLowerCase() !== HOST_CAPABILITY_MEDIA_TYPE) return null

  let raw: unknown
  try {
    raw = JSON.parse(element.textContent?.trim() || '')
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null

  const declared = raw as { version?: unknown; tacoId?: unknown; apiBase?: unknown }
  if (declared.version !== undefined && declared.version !== HOST_CAPABILITY_VERSION) return null

  const tacoId = typeof declared.tacoId === 'string' ? declared.tacoId : ''
  if (!SAFE_TACO_ID.test(tacoId)) return null

  const apiBase = sameOriginApiBase(declared.apiBase, tacoId, loc.origin)
  if (!apiBase) return null

  return { tacoId, apiBase }
}

/**
 * Self-reported harness names allowed by the frozen contract, mapped to built-in icons. Unlisted or
 * unknown values resolve to the generic `monitor` icon: the shell never downloads a logo and never
 * presents a self-reported value as verified.
 */
export const HOST_HARNESS_ICONS: Record<string, IconName> = {
  codex: 'terminal',
  'claude-code': 'file-code',
  cursor: 'edit',
  'gemini-cli': 'globe',
  other: 'monitor',
}

/** Self-reported model family names allowed by the frozen contract, mapped to built-in icons. */
export const HOST_MODEL_ICONS: Record<string, IconName> = {
  gpt: 'bot',
  claude: 'file-text',
  gemini: 'globe',
  other: 'monitor',
}
