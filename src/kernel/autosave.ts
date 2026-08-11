// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Adapted for Taco from Bento kernel/src/autosave.ts.

import type { KernelDoc } from './doc.ts'
import { appConfig } from './app.ts'

const DB_VERSION = 1
const RECOVERY = 'recovery'
const VERSIONS = 'versions'
const MAX_VERSIONS = 20
const PRUNE_DAYS = 30

export interface Snapshot {
  id?: number
  docId: string
  at: number
  title: string
  json: string
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return }
    let request: IDBOpenDBRequest
    try { request = indexedDB.open(`${appConfig().appId}-autosave`, DB_VERSION) }
    catch { resolve(null); return }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(RECOVERY)) {
        db.createObjectStore(RECOVERY, { keyPath: 'docId' })
      }
      if (!db.objectStoreNames.contains(VERSIONS)) {
        const store = db.createObjectStore(VERSIONS, { keyPath: 'id', autoIncrement: true })
        store.createIndex('docId', 'docId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return dbPromise
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null
    return new Promise<T | null>((resolve) => {
      let transaction: IDBTransaction
      try { transaction = db.transaction(store, mode) }
      catch { resolve(null); return }
      const request = action(transaction.objectStore(store))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    })
  })
}

const snapshot = (doc: KernelDoc): Snapshot => ({
  docId: doc.docId,
  at: Date.now(),
  title: doc.title,
  json: JSON.stringify(doc),
})

export async function putRecovery(doc: KernelDoc): Promise<boolean> {
  return (await tx(RECOVERY, 'readwrite', (store) => store.put(snapshot(doc)))) !== null
}

export async function getRecovery(docId: string): Promise<Snapshot | null> {
  return (await tx<Snapshot>(RECOVERY, 'readonly', (store) => store.get(docId))) ?? null
}

export async function clearRecovery(docId: string): Promise<void> {
  await tx(RECOVERY, 'readwrite', (store) => store.delete(docId))
}

export async function addVersion(doc: KernelDoc): Promise<void> {
  await tx(VERSIONS, 'readwrite', (store) => store.add(snapshot(doc)))
  const versions = await listVersions(doc.docId)
  await Promise.all(versions.slice(MAX_VERSIONS).map((entry) =>
    tx(VERSIONS, 'readwrite', (store) => store.delete(entry.id!))))
}

export async function listVersions(docId: string): Promise<Snapshot[]> {
  const db = await openDb()
  if (!db) return []
  return new Promise((resolve) => {
    let transaction: IDBTransaction
    try { transaction = db.transaction(VERSIONS, 'readonly') }
    catch { resolve([]); return }
    const index = transaction.objectStore(VERSIONS).index('docId')
    const result: Snapshot[] = []
    const request = index.openCursor(IDBKeyRange.only(docId))
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) { result.push(cursor.value as Snapshot); cursor.continue() }
      else resolve(result.sort((a, b) => b.at - a.at))
    }
    request.onerror = () => resolve([])
  })
}

export async function pruneOld(): Promise<void> {
  const cutoff = Date.now() - PRUNE_DAYS * 24 * 60 * 60 * 1000
  const db = await openDb()
  if (!db) return
  for (const name of [RECOVERY, VERSIONS]) {
    try {
      const request = db.transaction(name, 'readwrite').objectStore(name).openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        if ((cursor.value as Snapshot).at < cutoff) cursor.delete()
        cursor.continue()
      }
    } catch { /* best-effort storage */ }
  }
}
