import { describe, expect, it } from 'vitest'
import type { TacoBundle } from '../src/model.ts'
import {
  inertImageAttributes,
  credentialFreeFile,
  sanitizeEditorHtml,
  sanitizeMermaidSvg,
  validateTacoSecurity,
} from '../src/security.ts'

const bundle = (): TacoBundle => ({
  format: 'taco/files', version: 1, docId: 'security-test', title: 'Security test', root: 'specs/security-test',
  files: [{
    id: 'file-spec', path: 'specs/security-test/spec.md', mediaType: 'text/markdown', content: 'Safe',
    blocks: [{ id: 'block-safe', type: 'paragraph', html: '<p data-taco-block-id="block-safe">Safe</p>' }],
  }],
})

describe('untrusted Taco input policy', () => {
  it('rebuilds editor HTML without executable tags, handlers, forms, URLs or passive remote images', () => {
    const html = sanitizeEditorHtml([
      '<base href="https://attacker.test/">',
      '<meta http-equiv="refresh" content="0;url=https://attacker.test/">',
      '<form action="javascript:alert(1)"><button formaction="javascript:alert(2)">go</button></form>',
      '<p onclick="alert(3)"><a href="javascript:alert(4)">link</a>',
      '<img src="https://attacker.test/track" onerror="alert(5)"></p>',
      '<svg onload="alert(6)"><foreignObject>bad</foreignObject></svg>',
    ].join(''))
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('base,meta,form,button,svg,script,style')).toBeNull()
    expect(doc.querySelector('[onclick],[onerror],[formaction]')).toBeNull()
    expect(doc.querySelector('a')?.hasAttribute('href')).toBe(false)
    expect(doc.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/gif;base64,/)
    expect(doc.querySelector('img')?.getAttribute('data-taco-source')).toBe('https://attacker.test/track')
  })

  it('allows only inert raster data to render directly as an image', () => {
    expect(inertImageAttributes('javascript:alert(1)').src).toMatch(/^data:image\/gif;base64,/)
    expect(inertImageAttributes('data:image/svg+xml,<svg onload=alert(1)>').src).toMatch(/^data:image\/gif;base64,/)
    expect(inertImageAttributes('data:image/png;base64,AAAA').src).toBe('data:image/png;base64,AAAA')
  })

  it('preserves inert image source metadata without loading the remote source', () => {
    const sanitized = sanitizeEditorHtml('<img src="https://raw.githubusercontent.com/example/image.png">')
    const image = new DOMParser().parseFromString(sanitized, 'text/html').querySelector('img')

    expect(image?.getAttribute('src')).toMatch(/^data:image\/gif;base64,/)
    expect(image?.getAttribute('data-taco-source')).toBe('https://raw.githubusercontent.com/example/image.png')
  })

  it('sanitizes Mermaid output after rendering', () => {
    const svg = sanitizeMermaidSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><style>@import url(https://attacker.test/x)</style><foreignObject><img src=x onerror=alert(2) /></foreignObject><a href="https://attacker.test/"><rect width="10" height="10" /></a><path style="fill:url(https://attacker.test/p)" d="M0 0" /><path class="relation" d="M0 0 C10 0 10 10 20 10"/><g class="node"><g class="label"><text>Centered node</text></g></g><g class="edgeLabel"><rect class="background" width="20" height="10"/><text>Centered edge</text></g></svg>')
    expect(svg).not.toMatch(/onload|onerror|foreignObject|<style|<a\b|https:\/\/attacker/i)
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
    expect(parsed.documentElement.textContent).toContain('Centered node')
    expect(parsed.documentElement.textContent).toContain('Centered edge')
  })

  it('preserves native diagram paint without allowing stylesheet escape or resource loads', () => {
    const svg = sanitizeMermaidSvg('<svg id="diagram" xmlns="http://www.w3.org/2000/svg"><style>#diagram .node{fill:#abc;stroke:#123;position:fixed;background:url(https://evil.test/pixel)}body{color:red}#diagram ~ body{color:red}#diagram .leak{fill:url(https://evil.test/pixel)}@import "https://evil.test/font";</style><g class="node"><rect width="20" height="10"/></g></svg>')
    expect(svg).toContain('fill: #abc')
    expect(svg).toContain('stroke: #123')
    expect(svg).not.toMatch(/evil\.test|position|background|body|@import/)
  })

  it('reports credential-bearing and outdated files without returning values', () => {
    const document = bundle()
    document.collab = { room: 'wss://relay.test/d/room', key: 'room-secret', ownerPriv: 'owner-secret' }
    const result = validateTacoSecurity(document, '0')
    expect(result.issues).toEqual(['collab-secrets-present', 'runtime-security-outdated'])
    expect(JSON.stringify(result)).not.toContain('room-secret')
    expect(JSON.stringify(result)).not.toContain('owner-secret')
  })

  it('projects Agent-readable files without unknown credential fields', () => {
    const file = bundle().files[0]
    ;(file as unknown as Record<string, unknown>).collab = { key: 'nested-room-secret' }
    ;(file.blocks![0] as unknown as Record<string, unknown>).ownerPriv = 'nested-owner-secret'

    const projected = credentialFreeFile(file)

    expect(projected).not.toHaveProperty('collab')
    expect(projected.blocks?.[0]).toEqual({
      id: 'block-safe', type: 'paragraph', html: '<p data-taco-block-id="block-safe">Safe</p>',
    })
    expect(JSON.stringify(projected)).not.toContain('nested-room-secret')
    expect(JSON.stringify(projected)).not.toContain('nested-owner-secret')
  })
})
