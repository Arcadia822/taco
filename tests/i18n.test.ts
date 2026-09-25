import { describe, expect, it } from 'vitest'
import { LOCALE_CHOICES, copy, resolveLocale } from '../src/i18n.ts'
import { structuredFileLabels } from '../src/structured-file-viewer.ts'

describe('shell internationalization', () => {
  it('exposes only English and simplified Chinese with complete catalogs', () => {
    expect(LOCALE_CHOICES).toEqual([
      { code: 'zh-Hans', label: '简体中文' },
      { code: 'en', label: 'English' },
    ])

    const englishKeys = Object.keys(copy.en).sort()
    for (const { code } of LOCALE_CHOICES) {
      expect(Object.keys(copy[code]).sort()).toEqual(englishKeys)
      expect(copy[code].language).not.toBe('')
      expect(copy[code].saveUnpacked(2)).toContain('2')
      expect(Object.values(structuredFileLabels(code)).every((value) => value.trim().length > 0)).toBe(true)
    }
  })

  it('prefers a supported saved choice, then the first supported browser preference', () => {
    expect(resolveLocale('en-GB', ['zh-CN'])).toBe('en')
    expect(resolveLocale('ja', ['fr-CA', 'zh-CN'])).toBe('zh-Hans')
    expect(resolveLocale(null, ['nl-NL', 'en-US', 'zh-CN'])).toBe('en')
    expect(resolveLocale(null, [])).toBe('en')
  })

  it('maps Chinese regional preferences to simplified Chinese without retaining other catalogs', () => {
    expect(resolveLocale('zh-CN', ['en-US'])).toBe('zh-Hans')
    expect(resolveLocale('zh-HK', ['en-US'])).toBe('zh-Hans')
    expect(resolveLocale(null, ['zh-Hant-TW'])).toBe('zh-Hans')
    expect(resolveLocale('pt-BR', ['en-US'])).toBe('en')
    expect(resolveLocale('unknown', ['it-IT'])).toBe('en')
  })
})
