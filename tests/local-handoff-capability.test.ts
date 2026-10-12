import { describe, expect, it } from 'vitest'
import { stripListenCapabilityFromUrl } from '../src/local-handoff.ts'

describe('local handoff capability stripping (Finding 5)', () => {
  const SENSITIVE_TOKEN = 'secret_token_abcdef1234567890'
  const SENSITIVE_SESSION_ID = 'sess_9876543210fedcba'
  const SENSITIVE_DOC_ID = 'doc_test_123'
  const SENSITIVE_PORT = '49152'

  const rawQueryParams = new URLSearchParams({
    port: SENSITIVE_PORT,
    token: SENSITIVE_TOKEN,
    sessionId: SENSITIVE_SESSION_ID,
    docId: SENSITIVE_DOC_ID,
  }).toString()

  const encodedQueryParams = encodeURIComponent(rawQueryParams)

  it('strips standalone taco-listen capability fragment from URL', () => {
    const rawUrl = `file:///Users/alice/docs/Spec.taco.html#taco-listen=${encodedQueryParams}`
    const cleanUrl = stripListenCapabilityFromUrl(rawUrl)

    expect(cleanUrl).toBe('file:///Users/alice/docs/Spec.taco.html')
    expect(cleanUrl.includes(SENSITIVE_TOKEN)).toBe(false)
    expect(cleanUrl.includes(SENSITIVE_SESSION_ID)).toBe(false)
    expect(cleanUrl.includes('taco-listen=')).toBe(false)
  })

  it('preserves file path and heading fragments while stripping taco-listen capability', () => {
    const rawUrl = `file:///Users/alice/docs/Spec.taco.html#taco-listen=${encodedQueryParams}::specs/sample/spec.md::section-heading`
    const cleanUrl = stripListenCapabilityFromUrl(rawUrl)

    expect(cleanUrl).toBe(
      'file:///Users/alice/docs/Spec.taco.html#specs/sample/spec.md::section-heading',
    )
    expect(cleanUrl.includes(SENSITIVE_TOKEN)).toBe(false)
    expect(cleanUrl.includes(SENSITIVE_SESSION_ID)).toBe(false)
    expect(cleanUrl.includes('taco-listen=')).toBe(false)
    expect(cleanUrl.includes('specs/sample/spec.md')).toBe(true)
    expect(cleanUrl.includes('section-heading')).toBe(true)
  })

  it('preserves query parameters while stripping taco-listen fragment', () => {
    const rawUrl = `file:///Users/alice/docs/Spec.taco.html?origin_path=%2FUsers%2Falice%2Fdocs%2Fspec.md#taco-listen=${encodedQueryParams}`
    const cleanUrl = stripListenCapabilityFromUrl(rawUrl)

    expect(cleanUrl).toBe(
      'file:///Users/alice/docs/Spec.taco.html?origin_path=%2FUsers%2Falice%2Fdocs%2Fspec.md',
    )
    expect(cleanUrl.includes(SENSITIVE_TOKEN)).toBe(false)
    expect(cleanUrl.includes(SENSITIVE_SESSION_ID)).toBe(false)
    expect(cleanUrl.includes('origin_path')).toBe(true)
  })

  it('leaves URLs without taco-listen fragment untouched', () => {
    const urlWithoutFragment = 'file:///Users/alice/docs/Spec.taco.html'
    expect(stripListenCapabilityFromUrl(urlWithoutFragment)).toBe(urlWithoutFragment)

    const urlWithOtherFragment = 'file:///Users/alice/docs/Spec.taco.html#specs/sample/spec.md'
    expect(stripListenCapabilityFromUrl(urlWithOtherFragment)).toBe(urlWithOtherFragment)
  })
})
