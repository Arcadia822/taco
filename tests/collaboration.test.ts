import { describe, expect, it, vi } from 'vitest'
import type { TacoBundle } from '../src/model.ts'
import { applySyncDoc, projectSyncChanges, TacoStore, toSyncDoc, type TacoSyncDoc } from '../src/store.ts'
import { SyncState } from '../src/sync/crdt.ts'
import { TacoSyncSession, type Frame } from '../src/sync/session.ts'
import { SYNC_V } from '../src/sync/crdt.ts'
import { joinFromDoc, onlineTransport, stopSharing } from '../src/sync/online.ts'

const bundle = (): TacoBundle => ({
  format: 'taco/files',
  version: 1,
  docId: 'collaboration-test',
  title: 'Collaboration test',
  root: 'specs/collaboration',
  files: [{
    id: 'file-spec',
    path: 'specs/collaboration/spec.md',
    mediaType: 'text/markdown',
    content: 'Hello',
    blocks: [{
      id: 'block-intro',
      type: 'paragraph',
      html: '<p data-taco-block-id="block-intro">Hello</p>',
    }],
  }],
})

const mutateBlock = (doc: TacoSyncDoc, text: string): void => {
  const block = doc.files[0].nodes.find((node) => node.id === 'block-intro')
  if (!block || block.kind !== 'block') throw new Error('missing block')
  block.html = `<p data-taco-block-id="block-intro">${text}</p>`
}

describe('local collaboration', () => {
  it('keeps a new session inactive until collaboration is explicitly enabled', () => {
    const document = bundle()
    const session = new TacoSyncSession(new TacoStore(document))

    expect(session.isActive()).toBe(false)
    session.stampInto(document)
    expect(document.collab).toBeUndefined()

    session.enable()
    expect(session.isActive()).toBe(true)
    session.stampInto(document)
    expect(document.collab?.sync).toBeDefined()

    session.disable()
    expect(session.isActive()).toBe(false)
  })

  it('does not present another tab with the same collaboration identity as a guest', () => {
    const document = bundle()
    document.collab = { owner: 'same-owner-key', ownerPriv: 'private-key' }
    const session = new TacoSyncSession(new TacoStore(document))
    const receive = (session as unknown as { onFrame(frame: Frame): void }).onFrame.bind(session)
    const presence = {
      name: 'Guest', color: '#123456', fileId: 'file-spec', from: 0, to: 0,
      focused: false, hasCursor: false, role: 'owner' as const, pub: 'same-owner-key',
    }

    receive({ t: 'p', a: 'another-tab', p: presence, pv: SYNC_V })
    receive({ t: 'p', a: 'actual-guest', p: { ...presence, pub: 'other-key' }, pv: SYNC_V })

    expect(session.peers()).toHaveLength(2)
    expect(session.collaborators().map((peer) => peer.actor)).toEqual(['actual-guest'])
  })

  it('keeps online transports scoped to their own Taco session', () => {
    class FakeWebSocket {
      static readonly OPEN = 1
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onclose: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(readonly url: string) {}
      send(): void {}
      close(): void { this.onclose?.() }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const firstDocument = bundle()
    const secondDocument = { ...bundle(), docId: 'collaboration-test-two' }
    const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    firstDocument.collab = { room: 'ws://localhost:8787/d/first', key, on: true }
    secondDocument.collab = { room: 'ws://localhost:8787/d/second', key, on: true }
    const firstStore = new TacoStore(firstDocument)
    const secondStore = new TacoStore(secondDocument)
    const firstSession = new TacoSyncSession(firstStore)
    const secondSession = new TacoSyncSession(secondStore)
    firstSession.enable()
    secondSession.enable()

    const firstTransport = joinFromDoc(firstSession, firstStore)
    const secondTransport = joinFromDoc(secondSession, secondStore)

    expect(firstTransport).not.toBeNull()
    expect(secondTransport).not.toBeNull()
    expect(secondTransport).not.toBe(firstTransport)
    expect(onlineTransport(firstSession)).toBe(firstTransport)
    expect(onlineTransport(secondSession)).toBe(secondTransport)

    stopSharing(firstSession, firstStore)
    stopSharing(secondSession, secondStore)
    firstSession.close()
    secondSession.close()
    vi.unstubAllGlobals()
  })

  it('syncs file title metadata without changing the file path', () => {
    const source = bundle()
    source.files[0].title = 'Collaborative specification'
    const target = bundle()
    const originalPath = target.files[0].path

    applySyncDoc(target, toSyncDoc(source))

    expect(target.files[0].title).toBe('Collaborative specification')
    expect(target.files[0].path).toBe(originalPath)
  })

  it('projects only the changed file into the collaboration document', () => {
    const source = bundle()
    source.files.push({
      id: 'file-plan',
      path: 'specs/collaboration/plan.md',
      mediaType: 'text/markdown',
      content: 'Plan',
      blocks: [{ id: 'block-plan', type: 'paragraph', html: '<p data-taco-block-id="block-plan">Plan</p>' }],
    })
    const initial = toSyncDoc(source)
    const unchangedFile = initial.files[1]
    source.files[0].title = 'Updated title'

    const projected = projectSyncChanges(initial, source, [{ kind: 'file', fileId: 'file-spec' }])

    expect(projected).not.toBe(initial)
    expect(projected.files[0].title).toBe('Updated title')
    expect(projected.files[1]).toBe(unchangedFile)
    expect(projected.title).toBe(initial.title)
  })

  it('keeps incremental file projection byte-for-byte equivalent to a full projection', () => {
    const source = bundle()
    source.files.push({
      id: 'file-plan',
      path: 'specs/collaboration/plan.md',
      mediaType: 'text/markdown',
      content: 'Plan',
      blocks: [{ id: 'block-plan', type: 'paragraph', html: '<p data-taco-block-id="block-plan">Plan</p>' }],
    })
    const initial = toSyncDoc(source)
    source.files[0].title = 'Updated specification'
    source.files[1].blocks![0].html = '<p data-taco-block-id="block-plan">Updated plan</p>'
    source.comments = [{
      id: 'thread-plan',
      anchor: {
        path: source.files[1].path,
        position: { start: 0, end: 4 },
        quote: { exact: 'Plan', prefix: '', suffix: '' },
      },
      status: 'open',
      messages: [{ id: 'message-plan', author: 'Ada', body: 'Expand this.', createdAt: '2026-08-11T00:00:00.000Z' }],
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    }]

    const projected = projectSyncChanges(initial, source, [
      { kind: 'file', fileId: 'file-spec' },
      { kind: 'file', fileId: 'file-plan' },
      { kind: 'comments' },
    ])

    expect(projected).toEqual(toSyncDoc(source))
  })

  it('converges concurrent edits inside the same Markdown block', () => {
    const initial = toSyncDoc(bundle())
    const leftDoc = structuredClone(initial)
    const rightDoc = structuredClone(initial)
    const left = new SyncState('left')
    const right = new SyncState('right')
    left.adopt(leftDoc)
    right.adopt(rightDoc)

    const leftBefore = structuredClone(leftDoc)
    const rightBefore = structuredClone(rightDoc)
    mutateBlock(leftDoc, 'Hello brave')
    mutateBlock(rightDoc, 'Hello world')
    const leftOps = left.diff(leftBefore, leftDoc, { text: true })
    const rightOps = right.diff(rightBefore, rightDoc, { text: true })

    left.apply(leftDoc, rightOps)
    right.apply(rightDoc, leftOps)

    expect(leftDoc).toEqual(rightDoc)
    const html = (leftDoc.files[0].nodes[0] as { html: string }).html
    expect(html).toContain('brave')
    expect(html).toContain('world')
  })

  it('keeps independently-created comment threads from both replicas', () => {
    const initial = toSyncDoc(bundle())
    const leftDoc = structuredClone(initial)
    const rightDoc = structuredClone(initial)
    const left = new SyncState('left')
    const right = new SyncState('right')
    left.adopt(leftDoc)
    right.adopt(rightDoc)

    const makeNodes = (suffix: string, author: string) => [{
      id: `thread-${suffix}`,
      kind: 'comment-thread' as const,
      anchor: {
        path: 'specs/collaboration/spec.md',
        position: { start: 0, end: 5 },
        quote: { exact: 'Hello', prefix: '', suffix: '' },
      },
      status: 'open' as const,
      createdAt: `2026-08-10T00:00:0${suffix === 'left' ? '1' : '2'}.000Z`,
      updatedAt: `2026-08-10T00:00:0${suffix === 'left' ? '1' : '2'}.000Z`,
    }, {
      id: `message-${suffix}`,
      kind: 'comment-message' as const,
      threadId: `thread-${suffix}`,
      author,
      body: `from ${suffix}`,
      createdAt: `2026-08-10T00:00:0${suffix === 'left' ? '1' : '2'}.000Z`,
    }]

    const leftBefore = structuredClone(leftDoc)
    const rightBefore = structuredClone(rightDoc)
    leftDoc.files[0].nodes.push(...makeNodes('left', 'Ada'))
    rightDoc.files[0].nodes.push(...makeNodes('right', 'Grace'))
    const leftOps = left.diff(leftBefore, leftDoc, { text: true })
    const rightOps = right.diff(rightBefore, rightDoc, { text: true })

    left.apply(leftDoc, rightOps)
    right.apply(rightDoc, leftOps)

    expect(leftDoc).toEqual(rightDoc)
    const materialized = bundle()
    applySyncDoc(materialized, leftDoc)
    expect(materialized.comments?.map((thread) => thread.messages[0].author).sort()).toEqual(['Ada', 'Grace'])
  })
})
