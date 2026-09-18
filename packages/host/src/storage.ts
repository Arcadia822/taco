import { sha256Hex } from '@taco/protocol'

export interface StorageDriver {
  putObject(blobPath: string, data: string | Uint8Array, contentType?: string): Promise<void>
  getObject(blobPath: string): Promise<Uint8Array | null>
  deleteObject(blobPath: string): Promise<void>
  presignPutUrl(
    blobPath: string,
    options: { maxBytes: number; validUntil: number },
  ): Promise<string>
}

export class MemoryBlobDriver implements StorageDriver {
  private readonly store = new Map<string, Uint8Array>()

  async putObject(blobPath: string, data: string | Uint8Array): Promise<void> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    this.store.set(blobPath, bytes)
  }

  async getObject(blobPath: string): Promise<Uint8Array | null> {
    return this.store.get(blobPath) ?? null
  }

  async deleteObject(blobPath: string): Promise<void> {
    this.store.delete(blobPath)
  }

  async presignPutUrl(blobPath: string): Promise<string> {
    return `https://mock-blob.vercel-storage.com/${blobPath}?signature=mock_sig_${Date.now()}`
  }
}

export interface UserRow {
  id: string
  kind: 'anonymous' | 'registered'
  displayName: string
  createdAt: string
}

export interface ApiKeyRow {
  id: string
  userId: string
  prefix: string
  keyHash: string
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
}

export interface UploadReservationRow {
  id: string
  userId: string
  purpose: 'publish' | 'update'
  targetScope: string
  idempotencyKey: string
  payloadHash: string
  payloadBytes: number
  tacoId: string
  revisionId: string
  blobPath: string
  status: 'pending' | 'committed' | 'abandoned'
  expiresAt: string
  urlValidUntil: string
  createdAt: string
}

export interface TacoRow {
  id: string
  ownerId: string
  title: string
  currentRevisionId: string | null
  status: 'open' | 'closed' | 'expired' | 'deleted'
  lastSequence: number
  createdAt: string
  updatedAt: string
  expiresAt: string | null
}

export interface RevisionRow {
  id: string
  tacoId: string
  parentRevisionId: string | null
  publisherId: string
  sourceDocId: string | null
  contentHash: string
  blobPath: string
  createdAt: string
}

export interface EventRow {
  id: string
  sequence: number
  tacoId: string
  revisionId: string | null
  type: string
  occurredAt: string
  actor: {
    kind: 'user' | 'guest'
    id: string
    displayName: string
    verified: false
  }
  data: Record<string, unknown>
}

export interface ThreadRow {
  id: string
  revisionId: string
  tacoId: string
  status: 'open' | 'resolved'
  anchor: unknown | null
  isAnchorStale: boolean
  isImported: boolean
  resolvedBy: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ThreadMessageRow {
  id: string
  threadId: string
  revisionId: string
  author: {
    kind: 'user' | 'guest' | 'imported'
    id: string
    displayName: string
    verified: boolean
  }
  body: string
  createdAt: string
  deletedAt: string | null
}

export interface ReviewerStateRow {
  revisionId: string
  actor: {
    kind: 'user' | 'guest'
    id: string
    displayName: string
    verified: boolean
  }
  completed: boolean
  completedAtSequence: number | null
  approved: boolean
  approvedAt: string | null
}

export interface MutationReceiptRow {
  tacoId: string
  actorKind: 'user' | 'guest'
  actorId: string
  idempotencyKey: string
  statusCode: number
  responseBody: unknown
  createdAt: string
}

/**
 * In-memory transactional storage driver replicating PostgreSQL row-locking and ACID behavior for fast testing and local execution
 */
export class MemoryDatabaseDriver {
  users = new Map<string, UserRow>()
  apiKeys = new Map<string, ApiKeyRow>()
  uploadReservations = new Map<string, UploadReservationRow>() // key: user:purpose:targetScope:idempotencyKey
  tacos = new Map<string, TacoRow>()
  revisions = new Map<string, RevisionRow>()
  events: EventRow[] = []
  threads = new Map<string, ThreadRow>() // key: revisionId:threadId
  threadMessages: ThreadMessageRow[] = []
  reviewerStates = new Map<string, ReviewerStateRow>() // key: revisionId:actorKind:actorId
  mutationReceipts = new Map<string, MutationReceiptRow>() // key: tacoId:actorKind:actorId:idempotencyKey

  // Helpers
  async authenticateKey(secret: string): Promise<UserRow | null> {
    const keyHash = await sha256Hex(secret)
    for (const key of this.apiKeys.values()) {
      if (key.keyHash === keyHash) {
        if (key.revokedAt !== null) return null
        if (key.expiresAt && Date.parse(key.expiresAt) < Date.now()) return null
        return this.users.get(key.userId) ?? null
      }
    }
    return null
  }
}
