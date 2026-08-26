import { describe, expect, it } from 'vitest'
import type { TacoBundle } from '../src/model.ts'
import {
  inertImageAttributes,
  credentialFreeFile,
  sanitizeEditorHtml,
  sanitizeMermaidSvg,
  validateTacoSecurity,
} from '../src/security.ts'
import { rebuildSyncDoc, validateOps, validatePresence, validateSyncState } from '../src/sync/validation.ts'
import { SYNC_V } from '../src/sync/crdt.ts'
import { toSyncDoc } from '../src/store.ts'

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
    expect(Array.from(parsed.querySelectorAll('.node .label text, .edgeLabel text')).every((label) =>
      label.getAttribute('text-anchor') === 'middle'
      && label.getAttribute('style')?.includes('text-anchor:middle')))
      .toBe(true)
    expect(svg).toContain('<svg')
    expect(parsed.querySelector('path.relation')?.getAttribute('fill')).toBe('none')
    expect(parsed.querySelector('.edgeLabel rect.background')?.getAttribute('fill')).toBe('none')
    expect(parsed.querySelector('.edgeLabel rect.background')?.getAttribute('stroke')).toBe('none')
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

describe('collaboration input validation', () => {
  it('rebuilds a snapshot key by key and sanitizes remote block HTML', () => {
    const document = bundle()
    const sync = toSyncDoc(document)
    const block = sync.files[0].nodes[0]
    if (block.kind !== 'block') throw new Error('expected block')
    block.html = '<p data-taco-block-id="block-safe" onclick="alert(1)">Remote<img src="https://attacker.test/track"></p>'
    ;(sync as unknown as Record<string, unknown>).collab = { key: 'remote-secret' }
    ;(sync.files[0] as unknown as Record<string, unknown>).unknownSecret = 'drop-me'

    const rebuilt = rebuildSyncDoc(sync, document)
    const rebuiltBlock = rebuilt.files[0].nodes[0]
    expect(rebuilt).not.toHaveProperty('collab')
    expect(rebuilt.files[0]).not.toHaveProperty('unknownSecret')
    expect(rebuiltBlock).toMatchObject({ kind: 'block', type: 'paragraph' })
    expect((rebuiltBlock as { html: string }).html).not.toContain('onclick')
    expect((rebuiltBlock as { html: string }).html).not.toContain('src="https://')
  })

  it('rejects an invalid snapshot atomically before projection', () => {
    const document = bundle()
    const sync = toSyncDoc(document)
    sync.files.push(structuredClone(sync.files[0]))
    expect(() => rebuildSyncDoc(sync, document)).toThrow('security:duplicate-sync-file')
    expect(document.files[0].content).toBe('Safe')
  })

  it('rejects malformed optional comment message timestamps atomically', () => {
    const document = bundle()
    document.comments = [{
      id: 'thread-security',
      anchor: { path: document.files[0].path, position: { start: 0, end: 4 }, quote: { exact: 'Safe', prefix: '', suffix: '' } },
      status: 'open',
      messages: [{ id: 'message-security', author: 'Ada', body: 'Review', createdAt: '2026-08-10T00:00:00.000Z' }],
      createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
    }]
    const sync = toSyncDoc(document)
    const message = sync.files[0].nodes.find((node) => node.id === 'message-security') as unknown as Record<string, unknown>
    message.deletedAt = 'invalid'
    expect(() => rebuildSyncDoc(sync, document)).toThrow('security:invalid-comment-message')
    expect(document.comments[0].messages[0].body).toBe('Review')
  })

  it('rejects credential mutation and malformed operation units', () => {
    const valid = [{ a: 'peer', s: 1, l: 1, op: 'set', k: 'title', v: 'Remote' }]
    expect(validateOps(valid)).toEqual(valid)
    expect(validateOps([{ a: 'peer', s: 2, l: 2, op: 'set', k: 'title' }])).toHaveLength(1)
    expect(() => validateOps([...valid, { a: 'peer', s: 2, l: 2, op: 'set', k: 'collab.key', v: 'secret' }])).toThrow('security:invalid-set-op')
    expect(() => validateOps([{ a: 'peer', s: 3, l: 3, op: 'ins', kind: 'element', id: 'bad', sl: 'file-spec', ord: 'U', node: {} }])).toThrow('security:invalid-ins-op')
  })

  it('requires the complete supported sync-state envelope', () => {
    const state = { v: SYNC_V, lamport: 0, vv: {}, regs: {}, pos: {}, births: {}, tombs: {}, stash: {}, limbo: {} }
    expect(validateSyncState(state)).toEqual(state)
    expect(() => validateSyncState({ ...state, vv: { peer: 'one' } })).toThrow('security:invalid-sync-state')
    expect(() => validateSyncState({ ...state, pos: { node: { p: '@doc', o: 'not-an-order!', r: [1, 'peer'] } } })).toThrow('security:invalid-sync-state')
  })

  it('accepts only bounded, inert collaboration presence', () => {
    const presence = { name: 'Ada', color: '#123abc', fileId: 'file-spec', from: 0, to: 1, focused: true, hasCursor: true }
    expect(validatePresence(presence)).toEqual(presence)
    expect(() => validatePresence({ ...presence, color: 'url(https://attacker.test/pixel)' })).toThrow('security:invalid-presence')
  })
})
