import { storageGet, storageSet } from './kernel/storage.ts'

const LOCAL_KEY = 'taco-author'
const SESSION_KEY = 'taco-session-author'
const MAX_NAME = 64

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

export const requireAuthorName = (promptLabel: string): string | null => {
  const existing = currentAuthorName()
  if (existing) return existing
  const next = normalizeAuthorName(window.prompt(promptLabel)?.trim() ?? '')
  return next ? setAuthorName(next) : null
}
