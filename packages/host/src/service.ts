import { randomUUID } from 'node:crypto'
import {
  computeSnapshotContentHash,
  MAX_COMMENT_BYTES,
  MAX_CONTROL_REQUEST_BYTES,
  MAX_IMAGE_BYTES,
  MAX_PAYLOAD_BYTES,
  MAX_SNAPSHOT_FILES,
  sha256Hex,
  validateStagedUploadContent,
  type ImportedCommentThread,
} from '@taco/protocol'
import type { MemoryBlobDriver, MemoryDatabaseDriver } from './storage.ts'

export interface HostContext {
  db: MemoryDatabaseDriver
  blob: MemoryBlobDriver
  hostUrl: string
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  body: unknown
}

const jsonResponse = (
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): HttpResponse => ({
  status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...(extraHeaders ?? {}),
  },
  body,
})

const errorResponse = (
  status: number,
  code: string,
  message: string,
  options?: { retryable?: boolean; requestId?: string; details?: Record<string, unknown> },
): HttpResponse =>
  jsonResponse(status, {
    error: {
      code,
      message,
      retryable: options?.retryable ?? false,
      requestId: options?.requestId ?? `req_host_${Math.random().toString(36).slice(2, 10)}`,
      ...(options?.details ? { details: options.details } : {}),
    },
  })

export class TacoHostService {
  constructor(private readonly ctx: HostContext) {}

  /**
   * GET /v1/capabilities
   */
  async getCapabilities(): Promise<HttpResponse> {
    return jsonResponse(200, {
      protocol: 'taco-host/1',
      limits: {
        maxPayloadBytes: MAX_PAYLOAD_BYTES,
        maxControlRequestBytes: MAX_CONTROL_REQUEST_BYTES,
        maxCommentBytes: MAX_COMMENT_BYTES,
        maxFilesPerSnapshot: MAX_SNAPSHOT_FILES,
        maxImageBytes: MAX_IMAGE_BYTES,
      },
      idempotency: {
        retentionSeconds: 86400,
      },
      retention: {
        policy: 'manual_only',
        defaultTtlSeconds: null,
      },
    })
  }

  /**
   * POST /v1/anonymous-credentials
   */
  async createAnonymousCredentials(): Promise<HttpResponse> {
    const userId = `usr_anon_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    const keyId = `key_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    const prefix = 'taco_live_'
    const rawSecret = `${prefix}${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`
    const keyHash = await sha256Hex(rawSecret)
    const now = new Date().toISOString()

    const user = {
      id: userId,
      kind: 'anonymous' as const,
      displayName: 'Anonymous Publisher',
      createdAt: now,
    }
    const apiKeyRow = {
      id: keyId,
      userId,
      prefix,
      keyHash,
      createdAt: now,
      expiresAt: null,
      revokedAt: null,
    }

    this.ctx.db.users.set(userId, user)
    this.ctx.db.apiKeys.set(keyId, apiKeyRow)

    return jsonResponse(201, {
      user,
      apiKey: {
        id: keyId,
        prefix,
        secret: rawSecret,
        createdAt: now,
        expiresAt: null,
      },
    })
  }

  /**
   * GET /v1/me
   */
  async getMe(authHeader?: string): Promise<HttpResponse> {
    const user = await this.authenticateBearer(authHeader)
    if (!user) return errorResponse(401, 'UNAUTHORIZED', 'Missing or invalid Bearer ApiKey')
    return jsonResponse(200, user)
  }

  /**
   * POST /v1/guest-session
   */
  async createGuestSession(body?: { displayName?: string }): Promise<HttpResponse> {
    const guestId = `g_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const csrfToken = `csrf_${randomUUID().replace(/-/g, '')}`
    const expiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString()
    const displayName = body?.displayName || 'Guest Reviewer'

    return jsonResponse(
      200,
      {
        csrfToken,
        actor: {
          kind: 'guest',
          id: guestId,
          displayName,
          verified: false,
        },
        expiresAt,
      },
      {
        'Set-Cookie': `taco_guest=gs_${guestId}; Path=/; HttpOnly; SameSite=Lax`,
      },
    )
  }

  /**
   * POST /v1/uploads
   */
  async prepareUpload(
    authHeader: string | undefined,
    idempotencyKey: string | undefined,
    payload: {
      protocol: string
      purpose: 'publish' | 'update'
      tacoId?: string | null
      baseRevisionId?: string | null
      payloadHash: string
      payloadBytes: number
    },
  ): Promise<HttpResponse> {
    const user = await this.authenticateBearer(authHeader)
    if (!user) return errorResponse(401, 'UNAUTHORIZED', 'Valid Bearer ApiKey required')
    if (!idempotencyKey || !/^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
      return errorResponse(400, 'BAD_REQUEST', 'Missing or invalid Idempotency-Key header')
    }

    if (payload.protocol !== 'taco-host/1') {
      return errorResponse(400, 'BAD_REQUEST', `Unsupported protocol: ${payload.protocol}`)
    }
    if (payload.purpose !== 'publish' && payload.purpose !== 'update') {
      return errorResponse(400, 'BAD_REQUEST', 'Invalid purpose')
    }
    if (payload.payloadBytes <= 0 || payload.payloadBytes > MAX_PAYLOAD_BYTES) {
      return errorResponse(
        413,
        'PAYLOAD_TOO_LARGE',
        `payloadBytes exceeds limit: ${MAX_PAYLOAD_BYTES}`,
      )
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(payload.payloadHash)) {
      return errorResponse(422, 'UNPROCESSABLE_ENTITY', 'payloadHash must be sha256:<64 hex>')
    }

    let targetScope = 'global:publish'
    let tacoId = randomUUID()
    const revisionId = randomUUID()

    if (payload.purpose === 'publish') {
      if (payload.tacoId !== null && payload.tacoId !== undefined) {
        return errorResponse(400, 'BAD_REQUEST', 'tacoId must be null for publish')
      }
      if (payload.baseRevisionId !== null && payload.baseRevisionId !== undefined) {
        return errorResponse(400, 'BAD_REQUEST', 'baseRevisionId must be null for publish')
      }
    } else {
      if (!payload.tacoId || !payload.baseRevisionId) {
        return errorResponse(
          400,
          'BAD_REQUEST',
          'tacoId and baseRevisionId are required for update',
        )
      }
      const existingTaco = this.ctx.db.tacos.get(payload.tacoId)
      if (!existingTaco) return errorResponse(404, 'NOT_FOUND', 'Target Taco not found')
      if (existingTaco.ownerId !== user.id)
        return errorResponse(403, 'FORBIDDEN', 'User is not the Taco owner')
      if (existingTaco.status === 'deleted' || existingTaco.status === 'expired') {
        return errorResponse(410, 'GONE', 'Target Taco has been deleted or expired')
      }
      targetScope = payload.tacoId
      tacoId = payload.tacoId
    }

    const scopeKey = `${user.id}:${payload.purpose}:${targetScope}:${idempotencyKey}`
    const existingRes = this.ctx.db.uploadReservations.get(scopeKey)

    if (existingRes) {
      if (
        existingRes.payloadHash !== payload.payloadHash ||
        existingRes.payloadBytes !== payload.payloadBytes
      ) {
        return errorResponse(
          409,
          'IDEMPOTENCY_MISMATCH',
          'Different payload submitted under same idempotency key',
        )
      }
      if (existingRes.status === 'committed') {
        return jsonResponse(201, {
          uploadId: existingRes.id,
          status: 'committed',
        })
      }
      if (existingRes.status === 'abandoned') {
        return errorResponse(409, 'CONFLICT', 'Upload reservation has been abandoned')
      }

      // Refresh short-lived PUT URL
      const newUrl = await this.ctx.blob.presignPutUrl(existingRes.blobPath, {
        maxBytes: existingRes.payloadBytes,
        validUntil: Date.now() + 15 * 60 * 1000,
      })
      return jsonResponse(201, {
        uploadId: existingRes.id,
        status: 'pending',
        method: 'PUT',
        uploadUrl: newUrl,
        headers: { 'Content-Type': 'application/json' },
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        maxBytes: existingRes.payloadBytes,
      })
    }

    const uploadId = randomUUID()
    const blobPath = `tacos/${tacoId}/revisions/${revisionId}.json`
    const now = new Date()
    const urlValidUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString()
    const reservationExpiresAt = new Date(now.getTime() + 24 * 3600 * 1000).toISOString()

    const reservationRow = {
      id: uploadId,
      userId: user.id,
      purpose: payload.purpose,
      targetScope,
      idempotencyKey,
      payloadHash: payload.payloadHash,
      payloadBytes: payload.payloadBytes,
      tacoId,
      revisionId,
      blobPath,
      status: 'pending' as const,
      expiresAt: reservationExpiresAt,
      urlValidUntil,
      createdAt: now.toISOString(),
    }

    this.ctx.db.uploadReservations.set(scopeKey, reservationRow)

    const uploadUrl = await this.ctx.blob.presignPutUrl(blobPath, {
      maxBytes: payload.payloadBytes,
      validUntil: Date.now() + 15 * 60 * 1000,
    })

    return jsonResponse(201, {
      uploadId,
      status: 'pending',
      method: 'PUT',
      uploadUrl,
      headers: { 'Content-Type': 'application/json' },
      expiresAt: urlValidUntil,
      maxBytes: payload.payloadBytes,
    })
  }

  /**
   * POST /v1/tacos (Commit Publish)
   */
  async publishTaco(
    authHeader: string | undefined,
    idempotencyKey: string | undefined,
    body: { protocol: string; uploadId: string },
  ): Promise<HttpResponse> {
    const user = await this.authenticateBearer(authHeader)
    if (!user) return errorResponse(401, 'UNAUTHORIZED', 'Valid Bearer ApiKey required')
    if (!idempotencyKey) return errorResponse(400, 'BAD_REQUEST', 'Missing Idempotency-Key header')

    const scopeKey = `${user.id}:publish:global:publish:${idempotencyKey}`
    const reservation = this.ctx.db.uploadReservations.get(scopeKey)
    if (!reservation || reservation.id !== body.uploadId) {
      return errorResponse(404, 'NOT_FOUND', 'Matching upload reservation not found')
    }

    if (reservation.status === 'committed') {
      const existingTaco = this.ctx.db.tacos.get(reservation.tacoId)
      const existingRev = this.ctx.db.revisions.get(reservation.revisionId)
      if (!existingTaco || !existingRev)
        return errorResponse(500, 'INTERNAL_ERROR', 'Committed entities not found')
      return jsonResponse(201, {
        command: 'publish',
        host: this.ctx.hostUrl,
        tacoId: existingTaco.id,
        revisionId: existingRev.id,
        contentHash: existingRev.contentHash,
        url: `${this.ctx.hostUrl}/t/${existingTaco.id}`,
        revisionUrl: `${this.ctx.hostUrl}/t/${existingTaco.id}/r/${existingRev.id}`,
        expiresAt: existingTaco.expiresAt,
      })
    }

    // Load from private Blob
    const rawData = await this.ctx.blob.getObject(reservation.blobPath)
    if (!rawData) {
      return errorResponse(
        400,
        'BAD_REQUEST',
        'Staged content not found in storage; client must PUT before commit',
      )
    }

    // Verify hash & byte length
    const actualHex = await sha256Hex(rawData)
    if (
      `sha256:${actualHex}` !== reservation.payloadHash ||
      rawData.byteLength !== reservation.payloadBytes
    ) {
      return errorResponse(
        422,
        'UNPROCESSABLE_ENTITY',
        'Staged content hash/bytes does not match reservation',
      )
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawData))
    } catch {
      return errorResponse(422, 'UNPROCESSABLE_ENTITY', 'Staged payload is not valid UTF-8 JSON')
    }

    const validated = validateStagedUploadContent(parsedJson)
    if (!validated.ok) {
      return errorResponse(
        422,
        'UNPROCESSABLE_ENTITY',
        `Payload validation failed: ${validated.err}`,
      )
    }

    const snapshot = validated.payload.snapshot
    const contentHash = await computeSnapshotContentHash(snapshot)
    const now = new Date().toISOString()

    // Atomic DB commit
    const tacoRow = {
      id: reservation.tacoId,
      ownerId: user.id,
      title: snapshot.title,
      currentRevisionId: reservation.revisionId,
      status: 'open' as const,
      lastSequence: 1,
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
    }
    const revisionRow = {
      id: reservation.revisionId,
      tacoId: reservation.tacoId,
      parentRevisionId: null,
      publisherId: user.id,
      sourceDocId: snapshot.docId,
      contentHash,
      blobPath: reservation.blobPath,
      createdAt: now,
    }
    const initialEvent = {
      id: `ev_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      sequence: 1,
      tacoId: reservation.tacoId,
      revisionId: reservation.revisionId,
      type: 'revision.published',
      occurredAt: now,
      actor: {
        kind: 'user' as const,
        id: user.id,
        displayName: user.displayName,
        verified: false as const,
      },
      data: {
        contentHash,
        parentRevisionId: null,
      },
    }

    this.ctx.db.tacos.set(tacoRow.id, tacoRow)
    this.ctx.db.revisions.set(revisionRow.id, revisionRow)
    this.ctx.db.events.push(initialEvent)

    if (validated.payload.importedComments) {
      this.importCommentThreads(
        reservation.tacoId,
        reservation.revisionId,
        validated.payload.importedComments,
      )
    }

    reservation.status = 'committed'

    return jsonResponse(201, {
      command: 'publish',
      host: this.ctx.hostUrl,
      tacoId: tacoRow.id,
      revisionId: revisionRow.id,
      contentHash,
      url: `${this.ctx.hostUrl}/t/${tacoRow.id}`,
      revisionUrl: `${this.ctx.hostUrl}/t/${tacoRow.id}/r/${revisionRow.id}`,
      expiresAt: null,
    })
  }

  /**
   * POST /v1/tacos/{id}/revisions (Commit Revision)
   */
  async createRevision(
    authHeader: string | undefined,
    idempotencyKey: string | undefined,
    tacoId: string,
    body: { protocol: string; uploadId: string; baseRevisionId: string },
  ): Promise<HttpResponse> {
    const user = await this.authenticateBearer(authHeader)
    if (!user) return errorResponse(401, 'UNAUTHORIZED', 'Valid Bearer ApiKey required')
    if (!idempotencyKey) return errorResponse(400, 'BAD_REQUEST', 'Missing Idempotency-Key header')

    const scopeKey = `${user.id}:update:${tacoId}:${idempotencyKey}`
    const reservation = this.ctx.db.uploadReservations.get(scopeKey)
    if (!reservation || reservation.id !== body.uploadId) {
      return errorResponse(404, 'NOT_FOUND', 'Matching upload reservation not found')
    }

    const taco = this.ctx.db.tacos.get(tacoId)
    if (!taco) return errorResponse(404, 'NOT_FOUND', 'Taco not found')
    if (taco.ownerId !== user.id) return errorResponse(403, 'FORBIDDEN', 'User is not Taco owner')
    if (taco.status === 'closed')
      return errorResponse(409, 'TACO_CLOSED', 'Cannot update closed Taco')
    if (taco.status === 'deleted' || taco.status === 'expired')
      return errorResponse(410, 'GONE', 'Taco is gone')

    if (reservation.status === 'committed') {
      const existingRev = this.ctx.db.revisions.get(reservation.revisionId)
      if (!existingRev) return errorResponse(500, 'INTERNAL_ERROR', 'Committed revision not found')
      return jsonResponse(201, {
        command: 'update',
        host: this.ctx.hostUrl,
        tacoId: taco.id,
        revisionId: existingRev.id,
        contentHash: existingRev.contentHash,
        url: `${this.ctx.hostUrl}/t/${taco.id}`,
        revisionUrl: `${this.ctx.hostUrl}/t/${taco.id}/r/${existingRev.id}`,
        expiresAt: taco.expiresAt,
      })
    }

    if (taco.currentRevisionId !== body.baseRevisionId) {
      return errorResponse(409, 'REVISION_CONFLICT', 'Base revision is no longer current', {
        details: { currentRevisionId: taco.currentRevisionId },
      })
    }

    // Load from private Blob
    const rawData = await this.ctx.blob.getObject(reservation.blobPath)
    if (!rawData) {
      return errorResponse(400, 'BAD_REQUEST', 'Staged content not found in storage')
    }

    const actualHex = await sha256Hex(rawData)
    if (
      `sha256:${actualHex}` !== reservation.payloadHash ||
      rawData.byteLength !== reservation.payloadBytes
    ) {
      return errorResponse(
        422,
        'UNPROCESSABLE_ENTITY',
        'Staged content hash/bytes does not match reservation',
      )
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawData))
    } catch {
      return errorResponse(422, 'UNPROCESSABLE_ENTITY', 'Staged payload is not valid UTF-8 JSON')
    }

    const validated = validateStagedUploadContent(parsedJson)
    if (!validated.ok) {
      return errorResponse(
        422,
        'UNPROCESSABLE_ENTITY',
        `Payload validation failed: ${validated.err}`,
      )
    }

    const snapshot = validated.payload.snapshot
    const contentHash = await computeSnapshotContentHash(snapshot)
    const now = new Date().toISOString()
    const nextSequence = taco.lastSequence + 1

    const revisionRow = {
      id: reservation.revisionId,
      tacoId: taco.id,
      parentRevisionId: body.baseRevisionId,
      publisherId: user.id,
      sourceDocId: snapshot.docId,
      contentHash,
      blobPath: reservation.blobPath,
      createdAt: now,
    }

    taco.currentRevisionId = reservation.revisionId
    taco.title = snapshot.title
    taco.updatedAt = now
    taco.lastSequence = nextSequence

    const publishEvent = {
      id: `ev_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      sequence: nextSequence,
      tacoId: taco.id,
      revisionId: reservation.revisionId,
      type: 'revision.published',
      occurredAt: now,
      actor: {
        kind: 'user' as const,
        id: user.id,
        displayName: user.displayName,
        verified: false as const,
      },
      data: {
        contentHash,
        parentRevisionId: body.baseRevisionId,
      },
    }

    this.ctx.db.revisions.set(revisionRow.id, revisionRow)
    this.ctx.db.events.push(publishEvent)

    if (validated.payload.importedComments) {
      this.importCommentThreads(taco.id, reservation.revisionId, validated.payload.importedComments)
    }

    reservation.status = 'committed'

    return jsonResponse(201, {
      command: 'update',
      host: this.ctx.hostUrl,
      tacoId: taco.id,
      revisionId: revisionRow.id,
      contentHash,
      url: `${this.ctx.hostUrl}/t/${taco.id}`,
      revisionUrl: `${this.ctx.hostUrl}/t/${taco.id}/r/${revisionRow.id}`,
      expiresAt: taco.expiresAt,
    })
  }

  /**
   * POST /v1/tacos/{id}/reviews (Review Mutation)
   */
  async postReview(
    authHeader: string | undefined,
    guestCookie: string | undefined,
    idempotencyKey: string | undefined,
    tacoId: string,
    mutation: {
      revisionId: string
      type: string
      body?: string
      threadId?: string
      anchor?: unknown
    },
  ): Promise<HttpResponse> {
    if (!idempotencyKey) return errorResponse(400, 'BAD_REQUEST', 'Missing Idempotency-Key header')

    const actor = await this.authenticateActor(authHeader, guestCookie)
    if (!actor)
      return errorResponse(401, 'UNAUTHORIZED', 'Authentication required (ApiKey or guest session)')

    const taco = this.ctx.db.tacos.get(tacoId)
    if (!taco) return errorResponse(404, 'NOT_FOUND', 'Taco not found')
    if (taco.status === 'deleted' || taco.status === 'expired')
      return errorResponse(410, 'GONE', 'Taco is gone')

    // Idempotent receipt check
    const receiptKey = `${tacoId}:${actor.kind}:${actor.id}:${idempotencyKey}`
    const existingReceipt = this.ctx.db.mutationReceipts.get(receiptKey)
    if (existingReceipt) {
      return jsonResponse(existingReceipt.statusCode, existingReceipt.responseBody)
    }

    if (taco.status === 'closed') {
      return errorResponse(409, 'TACO_CLOSED', 'Taco is closed to new reviews')
    }

    const revision = this.ctx.db.revisions.get(mutation.revisionId)
    if (!revision || revision.tacoId !== tacoId) {
      return errorResponse(404, 'NOT_FOUND', 'Revision not found in this Taco')
    }

    const now = new Date().toISOString()
    let changed = true
    let eventData: Record<string, unknown> = {}
    let eventType = mutation.type

    // Process mutation types
    if (mutation.type === 'comment.created') {
      if (!mutation.body || mutation.body.trim().length === 0) {
        return errorResponse(400, 'BAD_REQUEST', 'Missing comment body')
      }
      const threadId = `th_${randomUUID().replace(/-/g, '').slice(0, 12)}`
      const messageId = `m_${randomUUID().replace(/-/g, '').slice(0, 12)}`

      this.ctx.db.threads.set(`${mutation.revisionId}:${threadId}`, {
        id: threadId,
        revisionId: mutation.revisionId,
        tacoId,
        status: 'open',
        anchor: mutation.anchor ?? null,
        isAnchorStale: false,
        isImported: false,
        resolvedBy: null,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
      })

      this.ctx.db.threadMessages.push({
        id: messageId,
        threadId,
        revisionId: mutation.revisionId,
        author: { ...actor, verified: false },
        body: mutation.body,
        createdAt: now,
        deletedAt: null,
      })

      eventData = {
        threadId,
        messageId,
        body: mutation.body,
        anchor: mutation.anchor ?? null,
      }
    } else if (mutation.type === 'comment.replied') {
      if (!mutation.threadId) return errorResponse(400, 'BAD_REQUEST', 'Missing threadId')
      if (!mutation.body || mutation.body.trim().length === 0) {
        return errorResponse(400, 'BAD_REQUEST', 'Missing reply body')
      }

      const thread = this.ctx.db.threads.get(`${mutation.revisionId}:${mutation.threadId}`)
      if (!thread) return errorResponse(404, 'NOT_FOUND', 'Thread not found in this revision')

      const messageId = `m_${randomUUID().replace(/-/g, '').slice(0, 12)}`
      this.ctx.db.threadMessages.push({
        id: messageId,
        threadId: mutation.threadId,
        revisionId: mutation.revisionId,
        author: { ...actor, verified: false },
        body: mutation.body,
        createdAt: now,
        deletedAt: null,
      })
      thread.updatedAt = now

      eventData = {
        threadId: mutation.threadId,
        messageId,
        body: mutation.body,
      }
    } else if (mutation.type === 'thread.resolved' || mutation.type === 'thread.reopened') {
      if (!mutation.threadId) return errorResponse(400, 'BAD_REQUEST', 'Missing threadId')
      const thread = this.ctx.db.threads.get(`${mutation.revisionId}:${mutation.threadId}`)
      if (!thread) return errorResponse(404, 'NOT_FOUND', 'Thread not found')

      const targetStatus = mutation.type === 'thread.resolved' ? 'resolved' : 'open'
      if (thread.status === targetStatus) {
        changed = false
      } else {
        thread.status = targetStatus
        thread.resolvedBy = targetStatus === 'resolved' ? actor.id : null
        thread.resolvedAt = targetStatus === 'resolved' ? now : null
        thread.updatedAt = now
        eventData = { threadId: mutation.threadId }
      }
    } else if (mutation.type === 'revision.approved') {
      const stateKey = `${mutation.revisionId}:${actor.kind}:${actor.id}`
      const existingState = this.ctx.db.reviewerStates.get(stateKey)
      if (existingState?.approved === true) {
        changed = false
      } else {
        this.ctx.db.reviewerStates.set(stateKey, {
          revisionId: mutation.revisionId,
          actor,
          completed: existingState?.completed ?? false,
          completedAtSequence: existingState?.completedAtSequence ?? null,
          approved: true,
          approvedAt: now,
        })
      }
    } else if (mutation.type === 'revision.approval_withdrawn') {
      const stateKey = `${mutation.revisionId}:${actor.kind}:${actor.id}`
      const existingState = this.ctx.db.reviewerStates.get(stateKey)
      if (!existingState || existingState.approved === false) {
        changed = false
      } else {
        existingState.approved = false
        existingState.approvedAt = null
      }
    } else if (mutation.type === 'review.completed') {
      const stateKey = `${mutation.revisionId}:${actor.kind}:${actor.id}`
      const existingState = this.ctx.db.reviewerStates.get(stateKey)
      if (existingState?.completed === true) {
        changed = false
      } else {
        this.ctx.db.reviewerStates.set(stateKey, {
          revisionId: mutation.revisionId,
          actor,
          completed: true,
          completedAtSequence: taco.lastSequence + 1,
          approved: existingState?.approved ?? false,
          approvedAt: existingState?.approvedAt ?? null,
        })
      }
    } else {
      return errorResponse(400, 'BAD_REQUEST', `Unknown mutation type: ${mutation.type}`)
    }

    if (!changed) {
      const noOpResponse = { changed: false, event: null }
      this.ctx.db.mutationReceipts.set(receiptKey, {
        tacoId,
        actorKind: actor.kind,
        actorId: actor.id,
        idempotencyKey,
        statusCode: 200,
        responseBody: noOpResponse,
        createdAt: now,
      })
      return jsonResponse(200, noOpResponse)
    }

    const nextSequence = taco.lastSequence + 1
    taco.lastSequence = nextSequence
    taco.updatedAt = now

    const event = {
      id: `ev_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      sequence: nextSequence,
      tacoId,
      revisionId: mutation.revisionId,
      type: eventType,
      occurredAt: now,
      actor: { ...actor, verified: false as const },
      data: eventData,
    }

    this.ctx.db.events.push(event)

    const successResponse = { changed: true, event }
    this.ctx.db.mutationReceipts.set(receiptKey, {
      tacoId,
      actorKind: actor.kind,
      actorId: actor.id,
      idempotencyKey,
      statusCode: 201,
      responseBody: successResponse,
      createdAt: now,
    })

    return jsonResponse(201, successResponse)
  }

  /**
   * GET /v1/tacos/{id}/revisions
   */
  async listRevisions(tacoId: string, after?: string, limit = 100): Promise<HttpResponse> {
    const taco = this.ctx.db.tacos.get(tacoId)
    if (!taco) return errorResponse(404, 'NOT_FOUND', 'Taco not found')
    if (taco.status === 'deleted' || taco.status === 'expired')
      return errorResponse(410, 'GONE', 'Taco is gone')

    const allRevs = Array.from(this.ctx.db.revisions.values())
      .filter((r) => r.tacoId === tacoId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    let startIndex = 0
    if (after) {
      const afterIdx = allRevs.findIndex((r) => r.id === after)
      if (afterIdx !== -1) startIndex = afterIdx + 1
    }

    const paged = allRevs.slice(startIndex, startIndex + limit)
    const hasMore = allRevs.length > startIndex + limit
    const nextCursor = hasMore ? paged[paged.length - 1].id : null

    return jsonResponse(200, {
      revisions: paged.map((r) => ({
        id: r.id,
        tacoId: r.tacoId,
        parentRevisionId: r.parentRevisionId,
        publisherId: r.publisherId,
        sourceDocId: r.sourceDocId,
        contentHash: r.contentHash,
        createdAt: r.createdAt,
      })),
      throughSequence: String(taco.lastSequence),
      nextCursor,
      hasMore,
    })
  }

  /**
   * GET /v1/tacos/{id}/revisions/{rev}
   */
  async getRevision(tacoId: string, revisionId: string): Promise<HttpResponse> {
    const taco = this.ctx.db.tacos.get(tacoId)
    if (!taco) return errorResponse(404, 'NOT_FOUND', 'Taco not found')
    if (taco.status === 'deleted' || taco.status === 'expired')
      return errorResponse(410, 'GONE', 'Taco is gone')

    const rev = this.ctx.db.revisions.get(revisionId)
    if (!rev || rev.tacoId !== tacoId) return errorResponse(404, 'NOT_FOUND', 'Revision not found')

    const rawData = await this.ctx.blob.getObject(rev.blobPath)
    if (!rawData)
      return errorResponse(500, 'INTERNAL_ERROR', 'Snapshot content missing from storage')

    const parsed = JSON.parse(new TextDecoder('utf-8').decode(rawData)) as { snapshot: unknown }
    return jsonResponse(200, {
      id: rev.id,
      tacoId: rev.tacoId,
      parentRevisionId: rev.parentRevisionId,
      publisherId: rev.publisherId,
      sourceDocId: rev.sourceDocId,
      contentHash: rev.contentHash,
      createdAt: rev.createdAt,
      snapshot: parsed.snapshot,
    })
  }

  /**
   * GET /v1/tacos/{id}/export
   */
  async exportTaco(tacoId: string): Promise<HttpResponse> {
    const taco = this.ctx.db.tacos.get(tacoId)
    if (!taco) return errorResponse(404, 'NOT_FOUND', 'Taco not found')
    if (taco.status === 'deleted' || taco.status === 'expired')
      return errorResponse(410, 'GONE', 'Taco is gone')

    const throughSequence = taco.lastSequence
    const revisionsList = Array.from(this.ctx.db.revisions.values())
      .filter((r) => r.tacoId === tacoId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    const exportedRevisions = []
    for (const r of revisionsList) {
      const raw = await this.ctx.blob.getObject(r.blobPath)
      if (!raw) return errorResponse(500, 'INTERNAL_ERROR', `Missing snapshot for revision ${r.id}`)
      const parsed = JSON.parse(new TextDecoder('utf-8').decode(raw)) as { snapshot: unknown }
      exportedRevisions.push({
        id: r.id,
        tacoId: r.tacoId,
        parentRevisionId: r.parentRevisionId,
        publisherId: r.publisherId,
        sourceDocId: r.sourceDocId,
        contentHash: r.contentHash,
        createdAt: r.createdAt,
        snapshot: parsed.snapshot,
      })
    }

    const eventsList = this.ctx.db.events
      .filter((e) => e.tacoId === tacoId && e.sequence <= throughSequence)
      .sort((a, b) => a.sequence - b.sequence)

    return jsonResponse(200, {
      protocol: 'taco-host-export/1',
      exportedAt: new Date().toISOString(),
      throughSequence: String(throughSequence),
      taco: {
        id: taco.id,
        ownerId: taco.ownerId,
        title: taco.title,
        currentRevisionId: taco.currentRevisionId,
        status: taco.status,
        createdAt: taco.createdAt,
        updatedAt: taco.updatedAt,
        expiresAt: taco.expiresAt,
        lastSequence: String(taco.lastSequence),
      },
      revisions: exportedRevisions,
      importedThreads: [],
      events: eventsList.map((e) => ({
        kind: 'event',
        id: e.id,
        sequence: String(e.sequence),
        tacoId: e.tacoId,
        revisionId: e.revisionId,
        type: e.type,
        occurredAt: e.occurredAt,
        actor: e.actor,
        data: e.data,
      })),
    })
  }

  /**
   * GET /v1/tacos/{id}
   */
  async getTaco(tacoId: string): Promise<HttpResponse> {
    const taco = this.ctx.db.tacos.get(tacoId)
    if (!taco) return errorResponse(404, 'NOT_FOUND', 'Taco not found')
    if (taco.status === 'deleted' || taco.status === 'expired')
      return errorResponse(410, 'GONE', 'Taco is gone')

    return jsonResponse(200, {
      id: taco.id,
      ownerId: taco.ownerId,
      title: taco.title,
      currentRevisionId: taco.currentRevisionId,
      status: taco.status,
      createdAt: taco.createdAt,
      updatedAt: taco.updatedAt,
      expiresAt: taco.expiresAt,
      lastSequence: String(taco.lastSequence),
    })
  }

  /**
   * GET /v1/tacos/{id}/events
   */
  async getEvents(
    tacoId: string,
    after?: string,
    throughSequence?: string,
    limit = 100,
  ): Promise<HttpResponse> {
    const taco = this.ctx.db.tacos.get(tacoId)
    if (!taco) return errorResponse(404, 'NOT_FOUND', 'Taco not found')
    if (taco.status === 'deleted' || taco.status === 'expired')
      return errorResponse(410, 'GONE', 'Taco is gone')

    const currentH = taco.lastSequence
    const effectiveH = throughSequence ? Number.parseInt(throughSequence, 10) : currentH

    if (effectiveH > currentH) {
      return errorResponse(400, 'BAD_REQUEST', 'throughSequence exceeds current high-water mark')
    }

    const afterSeq = after ? Number.parseInt(after, 10) : 0
    if (afterSeq > effectiveH) {
      return errorResponse(400, 'BAD_REQUEST', 'after cursor exceeds throughSequence')
    }

    const filtered = this.ctx.db.events
      .filter((e) => e.tacoId === tacoId && e.sequence > afterSeq && e.sequence <= effectiveH)
      .sort((a, b) => a.sequence - b.sequence)

    const paged = filtered.slice(0, limit)
    const hasMore = filtered.length > limit
    const nextCursor = hasMore ? String(paged[paged.length - 1].sequence) : null

    return jsonResponse(200, {
      events: paged.map((e) => ({
        kind: 'event',
        id: e.id,
        sequence: String(e.sequence),
        tacoId: e.tacoId,
        revisionId: e.revisionId,
        type: e.type,
        occurredAt: e.occurredAt,
        actor: e.actor,
        data: e.data,
      })),
      throughSequence: String(effectiveH),
      nextCursor,
      hasMore,
    })
  }

  // --- Private Helpers ---
  private async authenticateBearer(authHeader?: string) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null
    const secret = authHeader.slice(7).trim()
    return this.ctx.db.authenticateKey(secret)
  }

  private async authenticateActor(authHeader?: string, guestCookie?: string) {
    const user = await this.authenticateBearer(authHeader)
    if (user) {
      return {
        kind: 'user' as const,
        id: user.id,
        displayName: user.displayName,
        verified: false,
      }
    }

    if (guestCookie && guestCookie.includes('taco_guest=gs_')) {
      const match = guestCookie.match(/taco_guest=gs_([a-z0-9_]+)/i)
      if (match) {
        return {
          kind: 'guest' as const,
          id: match[1],
          displayName: 'Guest Reviewer',
          verified: false,
        }
      }
    }

    return null
  }

  private importCommentThreads(
    tacoId: string,
    revisionId: string,
    imported: ImportedCommentThread[],
  ) {
    const now = new Date().toISOString()
    for (const th of imported) {
      this.ctx.db.threads.set(`${revisionId}:${th.id}`, {
        id: th.id,
        revisionId,
        tacoId,
        status: th.status,
        anchor: th.anchor,
        isAnchorStale: false,
        isImported: true,
        resolvedBy: null,
        resolvedAt: null,
        createdAt: th.createdAt,
        updatedAt: th.updatedAt,
      })
      for (const m of th.messages) {
        this.ctx.db.threadMessages.push({
          id: m.id,
          threadId: th.id,
          revisionId,
          author: {
            kind: 'imported',
            id: `imp:${revisionId}:${m.authorId || m.author}`,
            displayName: m.author,
            verified: false,
          },
          body: m.body,
          createdAt: m.createdAt,
          deletedAt: m.deletedAt ?? null,
        })
      }
    }
  }
}
