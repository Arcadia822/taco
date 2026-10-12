import { describe, expect, it } from 'vitest'
import type { TacoBundle } from '../src/model.ts'
import {
  inertImageAttributes,
  credentialFreeFile,
  sanitizeEditorHtml,
  sanitizeMermaidSvg,
  validateTacoSecurity,
} from '../src/security.ts'
import { credentialFreeDocument, sendLocalHandoff } from '../src/local-handoff.ts'
import { isCommentThread } from '../skills/taco/scripts/pack.mjs'
import type { LocalHandoff } from '@taco/protocol'

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

  it('keeps a scoped child-combinator rule that label text needs, but no sibling escape', () => {
    // Discarding every `>` selector also dropped Mermaid's label reset
    // `#diagram text.actor > tspan { stroke: none }`, so labels inherited the 2px
    // box stroke and read as thick, smeared glyphs. Scoped descent must survive.
    const svg = sanitizeMermaidSvg('<svg id="diagram" xmlns="http://www.w3.org/2000/svg"><style>#diagram .actor{stroke:#28253d;fill:#fff;stroke-width:2}#diagram text.actor>tspan{fill:#28253d;stroke:none}body{color:red}#diagram ~ body{color:red}#diagram + svg{color:red}@import "https://evil.test/font";</style><text class="actor"><tspan>Alice</tspan></text></svg>')
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const css = Array.from(parsed.querySelectorAll('style')).map((node) => node.textContent ?? '').join('\n')
    // Assert the rule survived without pinning its exact serialization.
    expect(css).toContain('#diagram text.actor>tspan{')
    expect(css).toMatch(/#diagram text\.actor>tspan\{[^}]*stroke: none/)
    // Runaway selectors stay out: unscoped page selectors, sibling combinators that
    // can reach outside the SVG, and at-rules that load external resources.
    expect(css).not.toMatch(/(^|[},])body\s*\{/)
    expect(css).not.toContain('~')
    expect(css).not.toContain('+')
    expect(css).not.toContain('@import')
    expect(css).not.toContain('evil.test')
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

  it('strips known credential fields from document, files and blocks while preserving unknown metadata', () => {
    const raw = bundle() as unknown as Record<string, unknown>
    raw.collab = { key: 'top-key', ownerPriv: 'top-owner', invite: { priv: 'top-priv' } }
    raw.access = 'reader'
    raw.token = 'top-token'
    raw.credentials = { secret: 'top-secret' }
    raw.relayConfig = { url: 'wss://relay' }
    raw.customMetadata = { preserved: true }

    const fileObj = (raw.files as Array<Record<string, unknown>>)[0]
    fileObj.key = 'file-key'
    fileObj.token = 'file-token'
    fileObj.customFileField = 123
    const blockObj = (fileObj.blocks as Array<Record<string, unknown>>)[0]
    blockObj.ownerPriv = 'block-priv'
    blockObj.customBlockField = 'ok'
    raw.comments = [{
      id: 'thread-comment',
      anchor: null,
      status: 'open',
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      messages: [{
        id: 'msg-1',
        author: 'Reviewer',
        body: 'Comment text',
        createdAt: '2026-08-10T00:00:00.000Z',
        secret: 'nested-comment-secret',
        apiKey: 'nested-key',
      }],
    }]

    const clean = credentialFreeDocument(raw)
    expect(clean).not.toHaveProperty('collab')
    expect(clean).not.toHaveProperty('access')
    expect(clean).not.toHaveProperty('token')
    expect(clean).not.toHaveProperty('credentials')
    expect(clean).not.toHaveProperty('relayConfig')
    expect(clean).toHaveProperty('customMetadata', { preserved: true })

    const cleanFile = clean.files[0]
    expect(cleanFile).not.toHaveProperty('key')
    expect(cleanFile).not.toHaveProperty('token')
    expect(cleanFile).toHaveProperty('customFileField', 123)

    const cleanBlock = (cleanFile.blocks as Array<Record<string, unknown>>)[0]
    expect(cleanBlock).not.toHaveProperty('ownerPriv')
    expect(cleanBlock).toHaveProperty('customBlockField', 'ok')
    const cleanComment = (clean.comments as Array<Record<string, unknown>>)[0]
    const cleanMessage = (cleanComment.messages as Array<Record<string, unknown>>)[0]
    expect(cleanMessage).not.toHaveProperty('secret')
    expect(cleanMessage).not.toHaveProperty('apiKey')
    expect(cleanMessage).toHaveProperty('body', 'Comment text')
  })

  it('validates comment thread message arrays and accepts anchor:null', () => {
    expect(isCommentThread({
      id: 'thread-null-msg',
      anchor: null,
      status: 'open',
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      messages: [null],
    })).toBe(false)
    expect(isCommentThread({
      id: 'thread-null-arr',
      anchor: null,
      status: 'open',
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      messages: null as unknown as [],
    })).toBe(false)
    expect(isCommentThread({
      id: 'thread-valid',
      anchor: null,
      status: 'open',
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      messages: [{
        id: 'msg-1',
        author: 'Reviewer',
        body: 'Valid comment',
        createdAt: '2026-08-10T00:00:00.000Z',
      }],
    })).toBe(true)
  })

  it('rejects invalid or mismatched acknowledgements in sendLocalHandoff', async () => {
    const dummyDoc = bundle()
    const payload: LocalHandoff = {
      schema: 'taco-local-handoff/1',
      handoffId: 'test-h-1',
      sessionId: 'sess-1',
      docId: dummyDoc.docId,
      createdAt: '2026-10-11T00:00:00Z',
      baseline: dummyDoc,
      snapshot: dummyDoc,
    }

    // Mock fetch returning ok: 'false' as a string (must not be treated as success)
    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () => new Response(JSON.stringify({ ok: 'false', handoffId: 'test-h-1', receiptId: 'rcpt-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
      const ack1 = await sendLocalHandoff({ port: 1234, token: 'tok', docId: dummyDoc.docId, sessionId: 'sess-1', payload })
      expect(ack1.ok).toBe(false)

      // Mismatched handoffId
      globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, handoffId: 'wrong-id', receiptId: 'rcpt-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
      const ack2 = await sendLocalHandoff({ port: 1234, token: 'tok', docId: dummyDoc.docId, sessionId: 'sess-1', payload })
      expect(ack2.ok).toBe(false)

      // Missing receiptId
      globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, handoffId: 'test-h-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
      const ack3 = await sendLocalHandoff({ port: 1234, token: 'tok', docId: dummyDoc.docId, sessionId: 'sess-1', payload })
      expect(ack3.ok).toBe(false)

      // Valid ACK
      globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, handoffId: 'test-h-1', receiptId: 'rcpt-valid' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
      const ackValid = await sendLocalHandoff({ port: 1234, token: 'tok', docId: dummyDoc.docId, sessionId: 'sess-1', payload })
      expect(ackValid.ok).toBe(true)
      expect(ackValid.receiptId).toBe('rcpt-valid')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
