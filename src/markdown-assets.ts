import { isSafePath, relativePath, type TacoBundle, type TacoFile } from './model.ts'
import { decodePng } from '../extensions/taco/bin/png.mjs'
import { inertImageAttributes } from './security.ts'

declare const __EMBEDDED_ASSETS__: Record<string, string> | undefined

const marketingDocument = (bundle: TacoBundle, file: TacoFile): boolean =>
  bundle.docId === 'taco-product-spec' && relativePath(bundle, file) === 'README.md'

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

export const openPngPreview = (file: TacoFile): void => {
  if (pngError(file)) return
  const dialog = document.createElement('dialog')
  dialog.className = 'png-preview'
  dialog.dataset.tacoTransient = ''
  const close = document.createElement('button')
  close.textContent = 'Close'
  close.addEventListener('click', () => dialog.close())
  const image = document.createElement('img')
  image.src = file.content
  image.alt = file.title || file.path
  dialog.setAttribute('aria-label', image.alt)
  dialog.append(close, image)
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  document.body.append(dialog)
  dialog.showModal()
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
    previews.set(asset.path, asset)
  }
  for (const asset of previews.values()) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = `View full size: ${relativePath(bundle, asset)}`
    button.addEventListener('click', () => openPngPreview(asset))
    tools.append(button)
  }
  if (root instanceof HTMLElement) root.after(tools)
  return diagnostics
}
