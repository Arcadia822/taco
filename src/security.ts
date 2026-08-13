import DOMPurify from 'dompurify'
import type { TacoBundle, TacoFile } from './model.ts'

export const TACO_SECURITY_VERSION = '1'
export const MAX_BLOCK_HTML = 512 * 1024
export const MAX_SYNC_FILES = 2_000
export const MAX_SYNC_NODES = 50_000
export const MAX_FRAME_BYTES = 2 * 1024 * 1024

export const SUPPORTED_BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList',
  'taskList', 'horizontalRule', 'image', 'table', 'documentProperties',
  'centeredBlock',
])

const EDITOR_TAGS = [
  'a', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'img', 'input', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'table',
  'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
]

const EDITOR_ATTRS = [
  'align', 'alt', 'checked', 'class', 'colspan', 'data-key', 'data-taco-align',
  'data-bom', 'data-closed', 'data-eol', 'data-taco-block-id', 'data-type', 'data-yaml', 'disabled', 'height', 'href', 'rel', 'rowspan',
  'src', 'target', 'title', 'type', 'width',
]

const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='

const isRelativeReference = (value: string): boolean =>
  value.startsWith('#') || (!/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('//'))

export const safeLinkUrl = (value: string): string | null => {
  const url = value.trim()
  if (!url) return null
  if (isRelativeReference(url) || /^(https?:|mailto:)/i.test(url)) return url
  return null
}

export const safeRasterDataUrl = (value: string): string | null =>
  /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(value.trim()) ? value.trim() : null

export const inertImageAttributes = (source: unknown): Record<string, string> => {
  const value = typeof source === 'string' ? source.trim() : ''
  const raster = safeRasterDataUrl(value)
  return raster
    ? { src: raster }
    : { src: TRANSPARENT_PIXEL, ...(value ? { 'data-taco-source': value } : {}) }
}

const postProcessEditorHtml = (html: string): string => {
  const template = document.createElement('template')
  template.innerHTML = html
  for (const element of template.content.querySelectorAll<HTMLElement>('*')) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on') || name === 'style' || name === 'srcdoc') element.removeAttribute(attribute.name)
    }
    if (element instanceof HTMLAnchorElement) {
      const safe = safeLinkUrl(element.getAttribute('href') ?? '')
      if (safe) {
        element.setAttribute('href', safe)
        if (/^(https?:|mailto:)/i.test(safe)) {
          element.setAttribute('target', '_blank')
          element.setAttribute('rel', 'noopener noreferrer')
        }
      } else element.removeAttribute('href')
    }
    if (element instanceof HTMLImageElement) {
      const source = element.dataset.tacoSource ?? element.getAttribute('src') ?? ''
      const attrs = inertImageAttributes(source)
      element.setAttribute('src', attrs.src)
      if (attrs['data-taco-source']) element.dataset.tacoSource = attrs['data-taco-source']
      else delete element.dataset.tacoSource
    }
    if (element instanceof HTMLInputElement) {
      if (element.type !== 'checkbox') element.remove()
      else element.disabled = true
    }
  }
  return template.innerHTML
}

export const sanitizeEditorHtml = (html: string): string => {
  if (html.length > MAX_BLOCK_HTML) throw new Error('security:block-too-large')
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: EDITOR_TAGS,
    ALLOWED_ATTR: EDITOR_ATTRS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_TAGS: ['base', 'button', 'embed', 'form', 'iframe', 'link', 'meta', 'object', 'script', 'style', 'svg'],
  })
  return postProcessEditorHtml(String(sanitized))
}

export const sanitizeRenderedHtml = (html: string): string => sanitizeEditorHtml(html)

export const sanitizeMermaidSvg = (svg: string): string => {
  if (svg.length > MAX_BLOCK_HTML) throw new Error('security:mermaid-too-large')
  const sanitized = String(DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['a', 'foreignObject', 'image', 'script', 'style', 'use'],
    FORBID_ATTR: ['href', 'xlink:href'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
  }))
  const parsed = new DOMParser().parseFromString(sanitized, 'image/svg+xml')
  const root = parsed.documentElement
  if (root.localName !== 'svg' || parsed.querySelector('parsererror')) throw new Error('security:mermaid-invalid-svg')
  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value
      if (name.startsWith('on') || name === 'srcdoc' || /(?:@import|url\s*\(\s*['"]?(?:https?:|\/\/|data:))/i.test(value)) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  for (const relation of Array.from(root.querySelectorAll('path.relation'))) {
    relation.setAttribute('fill', 'none')
  }
  for (const background of Array.from(root.querySelectorAll('.edgeLabel rect.background'))) {
    background.setAttribute('fill', 'none')
    background.setAttribute('stroke', 'none')
  }
  return new XMLSerializer().serializeToString(root)
}

export type SecurityIssueCode = 'collab-secrets-present' | 'runtime-security-outdated'

export interface SecurityValidation {
  securityVersion: string
  issues: SecurityIssueCode[]
}

export const hasCollabSecrets = (bundle: Pick<TacoBundle, 'collab'>): boolean => Boolean(
  bundle.collab?.key || bundle.collab?.ownerPriv || bundle.collab?.invite?.priv,
)

export const credentialFreeFile = (file: TacoFile): TacoFile => ({
  ...(file.id ? { id: file.id } : {}),
  ...(file.title ? { title: file.title } : {}),
  path: file.path,
  mediaType: file.mediaType,
  content: file.content,
  ...(file.sourceHash ? { sourceHash: file.sourceHash } : {}),
  ...(file.blocks ? { blocks: file.blocks.map(({ id, type, html }) => ({ id, type, html })) } : {}),
})

export const validateTacoSecurity = (
  bundle: Pick<TacoBundle, 'collab'>,
  carriedSecurityVersion = TACO_SECURITY_VERSION,
): SecurityValidation => ({
  securityVersion: carriedSecurityVersion,
  issues: [
    ...(hasCollabSecrets(bundle) ? ['collab-secrets-present' as const] : []),
    ...(carriedSecurityVersion !== TACO_SECURITY_VERSION ? ['runtime-security-outdated' as const] : []),
  ],
})

export const assertBoundedJson = (value: unknown, label: string): void => {
  let encoded: string
  try { encoded = JSON.stringify(value) }
  catch { throw new Error(`security:${label}-not-json`) }
  if (encoded === undefined || encoded.length > MAX_FRAME_BYTES) throw new Error(`security:${label}-too-large`)
}

export const assertOptionalBoundedJson = (value: unknown, label: string): void => {
  if (value !== undefined) assertBoundedJson(value, label)
}
