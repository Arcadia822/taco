import { beforeEach, describe, expect, it } from 'vitest'
import type { TacoBundle } from '../src/model.ts'
import { parseBundle } from '../src/model.ts'
import {
  editorInviteBundle,
  sealedReaderBundle,
} from '../src/sharing.ts'
import { TacoStore } from '../src/store.ts'
import { mintCollab, setSyncHost } from '../src/sync/online.ts'

const bundle = (): TacoBundle => ({
  format: 'taco/files',
  version: 1,
  docId: 'sharing-test',
  title: 'Sharing test',
  root: 'specs/sharing',
  files: [{ path: 'specs/sharing/spec.md', mediaType: 'text/markdown', content: '# Sharing' }],
  comments: [{
    id: 'thread-1',
    anchor: { path: 'specs/sharing/spec.md', position: { start: 0, end: 1 }, quote: { exact: '#', prefix: '', suffix: ' Sharing' } },
    status: 'open',
    messages: [{ id: 'message-1', author: 'Ada', body: 'Review', createdAt: '2026-08-10T00:00:00.000Z' }],
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  }],
})

describe('Bento-style Taco sharing copies', () => {
  beforeEach(() => {
    localStorage.clear()
    setSyncHost('ws://localhost:8787')
  })

  it('mints an owner room and a delegated editor invitation without leaking the owner key', async () => {
    const source = bundle()
    source.collab = await mintCollab()
    ;(source.collab as unknown as Record<string, unknown>).writerPriv = 'legacy-writer-secret'
    ;(source.collab as unknown as Record<string, unknown>).futurePrivate = 'future-secret'

    const invited = await editorInviteBundle(source)

    expect(source.collab.ownerPriv).toBeTruthy()
    expect(invited.collab).toMatchObject({
      room: source.collab.room,
      key: source.collab.key,
      owner: source.collab.owner,
      role: 'writer',
      on: true,
    })
    expect(invited.collab?.ownerPriv).toBeUndefined()
    expect(invited.collab?.invite?.priv).toBeTruthy()
    expect(invited.collab?.invite?.sig).toBeTruthy()
    expect(Object.keys(invited.collab ?? {}).sort()).toEqual(['invite', 'key', 'on', 'owner', 'role', 'room', 'v'])
    expect(Object.keys(invited.collab?.invite ?? {}).sort()).toEqual(['priv', 'pub', 'role', 'sig'])
    expect(invited.collab).not.toHaveProperty('writerPriv')
    expect(invited.collab).not.toHaveProperty('futurePrivate')
    expect(JSON.stringify(invited)).not.toContain('legacy-writer-secret')
    expect(JSON.stringify(invited)).not.toContain('future-secret')
    expect(parseBundle(JSON.stringify(invited))).toMatchObject({ ok: true })
  })

  it('enforces a sealed reader at the store boundary', async () => {
    const source = bundle()
    source.collab = await mintCollab()
    const reader = sealedReaderBundle(source)
    const store = new TacoStore(reader)

    const committed = store.commit({ kind: 'document' }, () => { reader.title = 'Tampered' })

    expect(committed).toBe(false)
    expect(reader.title).toBe('Sharing test')
    expect(reader.access).toBe('reader')
    expect(reader.collab).toBeUndefined()
  })
})
