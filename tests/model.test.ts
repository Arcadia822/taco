import { describe, expect, it } from 'vitest'
import { defaultFile, fileKind, parseBundle, type TacoBundle } from '../src/model.ts'

const bundle = (): TacoBundle => ({
  format: 'taco/files',
  version: 1,
  docId: 'test-bundle',
  title: 'Test spec',
  root: 'specs/001-test',
  files: [
    { title: 'Product specification', path: 'specs/001-test/spec.md', mediaType: 'text/markdown', content: '# Spec' },
    { path: 'specs/001-test/prototype.html', mediaType: 'text/html', content: '<!doctype html><title>Prototype</title>' },
    { path: 'specs/001-test/contracts/openapi.yaml', mediaType: 'application/yaml', content: 'openapi: 3.1.0' },
    { path: 'specs/001-test/config.json', mediaType: 'application/json', content: '{"a":1}' },
  ],
})

describe('file-first Taco bundle', () => {
  it('round-trips file contents without interpreting Markdown', () => {
    const input = bundle()
    const result = parseBundle(JSON.stringify(input))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bundle).toEqual(input)
  })

  it('uses spec.md as the default file', () => {
    expect(defaultFile(bundle())?.path).toBe('specs/001-test/spec.md')
  })

  it('classifies formats without parsing their contents', () => {
    const files = bundle().files
    expect(files.map(fileKind)).toEqual(['markdown', 'html', 'yaml', 'json'])
  })

  it('rejects path traversal and files outside the declared root', () => {
    const escaped = bundle()
    escaped.files[0].path = 'specs/001-test/../secret.md'
    expect(parseBundle(JSON.stringify(escaped))).toMatchObject({ ok: false, err: 'shape' })
    escaped.files[0].path = 'specs/002-other/spec.md'
    expect(parseBundle(JSON.stringify(escaped))).toMatchObject({ ok: false, err: 'shape' })
  })

  it('rejects duplicate paths and malformed bundles', () => {
    const duplicate = bundle()
    duplicate.files.push(structuredClone(duplicate.files[0]))
    expect(parseBundle(JSON.stringify(duplicate))).toMatchObject({ ok: false, err: 'shape' })
    expect(parseBundle('{')).toMatchObject({ ok: false, err: 'json' })
    expect(parseBundle('')).toEqual({ ok: false, err: 'empty' })
  })

  it('rejects malformed optional file titles', () => {
    const invalid = bundle()
    invalid.files[0].title = '   '
    expect(parseBundle(JSON.stringify(invalid))).toMatchObject({ ok: false, err: 'shape' })
  })

  it('accepts only lowercase SHA-256 source baselines', () => {
    const based = bundle()
    based.files[0].sourceHash = 'a'.repeat(64)
    expect(parseBundle(JSON.stringify(based))).toMatchObject({ ok: true })
    based.files[0].sourceHash = 'not-a-sha256'
    expect(parseBundle(JSON.stringify(based))).toMatchObject({ ok: false, err: 'shape' })
  })

  it('opens future bundle versions in frozen mode', () => {
    const future = bundle()
    future.version = 99
    expect(parseBundle(JSON.stringify(future))).toMatchObject({ ok: true, frozen: 'version' })
  })

  it('rejects malformed collaboration credentials and access modes', () => {
    const invalidRoom = bundle()
    invalidRoom.collab = { room: 'https://relay.example.test', key: 'secret' }
    expect(parseBundle(JSON.stringify(invalidRoom))).toMatchObject({ ok: false, err: 'shape' })

    const invalidAccess = bundle() as unknown as Record<string, unknown>
    invalidAccess.access = 'writer'
    expect(parseBundle(JSON.stringify(invalidAccess))).toMatchObject({ ok: false, err: 'shape' })
  })

  it('accepts valid anchored comment threads and rejects missing-file anchors', () => {
    const commented = bundle()
    commented.comments = [{
      id: 'thread-1',
      anchor: {
        path: 'specs/001-test/spec.md',
        position: { start: 0, end: 6 },
        quote: { exact: '# Spec', prefix: '', suffix: '' },
      },
      status: 'open',
      messages: [{ id: 'message-1', author: 'Local user', body: 'Clarify this.', createdAt: '2026-08-10T00:00:00.000Z' }],
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    }]
    expect(parseBundle(JSON.stringify(commented))).toMatchObject({ ok: true })
    commented.comments[0].anchor.block = { id: 'block-code', type: 'codeBlock', language: 'typescript' }
    expect(parseBundle(JSON.stringify(commented))).toMatchObject({ ok: true })
    commented.comments[0].anchor.block.type = 'paragraph' as 'codeBlock'
    expect(parseBundle(JSON.stringify(commented))).toMatchObject({ ok: false, err: 'shape' })
    commented.comments[0].anchor.block.type = 'codeBlock'
    commented.comments[0].anchor.path = 'specs/001-test/missing.md'
    expect(parseBundle(JSON.stringify(commented))).toMatchObject({ ok: false, err: 'shape' })
  })
})
