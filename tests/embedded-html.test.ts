// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import {
  EMBEDDED_HTML_CSP,
  EMBEDDED_HTML_SANDBOX,
  embeddedHtmlDocument,
} from '../src/embedded-html.ts'

describe('embedded-html', () => {
  describe('EMBEDDED_HTML_SANDBOX', () => {
    it('contains allow-scripts and does NOT contain allow-same-origin', () => {
      expect(EMBEDDED_HTML_SANDBOX).toContain('allow-scripts')
      expect(EMBEDDED_HTML_SANDBOX).not.toContain('allow-same-origin')
      expect(EMBEDDED_HTML_SANDBOX).not.toContain('allow-top-navigation')
      expect(EMBEDDED_HTML_SANDBOX).toContain('allow-popups')
      expect(EMBEDDED_HTML_SANDBOX).toContain('allow-popups-to-escape-sandbox')
    })
  })

  describe('EMBEDDED_HTML_CSP', () => {
    it('defines a network-blocking CSP with inline script/style allowed', () => {
      expect(EMBEDDED_HTML_CSP).toContain("default-src 'none'")
      expect(EMBEDDED_HTML_CSP).toContain("script-src 'unsafe-inline'")
      expect(EMBEDDED_HTML_CSP).toContain("style-src 'unsafe-inline'")
      expect(EMBEDDED_HTML_CSP).toContain('img-src data: blob:')
      expect(EMBEDDED_HTML_CSP).toContain('media-src data: blob:')
      expect(EMBEDDED_HTML_CSP).toContain('font-src data:')
      expect(EMBEDDED_HTML_CSP).toContain("connect-src 'none'")
      expect(EMBEDDED_HTML_CSP).toContain("form-action 'none'")
      expect(EMBEDDED_HTML_CSP).toContain("base-uri 'none'")
      expect(EMBEDDED_HTML_CSP).toContain("object-src 'none'")
      expect(EMBEDDED_HTML_CSP).toContain("frame-src 'none'")
    })
  })

  describe('embeddedHtmlDocument', () => {
    it('inserts CSP immediately after doctype when doctype is present', () => {
      const html = '<!DOCTYPE html><html><head><title>Test</title></head><body>Hello</body></html>'
      const doc = embeddedHtmlDocument(html)

      expect(doc).toContain(EMBEDDED_HTML_CSP)
      const cspIndex = doc.indexOf(EMBEDDED_HTML_CSP)
      const doctypeIndex = doc.toLowerCase().indexOf('<!doctype')
      const headIndex = doc.toLowerCase().indexOf('<head>')

      expect(doctypeIndex).toBeGreaterThanOrEqual(0)
      expect(cspIndex).toBeGreaterThan(doctypeIndex)
      expect(cspIndex).toBeLessThan(headIndex)
      // Exactly one injected CSP
      expect(doc.split(EMBEDDED_HTML_CSP).length - 1).toBe(1)
    })

    it('inserts CSP immediately after doctype when doctype has leading whitespace', () => {
      const html = '   \n  <!doctype html>\n<html><body>Page</body></html>'
      const doc = embeddedHtmlDocument(html)

      expect(doc.startsWith('   \n  <!doctype html>')).toBe(true)
      const doctypeMatch = doc.match(/^   \n  <!doctype html>\n/i)
      expect(doctypeMatch).not.toBeNull()
      const afterMatch = doc.slice(doctypeMatch![0].length)
      expect(afterMatch.startsWith(EMBEDDED_HTML_CSP)).toBe(true)
    })

    it('prepends doctype and CSP when doctype is absent', () => {
      const html = '<html><head><title>No Doctype</title></head><body>No doctype</body></html>'
      const doc = embeddedHtmlDocument(html)

      expect(doc.startsWith(`<!doctype html>\n${EMBEDDED_HTML_CSP}\n`)).toBe(true)
      expect(doc.endsWith(html)).toBe(true)
      expect(doc.split(EMBEDDED_HTML_CSP).length - 1).toBe(1)
    })

    it('prepends doctype and CSP for a plain HTML fragment', () => {
      const fragment = '<p>Just a paragraph</p>'
      const doc = embeddedHtmlDocument(fragment)

      expect(doc).toBe(`<!doctype html>\n${EMBEDDED_HTML_CSP}\n<p>Just a paragraph</p>`)
      expect(doc.split(EMBEDDED_HTML_CSP).length - 1).toBe(1)
    })

    it('preserves leading BOM with doctype', () => {
      const html = '\uFEFF<!DOCTYPE html><html><head></head><body>BOM</body></html>'
      const doc = embeddedHtmlDocument(html)

      expect(doc.charCodeAt(0)).toBe(0xFEFF)
      expect(doc.slice(1).startsWith('<!DOCTYPE html>\n')).toBe(true)
      expect(doc.indexOf(EMBEDDED_HTML_CSP)).toBeGreaterThan(0)
      expect(doc.split(EMBEDDED_HTML_CSP).length - 1).toBe(1)
    })

    it('preserves leading BOM without doctype', () => {
      const html = '\uFEFF<div>Fragment with BOM</div>'
      const doc = embeddedHtmlDocument(html)

      expect(doc.charCodeAt(0)).toBe(0xFEFF)
      expect(doc.slice(1).startsWith(`<!doctype html>\n${EMBEDDED_HTML_CSP}\n`)).toBe(true)
      expect(doc.endsWith('<div>Fragment with BOM</div>')).toBe(true)
      expect(doc.split(EMBEDDED_HTML_CSP).length - 1).toBe(1)
    })

    it('places CSP before any loadable content in head-first documents', () => {
      const html = '<!doctype html><script src="https://evil.com/leak.js"></script>'
      const doc = embeddedHtmlDocument(html)

      const cspIndex = doc.indexOf(EMBEDDED_HTML_CSP)
      const scriptIndex = doc.indexOf('<script')
      expect(cspIndex).toBeLessThan(scriptIndex)
    })
  })
})
