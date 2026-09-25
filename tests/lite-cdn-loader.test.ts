import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CDN_URLS,
  loadWithHedging,
  PINNED_VERSIONS,
  type CdnProvider,
} from '../src/lite-cdn-loader.ts'
const pending = (): { promise: Promise<string>; resolve: (value: string) => void } => {
  let resolve!: (value: string) => void
  const promise = new Promise<string>((complete) => { resolve = complete })
  return { promise, resolve }
}


describe('Lite CDN Loader', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('pins CDN dependency versions for Lite', () => {
    expect(PINNED_VERSIONS).toEqual({
      tiptap: '3.29.2',
      lowlight: '3.3.0',
      highlight: '11.11.1',
      marked: '18.0.9',
      yaml: '2.9.0',
      dompurify: '3.4.13',
      mermaid: '12.0.0',
    })
    expect(CDN_URLS.jsdelivr.mermaid).toContain('mermaid@12.0.0')
    expect(CDN_URLS.jsdelivr.lowlight).toContain('lowlight@3.3.0')
    expect(CDN_URLS.jsdelivr.json).toContain('highlight.js@11.11.1')
    expect(CDN_URLS.esm_sh.mermaid).toContain('mermaid@12.0.0')
    expect(CDN_URLS.esm_sh.lowlight).toContain('lowlight@3.3.0')
  })

  it('resolves immediately when the primary candidate (jsdelivr) succeeds within 750ms', async () => {
    const candidate2 = vi.fn().mockImplementation(() => new Promise<string>(() => {}))
    const candidate1 = vi.fn().mockResolvedValue('jsdelivr-success')

    const loader = (provider: CdnProvider) => {
      if (provider === 'jsdelivr') return candidate1()
      return candidate2()
    }

    const promise = loadWithHedging(loader, 8000, 750)
    await vi.advanceTimersByTimeAsync(100)

    const result = await promise
    expect(result).toBe('jsdelivr-success')
    expect(candidate1).toHaveBeenCalledTimes(1)
    expect(candidate2).not.toHaveBeenCalled()
  })

  it('hedges with candidate 2 (esm.sh) after 750ms if candidate 1 stalls', async () => {
    const { promise: p1, resolve: resolve1 } = pending()
    const { promise: p2, resolve: resolve2 } = pending()

    const candidate1 = vi.fn().mockReturnValue(p1)
    const candidate2 = vi.fn().mockReturnValue(p2)

    const loader = (provider: CdnProvider) => {
      if (provider === 'jsdelivr') return candidate1()
      return candidate2()
    }

    const promise = loadWithHedging(loader, 8000, 750)

    // At 500ms, only candidate 1 has been called
    await vi.advanceTimersByTimeAsync(500)
    expect(candidate1).toHaveBeenCalledTimes(1)
    expect(candidate2).not.toHaveBeenCalled()

    // At 750ms, candidate 2 is triggered
    await vi.advanceTimersByTimeAsync(250)
    expect(candidate2).toHaveBeenCalledTimes(1)

    // If candidate 2 resolves first at 1200ms
    resolve2('esm-sh-won')
    await vi.advanceTimersByTimeAsync(450)

    const result = await promise
    expect(result).toBe('esm-sh-won')

    // Late resolution of candidate 1 does not affect result
    resolve1('jsdelivr-late')
    await vi.advanceTimersByTimeAsync(500)
    expect(result).toBe('esm-sh-won')
  })

  it('times out each candidate eight seconds after that candidate starts', async () => {
    const loader = () => new Promise<string>(() => {})
    const promise = loadWithHedging(loader, 8000, 750)
    const rejection = expect(promise).rejects.toThrow('Timed out after 8000ms')
    await vi.advanceTimersByTimeAsync(8000)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(750)
    await rejection
  })

  it('rejects when both candidates fail', async () => {
    const candidate1 = vi.fn().mockImplementation(async () => { throw new Error('jsdelivr network down') })
    const candidate2 = vi.fn().mockImplementation(async () => { throw new Error('esm.sh network down') })

    const loader = (provider: CdnProvider) => {
      if (provider === 'jsdelivr') return candidate1()
      return candidate2()
    }

    const promise = loadWithHedging(loader, 8000, 750)
    const rejection = expect(promise).rejects.toThrow('esm.sh network down')
    await vi.advanceTimersByTimeAsync(800)
    await rejection
  })
})
