// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// `ws` is already supplied by jsdom; this test deliberately exercises a real relay.
// @ts-expect-error the transitive package does not expose declarations in this project
import WebSocketImpl from 'ws'
import {
  mintCollab,
  mintInvite,
  OnlineTransport,
  setSyncHost,
  type OnlineStatus,
} from '../src/sync/online.ts'
import type { Frame } from '../src/sync/session.ts'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, String(value)) }
}

const enabled = process.env.TACO_RELAY_TEST === '1'
const relay = process.env.TACO_RELAY_URL || 'ws://127.0.0.1:8787'
const transports: OnlineTransport[] = []

const waitFor = async (predicate: () => boolean, label: string, timeout = 3_000): Promise<void> => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

const openTransport = async (
  room: string,
  key: string,
  docId: string,
  frames: Frame[],
  auth?: ConstructorParameters<typeof OnlineTransport>[5],
): Promise<OnlineTransport> => {
  const transport = new OnlineTransport(room, key, docId, (frame) => frames.push(frame), {
    onSnap: () => undefined,
    getSnapshot: () => ({ doc: {} as never, state: {} as never }),
    onOpen: () => undefined,
    onReady: () => false,
  }, auth)
  transports.push(transport)
  await waitFor(() => transport.status === 'open', `${docId} socket to open`)
  return transport
}

describe.runIf(enabled)('blind relay integration', () => {
  beforeAll(() => {
    ;(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocketImpl as unknown as typeof WebSocket
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage()
    setSyncHost(relay)
  })

  afterAll(() => {
    for (const transport of transports) transport.close()
  })

  it('replays signed writes, rejects reader writes, and keeps a revoked device out', async () => {
    const collab = await mintCollab()
    const ownerFrames: Frame[] = []
    const owner = await openTransport(collab.room, collab.key, 'relay-owner', ownerFrames, {
      kind: 'direct', pub: collab.owner, priv: collab.ownerPriv,
    })

    owner.send({ t: 'ops', a: 'owner-signed', ops: [] })
    await new Promise((resolve) => setTimeout(resolve, 150))

    const readerFrames: Frame[] = []
    const reader = await openTransport(collab.room, collab.key, 'relay-reader', readerFrames)
    reader.send({ t: 'ops', a: 'reader-unsigned', ops: [] })
    await new Promise((resolve) => setTimeout(resolve, 150))

    const firstReplay: Frame[] = []
    await openTransport(collab.room, collab.key, 'relay-replay-one', firstReplay)
    await waitFor(() => firstReplay.some((frame) => frame.t === 'ops'), 'signed frame replay')
    expect(firstReplay.filter((frame) => frame.t === 'ops').map((frame) => frame.a)).toEqual(['owner-signed'])

    const invite = await mintInvite(collab.ownerPriv)
    const memberFrames: Frame[] = []
    const member = await openTransport(collab.room, collab.key, 'relay-member', memberFrames, {
      kind: 'chain', owner: collab.owner, invite, docId: 'relay-member',
    })
    expect(member.myPub).toBeTruthy()
    member.send({ t: 'ops', a: 'member-signed', ops: [] })
    await new Promise((resolve) => setTimeout(resolve, 150))

    const secondReplay: Frame[] = []
    await openTransport(collab.room, collab.key, 'relay-replay-two', secondReplay)
    await waitFor(
      () => secondReplay.filter((frame) => frame.t === 'ops').length === 2,
      'owner and member replay',
    )
    expect(secondReplay.filter((frame) => frame.t === 'ops').map((frame) => frame.a)).toEqual([
      'owner-signed', 'member-signed',
    ])

    expect(await owner.revokeKey(member.myPub!, collab.owner, collab.ownerPriv)).toBe(true)
    await waitFor(() => member.status === 'closed', 'revoked member socket to close')

    const retryFrames: Frame[] = []
    const retry = new OnlineTransport(collab.room, collab.key, 'relay-member', (frame) => retryFrames.push(frame), {
      onSnap: () => undefined,
      getSnapshot: () => ({ doc: {} as never, state: {} as never }),
      onOpen: () => undefined,
      onReady: () => false,
    }, { kind: 'chain', owner: collab.owner, invite, docId: 'relay-member' })
    transports.push(retry)
    let retryStatus: OnlineStatus = retry.status
    retry.onStatus = (status) => { retryStatus = status }
    retry.send({ t: 'ops', a: 'revoked-retry', ops: [] })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(retryStatus).not.toBe('open')
    retry.close()

    const finalReplay: Frame[] = []
    await openTransport(collab.room, collab.key, 'relay-replay-final', finalReplay)
    await waitFor(
      () => finalReplay.filter((frame) => frame.t === 'ops').length === 2,
      'final persisted replay',
    )
    expect(finalReplay.some((frame) => frame.t === 'ops' && frame.a === 'revoked-retry')).toBe(false)
  })

  it('rejects an old invitation in a replacement room and accepts a newly shared editor', async () => {
    const previous = await mintCollab()
    const oldInvite = await mintInvite(previous.ownerPriv)
    const replacement = await mintCollab()

    const rejectedFrames: Frame[] = []
    const rejected = new OnlineTransport(
      replacement.room,
      replacement.key,
      'replacement-member',
      (frame) => rejectedFrames.push(frame),
      {
        onSnap: () => undefined,
        getSnapshot: () => ({ doc: {} as never, state: {} as never }),
        onOpen: () => undefined,
        onReady: () => false,
      },
      { kind: 'chain', owner: previous.owner, invite: oldInvite, docId: 'replacement-member' },
    )
    transports.push(rejected)
    rejected.send({ t: 'ops', a: 'old-editor', ops: [] })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(rejected.status).not.toBe('open')
    rejected.close()

    const newInvite = await mintInvite(replacement.ownerPriv)
    const editorFrames: Frame[] = []
    const editor = await openTransport(
      replacement.room,
      replacement.key,
      'replacement-member',
      editorFrames,
      { kind: 'chain', owner: replacement.owner, invite: newInvite, docId: 'replacement-member' },
    )
    editor.send({ t: 'ops', a: 'new-editor', ops: [] })
    await new Promise((resolve) => setTimeout(resolve, 150))

    const replay: Frame[] = []
    await openTransport(replacement.room, replacement.key, 'replacement-reader', replay)
    await waitFor(() => replay.some((frame) => frame.t === 'ops'), 'replacement editor replay')
    expect(replay.filter((frame) => frame.t === 'ops').map((frame) => frame.a)).toEqual(['new-editor'])
  })
})
