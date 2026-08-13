export const localFileUrl = (value: unknown, expectedPath: string): string | null => {
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
