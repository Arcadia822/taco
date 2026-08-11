// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Adapted for Taco from Bento kernel/src/storage.ts.

const backing = (kind: 'local' | 'session'): Storage | null => {
  try {
    return kind === 'local' ? globalThis.localStorage ?? null : globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

export const storageGet = (key: string, kind: 'local' | 'session' = 'local'): string | null => {
  try { return backing(kind)?.getItem(key) ?? null }
  catch { return null }
}

export const storageSet = (key: string, value: string, kind: 'local' | 'session' = 'local'): boolean => {
  try {
    const storage = backing(kind)
    if (!storage) return false
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export const storageJson = <T>(key: string, fallback: T, kind: 'local' | 'session' = 'local'): T => {
  const raw = storageGet(key, kind)
  if (raw === null) return fallback
  try { return (JSON.parse(raw) ?? fallback) as T }
  catch { return fallback }
}
