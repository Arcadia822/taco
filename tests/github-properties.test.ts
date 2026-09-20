import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGitHubPreview,
  githubTitle,
  parseGitHubReference,
  resetGitHubTitleCache,
} from '../src/github-properties.ts'

/** Test double: only `ok`, `status`, and `json` are read from a response. */
const responseFetcher = (response: unknown): typeof fetch =>
  vi.fn(async () => response) as unknown as typeof fetch

const openLabel = (label: string): string => `Open ${label} on GitHub`

afterEach(() => {
  vi.unstubAllGlobals()
  resetGitHubTitleCache()
  document.body.replaceChildren()
})

describe('GitHub property references', () => {
  it('reads repository links and owner/repo shorthand', () => {
    for (const value of [
      'https://github.com/Arcadia822/taco',
      'github.com/Arcadia822/taco',
      'Arcadia822/taco',
      'https://github.com/Arcadia822/taco/',
    ]) {
      expect(parseGitHubReference('repo', value)).toMatchObject({
        kind: 'repo',
        owner: 'Arcadia822',
        repo: 'taco',
        url: 'https://github.com/Arcadia822/taco',
        label: 'Arcadia822/taco',
        apiUrl: 'https://api.github.com/repos/Arcadia822/taco',
      })
    }
  })

  it('reads issue links and owner/repo#number shorthand', () => {
    for (const value of [
      'https://github.com/Arcadia822/taco/issues/32',
      'github.com/Arcadia822/taco/issues/32',
      'Arcadia822/taco#32',
      'https://github.com/Arcadia822/taco/issues/32#issuecomment-5710571370',
    ]) {
      expect(parseGitHubReference('issue', value)).toMatchObject({
        kind: 'issue',
        number: 32,
        url: 'https://github.com/Arcadia822/taco/issues/32',
        label: 'Arcadia822/taco#32',
        apiUrl: 'https://api.github.com/repos/Arcadia822/taco/issues/32',
      })
    }
  })

  it('leaves anything that is not a GitHub link to the plain text control', () => {
    expect(parseGitHubReference('link', 'https://github.com/Arcadia822/taco')).toBeNull()
    expect(parseGitHubReference('repo', 32)).toBeNull()
    expect(parseGitHubReference('repo', null)).toBeNull()
    expect(parseGitHubReference('repo', 'https://gitlab.com/Arcadia822/taco')).toBeNull()
    expect(parseGitHubReference('repo', 'https://gist.github.com/Arcadia822/abc')).toBeNull()
    expect(parseGitHubReference('repo', 'javascript:alert(1)')).toBeNull()
    expect(parseGitHubReference('repo', '//github.com/Arcadia822/taco')).toBeNull()
    expect(parseGitHubReference('repo', 'https://github.com/Arcadia822')).toBeNull()
    expect(parseGitHubReference('repo', 'https://github.com/Arcadia822/taco/issues/32')).toBeNull()
    expect(parseGitHubReference('repo', 'https://github.com/../../etc')).toBeNull()
    expect(parseGitHubReference('issue', 'https://github.com/Arcadia822/taco')).toBeNull()
    expect(parseGitHubReference('issue', 'Arcadia822/taco#not-a-number')).toBeNull()
    expect(parseGitHubReference('issue', '#32')).toBeNull()
  })

  it('keeps the readable link when the metadata cannot be fetched', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch
    const link = createGitHubPreview(parseGitHubReference('repo', 'https://github.com/Arcadia822/taco')!, {
      openLabel,
      fetcher,
    })
    document.body.append(link)

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(link.getAttribute('href')).toBe('https://github.com/Arcadia822/taco')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('aria-label')).toBe('Open Arcadia822/taco on GitHub')
    expect(link.querySelector('.document-property-github-label')?.textContent).toBe('Arcadia822/taco')
    expect(link.querySelector('.document-property-github-title')?.textContent).toBe('')
  })

  it('shows the fetched title as plain text and requests it once per reference', async () => {
    const fetcher = responseFetcher({
      ok: true,
      json: async () => ({ full_name: 'Arcadia822/taco', description: 'A single-file workspace', name: '<img src=x onerror=alert(1)>' }),
    })
    const reference = parseGitHubReference('repo', 'Arcadia822/taco')!
    const first = createGitHubPreview(reference, { openLabel, fetcher })
    const second = createGitHubPreview(reference, { openLabel, fetcher })
    document.body.append(first, second)

    await vi.waitFor(() => expect(first.querySelector('.document-property-github-title')?.textContent).toBe('A single-file workspace'))
    expect(second.querySelector('.document-property-github-title')?.textContent).toBe('A single-file workspace')
    expect(first.querySelectorAll('img')).toHaveLength(0)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not repeat the label when the repository has no description', async () => {
    const fetcher = responseFetcher({ ok: true, json: async () => ({ full_name: 'Arcadia822/taco' }) })
    expect(await githubTitle(parseGitHubReference('repo', 'Arcadia822/taco')!, fetcher)).toBeNull()
  })

  it('reports no title for a repository that cannot be read', async () => {
    const fetcher = responseFetcher({ ok: false, status: 403, json: async () => ({ message: 'rate limit exceeded' }) })
    expect(await githubTitle(parseGitHubReference('issue', 'Arcadia822/taco#32')!, fetcher)).toBeNull()
  })

  it('reports no title when the environment has no fetch', async () => {
    vi.stubGlobal('fetch', undefined)
    expect(await githubTitle(parseGitHubReference('repo', 'Arcadia822/taco')!)).toBeNull()
  })
})
