import { DELETED_COMMENT_BODY } from '../../../../src/comments.ts'
import {
  HostApiError,
  HostTransportError,
  newIdempotencyKey,
  type HostAnchor,
  type HostAutoSavePatch,
  type HostClient,
  type HostCommentMutation,
  type HostCommentThread,
  type HostFilePatch,
  type HostListenerSnapshot,
  type HostSnapshot,
  type HostStateResponse,
} from './host-client.ts'
import { isInternalFile, type NavigationManifest, type TacoBundle, type TacoCommentMessage, type TacoCommentThread, type TacoFile } from '../../../../src/model.ts'

/** One Host-served document revision, mapped into the browser's own bundle types. */
export interface HostedContent {
  title: string
  root: string
  files: TacoFile[]
  navigation?: NavigationManifest
  checkpoints?: unknown
  comments: TacoCommentThread[]
}

export type HostedReadiness = 'loading' | 'ready' | 'unsupported' | 'failed'
export type HostedSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'
export type HostedCommentState = 'idle' | 'pending' | 'saved' | 'error'

export interface HostedStatus {
  readiness: HostedReadiness
  save: HostedSaveState
  comments: HostedCommentState
  detail?: string
}

export type HostedHandoffOutcome =
  | { kind: 'done'; handoffId: string | null }
  | { kind: 'no-change' }
  | { kind: 'blocked'; save: HostedSaveState }
  | { kind: 'conflict' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; detail: string }

export interface HostedBridge {
  /** Live bundle. The session only reads it; adoption is requested through `adoptContent`. */
  readonly bundle: TacoBundle
  /** Self-reported reviewer name; never treated as authentication. */
  author: () => string
  onStatus: (status: HostedStatus) => void
  adoptContent: (content: HostedContent) => void
  adoptListeners: (snapshot: HostListenerSnapshot) => void
}

export interface HostedSessionOptions {
  client: HostClient
  bridge: HostedBridge
  saveDebounceMs?: number
  commentDebounceMs?: number
  listenerPollMs?: number
}

/** Whole-patch ceiling the Host enforces is 1 MiB; stay under it so UTF-8 timing cannot trip it. */
const PATCH_BYTE_LIMIT = 900 * 1024
/** Above this, one file's body goes to a private upload instead of riding inside the JSON patch. */
const INLINE_FILE_BYTE_LIMIT = 128 * 1024

interface MirrorFile {
  id?: string
  mediaType: string
  content: string
}

interface MirrorThread {
  status: 'open' | 'resolved'
  messages: Map<string, { deleted: boolean }>
}

interface PatchChunk {
  changes: PreparedChange[]
  checkpoints?: unknown
  title?: string
  navigation?: unknown
}

/** One file change plus the exact content it will write, so the mirror can record what was accepted. */
interface PreparedChange {
  patch: HostFilePatch
  content?: string
}

const encodeBytes = (value: string): number => new TextEncoder().encode(value).byteLength

const relativeToRoot = (root: string, path: string): string =>
  root === '.' || !path.startsWith(`${root}/`) ? path : path.slice(root.length + 1)

const jsonOf = (value: unknown): string | null => (value === undefined ? null : JSON.stringify(value))

const navigationForHost = (bundle: TacoBundle): NavigationManifest | null => {
  if (!bundle.navigation) return null
  const fullPath = (path: string): string =>
    bundle.root === '.' || path.startsWith(`${bundle.root}/`) ? path : `${bundle.root}/${path}`
  return {
    ...bundle.navigation,
    ...(bundle.navigation.entry ? { entry: fullPath(bundle.navigation.entry) } : {}),
    groups: bundle.navigation.groups.map((group) => ({ ...group, paths: group.paths.map(fullPath) })),
  }
}

const errorDetail = (error: unknown): string => {
  if (error instanceof HostApiError) return error.message || `Host rejected the request (${error.status})`
  return error instanceof Error ? error.message : String(error)
}

const toBrowserThread = (thread: HostCommentThread): TacoCommentThread => ({
  id: thread.id,
  status: thread.status,
  anchor: thread.anchor ? structuredClone(thread.anchor) : null,
  createdAt: thread.createdAt,
  updatedAt: thread.updatedAt,
  messages: thread.messages.map((message): TacoCommentMessage => ({
    id: message.id,
    author: message.author,
    body: message.body ?? DELETED_COMMENT_BODY,
    createdAt: message.createdAt,
    ...(message.deletedAt ? { deletedAt: message.deletedAt } : {}),
  })),
})

const mirrorFromSnapshot = (snapshot: HostSnapshot): Map<string, MirrorFile> => {
  const mirror = new Map<string, MirrorFile>()
  for (const file of snapshot.files) {
    if (isInternalFile(file.path)) continue
    mirror.set(relativeToRoot(snapshot.root, file.path), {
      id: file.id,
      mediaType: file.mediaType,
      content: file.content,
    })
  }
  return mirror
}

/**
 * Hosted review session: keeps the browser's already-edited bundle in step with the Host's single
 * shared saved state. Autosave only ever sends the delta since the last acknowledgement, comments
 * travel as their own durable actions, and the handoff reads the saved state instead of uploading.
 */
export class HostedSession {
  private readiness: HostedReadiness = 'loading'
  private save: HostedSaveState = 'idle'
  private comments: HostedCommentState = 'idle'
  private detail: string | undefined
  private stateVersion = '0'
  private commentsSequence = '0'
  private mirrorFiles = new Map<string, MirrorFile>()
  private mirrorCheckpoints: string | null = null
  private mirrorTitle = ''
  private mirrorNavigation: string | null = null
  private mirrorThreads = new Map<string, MirrorThread>()
  private dirty = false
  private commentDirty = false
  private saveTimer: number | null = null
  private commentTimer: number | null = null
  private listenerTimer: number | null = null
  private queue: Promise<void> = Promise.resolve()
  private handoffKey: string | null = null
  private handoffBusy = false
  private destroyed = false
  private firstLoad: Promise<void> | null = null
  /** Content fingerprint taken when a save was assembled, to notice edits that land mid-flight. */
  private flightSignature = ''
  private editGeneration = 0
  private unloadGuarded = false

  constructor(private readonly options: HostedSessionOptions) {}
  private readonly onBeforeUnload = (event: BeforeUnloadEvent): void => {
    event.preventDefault()
    event.returnValue = ''
  }

  hasPendingWrites(): boolean {
    return !this.destroyed && (
      this.dirty ||
      this.commentDirty ||
      this.save === 'dirty' ||
      this.save === 'saving' ||
      this.save === 'error' ||
      this.save === 'conflict' ||
      this.comments === 'pending' ||
      this.comments === 'error'
    )
  }

  private updateUnloadGuard(): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    const shouldGuard = this.hasPendingWrites()
    if (shouldGuard && !this.unloadGuarded) {
      window.addEventListener('beforeunload', this.onBeforeUnload)
      this.unloadGuarded = true
    } else if (!shouldGuard && this.unloadGuarded) {
      window.removeEventListener('beforeunload', this.onBeforeUnload)
      this.unloadGuarded = false
    }
  }


  get currentStatus(): HostedStatus {
    return { readiness: this.readiness, save: this.save, comments: this.comments, detail: this.detail }
  }

  get tacoId(): string {
    return this.options.client.capability.tacoId
  }

  /** True once the Host serves a shared state for this Taco, so writes are meaningful. */
  get ready(): boolean {
    return this.readiness === 'ready'
  }

  get busy(): boolean {
    return this.handoffBusy
  }

  /** Load the shared state and durable comments, then enable autosave. */
  async start(): Promise<void> {
    this.firstLoad ??= this.enqueue(() => this.load())
    return this.firstLoad
  }

  private async load(): Promise<void> {
    if (this.destroyed) return
    this.setStatus({ readiness: 'loading', save: 'idle', comments: 'idle' })
    const baselineGen = this.editGeneration
    let state: HostStateResponse | null
    try {
      state = await this.options.client.readState()
    } catch (error) {
      this.setStatus({ readiness: 'failed', save: 'error', comments: 'error', detail: errorDetail(error) })
      return
    }
    if (!state) {
      // No publish baseline: the page keeps its ordinary copy-only behaviour.
      this.setStatus({ readiness: 'unsupported', save: 'idle', comments: 'idle' })
      return
    }

    this.stateVersion = state.stateVersion
    this.commentsSequence = state.commentsThroughSequence
    this.mirrorFiles = mirrorFromSnapshot(state.snapshot)
    this.mirrorCheckpoints = jsonOf(state.snapshot.checkpoints)
    this.mirrorTitle = state.snapshot.title
    this.mirrorNavigation = jsonOf(state.snapshot.navigation)
    let commentsFailed = false
    let threads: TacoCommentThread[] = []
    try {
      threads = (await this.options.client.readComments()).map(toBrowserThread)
    } catch (error) {
      // Comments are additive: a failed read must not block editing or claim a saved handoff state.
      commentsFailed = true
      this.detail = errorDetail(error)
    }
    if (this.destroyed) return
    const preReadyEdit = this.editGeneration !== baselineGen || this.dirty || this.commentDirty
    if (!preReadyEdit) {
      this.adoptSnapshotContent(state.snapshot, threads)
      this.dirty = false
      this.commentDirty = false
      this.setStatus({
        readiness: 'ready',
        save: 'saved',
        comments: commentsFailed ? 'error' : 'saved',
        detail: commentsFailed ? this.detail : undefined,
      })
    } else {
      // Pre-ready edits occurred: do not overwrite the live draft and do not silently autosave.
      // Establish mirrors and mark conflict so handoff is blocked until explicit reload/discard.
      this.mirrorThreads = new Map(threads.map((thread) => [thread.id, {
        status: thread.status,
        messages: new Map(thread.messages.map((message) => [message.id, { deleted: Boolean(message.deletedAt) }])),
      }]))
      this.setStatus({
        readiness: 'ready',
        save: 'conflict',
        comments: this.commentDirty ? 'pending' : (commentsFailed ? 'error' : 'saved'),
        detail: 'Somebody may have saved while the page was loading. Your changes are kept in the editor.',
      })
    }
    this.startListenerPolling()
    void this.refreshListeners()
    this.updateUnloadGuard()
  }

  private adoptSnapshotContent(snapshot: HostSnapshot, comments: TacoCommentThread[]): void {
    this.mirrorThreads = new Map(comments.map((thread) => [thread.id, {
      status: thread.status,
      messages: new Map(thread.messages.map((message) => [message.id, { deleted: Boolean(message.deletedAt) }])),
    }]))
    this.options.bridge.adoptContent({
      title: snapshot.title,
      root: snapshot.root,
      files: snapshot.files.map((file) => ({
        ...(file.id ? { id: file.id } : {}),
        ...(file.title ? { title: file.title } : {}),
        path: file.path,
        mediaType: file.mediaType,
        content: file.content,
      })),
      ...(snapshot.navigation ? { navigation: structuredClone(snapshot.navigation) as NavigationManifest } : {}),
      ...(snapshot.checkpoints === undefined ? {} : { checkpoints: structuredClone(snapshot.checkpoints) }),
      comments,
    })
  }

  /** A file, Checkpoint, or comment change the reviewer just made in the browser. */
  markContentChanged(): void {
    if (this.destroyed || this.readiness === 'unsupported' || this.readiness === 'failed') return
    this.editGeneration++
    this.dirty = true
    if (this.save !== 'saving' && this.save !== 'conflict') this.setStatus({ save: 'dirty' })
    else this.updateUnloadGuard()
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer)
    if (this.ready && this.save !== 'conflict') {
      this.saveTimer = window.setTimeout(() => {
        this.saveTimer = null
        void this.enqueue(() => this.saveContent())
      }, this.options.saveDebounceMs ?? 1000)
    }
  }

  markCommentsChanged(): void {
    if (this.destroyed || this.readiness === 'unsupported' || this.readiness === 'failed') return
    this.editGeneration++
    this.commentDirty = true
    if (this.comments !== 'pending') this.setStatus({ comments: 'pending' })
    else this.updateUnloadGuard()
    if (this.commentTimer !== null) window.clearTimeout(this.commentTimer)
    if (this.ready) {
      this.commentTimer = window.setTimeout(() => {
        this.commentTimer = null
        void this.enqueue(() => this.saveComments())
      }, this.options.commentDebounceMs ?? 300)
    }
  }

  /** Retry the writes that failed, without touching the reviewer's content. */
  retry(): void {
    if (this.destroyed || this.readiness === 'unsupported' || this.readiness === 'failed') return
    this.markContentChanged()
    this.markCommentsChanged()
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task)
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }

  /** Wait for every scheduled write to finish; returns the state the reviewer must see. */
  async flush(): Promise<HostedStatus> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.commentTimer !== null) {
      window.clearTimeout(this.commentTimer)
      this.commentTimer = null
    }
    await this.enqueue(() => this.saveComments())
    await this.enqueue(() => this.saveContent())
    return this.currentStatus
  }

  private computeFileChanges(): HostFilePatch[] {
    const bundle = this.options.bridge.bundle
    const root = bundle.root
    const local = new Map<string, TacoFile>()
    for (const file of bundle.files) {
      if (isInternalFile(file.path)) continue
      local.set(relativeToRoot(root, file.path), file)
    }
    const mirrorById = new Map<string, string>()
    for (const [relative, record] of this.mirrorFiles) {
      if (record.id) mirrorById.set(record.id, relative)
    }

    const patches: HostFilePatch[] = []
    const consumed = new Set<string>()
    for (const [relative, file] of local) {
      const previous = file.id ? mirrorById.get(file.id) : undefined
      if (previous !== undefined && previous !== relative) {
        patches.push({
          ...(file.id ? { id: file.id } : {}),
          path: relative,
          previousPath: previous,
          changeType: 'renamed',
          mediaType: file.mediaType,
          content: file.content,
        })
        consumed.add(previous)
        continue
      }
      const known = this.mirrorFiles.get(relative)
      if (!known) {
        patches.push({
          ...(file.id ? { id: file.id } : {}),
          path: relative,
          changeType: 'added',
          mediaType: file.mediaType,
          content: file.content,
        })
        continue
      }
      if (known.content !== file.content || known.mediaType !== file.mediaType) {
        patches.push({
          ...(file.id ? { id: file.id } : {}),
          path: relative,
          changeType: 'modified',
          mediaType: file.mediaType,
          content: file.content,
        })
      }
    }
    for (const [relative, record] of this.mirrorFiles) {
      if (local.has(relative) || consumed.has(relative)) continue
      patches.push({
        ...(record.id ? { id: record.id } : {}),
        path: relative,
        changeType: 'deleted',
        mediaType: record.mediaType,
        content: null,
      })
    }
    return patches
  }

  private checkpointsChanged(): boolean {
    return jsonOf(this.options.bridge.bundle.checkpoints) !== this.mirrorCheckpoints
  }

  /**
   * Save the delta since the last acknowledgement. File bodies above the inline limit are reserved
   * as private uploads first, and a delta too large for one request is split into sequential
   * compare-and-swap saves, so the Host never receives a truncated patch.
   */
  private async saveContent(): Promise<void> {
    if (this.destroyed || !this.ready || this.save === 'saving' || this.save === 'conflict') return
    if (!this.dirty) return
    const patches = this.computeFileChanges()
    const bundle = this.options.bridge.bundle
    const navigation = navigationForHost(bundle)
    const metadata: Pick<HostAutoSavePatch, 'title' | 'navigation' | 'checkpoints'> = {
      ...(bundle.title === this.mirrorTitle ? {} : { title: bundle.title }),
      ...(jsonOf(navigation ?? undefined) === this.mirrorNavigation ? {} : { navigation }),
      ...(this.checkpointsChanged() ? { checkpoints: structuredClone(bundle.checkpoints ?? null) } : {}),
    }
    if (patches.length === 0 && Object.keys(metadata).length === 0) {
      this.dirty = false
      this.setStatus({ save: 'saved' })
      return
    }
    this.setStatus({ save: 'saving' })
    this.flightSignature = this.signature()
    try {
      const prepared = await this.prepareUploads(patches)
      for (const chunk of this.chunkPatches(prepared, metadata)) {
        const patch: HostAutoSavePatch = {
          protocol: 'taco-state/1',
          expectedStateVersion: this.stateVersion,
          author: this.options.bridge.author(),
          fileChanges: chunk.changes.map((change) => change.patch),
          ...(chunk.checkpoints === undefined ? {} : { checkpoints: chunk.checkpoints }),
          ...(chunk.title === undefined ? {} : { title: chunk.title }),
          ...(chunk.navigation === undefined ? {} : { navigation: chunk.navigation }),
        }
        // One key per logical write: a retry after a lost response must replay, never duplicate.
        const key = newIdempotencyKey()
        const result = await this.withRetry(() => this.options.client.autosave(patch, key))
        this.stateVersion = result.stateVersion
        this.applyAcknowledged(chunk.changes, patch.checkpoints)
        if (patch.title !== undefined) this.mirrorTitle = patch.title
        if (patch.navigation !== undefined) this.mirrorNavigation = jsonOf(patch.navigation ?? undefined)
      }
      if (this.signature() === this.flightSignature) {
        this.dirty = false
        this.setStatus({ save: 'saved' })
      } else {
        // Edits landed while the request was in flight: stay dirty and save the remainder.
        this.setStatus({ save: 'dirty' })
        this.markContentChanged()
      }
    } catch (error) {
      if (error instanceof HostApiError && error.status === 409) {
        this.setStatus({ save: 'conflict', detail: error.message })
      } else {
        this.setStatus({ save: 'error', detail: errorDetail(error) })
      }
    } finally {
      this.updateUnloadGuard()
    }
  }

  private async prepareUploads(patches: readonly HostFilePatch[]): Promise<PreparedChange[]> {
    const prepared: PreparedChange[] = []
    for (const patch of patches) {
      const content = patch.content
      if (typeof content !== 'string' || encodeBytes(content) <= INLINE_FILE_BYTE_LIMIT) {
        prepared.push({ patch, content: typeof content === 'string' ? content : undefined })
        continue
      }
      // One key per reservation: a lost-response retry must reuse the same private object.
      const key = newIdempotencyKey()
      const uploadId = await this.withRetry(() => this.options.client.reserveUpload(content, key, this.tacoId))
      const uploaded: HostFilePatch = { ...patch, uploadId }
      delete uploaded.content
      // The Host stored exactly these bytes, so this stays the acknowledged content for the mirror.
      prepared.push({ patch: uploaded, content })
    }
    return prepared
  }

  private chunkPatches(changes: readonly PreparedChange[], metadata: Pick<HostAutoSavePatch, 'title' | 'navigation' | 'checkpoints'>): PatchChunk[] {
    // `…"fileChanges":[]}` — swapping `[]` for `[p1,p2]` costs each patch plus its separators.
    const wrapper = JSON.stringify({
      protocol: 'taco-state/1',
      expectedStateVersion: this.stateVersion,
      author: this.options.bridge.author(),
      ...metadata,
      fileChanges: [],
    })
    const openBytes = encodeBytes(wrapper.slice(0, -2))
    if (openBytes + 2 > PATCH_BYTE_LIMIT) throw new Error('Document metadata exceeds the autosave request limit')
    const chunks: PatchChunk[] = []
    let current: PreparedChange[] = []
    let currentBytes = 0
    for (const change of changes) {
      const patchBytes = encodeBytes(JSON.stringify(change.patch))
      if (current.length > 0 && openBytes + currentBytes + 1 + patchBytes + 2 > PATCH_BYTE_LIMIT) {
        chunks.push({ changes: current })
        current = []
        currentBytes = 0
      }
      currentBytes += (current.length > 0 ? 1 : 0) + patchBytes
      current.push(change)
    }
    chunks.push({ changes: current })
    // Navigation and Checkpoints are validated against the resulting file set, so travel last.
    Object.assign(chunks[chunks.length - 1], metadata)
    return chunks
  }

  /**
   * Fold an acknowledged chunk into the mirror so the next delta starts from the Host's state. The
   * content recorded is the exact content that was sent (or uploaded), not whatever the editor holds
   * now, because a mid-flight edit is saved by the follow-up pass.
   */
  private applyAcknowledged(changes: readonly PreparedChange[], checkpoints: unknown): void {
    for (const { patch: change, content } of changes) {
      if (change.changeType === 'deleted') {
        this.mirrorFiles.delete(change.path)
        continue
      }
      const renamedFrom = change.changeType === 'renamed' ? change.previousPath : undefined
      const previous = renamedFrom ? this.mirrorFiles.get(renamedFrom) : this.mirrorFiles.get(change.path)
      if (renamedFrom) this.mirrorFiles.delete(renamedFrom)
      this.mirrorFiles.set(change.path, {
        id: change.id ?? previous?.id,
        mediaType: change.mediaType ?? previous?.mediaType ?? 'text/plain',
        content: content ?? previous?.content ?? '',
      })
    }
    if (checkpoints !== undefined) this.mirrorCheckpoints = jsonOf(checkpoints)
  }

  private async saveComments(): Promise<void> {
    if (this.destroyed || !this.ready || !this.commentDirty) return
    const ops = this.computeCommentOps()
    if (ops.length === 0) {
      this.commentDirty = false
      this.setStatus({ comments: 'saved' })
      return
    }
    this.setStatus({ comments: 'pending' })
    try {
      for (const op of ops) {
        // One key per action: a retry after a lost response must replay, never post twice.
        const key = newIdempotencyKey()
        const sequence = await this.withRetry(() => this.options.client.mutateComment(op, key))
        this.applyCommentOp(op)
        if (sequence && BigInt(sequence) > BigInt(this.commentsSequence)) this.commentsSequence = sequence
      }
      const remainingOps = this.computeCommentOps()
      if (remainingOps.length === 0) {
        this.commentDirty = false
        this.setStatus({ comments: 'saved' })
      } else {
        this.setStatus({ comments: 'pending' })
        this.markCommentsChanged()
      }
    } catch (error) {
      this.setStatus({ comments: 'error', detail: errorDetail(error) })
    } finally {
      this.updateUnloadGuard()
    }
  }

  private computeCommentOps(): HostCommentMutation[] {
    const author = this.options.bridge.author()
    const ops: HostCommentMutation[] = []
    for (const thread of this.options.bridge.bundle.comments ?? []) {
      const mirror = this.mirrorThreads.get(thread.id)
      if (!mirror) {
        const [first, ...rest] = thread.messages
        if (!first) continue
        ops.push({
          author: first.author || author,
          action: 'create',
          threadId: thread.id,
          messageId: first.id,
          anchor: thread.anchor ? (structuredClone(thread.anchor) as HostAnchor) : null,
          body: first.body,
        })
        for (const message of rest) {
          if (message.deletedAt) continue
          ops.push({
            author: message.author || author,
            action: 'reply',
            threadId: thread.id,
            messageId: message.id,
            body: message.body,
          })
        }
        if (thread.status === 'resolved') {
          ops.push({ author, action: 'resolve', threadId: thread.id })
        }
        continue
      }
      for (const message of thread.messages) {
        const known = mirror.messages.get(message.id)
        if (!known) {
          if (message.deletedAt) continue
          ops.push({
            author: message.author || author,
            action: 'reply',
            threadId: thread.id,
            messageId: message.id,
            body: message.body,
          })
        } else if (!known.deleted && message.deletedAt) {
          ops.push({ author, action: 'delete', threadId: thread.id, messageId: message.id })
        }
      }
      if (mirror.status !== thread.status) {
        ops.push({ author, action: thread.status === 'resolved' ? 'resolve' : 'reopen', threadId: thread.id })
      }
    }
    return ops
  }

  private applyCommentOp(op: HostCommentMutation): void {
    const threadId = op.threadId
    if (!threadId) return
    if (op.action === 'create') {
      const messages = new Map<string, { deleted: boolean }>()
      if (op.messageId) messages.set(op.messageId, { deleted: false })
      this.mirrorThreads.set(threadId, { status: 'open', messages })
      return
    }
    const mirror = this.mirrorThreads.get(threadId)
    if (!mirror) return
    if (op.action === 'reply' && op.messageId) mirror.messages.set(op.messageId, { deleted: false })
    else if (op.action === 'delete' && op.messageId) mirror.messages.set(op.messageId, { deleted: true })
    else if (op.action === 'resolve') mirror.status = 'resolved'
    else if (op.action === 'reopen') mirror.status = 'open'
  }

  /**
   * The reviewer pressed 「交接」. Nothing is uploaded here: the Host freezes the diff from its own
   * saved state, so this waits for autosave, re-reads the shared state, and then reports only the
   * author and the versions being handed off.
   */
  async handoff(): Promise<HostedHandoffOutcome> {
    await this.start()
    if (this.readiness === 'unsupported') return { kind: 'unsupported' }
    if (this.readiness !== 'ready') return { kind: 'failed', detail: this.detail ?? 'Host is not ready' }
    if (this.handoffBusy) return { kind: 'blocked', save: 'saving' }
    this.handoffBusy = true
    try {
      const status = await this.flush()
      if (status.save === 'conflict') return { kind: 'conflict' }
      if (status.save === 'error' || status.comments === 'error') return { kind: 'blocked', save: 'error' }
      if (this.dirty || this.commentDirty) return { kind: 'blocked', save: 'dirty' }

      const expectedGeneration = this.editGeneration
      const synced = await this.enqueue(() => this.syncFromHost({ expectedGeneration }))
      if (!synced || this.dirty || this.commentDirty) return { kind: 'blocked', save: 'dirty' }

      const key = this.handoffKey ?? newIdempotencyKey()
      this.handoffKey = key
      const result = await this.withRetry(() => this.options.client.commitHandoff({
        author: this.options.bridge.author(),
        expectedStateVersion: this.stateVersion,
        expectedCommentsThroughSequence: this.commentsSequence,
      }, key))
      // A definitive answer arrived, so the key must not be reused for a later handoff.
      this.handoffKey = null
      return result.changed ? { kind: 'done', handoffId: result.handoffId } : { kind: 'no-change' }
    } catch (error) {
      if (error instanceof HostApiError && error.status === 409) {
        // Somebody saved between our read and the commit: never claim a handoff we did not freeze.
        await this.enqueue(() => this.syncFromHost()).catch(() => undefined)
        return { kind: 'conflict' }
      }
      return { kind: 'failed', detail: errorDetail(error) }
    } finally {
      this.handoffBusy = false
    }
  }

  /** Re-read the shared state. Callers must already have no unsaved local edits to lose. */
  async syncFromHost(options?: { force?: boolean; expectedGeneration?: number }): Promise<boolean> {
    const baselineGen = options?.expectedGeneration ?? this.editGeneration
    const state = await this.options.client.readState()
    if (!state) {
      this.setStatus({ readiness: 'unsupported' })
      throw new HostApiError(404, 'NOT_FOUND', 'This Taco no longer has a Host review baseline')
    }
    const threads = (await this.options.client.readComments()).map(toBrowserThread)
    if (this.editGeneration !== baselineGen || (!options?.force && (this.dirty || this.commentDirty))) {
      return false
    }
    this.stateVersion = state.stateVersion
    this.commentsSequence = state.commentsThroughSequence
    this.mirrorFiles = mirrorFromSnapshot(state.snapshot)
    this.mirrorCheckpoints = jsonOf(state.snapshot.checkpoints)
    this.mirrorTitle = state.snapshot.title
    this.mirrorNavigation = jsonOf(state.snapshot.navigation)
    this.adoptSnapshotContent(state.snapshot, threads)
    this.dirty = false
    this.commentDirty = false
    this.setStatus({ readiness: 'ready', save: 'saved', comments: 'saved' })
    void this.refreshListeners()
    this.updateUnloadGuard()
    return true
  }

  /**
   * Discard this page's unsaved draft in favour of the Host's current state.
   *
   * A conflict is the one case where the page cannot save its own draft: somebody else saved first,
   * and overwriting their work would silently discard it. The draft is therefore kept in the editor
   * and never resent, and the only offered resolution is this explicit, clearly labelled reload.
   */
  async discardLocalDraft(): Promise<void> {
    await this.start()
    await this.enqueue(async () => {
      try {
        const synced = await this.syncFromHost({ force: true })
        if (!synced) return
      } catch (error) {
        this.setStatus({ save: 'error', detail: errorDetail(error) })
      }
    })
  }

  async refreshListeners(): Promise<HostListenerSnapshot | null> {
    if (this.destroyed || !this.ready) return null
    try {
      const snapshot = await this.options.client.listListeners()
      this.options.bridge.adoptListeners(snapshot)
      return snapshot
    } catch (error) {
      // Presence is advisory: a background poll must not disturb the save state or claim delivery.
      // But return null so callers who await can detect failure if desired.
      return null
    }
  }

  private startListenerPolling(): void {
    if (this.listenerTimer !== null) return
    this.listenerTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void this.refreshListeners()
    }, this.options.listenerPollMs ?? 30_000)
  }

  private async withRetry<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      // Only an unanswered request is retried, and only once: a definitive Host answer is final.
      if (!(error instanceof HostTransportError)) throw error
      return run()
    }
  }

  private signature(): string {
    const bundle = this.options.bridge.bundle
    return JSON.stringify([
      bundle.files.map((file) => [file.id ?? file.path, file.path, file.mediaType, file.content]),
      bundle.checkpoints ?? null,
      bundle.title,
      bundle.navigation ?? null,
    ])
  }

  private setStatus(next: Partial<HostedStatus>): void {
    if (next.readiness) this.readiness = next.readiness
    if (next.save) this.save = next.save
    if (next.comments) this.comments = next.comments
    this.detail = next.detail
    this.updateUnloadGuard()
    if (this.destroyed) return
    this.options.bridge.onStatus(this.currentStatus)
  }

  destroy(): void {
    this.destroyed = true
    if (this.unloadGuarded && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('beforeunload', this.onBeforeUnload)
      this.unloadGuarded = false
    }
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer)
    if (this.commentTimer !== null) window.clearTimeout(this.commentTimer)
    if (this.listenerTimer !== null) window.clearInterval(this.listenerTimer)
    this.saveTimer = null
    this.commentTimer = null
    this.listenerTimer = null
  }
}
