import { describe, expect, it } from 'vitest'
import { BundleDirtyTracker } from '../src/dirty-tracker.ts'
import type { TacoBundle } from '../src/model.ts'
import { TacoStore } from '../src/store.ts'

const bundle = (): TacoBundle => ({
  format: 'taco/files',
  version: 1,
  docId: 'dirty-tracker-test',
  title: 'Dirty tracker test',
  root: 'specs/dirty-tracker',
  files: [{
    id: 'file-spec',
    path: 'specs/dirty-tracker/spec.md',
    mediaType: 'text/markdown',
    content: 'Original',
    blocks: [{ id: 'block-original', type: 'paragraph', html: '<p>Original</p>' }],
  }],
})

describe('BundleDirtyTracker', () => {
  it('checks the affected file and becomes clean when the edit is undone', () => {
    const document = bundle()
    const store = new TacoStore(document)
    const tracker = new BundleDirtyTracker(document)
    store.onChange(({ change }) => tracker.note(change))

    store.commit({ kind: 'file', fileId: 'file-spec' }, () => { document.files[0].content = 'Changed' })
    expect(tracker.isDirty()).toBe(true)

    store.commit({ kind: 'file', fileId: 'file-spec' }, () => { document.files[0].content = 'Original' })
    expect(tracker.isDirty()).toBe(false)
  })

  it('ignores derived editor blocks when persisted content is unchanged', () => {
    const document = bundle()
    const store = new TacoStore(document)
    const tracker = new BundleDirtyTracker(document)
    store.onChange(({ change }) => tracker.note(change))

    store.commit({ kind: 'file', fileId: 'file-spec' }, () => {
      document.files[0].blocks = [{ id: 'block-derived', type: 'paragraph', html: '<p>Original</p>' }]
    })

    expect(tracker.isDirty()).toBe(false)
  })
})
