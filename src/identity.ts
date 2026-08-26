import { storageGet, storageSet } from './kernel/storage.ts'

const LOCAL_KEY = 'taco-author'
const SESSION_KEY = 'taco-session-author'
const MAX_NAME = 64
const PRINCIPAL_PREFIX = 'taco-comment-principal:'

const opaqueId = (): string => globalThis.crypto?.randomUUID?.()
  ?? `principal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export interface CommentPrincipal {
  id: string
  persistent: boolean
}

export const commentPrincipal = (docId: string): CommentPrincipal => {
  const key = `${PRINCIPAL_PREFIX}${docId}`
  const existing = storageGet(key)
  if (existing) return { id: existing, persistent: true }
  const id = opaqueId()
  if (storageSet(key, id)) return { id, persistent: true }
  const sessionKey = `${key}:session`
  const session = storageGet(sessionKey, 'session')
  if (session) return { id: session, persistent: false }
  storageSet(sessionKey, id, 'session')
  return { id, persistent: false }
}

export const normalizeAuthorName = (value: string): string => value.trim().slice(0, MAX_NAME)

export const currentAuthorName = (): string =>
  normalizeAuthorName(storageGet(SESSION_KEY, 'session') ?? storageGet(LOCAL_KEY) ?? '')

export const displayAuthorName = (): string => currentAuthorName() || 'Guest'

export const setAuthorName = (value: string): string => {
  const name = normalizeAuthorName(value)
  storageSet(SESSION_KEY, name, 'session')
  if (name) storageSet(LOCAL_KEY, name)
  return name
}
