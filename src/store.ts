import { bundleCanWrite, ensureFileIds, type TacoBlock, type TacoBundle, type TacoCommentMessage, type TacoCommentThread, type TacoFile, type TacoTextAnchor } from './model.ts'

export type SyncNode =
  | (TacoBlock & { kind: 'block' })
  | { id: string; kind: 'comment-thread'; anchor: TacoTextAnchor; status: 'open' | 'resolved'; createdAt: string; updatedAt: string }
  | (TacoCommentMessage & { kind: 'comment-message'; threadId: string })

export interface SyncFile {
  id: string
  path: string
  mediaType: string
  nodes: SyncNode[]
  [extra: string]: unknown
}

export interface TacoSyncDoc {
  format: string
  version: number
  docId: string
  title: string
  root: string
  files: SyncFile[]
  [extra: string]: unknown
}

export type StoreChange =
  | { kind: 'all' }
  | { kind: 'document' }
  | { kind: 'file'; fileId: string }
  | { kind: 'comments'; path?: string }

export interface StoreChangeEvent {
  source: StoreChangeSource
  change: StoreChange
}

const clone = <T>(value: T): T => structuredClone(value)

const toSyncFile = (bundle: TacoBundle, file: TacoFile): SyncFile => {
  const { blocks = [], content: _content, ...rest } = file
  const nodes: SyncNode[] = blocks.map((block) => ({ ...clone(block), kind: 'block' }))
  for (const thread of (bundle.comments ?? []).filter((candidate) => candidate.anchor.path === file.path)) {
    nodes.push({
      id: thread.id,
      kind: 'comment-thread',
      anchor: clone(thread.anchor),
      status: thread.status,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    })
    for (const message of thread.messages) nodes.push({ ...clone(message), kind: 'comment-message', threadId: thread.id })
  }
  return { ...clone(rest), id: file.id!, nodes }
}

export const toSyncDoc = (bundle: TacoBundle): TacoSyncDoc => {
  ensureFileIds(bundle)
  const { files: _files, comments: _comments, collab: _collab, ...doc } = bundle
  return {
    ...clone(doc),
    files: bundle.files.map((file) => toSyncFile(bundle, file)),
  }
}

export const projectSyncChanges = (
  current: TacoSyncDoc,
  bundle: TacoBundle,
  changes: readonly StoreChange[],
): TacoSyncDoc => {
  if (!changes.length) return current
  if (changes.some((change) => change.kind === 'all')) return toSyncDoc(bundle)

  let next = current
  if (changes.some((change) => change.kind === 'document')) {
    const { files: _files, comments: _comments, collab: _collab, ...document } = bundle
    next = { ...current, ...clone(document), files: current.files }
  }

  const fileIds = new Set(changes.flatMap((change) => {
    if (change.kind === 'file') return [change.fileId]
    if (change.kind === 'comments') {
      return bundle.files
        .filter((file) => !change.path || file.path === change.path)
        .map((file) => file.id!)
    }
    return []
  }))
  if (!fileIds.size) return next

  const changedFiles = new Map(bundle.files
    .filter((file) => file.id && fileIds.has(file.id))
    .map((file) => [file.id!, toSyncFile(bundle, file)]))
  const files = next.files.map((file) => changedFiles.get(file.id) ?? file)
  for (const [id, file] of changedFiles) {
    if (!files.some((candidate) => candidate.id === id)) files.push(file)
  }
  return { ...next, files }
}

const isBlockNode = (node: SyncNode): node is TacoBlock & { kind: 'block' } => node.kind === 'block'
const isThreadNode = (node: SyncNode): node is Extract<SyncNode, { kind: 'comment-thread' }> => node.kind === 'comment-thread'
const isMessageNode = (node: SyncNode): node is TacoCommentMessage & { kind: 'comment-message'; threadId: string } => node.kind === 'comment-message'

export const applySyncDoc = (bundle: TacoBundle, sync: TacoSyncDoc): void => {
  const previousFiles = new Map(bundle.files.map((file) => [file.id, file]))
  const files: TacoFile[] = sync.files.map((file) => {
    const previous = previousFiles.get(file.id)
    const { nodes, ...rest } = file
    return {
      ...clone(previous ?? { content: '' }),
      ...clone(rest),
      content: previous?.content ?? '',
      blocks: nodes.filter(isBlockNode).map(({ kind: _kind, ...block }) => clone(block)),
    } as TacoFile
  })

  const comments: TacoCommentThread[] = []
  for (const file of sync.files) {
    const threads = new Map(file.nodes.filter(isThreadNode).map((thread) => [thread.id, thread]))
    const messages = file.nodes.filter(isMessageNode)
    for (const thread of threads.values()) {
      const threadMessages = messages
        .filter((message) => message.threadId === thread.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .map(({ kind: _kind, threadId: _threadId, ...message }) => clone(message))
      if (!threadMessages.length) continue
      comments.push({
        id: thread.id,
        anchor: { ...clone(thread.anchor), path: file.path },
        status: thread.status,
        messages: threadMessages,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      })
    }
  }

  const { files: _files, ...doc } = sync
  const collab = bundle.collab
  for (const key of Object.keys(bundle)) delete bundle[key]
  Object.assign(bundle, clone(doc), { files }, comments.length ? { comments } : {}, collab ? { collab } : {})
}

export type StoreChangeSource = 'local' | 'remote'

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

  changed(change: StoreChange = { kind: 'all' }): void {
    this.emit('local', change)
  }

  applyRemote(sync: TacoSyncDoc): void {
    applySyncDoc(this.bundle, sync)
    this.emit('remote', { kind: 'all' })
  }

  onChange(listener: (event: StoreChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(source: StoreChangeSource, change: StoreChange): void {
    for (const listener of this.listeners) listener({ source, change })
  }
}
