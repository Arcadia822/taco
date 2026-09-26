import { describe, expect, it } from 'vitest'
import { FORMAT, type TacoBundle } from '../src/model.ts'
import { TacoStore } from '../src/store.ts'

const createSampleBundle = (): TacoBundle => ({
  format: FORMAT,
  version: 1,
  docId: 'test-doc',
  title: 'Test Doc',
  root: 'specs/sample',
  files: [
    {
      id: 'f1',
      path: 'specs/sample/overview.md',
      mediaType: 'text/markdown',
      content: '# Overview',
    },
    {
      id: 'f2',
      path: 'specs/sample/api.md',
      mediaType: 'text/markdown',
      content: '# API',
    },
  ],
})

describe('TacoStore', () => {
  it('updateNavigation commits a document change event and mutates bundle', () => {
    const bundle = createSampleBundle()
    const store = new TacoStore(bundle)
    const events: unknown[] = []
    store.onChange((event) => events.push(event))

    const success = store.updateNavigation({
      version: 1,
      entry: 'specs/sample/api.md',
      groups: [],
    })

    expect(success).toBe(true)
    expect(bundle.navigation).toEqual({
      version: 1,
      entry: 'specs/sample/api.md',
      groups: [],
    })
    expect(events).toEqual([
      {
        source: 'local',
        change: { kind: 'document' },
      },
    ])
  })

  it('commit mutates bundle and emits change event', () => {
    const bundle = createSampleBundle()
    const store = new TacoStore(bundle)
    const events: unknown[] = []
    store.onChange((event) => events.push(event))

    const success = store.commit({ kind: 'file', fileId: 'f1' }, () => {
      bundle.files[0].content = '# Updated Overview'
    })

    expect(success).toBe(true)
    expect(bundle.files[0].content).toBe('# Updated Overview')
    expect(events).toEqual([
      {
        source: 'local',
        change: { kind: 'file', fileId: 'f1' },
      },
    ])
  })

  it('refuses commit when bundle is in reader mode', () => {
    const bundle = createSampleBundle()
    bundle.access = 'reader'
    const store = new TacoStore(bundle)
    const events: unknown[] = []
    store.onChange((event) => events.push(event))

    const success = store.commit({ kind: 'file', fileId: 'f1' }, () => {
      bundle.files[0].content = '# Should Not Update'
    })

    expect(success).toBe(false)
    expect(bundle.files[0].content).toBe('# Overview')
    expect(events).toHaveLength(0)
  })
})
