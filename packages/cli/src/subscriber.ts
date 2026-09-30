export interface SubscribeFrameHandler {
  onFrame(frame: string): void
  onDiagnostic(diag: { code: string; message: string; attempt?: number }): void
  onError(err: { code: string; message: string }): void
}

export interface WebSocketSessionAdapter {
  connect(url: string, headers?: Record<string, string>): Promise<void>
  send(data: string): void
  close(): void
  onMessage(cb: (msg: string) => void): void
  onClose(cb: (code: number, reason: string) => void): void
  onError(cb: (err: Error) => void): void
}

export interface SubscribeMetadata {
  listenerId?: string
  harness?: string
  model?: string
  modelId?: string
  name?: string
}

export type SubscribeMode = 'handoff' | 'stream'

export interface TacoSubscriberOptions {
  initialAfter?: string | null
  maxReconnectTimeMs?: number
  metadata?: SubscribeMetadata
  mode?: SubscribeMode
}

/**
 * Client-side subscriber managing NDJSON stream output, exponential backoff reconnect,
 * and automatic transparent reconnection on 1012 (Service Restart / Rotation) with latest confirmed cursor.
 */
export class TacoSubscriber {
  private lastConfirmedCursor: string | null = null
  private running = true
  private readonly listenerId: string
  private readonly metadata?: SubscribeMetadata
  private readonly mode: SubscribeMode

  constructor(
    private readonly hostUrl: string,
    private readonly tacoId: string,
    private readonly handler: SubscribeFrameHandler,
    private readonly adapterFactory: () => WebSocketSessionAdapter,
    options?: TacoSubscriberOptions,
  ) {
    this.lastConfirmedCursor = options?.initialAfter ?? null
    this.metadata = options?.metadata
    this.listenerId = options?.metadata?.listenerId || crypto.randomUUID()
    this.mode = options?.mode ?? 'handoff'
  }
  async start(): Promise<{ exitCode: number }> {
    let reconnectAttempts = 0
    const startReconnectTime = Date.now()
    const maxReconnectTime = this.options?.maxReconnectTimeMs || 5 * 60 * 1000 // 5 minutes

    while (this.running) {
      try {
        const exit = await this.runOneConnection()
        if (exit !== undefined) {
          return { exitCode: exit }
        }
        // If runOneConnection returned without code, was closed for restart (1012)
        reconnectAttempts = 0
      } catch (err) {
        const errObj = err as Error & { statusCode?: number; code?: string }
        if (errObj.code === 'CURSOR_EXPIRED' || errObj.statusCode === 410) {
          this.handler.onError({
            code: 'CURSOR_EXPIRED',
            message: errObj.message || 'Cursor has expired and cannot be replayed',
          })
          return { exitCode: 6 }
        }
        if (errObj.code === 'NOT_FOUND' || errObj.statusCode === 404) {
          this.handler.onError({
            code: 'NOT_FOUND',
            message: errObj.message || 'Taco not found',
          })
          return { exitCode: 2 }
        }
        if (errObj.code === 'VALIDATION_ERROR' || errObj.statusCode === 400) {
          this.handler.onError({
            code: 'VALIDATION_ERROR',
            message: errObj.message || 'Validation error',
          })
          return { exitCode: 2 }
        }

        reconnectAttempts += 1
        this.handler.onDiagnostic({
          code: 'DISCONNECTED',
          message: `WebSocket disconnected: ${(err as Error).message}`,
          attempt: reconnectAttempts,
        })

        if (Date.now() - startReconnectTime > maxReconnectTime) {
          this.handler.onError({
            code: 'RETRY_EXHAUSTED',
            message: 'Unreachable for over 5 minutes; aborting subscription',
          })
          return { exitCode: 5 }
        }

        // Exponential backoff with jitter
        const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 10000)
        const { promise: delayPromise, resolve: resolveDelay } = Promise.withResolvers<void>()
        setTimeout(resolveDelay, delay)
        await delayPromise
      }
    }

    return { exitCode: 0 }
  }

  private runOneConnection(): Promise<number | undefined> {
    const { promise, resolve, reject } = Promise.withResolvers<number | undefined>()
    // The cursor travels in the URL: the transport carries the resume position, so a
    // reconnect after a drop resumes from the last confirmed sequence instead of the live
    // watermark. Transports that negotiate over a control frame also send it below.
    const resumeQuery = this.lastConfirmedCursor
      ? `?after=${encodeURIComponent(this.lastConfirmedCursor)}`
      : ''
    const wsUrl =
      this.hostUrl.replace(/^http/, 'ws') + `/v1/tacos/${this.tacoId}/subscribe${resumeQuery}`
    const socket = this.adapterFactory()

    const headers: Record<string, string> = {
      'X-Listener-Id': this.listenerId,
    }
    if (this.metadata?.harness) {
      headers['X-Taco-Harness'] = this.metadata.harness
    }
    if (this.metadata?.model) {
      headers['X-Taco-Model'] = this.metadata.model
    }
    if (this.metadata?.modelId) {
      headers['X-Taco-Model-Id'] = this.metadata.modelId
    }
    if (this.metadata?.name) {
      headers['X-Taco-Listener-Name'] = this.metadata.name
    }

    socket.onMessage((text) => {
      try {
        const frame = JSON.parse(text) as {
          kind: string
          cursor?: string
          sequence?: string
          mode?: string
          error?: { code: string; message?: string }
        }
        if (frame.kind === 'error') {
          // Settle first: closing the transport reports a client-initiated close synchronously,
          // and that must not be mistaken for a dropped connection worth reconnecting.
          if (frame.error?.code === 'CURSOR_EXPIRED') {
            this.handler.onError({
              code: 'CURSOR_EXPIRED',
              message: frame.error.message || 'Cursor has expired and cannot be replayed',
            })
            resolve(6)
            socket.close()
            return
          }
          if (frame.error?.code === 'TACO_CLOSED') {
            resolve(4)
            socket.close()
            return
          }
        }

        if (this.mode === 'handoff') {
          // In default handoff mode:
          // 1. Ready frame is emitted to signal connection & cursor
          // 2. comment/file/non-handoff events are filtered out
          // 3. review.handed_off event is emitted, then connection closes cleanly with code 0
          if (frame.kind === 'ready') {
            this.handler.onFrame(text)
            if (frame.mode === 'live' || (!this.lastConfirmedCursor && frame.mode !== 'replay')) {
              if (frame.cursor) {
                this.lastConfirmedCursor = frame.cursor
              }
            }
          } else if (frame.kind === 'event' || ('sequence' in frame && 'type' in frame)) {
            if ('sequence' in frame && typeof frame.sequence === 'string') {
              this.lastConfirmedCursor = frame.sequence
            }
            if ('type' in frame && frame.type === 'review.handed_off') {
              this.handler.onFrame(text)
              resolve(0)
              socket.close()
              return
            }
          }
          return
        }

        // Stream mode: emit every frame
        this.handler.onFrame(text)

        if (frame.kind === 'ready') {
          // Ready cursor not skipping replay:
          // In live mode (or when no cursor has been confirmed and mode is not replay),
          // ready frame cursor indicates starting watermark.
          // In replay mode, ready cursor must NOT advance lastConfirmedCursor past unreceived replay events!
          if (frame.mode === 'live' || (!this.lastConfirmedCursor && frame.mode !== 'replay')) {
            if (frame.cursor) {
              this.lastConfirmedCursor = frame.cursor
            }
          }
        } else if (frame.kind === 'event' || ('sequence' in frame && 'type' in frame)) {
          if ('sequence' in frame && typeof frame.sequence === 'string') {
            this.lastConfirmedCursor = frame.sequence
          }
        } else if (frame.kind === 'checkpoint' && frame.cursor) {
          this.lastConfirmedCursor = frame.cursor
        }
      } catch (err) {
        // A malformed frame or failed output must not be treated as delivered.
        reject(err as Error)
        socket.close()
      }
    })

    socket.onClose((code, reason) => {
      if (code === 1000 && reason === 'taco.closed') {
        // Taco closed cleanly
        resolve(0)
        return
      }
      if (code === 1012) {
        // Graceful instance rotation: reconnect immediately with lastConfirmedCursor
        resolve(undefined)
        return
      }
      // Unexpected disconnect -> trigger reconnect loop
      reject(new Error(`Closed with code ${code} (${reason})`))
    })

    socket.onError((err) => {
      const errObj = err as Error & { statusCode?: number; code?: string }
      if (errObj.code === 'CURSOR_EXPIRED' || errObj.statusCode === 410) {
        this.handler.onError({
          code: 'CURSOR_EXPIRED',
          message: errObj.message || 'Cursor has expired and cannot be replayed',
        })
        resolve(6)
        socket.close()
        return
      }
      reject(err)
    })

    socket
      .connect(wsUrl, headers)
      .then(() => {
        // Send subscribe frame within 10s
        socket.send(
          JSON.stringify({
            type: 'subscribe',
            protocol: 'taco-host/1',
            after: this.lastConfirmedCursor,
          }),
        )
      })
      .catch((err) => {
        const errObj = err as Error & { statusCode?: number; code?: string }
        if (errObj.code === 'CURSOR_EXPIRED' || errObj.statusCode === 410) {
          this.handler.onError({
            code: 'CURSOR_EXPIRED',
            message: errObj.message || 'Cursor has expired and cannot be replayed',
          })
          resolve(6)
          return
        }
        if (errObj.code === 'NOT_FOUND' || errObj.statusCode === 404) {
          this.handler.onError({
            code: 'NOT_FOUND',
            message: errObj.message || 'Taco not found',
          })
          resolve(2)
          return
        }
        if (errObj.code === 'VALIDATION_ERROR' || errObj.statusCode === 400) {
          this.handler.onError({
            code: 'VALIDATION_ERROR',
            message: errObj.message || 'Validation error',
          })
          resolve(2)
          return
        }
        reject(err)
      })
    return promise
  }

  stop() {
    this.running = false
  }
}
