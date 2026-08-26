// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Local-only Taco session adapted from Bento slides/src/sync/session.ts.

import type { TacoBundle } from '../model.ts'
import { projectSyncChanges, TacoStore, toSyncDoc, type StoreChange, type TacoSyncDoc } from '../store.ts'
import { SyncState, SYNC_V, type Op, type SyncStateJSON } from './crdt.ts'
import { storageJson } from '../kernel/storage.ts'
import {
  rebuildSyncDoc,
  validateOps,
  validatePresence,
  validateSyncState,
  validateVersionVector,
} from './validation.ts'
import { assertBoundedJson } from '../security.ts'

export interface TacoPresence {
  name: string
  color: string
  fileId: string
  from: number
  to: number
  focused: boolean
  hasCursor: boolean
  pub?: string
  role?: 'owner' | 'editor' | 'viewer'
}

export interface TacoPeer extends TacoPresence {
  actor: string
  at: number
}

type HelloFrame = { t: 'hello'; a: string; vv: Record<string, number>; p: TacoPresence }
type OpsFrame = { t: 'ops'; a: string; ops: Op[] }
type NeedFrame = { t: 'need'; a: string; vv: Record<string, number> }
type PresenceFrame = { t: 'p'; a: string; p: TacoPresence }
type SnapshotFrame = { t: 'snap'; a: string; doc: TacoSyncDoc; state: SyncStateJSON }
type ByeFrame = { t: 'bye'; a: string }
export type Frame = (HelloFrame | OpsFrame | NeedFrame | PresenceFrame | SnapshotFrame | ByeFrame) & { pv?: number }

export interface Transport {
  readonly kind: string
  send(frame: Frame): void
  close(): void
}

export type RefusalCode = 'too-large' | 'storage-failed' | 'room-full' | 'rate-limited'

// Node exposes BroadcastChannel as well. A jsdom test document is not a real
// browser tab and must not accidentally join every other test fixture that
// happens to reuse the same document id.
const isTestDom = (): boolean => typeof navigator !== 'undefined'
  && /jsdom/i.test(navigator.userAgent)

class BroadcastTransport implements Transport {
  readonly kind = 'local'
  private channel: BroadcastChannel | null = null

  constructor(docId: string, onFrame: (frame: Frame) => void) {
    if (typeof BroadcastChannel === 'undefined' || isTestDom()) return
    this.channel = new BroadcastChannel(`taco-sync-${docId}`)
    this.channel.onmessage = (event) => onFrame(event.data as Frame)
  }

  send(frame: Frame): void { this.channel?.postMessage(frame) }
  close(): void { this.channel?.close() }
}

const COLORS = ['#ef8354', '#4f7cac', '#5aa469', '#9b72cf', '#d1a22f', '#2f9c95', '#d2649a', '#718355']

const actorColor = (actor: string): string => {
  let hash = 0
  for (let index = 0; index < actor.length; index += 1) hash = (hash * 31 + actor.charCodeAt(index)) >>> 0
  return COLORS[hash % COLORS.length]
}

const actorId = (): string => globalThis.crypto?.randomUUID?.().slice(0, 12)
  ?? Math.random().toString(36).slice(2, 14)

const emptyPresence = (): Omit<TacoPresence, 'color'> => ({
  name: 'Guest', fileId: '', from: 0, to: 0, focused: false, hasCursor: false,
})

const HEARTBEAT_MS = 4_000
const PEER_TTL_MS = 11_000
const DIFF_MS = 75

export class TacoSyncSession {
  readonly actor = actorId()
  readonly color = actorColor(this.actor)
  private state: SyncState
  private syncDoc: TacoSyncDoc
  private pendingChanges: StoreChange[] = []
  private log: Op[] = []
  private transports: Transport[] = []
  private peersMap = new Map<string, TacoPeer>()
  private peerListeners = new Set<() => void>()
  private remoteListeners = new Set<() => void>()
  private diffTimer: number | null = null
  private heartbeat: number | null = null
  private forkPending = false
  private presenceValue: Omit<TacoPresence, 'color'> = emptyPresence()
  private active = false
  private closed = false
  private incompatibleProtocols = new Set<string>()
  private readonly unsubscribeStore: () => void
  private readonly beforeUnload = (): void => this.send({ t: 'bye', a: this.actor })

  constructor(private store: TacoStore) {
    this.syncDoc = rebuildSyncDoc(toSyncDoc(store.bundle), store.bundle)
    const saved = store.bundle.collab?.sync as SyncStateJSON | undefined
    try {
      if (saved?.v !== SYNC_V) throw new Error('security:sync-state-version')
      this.state = SyncState.fromJSON(this.actor, validateSyncState(saved))
      this.forkPending = true
    } catch {
      this.state = new SyncState(this.actor)
    }
    this.state.adopt(this.syncDoc)
    this.unsubscribeStore = store.onChange(({ source, change }) => {
      if (source === 'local' && this.active) {
        this.pendingChanges.push(change)
        this.scheduleFlush()
      }
    })
  }

  isActive(): boolean {
    return this.active
  }

  enable(): void {
    if (this.active) return
    this.flush()
    this.transports = [new BroadcastTransport(this.store.bundle.docId, (frame) => this.onFrame(frame))]
    this.active = true
    this.hello()
    if (typeof window !== 'undefined' && !isTestDom()) {
      this.heartbeat = window.setInterval(() => {
        this.pushPresence()
        this.sweepPeers()
      }, HEARTBEAT_MS)
      window.addEventListener('beforeunload', this.beforeUnload)
    }
  }

  disable(): void {
    if (!this.active) return
    this.flush()
    this.send({ t: 'bye', a: this.actor })
    for (const transport of this.transports) transport.close()
    this.transports = []
    this.active = false
    if (this.heartbeat !== null) window.clearInterval(this.heartbeat)
    this.heartbeat = null
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', this.beforeUnload)
    if (this.diffTimer !== null) window.clearTimeout(this.diffTimer)
    this.diffTimer = null
    if (this.peersMap.size) {
      this.peersMap.clear()
      this.emitPeers()
    }
  }

  setPresence(presence: Partial<Omit<TacoPresence, 'color'>>): void {
    this.presenceValue = { ...this.presenceValue, ...presence }
    this.pushPresence()
  }

  presence(): TacoPresence {
    const collab = this.store.bundle.collab
    let pub: string | undefined
    let role: TacoPresence['role']
    if (collab?.role === 'reader') role = 'viewer'
    else if (collab?.ownerPriv && collab.owner) { role = 'owner'; pub = collab.owner }
    else if (collab?.invite) {
      role = 'editor'
      pub = storageJson<{ pub?: string } | null>(`taco-member-${this.store.bundle.docId}`, null)?.pub
    }
    return { ...this.presenceValue, color: this.color, ...(pub ? { pub } : {}), ...(role ? { role } : {}) }
  }

  addTransport(factory: (docId: string, onFrame: (frame: Frame) => void) => Transport): Transport {
    const transport = factory(this.store.bundle.docId, (frame) => this.onFrame(frame))
    this.transports.push(transport)
    this.hello()
    return transport
  }

  removeTransport(transport: Transport): void {
    transport.close()
    this.transports = this.transports.filter((candidate) => candidate !== transport)
  }

  get transportKinds(): string[] {
    return this.transports.map((transport) => transport.kind)
  }

  peers(): TacoPeer[] {
    return [...this.peersMap.values()].sort((left, right) => left.actor.localeCompare(right.actor))
  }

  /** Multiple tabs opened from the same owner/editor copy are one person. */
  collaborators(): TacoPeer[] {
    const ownPub = this.presence().pub
    return this.peers().filter((peer) => !ownPub || peer.pub !== ownPub)
  }

  onPeers(listener: () => void): () => void {
    this.peerListeners.add(listener)
    return () => this.peerListeners.delete(listener)
  }

  onRemote(listener: () => void): () => void {
    this.remoteListeners.add(listener)
    return () => this.remoteListeners.delete(listener)
  }

  flush(): void {
    if (this.diffTimer !== null) {
      window.clearTimeout(this.diffTimer)
      this.diffTimer = null
    }
    if (!this.pendingChanges.length) return
    const before = this.syncDoc
    const after = projectSyncChanges(before, this.store.bundle, this.pendingChanges)
    this.pendingChanges = []
    const ops = this.state.diff(before, after, { text: true })
    this.syncDoc = after
    if (!ops.length) return
    this.log.push(...ops)
    this.send({ t: 'ops', a: this.actor, ops })
  }

  stampInto(bundle: TacoBundle): void {
    if (!this.active) return
    this.flush()
    ;(bundle.collab ??= {}).sync = structuredClone(this.state.toJSON())
  }

  snapshot(): { doc: TacoSyncDoc; state: SyncStateJSON } {
    this.flush()
    return { doc: structuredClone(this.syncDoc), state: structuredClone(this.state.toJSON()) }
  }

  onRelayReady(seen: Set<string>): boolean {
    const missing = this.log.filter((op) => !seen.has(`${op.a}:${op.s}`))
    if (missing.length) this.send({ t: 'ops', a: this.actor, ops: missing })
    const fork = this.forkPending
    this.forkPending = false
    return fork
  }

  refused(code: RefusalCode, ops: Op[] | null): void {
    if (code === 'rate-limited' || !ops?.length) return
    const keys = new Set(ops.map((op) => `${op.a}:${op.s}`))
    this.log = this.log.filter((op) => !keys.has(`${op.a}:${op.s}`))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.disable()
    this.unsubscribeStore()
  }

  private scheduleFlush(): void {
    if (this.diffTimer !== null) return
    this.diffTimer = window.setTimeout(() => {
      this.diffTimer = null
      this.flush()
    }, DIFF_MS)
  }

  hello(): void {
    this.send({ t: 'hello', a: this.actor, vv: this.state.vv, p: this.presence() })
    if (this.forkPending) {
      this.send({ t: 'snap', a: this.actor, doc: structuredClone(this.syncDoc), state: structuredClone(this.state.toJSON()) })
      this.forkPending = false
    }
  }

  private pushPresence(): void {
    this.send({ t: 'p', a: this.actor, p: this.presence() })
  }

  private onFrame(input: unknown): void {
    try { assertBoundedJson(input, 'frame') }
    catch (error) { console.warn(`[taco-security] ${(error as Error).message}`); return }
    if (!input || typeof input !== 'object' || Array.isArray(input)) { console.warn('[taco-security] invalid-frame'); return }
    const frame = input as Partial<Frame>
    if (frame.pv !== SYNC_V) {
      const version = String(frame.pv ?? 'missing')
      if (!this.incompatibleProtocols.has(version)) {
        this.incompatibleProtocols.add(version)
        console.warn(`[taco-sync] incompatible-protocol:${version}; expected:${SYNC_V}`)
      }
      return
    }
    if (typeof frame.a !== 'string' || !frame.a || frame.a.length > 256) { console.warn('[taco-security] invalid-actor'); return }
    if (frame.a === this.actor) return
    if (!['hello', 'ops', 'need', 'p', 'snap', 'bye'].includes(String(frame.t))) {
      console.warn('[taco-security] unknown-frame')
      return
    }
    switch (frame.t) {
      case 'hello': {
        let presence: TacoPresence
        let vv: Record<string, number>
        try { presence = validatePresence(frame.p); vv = validateVersionVector(frame.vv) }
        catch (error) { console.warn(`[taco-security] ${(error as Error).message}`); return }
        this.touchPeer(frame.a, presence)
        this.send({ t: 'p', a: this.actor, p: this.presence() })
        this.send({ t: 'need', a: this.actor, vv: this.state.vv })
        const missing = this.state.missingFor(this.log, vv)
        if (missing.length) this.send({ t: 'ops', a: this.actor, ops: missing })
        break
      }
      case 'need': {
        let vv: Record<string, number>
        try { vv = validateVersionVector(frame.vv) }
        catch (error) { console.warn(`[taco-security] ${(error as Error).message}`); return }
        const missing = this.state.missingFor(this.log, vv)
        if (missing.length) this.send({ t: 'ops', a: this.actor, ops: missing })
        break
      }
      case 'ops':
        if (!frame.ops) { console.warn('[taco-security] invalid-ops-frame'); return }
        this.applyOps(frame.ops)
        break
      case 'snap':
        if (!frame.doc || !frame.state) { console.warn('[taco-security] invalid-snapshot-frame'); return }
        this.applySnapshot(frame.doc, frame.state)
        break
      case 'p':
        try { this.touchPeer(frame.a, validatePresence(frame.p)) }
        catch (error) { console.warn(`[taco-security] ${(error as Error).message}`) }
        break
      case 'bye':
        this.peersMap.delete(frame.a)
        this.emitPeers()
        break
    }
  }

  private applyOps(input: unknown): void {
    this.flush()
    let ops: Op[]
    try { ops = validateOps(input, this.store.bundle) }
    catch (error) {
      console.warn(`[taco-security] ${(error as Error).message}`)
      return
    }
    const beforeDoc = structuredClone(this.syncDoc)
    const beforeState = this.state.toJSON()
    const beforeLogLength = this.log.length
    for (const op of ops) {
      if (!this.log.some((known) => known.a === op.a && known.s === op.s)) this.log.push(op)
    }
    let result
    try {
      result = this.state.apply(this.syncDoc, ops)
      this.syncDoc = rebuildSyncDoc(this.syncDoc, this.store.bundle)
    } catch (error) {
      this.syncDoc = beforeDoc
      this.state = SyncState.fromJSON(this.actor, beforeState)
      this.log.length = beforeLogLength
      console.warn(`[taco-security] ${(error as Error).message}`)
      return
    }
    if (!result.changed) return
    this.store.applyRemote(structuredClone(this.syncDoc))
    for (const listener of this.remoteListeners) listener()
    if (this.state.gappedActors.length) this.send({ t: 'need', a: this.actor, vv: this.state.vv })
  }

  applySnapshot(doc: TacoSyncDoc, state: SyncStateJSON): void {
    let safeDoc: TacoSyncDoc
    let safeState: SyncStateJSON
    try {
      safeDoc = rebuildSyncDoc(doc, this.store.bundle)
      safeState = validateSyncState(state)
    } catch (error) {
      console.warn(`[taco-security] ${(error as Error).message}`)
      return
    }
    this.flush()
    const beforeDoc = structuredClone(this.syncDoc)
    const beforeState = this.state.toJSON()
    let result
    try {
      result = this.state.mergeSnapshot(this.syncDoc, safeDoc, safeState)
      this.syncDoc = rebuildSyncDoc(this.syncDoc, this.store.bundle)
    } catch (error) {
      this.syncDoc = beforeDoc
      this.state = SyncState.fromJSON(this.actor, beforeState)
      console.warn(`[taco-security] ${(error as Error).message}`)
      return
    }
    if (!result.changed) return
    this.store.applyRemote(structuredClone(this.syncDoc))
    for (const listener of this.remoteListeners) listener()
  }

  private touchPeer(actor: string, presence: TacoPresence): void {
    this.peersMap.set(actor, { ...presence, actor, at: Date.now() })
    this.emitPeers()
  }

  private sweepPeers(): void {
    const cutoff = Date.now() - PEER_TTL_MS
    let changed = false
    for (const [actor, peer] of this.peersMap) {
      if (peer.at >= cutoff) continue
      this.peersMap.delete(actor)
      changed = true
    }
    if (changed) this.emitPeers()
  }

  private emitPeers(): void {
    for (const listener of this.peerListeners) listener()
  }

  private send(frame: Frame): void {
    const stamped = { ...frame, pv: SYNC_V }
    for (const transport of this.transports) transport.send(stamped)
  }
}
