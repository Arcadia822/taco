import { describe, expect, it } from 'vitest'
import { defaultFile, fileKind, isInternalFile, parseBundle, type TacoBundle } from '../src/model.ts'

const bundle = (): TacoBundle => ({
  format: 'taco/files',
  version: 1,
  docId: 'test-bundle',
  title: 'Test spec',
  root: 'specs/001-test',
  files: [
    { title: 'Project overview', path: 'specs/001-test/README.md', mediaType: 'text/markdown', content: '# Guide' },
    { title: 'Product specification', path: 'specs/001-test/spec.md', mediaType: 'text/markdown', content: '# Spec' },
    { path: 'specs/001-test/contracts/openapi.yaml', mediaType: 'application/yaml', content: 'openapi: 3.1.0' },
    { path: 'specs/001-test/config.json', mediaType: 'application/json', content: '{"a":1}' },
    { path: 'specs/001-test/diagrams/flow.MMD', mediaType: 'text/plain', content: 'flowchart LR\nA --> B' },
  ],
})

describe('file-first Taco bundle', () => {
  it('round-trips file contents without interpreting Markdown', () => {
    const input = bundle()
    const result = parseBundle(JSON.stringify(input))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bundle).toEqual(input)
  })

  it('defaults to the first visible Markdown file', () => {
    const b = bundle()
    b.files = [b.files[2], b.files[3], b.files[0], b.files[1], b.files[4]]
    expect(defaultFile(b)?.path).toBe('specs/001-test/README.md')
  })

  it('ignores README.md and spec.md filename precedence', () => {
    const readmeLast = bundle()
    readmeLast.files = [...readmeLast.files.slice(1), readmeLast.files[0]]
    expect(defaultFile(readmeLast)?.path).toBe('specs/001-test/spec.md')
  })

  it('prioritizes navigation.entry and falls back when the entry is missing', () => {
    const b = bundle()
    b.navigation = {
      version: 1,
      entry: 'contracts/openapi.yaml',
      groups: [],
    }
    expect(defaultFile(b)?.path).toBe('specs/001-test/contracts/openapi.yaml')

    // 悬空 entry 安全回退至第一个可见 Markdown 文件
    b.navigation!.entry = 'non-existent.md'
    expect(defaultFile(b)?.path).toBe('specs/001-test/README.md')
  })


  it('classifies formats without parsing their contents', () => {
    const files = bundle().files
    expect(files.map(fileKind)).toEqual(['markdown', 'markdown', 'yaml', 'json', 'mermaid'])
  })

  it('treats _dir.yaml as an ordinary visible YAML file while keeping .DS_Store internal', () => {
    const dirYaml = {
      path: 'specs/001-test/docs/_dir.yaml',
      mediaType: 'application/yaml',
      content: 'category: Architecture\n',
    }
    const dsStore = {
      path: 'specs/001-test/.DS_Store',
      mediaType: 'application/octet-stream',
      content: '',
    }
    expect(isInternalFile(dirYaml.path)).toBe(false)
    expect(isInternalFile('_dir.yaml')).toBe(false)
    expect(fileKind(dirYaml)).toBe('yaml')
    expect(isInternalFile(dsStore.path)).toBe(true)

    const onlyYamlAndDsStore: TacoBundle = {
      ...bundle(),
      files: [dsStore, dirYaml],
    }
    expect(defaultFile(onlyYamlAndDsStore)).toEqual(dirYaml)
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

  it('rejects ordinary HTML source files', () => {
    const htmlPath = bundle()
    htmlPath.files.push({
      path: 'specs/001-test/prototype.html',
      mediaType: 'text/plain',
      content: '<!doctype html><title>Prototype</title>',
    })
    expect(parseBundle(JSON.stringify(htmlPath))).toMatchObject({
      ok: false,
      err: 'shape',
      detail: 'HTML source files are not supported: specs/001-test/prototype.html',
    })

    const htmlMediaType = bundle()
    htmlMediaType.files[2].mediaType = 'text/html'
    expect(parseBundle(JSON.stringify(htmlMediaType))).toMatchObject({ ok: false, err: 'shape' })
  })

  it('rejects the legacy sourceUrl field on any file', () => {
    const withSourceUrl = bundle()
    withSourceUrl.files[0] = {
      ...withSourceUrl.files[0],
      sourceUrl: 'file:///Users/example/project/specs/001-test/README.md',
    }
    expect(parseBundle(JSON.stringify(withSourceUrl))).toMatchObject({
      ok: false,
      err: 'shape',
      detail: 'sourceUrl is no longer supported: specs/001-test/README.md',
    })
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

  it('accepts optional message timestamps, rejects malformed ones, and normalizes tombstones', () => {
    const commented = bundle()
    commented.comments = [{
      id: 'thread-1',
      anchor: { path: 'specs/001-test/spec.md', position: { start: 0, end: 6 }, quote: { exact: '# Spec', prefix: '', suffix: '' } },
      status: 'open',
      messages: [{
        id: 'message-1', author: 'Ada', body: 'must not survive', createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z', deletedAt: '2026-08-11T00:00:00.000Z',
      }],
      createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
    }]
    const parsed = parseBundle(JSON.stringify(commented))
    expect(parsed).toMatchObject({ ok: true })
    if (parsed.ok) expect(parsed.bundle.comments?.[0].messages[0].body).toBe('[Deleted message]')
    commented.comments[0].messages[0].updatedAt = 'not-a-timestamp'
    expect(parseBundle(JSON.stringify(commented))).toMatchObject({ ok: false, err: 'shape' })
  })

  it('round-trips a pre-feature comment message without adding optional fields', () => {
    const legacy = bundle()
    legacy.comments = [{
      id: 'thread-legacy',
      anchor: { path: 'specs/001-test/spec.md', position: { start: 0, end: 6 }, quote: { exact: '# Spec', prefix: '', suffix: '' } },
      status: 'open',
      messages: [{ id: 'message-legacy', author: 'Ada', authorId: 'legacy-actor', body: 'Legacy', createdAt: '2026-08-10T00:00:00.000Z' }],
      createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
    }]
    const serialized = JSON.stringify(legacy)
    const parsed = parseBundle(serialized)
    expect(parsed).toMatchObject({ ok: true })
    if (parsed.ok) expect(JSON.stringify(parsed.bundle)).toBe(serialized)
  })

  it('accepts image/png files with valid data URLs and rejects invalid payloads', () => {
    const pngBundle = bundle()
    pngBundle.files.push({
      path: 'specs/001-test/design/screen.png',
      mediaType: 'image/png',
      content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      sourceHash: 'a'.repeat(64),
    })
    expect(parseBundle(JSON.stringify(pngBundle))).toMatchObject({ ok: true })

    const invalidContent = structuredClone(pngBundle)
    invalidContent.files[invalidContent.files.length - 1].content = 'not-a-data-url'
    expect(parseBundle(JSON.stringify(invalidContent))).toMatchObject({ ok: false, err: 'shape' })

    const hasSourceUrl = structuredClone(pngBundle)
    hasSourceUrl.files[hasSourceUrl.files.length - 1].sourceUrl = 'file:///path/to/screen.png'
    expect(parseBundle(JSON.stringify(hasSourceUrl))).toMatchObject({ ok: false, err: 'shape' })
  })
})
