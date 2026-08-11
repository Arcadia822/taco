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
