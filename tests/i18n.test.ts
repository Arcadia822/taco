import { describe, expect, it } from 'vitest'
import { LOCALE_CHOICES, copy, resolveLocale } from '../src/i18n.ts'
import { structuredFileLabels } from '../src/structured-file-viewer.ts'

describe('shell internationalization', () => {
  it('matches Bento bundled locale choices and provides a complete catalog for each', () => {
    expect(LOCALE_CHOICES).toEqual([
      { code: 'zh-Hans', label: '简体中文' },
      { code: 'en', label: 'English' },
      { code: 'zh-Hant', label: '繁體中文' },
      { code: 'ja', label: '日本語' },
      { code: 'es', label: 'Español' },
      { code: 'fr', label: 'Français' },
      { code: 'de', label: 'Deutsch' },
      { code: 'it', label: 'Italiano' },
      { code: 'pt', label: 'Português' },
    ])

    const englishKeys = Object.keys(copy.en).sort()
    for (const { code } of LOCALE_CHOICES) {
      expect(Object.keys(copy[code]).sort()).toEqual(englishKeys)
      expect(copy[code].language).not.toBe('')
      expect(copy[code].saveUnpacked(2)).toContain('2')
      expect(Object.values(structuredFileLabels(code)).every((value) => value.trim().length > 0)).toBe(true)
    }
  })

  it('prefers a saved choice, then the first supported browser preference', () => {
    expect(resolveLocale('ja', ['fr-CA'])).toBe('ja')
    expect(resolveLocale(null, ['nl-NL', 'fr-CA', 'de-DE'])).toBe('fr')
    expect(resolveLocale(null, ['zh-Hant-TW'])).toBe('zh-Hant')
    expect(resolveLocale(null, ['pt-BR'])).toBe('pt')
    expect(resolveLocale(null, [])).toBe('en')
  })

  it('migrates legacy and regional saved locale codes to bundled catalogs', () => {
    expect(resolveLocale('zh-CN', ['en-US'])).toBe('zh-Hans')
    expect(resolveLocale('zh-HK', ['en-US'])).toBe('zh-Hant')
    expect(resolveLocale('pt-BR', ['en-US'])).toBe('pt')
    expect(resolveLocale('de-DE', ['en-US'])).toBe('de')
    expect(resolveLocale('unknown', ['it-IT'])).toBe('it')
  })
})
