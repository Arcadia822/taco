import { isSafePath, relativePath, type TacoBundle, type TacoFile } from './model.ts'
import { decodePng } from '../extensions/taco/bin/png.mjs'
import { inertImageAttributes } from './security.ts'

declare const __EMBEDDED_ASSETS__: Record<string, string> | undefined

const marketingDocument = (bundle: TacoBundle, file: TacoFile): boolean =>
  bundle.root === 'specs/001-taco-bento-product' && relativePath(bundle, file) === 'README.md'

const resolveRelativePath = (fromFilePath: string, targetPath: string): string | null => {
  let target: string
  try { target = decodeURIComponent(targetPath.split(/[?#]/)[0]) }
  catch { return null }
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || /[\\\0]/.test(target)) return null
  const parts = fromFilePath.split('/').slice(0, -1)
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(part)
  }
  const path = parts.join('/')
  return isSafePath(path) ? path : null
}

const validated = new WeakMap<TacoFile, { content: string; error?: string }>()
const pngError = (file: TacoFile): string | undefined => {
  const previous = validated.get(file)
  if (previous?.content === file.content) return previous.error
  let error: string | undefined
  try { decodePng(file.content, file.path) }
  catch (cause) { error = (cause as Error).message }
  validated.set(file, { content: file.content, error })
  return error
}

const svgAttribute = (tag: string, name: string): number | null => {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)
  if (!match || match[1].includes('%')) return null
  const value = Number.parseFloat(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

const svgMarkup = (content: string): string | null => {
  const prefix = 'data:image/svg+xml'
  if (!content.startsWith(prefix)) return content
  const separator = content.indexOf(',')
  if (separator === -1) return null
  const payload = content.slice(separator + 1)
  try {
    return content.slice(prefix.length, separator).includes('base64')
      ? atob(payload)
      : decodeURIComponent(payload)
  } catch { return null }
}

/**
 * An SVG carrying only a viewBox has no intrinsic size, so a browser reports a
 * 150×150 fallback and stretches the image to its container. Read the authored
 * width/height, else the viewBox, to keep both previews at the original size.
 */
export const svgIntrinsicSize = (content: string): { width: number; height: number } | null => {
  const markup = svgMarkup(content)
  const tag = markup ? /<svg\b[^>]*>/i.exec(markup)?.[0] : undefined
  if (!tag) return null
  const width = svgAttribute(tag, 'width')
  const height = svgAttribute(tag, 'height')
  if (width !== null && height !== null) return { width, height }
  const viewBox = /\bviewBox\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]
  if (!viewBox) return null
  const parts = viewBox.trim().split(/[\s,]+/).map(Number)
  return parts.length === 4 && parts[2] > 0 && parts[3] > 0 ? { width: parts[2], height: parts[3] } : null
}

export const mediaSource = (file: TacoFile): string =>
  file.mediaType === 'image/svg+xml' && !file.content.startsWith('data:')
    ? `data:image/svg+xml;utf8,${encodeURIComponent(file.content)}`
    : file.content

/** Caps an image at its authored size while still shrinking inside a smaller container. */
export const applyNaturalSize = (image: HTMLImageElement, size: { width: number; height: number } | null): void => {
  if (!size) return
  image.style.setProperty('--media-natural-width', `${size.width}px`)
  image.style.setProperty('--media-natural-height', `${size.height}px`)
}

export const openPngPreview = (file: TacoFile): void => {
  if (file.mediaType === 'image/png' && pngError(file)) return
  document.querySelector('dialog.png-preview, dialog.media-preview-dialog')?.remove()
  const dialog = document.createElement('dialog')
  dialog.className = 'media-preview-dialog png-preview'
  dialog.dataset.tacoTransient = ''
  const image = document.createElement('img')
  image.src = mediaSource(file)
  image.alt = file.title || file.path
  if (file.mediaType === 'image/svg+xml') applyNaturalSize(image, svgIntrinsicSize(file.content))
  dialog.setAttribute('aria-label', image.alt)
  dialog.append(image)

  const finish = (): void => {
    if (typeof dialog.close === 'function') dialog.close()
    else {
      dialog.removeAttribute('open')
      dialog.remove()
    }
  }

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    finish()
  })
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) finish()
  })
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  document.body.append(dialog)
  if (typeof dialog.showModal === 'function') dialog.showModal()
  else dialog.setAttribute('open', '')
}


export const resolveEmbeddedMarkdownAssets = (
  root: ParentNode,
  bundle: TacoBundle,
  file: TacoFile,
  protocol = globalThis.location?.protocol,
): string[] => {
  const diagnostics: string[] = []
  const previews = new Map<string, TacoFile>()
  const files = new Map(bundle.files.map((asset) => [asset.path, asset]))
  // Keep controls outside ProseMirror's editable DOM and canonical serialization.
  const panel = root instanceof HTMLElement ? root.nextElementSibling : null
  if (panel?.classList.contains('markdown-asset-tools')) panel.remove()
  const tools = document.createElement('aside')
  tools.className = 'markdown-asset-tools'
  tools.dataset.tacoTransient = ''
  const report = (message: string): void => {
    if (diagnostics.includes(message)) return
    diagnostics.push(message)
    const notice = document.createElement('p')
    notice.setAttribute('role', 'status')
    notice.textContent = message
    tools.append(notice)
  }
  for (const image of root.querySelectorAll<HTMLImageElement>('img')) {
    const source = image.dataset.tacoSource ?? image.getAttribute('src') ?? ''
    if (!source) continue
    if (marketingDocument(bundle, file)) {
      const embedded = typeof __EMBEDDED_ASSETS__ !== 'undefined' ? __EMBEDDED_ASSETS__?.[source] : undefined
      if (embedded) {
        image.dataset.tacoSource = source
        const resolved = protocol === 'file:' ? embedded : source
        if (image.getAttribute('src') !== resolved) image.setAttribute('src', resolved)
        continue
      }
    }
    // Remote and authored inline images retain the existing sanitizer policy.
    if (/^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith('//')) continue
    if (!/\.png(?:[?#]|$)/i.test(source)) continue
    image.dataset.tacoSource = source
    const path = resolveRelativePath(relativePath(bundle, file), source)
    const asset = path ? files.get(`${bundle.root}/${path}`) : undefined
    const error = !path
      ? `Unsafe PNG reference in ${file.path}: ${source}; use a path inside ${bundle.root}`
      : !asset || asset.mediaType !== 'image/png'
        ? `Missing PNG in ${file.path}: ${source} (resolved to ${bundle.root}/${path}); add the image, correct the link or remove its --ignore exclusion, then repack`
        : pngError(asset)
    image.onerror = null
    if (error || !asset) {
      image.setAttribute('src', inertImageAttributes(source).src)
      if (error) report(error)
      continue
    }
    image.onerror = () => report(`Cannot decode PNG: ${asset.path}; re-export the image and repack`)
    if (image.getAttribute('src') !== asset.content) image.setAttribute('src', asset.content)
    image.style.cursor = 'pointer'
    image.onclick = () => openPngPreview(asset)
    previews.set(asset.path, asset)
  }
  if (tools.children.length && root instanceof HTMLElement) root.after(tools)
  return diagnostics
}
