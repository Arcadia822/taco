export interface StoredFileSelection {
  path: string
  hash: string
}

export const fileSelectionSessionKey = (docId: string): string => `taco-selected-file-${docId}`

export const filePathFromHash = (hash: string): string => {
  const encodedPath = hash.replace(/^#/, '').split('::', 1)[0] ?? ''
  try { return decodeURIComponent(encodedPath) }
  catch { return '' }
}

export const storedFileSelection = (raw: string | null): StoredFileSelection | null => {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredFileSelection>
    return typeof parsed.path === 'string' && typeof parsed.hash === 'string'
      ? { path: parsed.path, hash: parsed.hash }
      : null
  } catch {
    return null
  }
}

export const selectedPathForLoad = (protocol: string, hash: string, stored: string | null): string => {
  const hashPath = filePathFromHash(hash)
  if (protocol !== 'file:') return hashPath
  const selection = storedFileSelection(stored)
  return selection?.hash === hash ? selection.path : hashPath
}

export const usesUrlHashForFileSelection = (protocol: string): boolean => protocol !== 'file:'

export const serializeFileSelection = (path: string, hash: string): string => JSON.stringify({ path, hash } satisfies StoredFileSelection)

export const fileSelectionHash = (path: string, headingId = ''): string =>
  `#${encodeURIComponent(path)}${headingId ? `::${encodeURIComponent(headingId)}` : ''}`

export type DocumentLink =
  | { kind: 'external'; href: string }
  | { kind: 'internal'; path: string; heading: string }
  | { kind: 'unsupported' }

const decode = (value: string): string | null => {
  try { return decodeURIComponent(value) }
  catch { return null }
}

/**
 * Resolves a Markdown link the way a repository viewer does: relative to the
 * linking file, `/` relative to the bundle root, `#heading` within the file.
 * Returns a bundle path; the caller decides whether that path exists.
 */
export const resolveDocumentLink = (root: string, fromPath: string, href: string): DocumentLink => {
  const trimmed = href.trim()
  if (/^(?:https?:|mailto:)/i.test(trimmed)) return { kind: 'external', href: trimmed }
  if (!trimmed || /^[a-z][a-z\d+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) return { kind: 'unsupported' }
  const hashIndex = trimmed.indexOf('#')
  const target = (hashIndex < 0 ? trimmed : trimmed.slice(0, hashIndex)).split('?', 1)[0]!
  const heading = decode(hashIndex < 0 ? '' : trimmed.slice(hashIndex + 1))
  const decodedTarget = decode(target)
  if (heading === null || decodedTarget === null) return { kind: 'unsupported' }
  if (!decodedTarget) return { kind: 'internal', path: fromPath, heading }
  const base = decodedTarget.startsWith('/') ? root.split('/') : fromPath.split('/').slice(0, -1)
  const parts: string[] = []
  for (const part of [...base, ...decodedTarget.split('/')]) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) return { kind: 'unsupported' }
      parts.pop()
    } else parts.push(part)
  }
  const path = parts.join('/')
  return path === root || path.startsWith(`${root}/`) ? { kind: 'internal', path, heading } : { kind: 'unsupported' }
}
