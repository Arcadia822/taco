import { describe, expect, it } from 'vitest'
import { FORMAT, type TacoBundle } from '../src/model.ts'
import { applySyncDoc, TacoStore, toSyncDoc } from '../src/store.ts'

const createSampleBundle = (): TacoBundle => ({
  format: FORMAT,
  version: 1,
  docId: 'test-doc',
  title: 'Test Doc',
  root: 'specs/sample',
  files: [
    {
      id: 'f1',
      path: 'specs/sample/README.md',
      mediaType: 'text/markdown',
      content: '# Hello',
    },
    {
      id: 'f2',
      path: 'specs/sample/api.md',
      mediaType: 'text/markdown',
      content: '# API',
    },
  ],
})

describe('TacoStore and sync navigation support', () => {
  it('spreads navigation into toSyncDoc when present', () => {
    const bundle = createSampleBundle()
    bundle.navigation = {
      version: 1,
      entry: 'specs/sample/api.md',
      groups: [
        {
          id: 'g1',
          title: 'Docs',
          paths: ['specs/sample/api.md'],
        },
      ],
    }

    const syncDoc = toSyncDoc(bundle)
    expect(syncDoc.navigation).toEqual({
      version: 1,
      entry: 'specs/sample/api.md',
      groups: [
        {
          id: 'g1',
          title: 'Docs',
          paths: ['specs/sample/api.md'],
        },
      ],
    })
  })

  it('updateNavigation commits a document change event and mutates bundle', () => {
    const bundle = createSampleBundle()
    const store = new TacoStore(bundle)
    const events: unknown[] = []
    store.onChange((event) => events.push(event))

    const success = store.updateNavigation({
      version: 1,
      groups: [{ id: 'core', title: 'Core', paths: ['specs/sample/README.md'] }],
    })

    expect(success).toBe(true)
    expect(bundle.navigation).toEqual({
      version: 1,
      groups: [{ id: 'core', title: 'Core', paths: ['specs/sample/README.md'] }],
    })
    expect(events).toEqual([
      {
        source: 'local',
        change: { kind: 'document' },
      },
    ])
  })

  it('applySyncDoc writes back navigation and deletes navigation if omitted on remote', () => {
    const bundle = createSampleBundle()
    bundle.navigation = {
      version: 1,
      groups: [{ id: 'old', title: 'Old', paths: [] }],
    }

    const remoteSync = toSyncDoc(createSampleBundle())
    remoteSync.navigation = {
      version: 1,
      entry: 'specs/sample/api.md',
      groups: [{ id: 'new', title: 'New', paths: ['specs/sample/api.md'] }],
    }

    applySyncDoc(bundle, remoteSync)
    expect(bundle.navigation).toEqual({
      version: 1,
      entry: 'specs/sample/api.md',
      groups: [{ id: 'new', title: 'New', paths: ['specs/sample/api.md'] }],
    })

    const emptyRemote = toSyncDoc(createSampleBundle())
    applySyncDoc(bundle, emptyRemote)
    expect(bundle.navigation).toBeUndefined()
  })
})
