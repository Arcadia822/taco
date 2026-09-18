/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) serializer
 * Produces deterministic UTF-8 bytes for cryptographic signing and hashing.
 */
export const canonicalizeJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => (item === undefined ? 'null' : canonicalizeJson(item)))
    return `[${items.join(',')}]`
  }

  const record = value as Record<string, unknown>
  // Sort Unicode code points (UTF-16 code units lexical order per RFC 8785)
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()

  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`)
  return `{${entries.join(',')}}`
}

/**
 * Computes SHA-256 hex digest of string or buffer using Web Crypto API (supported across Node, Bun, Browser)
 */
export const sha256Hex = async (data: string | Uint8Array): Promise<string> => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Computes RFC 8785 JCS(snapshot) contentHash formatted with 'sha256:' prefix
 */
export const computeSnapshotContentHash = async (snapshot: unknown): Promise<string> => {
  const canonical = canonicalizeJson(snapshot)
  const hex = await sha256Hex(canonical)
  return `sha256:${hex}`
}
