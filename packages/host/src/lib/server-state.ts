import { randomUUID } from 'node:crypto'

export interface TacoPaste {
  id: string
  title: string
  storageKey: string
  contentHash: string
  createdAt: string
  lastSequence: number
}

export interface TacoCommentEvent {
  id: string
  sequence: number
  tacoId: string
  body: string
  author: string
  occurredAt: string
}

class PastebinState {
  pastes = new Map<string, TacoPaste>() // key: paste UUID
  events = new Map<string, TacoCommentEvent[]>() // key: paste UUID
  subscribers = new Map<string, Set<(ev: TacoCommentEvent) => void>>()
}

const globalForState = globalThis as unknown as { __tacoPastebinState?: PastebinState }
export const state = globalForState.__tacoPastebinState || (globalForState.__tacoPastebinState = new PastebinState())

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const hashBuf = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function subscribeToPasteEvents(tacoId: string, listener: (ev: TacoCommentEvent) => void): () => void {
  let listeners = state.subscribers.get(tacoId)
  if (!listeners) {
    listeners = new Set()
    state.subscribers.set(tacoId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners?.delete(listener)
  }
}

export function broadcastPasteEvent(ev: TacoCommentEvent) {
  const listeners = state.subscribers.get(ev.tacoId)
  if (listeners) {
    for (const fn of listeners) {
      fn(ev)
    }
  }
}
