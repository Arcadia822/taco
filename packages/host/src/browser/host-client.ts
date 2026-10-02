import type { TextAnchor } from '@taco/protocol'
import type { TacoBlock } from '../../../../src/model.ts'
import type { HostCapability } from './host-capability.ts'

/** Snapshot file as served by `GET /v1/tacos/{id}/state` (path is the full bundle path). */
export interface HostSnapshotFile {
  id?: string
  title?: string
  path: string
  mediaType: string
  content: string
  blocks?: TacoBlock[]
}

export interface HostSnapshot {
  format: 'taco/files'
  version: 1
  docId: string
  title: string
  root: string
  files: HostSnapshotFile[]
  navigation?: unknown
  checkpoints?: unknown
}

export interface HostStateResponse {
  stateVersion: string
  commentsThroughSequence: string
  snapshot: HostSnapshot
}

/** Incremental file change; `path`/`previousPath` are relative to the snapshot root. */
export interface HostFilePatch {
  id?: string
  path: string
  previousPath?: string
  changeType: 'added' | 'modified' | 'deleted' | 'renamed'
  mediaType?: string
  content?: string | null
  uploadId?: string
}

export interface HostAutoSavePatch {
  protocol: 'taco-state/1'
  expectedStateVersion: string
  author: string
  fileChanges: HostFilePatch[]
  checkpoints?: unknown
  title?: string
  navigation?: unknown
}

export interface HostAutosaveResult {
  stateVersion: string
  savedAt: string
  historyWindowId: string
}

export type HostAnchor = TextAnchor

export interface HostCommentMessage {
  id: string
  author: string
  body: string | null
  createdAt: string
  deletedAt: string | null
}

export interface HostCommentThread {
  id: string
  status: 'open' | 'resolved'
  anchor: HostAnchor | null
  isAnchorStale: boolean
  createdAt: string
  updatedAt: string
  messages: HostCommentMessage[]
  actions: unknown[]
}

export interface HostCommentMutation {
  author: string
  action: 'create' | 'reply' | 'resolve' | 'reopen' | 'delete'
  threadId?: string
  messageId?: string
  anchor?: HostAnchor | null
  body?: string
}

/** Self-reported lease; a live connection only, never proof of identity or of delivery. */
export interface HostListener {
  listenerId: string
  name?: string
  sessionTitle?: string
  harness?: string
  model?: string
  modelId?: string
  connectedAt?: string
  lastSeenAt: string
  expiresAt: string
}

export interface HostListenerSnapshot {
  observedAt: string
  listeners: HostListener[]
}

export interface HostHandoffRequest {
  author: string
  expectedStateVersion: string
  expectedCommentsThroughSequence: string
}

export interface HostHandoffCommit {
  changed: boolean
  handoffId: string | null
  event: unknown | null
}

export class HostApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'HostApiError'
  }
}

/** The request never produced a definitive response, so the caller may retry with the same key. */
export class HostTransportError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'HostTransportError'
  }
}

/** Idempotency-Key values must be RFC 4122 v4 UUIDs; the Host deduplicates writes by key. */
export function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  const bytes = new Uint8Array(16)
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') cryptoApi.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const sha256Prefixed = async (bytes: Uint8Array): Promise<string> => {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('WebCrypto is unavailable, so large file uploads cannot be verified')
  const digest = await subtle.digest('SHA-256', bytes)
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

const toApiError = async (response: Response): Promise<HostApiError> => {
  let code = ''
  let message = ''
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } }
    code = typeof body.error?.code === 'string' ? body.error.code : ''
    message = typeof body.error?.message === 'string' ? body.error.message : ''
  } catch {
    message = ''
  }
  return new HostApiError(response.status, code, message || `Host request failed with status ${response.status}`)
}

/**
 * Thin client for the frozen TACO-33 Host endpoints. Every request stays on the hosting page's own
 * origin, carries the public CSRF token the Host issued for this Taco, and never treats a transport
 * failure as a successful write.
 */
export class HostClient {
  private csrf: string | null = null

  constructor(
    readonly capability: HostCapability,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly origin: string = location.origin,
  ) {}

  private async send(path: string, init: RequestInit): Promise<Response> {
    const url = new URL(path, this.origin).toString()
    return this.fetchImpl(url, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', ...init })
  }

  private endpoint(path: string): string {
    return `${this.capability.apiBase}${path}`
  }

  /** `/v1/uploads` is a sibling of `/v1/tacos/{id}`, never a bundle-supplied address. */
  private uploadEndpoint(): string {
    const match = /^(.*)\/tacos\/[^/]+$/.exec(this.capability.apiBase)
    if (!match) throw new HostApiError(0, 'UPLOAD_UNSUPPORTED', 'This Host capability exposes no upload endpoint')
    return `${match[1]}/uploads`
  }

  private async ensureCsrf(): Promise<string> {
    if (this.csrf) return this.csrf
    const response = await this.send(this.endpoint('/csrf'), { headers: { Accept: 'application/json' } })
    if (!response.ok) throw await toApiError(response)
    let bodyToken = ''
    try {
      const body = (await response.json()) as { csrfToken?: unknown }
      bodyToken = typeof body.csrfToken === 'string' ? body.csrfToken : ''
    } catch {
      bodyToken = ''
    }
    const resolved = response.headers.get('x-taco-csrf') || bodyToken
    if (!resolved) throw new HostApiError(response.status, 'CSRF_UNAVAILABLE', 'Host did not issue a CSRF token')
    this.csrf = resolved
    return resolved
  }

  /**
   * Send a mutating request. A rejected CSRF token is refreshed once, because the Host rotates it on
   * every state read; a transport failure is reported as retryable instead of assumed successful.
   */
  private async mutate(url: string, method: string, body: unknown, idempotencyKey: string): Promise<Response> {
    const attempt = async (): Promise<Response> => {
      const token = await this.ensureCsrf()
      return this.send(url, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'X-Taco-CSRF': token,
        },
        body: JSON.stringify(body),
      })
    }
    let response: Response
    try {
      response = await attempt()
    } catch (error) {
      throw new HostTransportError('Host request failed before a response arrived', error)
    }
    if (response.status !== 403) return response
    this.csrf = null
    try {
      return await attempt()
    } catch (error) {
      throw new HostTransportError('Host request failed before a response arrived', error)
    }
  }

  /** `GET /state`; null when the Taco has no publish baseline, so the page stays copy-only. */
  async readState(): Promise<HostStateResponse | null> {
    const response = await this.send(this.endpoint('/state'), { headers: { Accept: 'application/json' } })
    if (response.status === 404) return null
    if (!response.ok) throw await toApiError(response)
    const header = response.headers.get('x-taco-csrf')
    if (header) this.csrf = header
    return (await response.json()) as HostStateResponse
  }

  async autosave(patch: HostAutoSavePatch, idempotencyKey: string): Promise<HostAutosaveResult> {
    const response = await this.mutate(this.endpoint('/state'), 'PATCH', patch, idempotencyKey)
    if (!response.ok) throw await toApiError(response)
    return (await response.json()) as HostAutosaveResult
  }

  async readComments(): Promise<HostCommentThread[]> {
    const response = await this.send(this.endpoint('/reviews'), { headers: { Accept: 'application/json' } })
    if (!response.ok) throw await toApiError(response)
    const body = (await response.json()) as unknown
    return Array.isArray(body) ? (body as HostCommentThread[]) : []
  }

  /** Returns the comment high-water sequence the Host recorded for this action. */
  async mutateComment(mutation: HostCommentMutation, idempotencyKey: string): Promise<string | null> {
    const response = await this.mutate(this.endpoint('/reviews'), 'POST', mutation, idempotencyKey)
    if (!response.ok) throw await toApiError(response)
    try {
      const body = (await response.json()) as { event?: { sequence?: unknown } }
      return typeof body.event?.sequence === 'string' ? body.event.sequence : null
    } catch {
      return null
    }
  }

  async commitHandoff(
    request: HostHandoffRequest,
    idempotencyKey: string,
  ): Promise<HostHandoffCommit> {
    const response = await this.mutate(this.endpoint('/handoffs'), 'POST', request, idempotencyKey)
    if (!response.ok) throw await toApiError(response)
    return (await response.json()) as HostHandoffCommit
  }

  async listListeners(): Promise<HostListenerSnapshot> {
    const response = await this.send(this.endpoint('/listeners'), { headers: { Accept: 'application/json' } })
    if (!response.ok) throw await toApiError(response)
    return (await response.json()) as HostListenerSnapshot
  }

  /**
   * Reserve a private object for one file too large to inline in a patch, then store the exact bytes
   * the reservation hashed. The Host-returned PUT target is re-checked against this page's origin.
   */
  async reserveUpload(content: string, idempotencyKey: string, tacoId: string): Promise<string> {
    const bytes = new TextEncoder().encode(content)
    const payloadHash = await sha256Prefixed(bytes)
    const response = await this.mutate(this.uploadEndpoint(), 'POST', {
      purpose: 'review-edit',
      tacoId,
      payloadBytes: bytes.byteLength,
      payloadHash,
    }, idempotencyKey)
    if (!response.ok) throw await toApiError(response)
    const reservation = (await response.json()) as {
      uploadId?: unknown
      status?: unknown
      uploadUrl?: unknown
    }
    const uploadId = typeof reservation.uploadId === 'string' ? reservation.uploadId : ''
    if (!uploadId) throw new HostApiError(response.status, 'UPLOAD_INVALID', 'Host returned no uploadId')
    if (reservation.status === 'committed') return uploadId

    let target: URL
    try {
      target = new URL(typeof reservation.uploadUrl === 'string' ? reservation.uploadUrl : '', this.origin)
    } catch {
      throw new HostApiError(response.status, 'UPLOAD_INVALID', 'Host returned an unusable upload URL')
    }
    if (target.origin !== this.origin) {
      throw new HostApiError(response.status, 'UPLOAD_INVALID', 'Host upload URL is not same-origin')
    }
    const put = await this.fetchImpl(target.toString(), {
      method: 'PUT',
      credentials: 'same-origin',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: bytes,
    })
    if (!put.ok) throw await toApiError(put)
    return uploadId
  }
}
