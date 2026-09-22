/**
 * GitHub references in document properties.
 *
 * A `repo` or `issue` property whose value is a GitHub link is shown with the
 * GitHub mark, the `owner/repo` (or `owner/repo#N`) label, and — when the
 * public metadata can be reached — the repository or issue title. The raw YAML
 * value is never rewritten: the link stays the value, and the title is display
 * state only.
 *
 * The offline workflow must survive untouched: an unreachable or rate-limited
 * API leaves the readable label and a working link, with no error surface and
 * no credential written into the file.
 */

export type GitHubReferenceKind = 'repo' | 'issue'

export interface GitHubReference {
  kind: GitHubReferenceKind
  owner: string
  repo: string
  number?: number
  /** Canonical `https://github.com/...` target opened by a click. */
  url: string
  /** Readable fallback, `owner/repo` or `owner/repo#N`. */
  label: string
  apiUrl: string
}

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])
const SEGMENT = /^[A-Za-z0-9._-]+$/
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

const isSegment = (value: string): boolean =>
  Boolean(value) && value !== '.' && value !== '..' && SEGMENT.test(value)

const pathSegments = (value: string): string[] | null => {
  const trimmed = value.trim()
  if (!trimmed) return null

  let path = trimmed
  if (/^\/\//.test(trimmed)) return null
  if (SCHEME.test(trimmed)) {
    if (!/^https?:\/\//i.test(trimmed)) return null
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return null
    }
    if (!GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) return null
    path = parsed.pathname
  } else {
    const host = trimmed.split('/')[0].toLowerCase()
    if (GITHUB_HOSTS.has(host)) path = trimmed.slice(host.length)
  }

  return path.split(/[?#]/)[0].split('/').map((segment) => segment.trim()).filter(Boolean)
}

const issueNumber = (value: string | null | undefined): number | null => {
  if (!value) return null
  const digits = value.replace(/^#/, '').trim()
  if (!/^\d+$/.test(digits)) return null
  const parsed = Number(digits)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * Read a `repo` or `issue` property value as a GitHub reference.
 *
 * Accepted shapes: `https://github.com/owner/repo`, `github.com/owner/repo`,
 * `owner/repo`, and for issues `.../issues/12`, `owner/repo#12`, `#12` when the
 * owner and repository are present in the same value. Anything else — including
 * non-GitHub hosts and non-http schemes — yields null so the property keeps its
 * plain text control.
 */
export const parseGitHubReference = (key: string, value: unknown): GitHubReference | null => {
  if (key !== 'repo' && key !== 'issue') return null
  if (typeof value !== 'string') return null

  const hash = value.indexOf('#')
  const fragment = hash >= 0 ? value.slice(hash + 1).trim() : ''
  const segments = pathSegments(hash >= 0 ? value.slice(0, hash) : value)
  if (!segments) return null

  const [owner, repo, ...rest] = segments
  if (!owner || !OWNER.test(owner) || !repo || !isSegment(repo)) return null
  const base = `https://github.com/${owner}/${repo}`
  const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

  if (key === 'repo') {
    if (rest.length || fragment) return null
    return { kind: 'repo', owner, repo, url: base, label: `${owner}/${repo}`, apiUrl: api }
  }

  const number = rest.length === 2 && rest[0] === 'issues'
    ? issueNumber(rest[1])
    : rest.length === 0 ? issueNumber(fragment) : null
  if (!number) return null

  return {
    kind: 'issue',
    owner,
    repo,
    number,
    url: `${base}/issues/${number}`,
    label: `${owner}/${repo}#${number}`,
    apiUrl: `${api}/issues/${number}`,
  }
}

const titleCache = new Map<string, Promise<string | null>>()

const stringField = (payload: unknown, key: string): string | null => {
  if (!payload || typeof payload !== 'object') return null
  const entry = Object.entries(payload).find(([name]) => name === key)
  if (!entry || typeof entry[1] !== 'string') return null
  const value = entry[1].trim()
  return value || null
}

const requestTitle = async (
  reference: GitHubReference,
  fetcher: typeof fetch,
): Promise<string | null> => {
  try {
    const response = await fetcher(reference.apiUrl, { headers: { accept: 'application/vnd.github+json' } })
    if (!response.ok) return null
    const payload = await response.json() as unknown
    // A repository's `full_name` only repeats the label, so its description is the informative title.
    return reference.kind === 'repo'
      ? stringField(payload, 'description')
      : stringField(payload, 'title')
  } catch {
    return null
  }
}

/**
 * The repository or issue title, or null when the metadata is unreachable,
 * rate-limited, absent, or `fetch` is unavailable. Failures are cached for the
 * session so an offline bundle never retries the same request on every repaint,
 * and opening a Taco never blocks on the network.
 */
export const githubTitle = (
  reference: GitHubReference,
  fetcher?: typeof fetch,
): Promise<string | null> => {
  const cached = titleCache.get(reference.apiUrl)
  if (cached) return cached
  const request = fetcher ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null)
  const pending = request ? requestTitle(reference, request) : Promise.resolve(null)
  titleCache.set(reference.apiUrl, pending)
  return pending
}

export const resetGitHubTitleCache = (): void => titleCache.clear()

const githubMark = (): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('fill', 'currentColor')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('document-property-github-logo')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z')
  svg.append(path)
  return svg
}

export interface GitHubPreviewOptions {
  openLabel: (label: string) => string
  fetcher?: typeof fetch
}

/**
 * A link to the original GitHub target: mark, readable label, and the fetched
 * title when it is available. The title is written as text and must stay plain
 * text — it comes from a third party.
 */
export const createGitHubPreview = (
  reference: GitHubReference,
  options: GitHubPreviewOptions,
): HTMLAnchorElement => {
  const link = document.createElement('a')
  link.className = 'document-property-github'
  link.href = reference.url
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  const openLabel = options.openLabel(reference.label)
  link.title = openLabel
  link.setAttribute('aria-label', openLabel)

  const label = document.createElement('span')
  label.className = 'document-property-github-label'
  label.textContent = reference.label

  const title = document.createElement('span')
  title.className = 'document-property-github-title'

  link.append(githubMark(), label, title)
  void githubTitle(reference, options.fetcher).then((text) => {
    if (text) title.textContent = text
  })
  return link
}
