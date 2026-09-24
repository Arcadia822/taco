const canonicalFileUrl = (value: unknown, expectedPath: string): string | null => {
  if (typeof value !== 'string' || !value) return null
  let url: URL
  try { url = new URL(value) }
  catch { return null }
  if (url.protocol !== 'file:' || url.host || url.username || url.password || url.search || url.hash) return null

  let pathname: string
  try { pathname = decodeURIComponent(url.pathname) }
  catch { return null }
  return pathname.endsWith(`/${expectedPath}`) ? url.href : null
}

export const portableLocalFileReference = (value: unknown, expectedPath: string): boolean =>
  value === `../${expectedPath}`

export const localFileReference = (value: unknown, expectedPath: string): boolean =>
  Boolean(canonicalFileUrl(value, expectedPath)) || portableLocalFileReference(value, expectedPath)

export const localFileUrl = (
  value: unknown,
  expectedPath: string,
  baseUrl = globalThis.location?.href,
): string | null => {
  const canonical = canonicalFileUrl(value, expectedPath)
  if (canonical) return canonical
  if (!portableLocalFileReference(value, expectedPath) || !baseUrl) return null

  let resolved: URL
  try { resolved = new URL(String(value), baseUrl) }
  catch { return null }
  if (resolved.protocol !== 'file:' || resolved.host || resolved.search || resolved.hash) return null

  let pathname: string
  try { pathname = decodeURIComponent(resolved.pathname) }
  catch { return null }
  return pathname.endsWith(`/${expectedPath}`) ? resolved.href : null
}

export const relocateLocalFileReference = (value: string, oldPath: string, newPath: string): string => {
  if (!localFileReference(value, oldPath)) throw new Error(`Invalid local file reference: ${oldPath}`)
  if (portableLocalFileReference(value, oldPath)) return `../${newPath}`

  const relative = `${'../'.repeat(oldPath.split('/').length - 1)}${newPath.split('/').map(encodeURIComponent).join('/')}`
  const relocated = new URL(relative, value).href
  if (!localFileReference(relocated, newPath)) throw new Error(`Invalid relocated file reference: ${newPath}`)
  return relocated
}
