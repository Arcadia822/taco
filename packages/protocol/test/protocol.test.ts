import { describe, expect, it } from 'vitest'
import {
  canonicalizeJson,
  computeSnapshotContentHash,
  isSafePath,
  isSafeRootPath,
  projectLocalBundleToUploadContent,
  validateDocumentSnapshot,
  validateImportedThread,
  validateStagedUploadContent,
} from '../src/index.ts'

describe('@taco/protocol', () => {
  it('canonicalizes JSON strictly per RFC 8785 (keys sorted by UTF-16 code units)', () => {
    const obj = { b: 1, a: 2, c: { z: 3, y: [null, undefined, 4] } }
    expect(canonicalizeJson(obj)).toBe('{"a":2,"b":1,"c":{"y":[null,null,4],"z":3}}')
  })

  it('validates safe paths rejecting traversals, backslashes, NUL, and drive letters', () => {
    expect(isSafePath('specs/example/spec.md')).toBe(true)
    expect(isSafePath('file.txt')).toBe(true)
    expect(isSafePath('deep/nested/path/to/asset.png')).toBe(true)

    expect(isSafePath('/etc/passwd')).toBe(false)
    expect(isSafePath('../secret')).toBe(false)
    expect(isSafePath('specs/../../secret')).toBe(false)
    expect(isSafePath('specs/./file.md')).toBe(false)
    expect(isSafePath('specs//file.md')).toBe(false)
    expect(isSafePath('specs\\file.md')).toBe(false)
    expect(isSafePath('C:/file.md')).toBe(false)
    expect(isSafePath('file\0.md')).toBe(false)
    expect(isSafePath('')).toBe(false)
  })

  it('validates safe root path permitting dot or clean relative directory', () => {
    expect(isSafeRootPath('.')).toBe(true)
    expect(isSafeRootPath('specs/008-taco-host-contract')).toBe(true)
    expect(isSafeRootPath('/root')).toBe(false)
    expect(isSafeRootPath('../outside')).toBe(false)
  })

  it('validates imported thread and enforces tombstone deletedAt body requirement', () => {
    const thread = {
      id: 'th_1',
      anchor: {
        path: 'doc.md',
        position: { start: 0, end: 5 },
        quote: { exact: 'Hello', prefix: '', suffix: '' },
      },
      status: 'open',
      createdAt: '2026-09-17T10:00:00Z',
      updatedAt: '2026-09-17T10:00:00Z',
      messages: [
        {
          id: 'm1',
          author: 'Alice',
          body: 'First message',
          createdAt: '2026-09-17T10:00:00Z',
        },
      ],
    }

    const res1 = validateImportedThread(thread)
    expect(res1.ok).toBe(true)

    const deletedInvalid = {
      ...thread,
      messages: [
        {
          id: 'm1',
          author: 'Alice',
          body: 'Original text that was deleted',
          createdAt: '2026-09-17T10:00:00Z',
          deletedAt: '2026-09-17T10:05:00Z',
        },
      ],
    }
    const res2 = validateImportedThread(deletedInvalid)
    expect(res2.ok).toBe(false)
    expect(res2.err).toContain('[Deleted message]')

    const deletedValid = {
      ...thread,
      messages: [
        {
          id: 'm1',
          author: 'Alice',
          body: '[Deleted message]',
          createdAt: '2026-09-17T10:00:00Z',
          deletedAt: '2026-09-17T10:05:00Z',
        },
      ],
    }
    expect(validateImportedThread(deletedValid).ok).toBe(true)
  })

  it('projects local bundle stripping known secrets and rejecting undeclared properties', async () => {
    const localBundle = {
      format: 'taco/files',
      version: 1,
      docId: 'doc_123',
      title: 'Test Document',
      root: 'specs/test',
      access: 'writer',
      collab: { role: 'editor', room: 'secret-room-token' },
      packOptions: { exclude: [] },
      files: [
        {
          path: 'specs/test/spec.md',
          mediaType: 'text/markdown',
          content: '# Header\n\nBody content',
          sourceUrl: 'file:///local/path/spec.md',
        },
      ],
    }

    const projection = projectLocalBundleToUploadContent(localBundle)
    expect(projection.ok).toBe(true)
    if (!projection.ok) return

    expect(projection.strippedCategories).toContain('access')
    expect(projection.strippedCategories).toContain('collab')
    expect(projection.strippedCategories).toContain('packOptions')
    expect(projection.strippedCategories).toContain('sourceUrl')

    // Verify projected snapshot matches validation rules
    const validated = validateStagedUploadContent(projection.content)
    expect(validated.ok).toBe(true)

    // Compute hash
    const hash = await computeSnapshotContentHash(projection.content.snapshot)
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/)

    // Reject undeclared properties
    const hostileBundle = {
      ...localBundle,
      maliciousExtraProperty: 'danger',
    }
    const hostileProjection = projectLocalBundleToUploadContent(hostileBundle)
    expect(hostileProjection.ok).toBe(false)
    expect(hostileProjection.err).toContain('Undeclared top-level property rejected')
  })
})
