import { bundleCanWrite, ensureFileIds, type NavigationManifest, type TacoBundle } from './model.ts'

export type StoreChange =
  | { kind: 'all' }
  | { kind: 'document' }
  | { kind: 'file'; fileId: string }
  | { kind: 'comments'; path?: string }

export type StoreChangeSource = 'local'

export interface StoreChangeEvent {
  source: StoreChangeSource
  change: StoreChange
}

const clone = <T>(value: T): T => structuredClone(value)


export class TacoStore {
  private listeners = new Set<(event: StoreChangeEvent) => void>()

  constructor(readonly bundle: TacoBundle) {
    ensureFileIds(bundle)
  }

  get doc(): TacoBundle {
    return this.bundle
  }

  commit(change: StoreChange, mutate: () => void): boolean
  commit(mutate: () => void): boolean
  commit(changeOrMutate: StoreChange | (() => void), maybeMutate?: () => void): boolean {
    if (!bundleCanWrite(this.bundle)) return false
    const change = typeof changeOrMutate === 'function' ? { kind: 'document' as const } : changeOrMutate
    const mutate = typeof changeOrMutate === 'function' ? changeOrMutate : maybeMutate
    if (!mutate) return false
    mutate()
    this.emit('local', change)
    return true
  }

  updateNavigation(navigation: NavigationManifest | undefined): boolean {
    return this.commit({ kind: 'document' }, () => {
      if (navigation) this.bundle.navigation = clone(navigation)
      else delete this.bundle.navigation
    })
  }

  changed(change: StoreChange = { kind: 'all' }): void {
    this.emit('local', change)
  }

  onChange(listener: (event: StoreChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(source: StoreChangeSource, change: StoreChange): void {
    for (const listener of this.listeners) listener({ source, change })
  }
}
