import type { DocumentSnapshot } from '@taco/protocol'
import { getDatabase, type SharedStateResult, type StoredEvent } from './db'

export { sha256Hex } from './db'

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

type EventListener = (ev: StoredEvent) => void

class ServerRuntimeState {
  subscribers = new Map<string, Set<EventListener>>()
}

const globalForState = globalThis as unknown as { __tacoServerRuntimeState?: ServerRuntimeState }
const runtimeState = globalForState.__tacoServerRuntimeState || (globalForState.__tacoServerRuntimeState = new ServerRuntimeState())

export function subscribeToTacoEvents(tacoId: string, listener: EventListener): () => void {
  let listeners = runtimeState.subscribers.get(tacoId)
  if (!listeners) {
    listeners = new Set()
    runtimeState.subscribers.set(tacoId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners?.delete(listener)
  }
}

export function broadcastTacoEvent(ev: StoredEvent): void {
  const listeners = runtimeState.subscribers.get(ev.tacoId)
  if (listeners) {
    for (const fn of listeners) {
      try {
        fn(ev)
      } catch {
        // Ignore subscriber drop
      }
    }
  }
}
export function subscribeToPasteEvents(tacoId: string, listener: (ev: TacoCommentEvent) => void): () => void {
  return subscribeToTacoEvents(tacoId, (stored) => {
    const data = stored.data && typeof stored.data === 'object' ? stored.data : undefined
    const body = data && 'body' in data && typeof data.body === 'string' ? data.body : ''
    let author = 'Anonymous'
    if (typeof stored.actor === 'string') {
      author = stored.actor
    } else if (stored.actor && typeof stored.actor === 'object' && 'displayName' in stored.actor) {
      const name = stored.actor.displayName
      if (typeof name === 'string') author = name
    }
    listener({
      id: stored.id,
      sequence: Number(stored.sequence),
      tacoId: stored.tacoId,
      body,
      author,
      occurredAt: stored.occurredAt,
    })
  })
}

export function broadcastPasteEvent(ev: TacoCommentEvent): void {
  broadcastTacoEvent({
    id: ev.id,
    sequence: String(ev.sequence),
    tacoId: ev.tacoId,
    type: 'comment.created',
    occurredAt: ev.occurredAt,
    actor: { kind: 'guest', id: ev.author, displayName: ev.author, verified: false },
    data: { body: ev.body },
  })
}

export async function getSharedReviewState(tacoId: string): Promise<SharedStateResult | null> {
  try {
    const db = getDatabase()
    return await db.getSharedState(tacoId)
  } catch {
    return null
  }
}

// Export dummy state for any legacy direct field access
export const state = {
  pastes: new Map<string, TacoPaste>(),
  events: new Map<string, TacoCommentEvent[]>(),
  subscribers: runtimeState.subscribers,
}
