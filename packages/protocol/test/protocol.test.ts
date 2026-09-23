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
  it('preserves valid checkpoints in projected and validated Host snapshots', () => {
    const checkpoints = {
      version: 1,
      nodes: [{
        id: 'plan',
        title: 'Plan',
        after: [],
        documents: [
          { path: 'specs/test/spec.md' },
          { path: 'specs/test/future.md', optional: true },
        ],
      }],
      documents: [
        { path: 'specs/test/future.md', status: 'freeze', updatedAt: '2026-09-23T08:00:00Z' },
      ],
    }
    const localBundle = {
      format: 'taco/files',
      version: 1,
      docId: 'checkpoint-host-test',
      title: 'Checkpoint test',
      root: 'specs/test',
      files: [{ path: 'specs/test/spec.md', mediaType: 'text/markdown', content: '# Spec' }],
      checkpoints,
    }

    const projection = projectLocalBundleToUploadContent(localBundle)
    expect(projection.ok).toBe(true)
    if (!projection.ok) return
    expect(projection.content.snapshot.checkpoints).toBe(checkpoints)
    const validated = validateStagedUploadContent(projection.content)
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    expect(validated.payload.snapshot.checkpoints).toBe(checkpoints)
    expect(validateDocumentSnapshot({ ...localBundle, checkpoints: undefined }).ok).toBe(true)
  })

  it('rejects malformed checkpoints rather than stripping or publishing them', () => {
    const invalid = {
      version: 1,
      nodes: [{
        id: 'plan',
        title: 'Plan',
        after: [],
        documents: [{ path: '../escaped.md' }],
      }],
      documents: [],
    }
    const snapshot = {
      format: 'taco/files',
      version: 1,
      docId: 'checkpoint-host-test',
      title: 'Checkpoint test',
      root: 'specs/test',
      files: [{ path: 'specs/test/spec.md', mediaType: 'text/markdown', content: '# Spec' }],
      checkpoints: invalid,
    }
    const validation = validateDocumentSnapshot(snapshot)
    expect(validation).toMatchObject({
      ok: false,
      err: expect.stringContaining('Checkpoints invalid at checkpoints.nodes[0].documents[0].path'),
    })
    const projection = projectLocalBundleToUploadContent(snapshot)
    expect(projection).toMatchObject({
      ok: false,
      err: expect.stringContaining('checkpoints.nodes[0].documents[0].path'),
    })
    expect(validateStagedUploadContent({ protocol: 'taco-host/1', snapshot }).ok).toBe(false)
  })
})
