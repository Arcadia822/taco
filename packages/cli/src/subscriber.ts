export interface SubscribeFrameHandler {
  onFrame(frame: string): void
  onDiagnostic(diag: { code: string; message: string; attempt?: number }): void
  onError(err: { code: string; message: string }): void
}

export interface WebSocketSessionAdapter {
  connect(url: string): Promise<void>
  send(data: string): void
  close(): void
  onMessage(cb: (msg: string) => void): void
  onClose(cb: (code: number, reason: string) => void): void
  onError(cb: (err: Error) => void): void
}

/**
 * Client-side subscriber managing NDJSON stream output, exponential backoff reconnect,
 * and automatic transparent reconnection on 1012 (Service Restart / Rotation) with latest confirmed cursor.
 */
export class TacoSubscriber {
  private lastConfirmedCursor: string | null = null
  private running = true

  constructor(
    private readonly hostUrl: string,
    private readonly tacoId: string,
    private readonly handler: SubscribeFrameHandler,
    private readonly adapterFactory: () => WebSocketSessionAdapter,
    private readonly options?: { initialAfter?: string | null; maxReconnectTimeMs?: number },
  ) {
    this.lastConfirmedCursor = options?.initialAfter ?? null
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
        await new Promise((r) => setTimeout(r, delay))
      }
    }

    return { exitCode: 0 }
  }

  private runOneConnection(): Promise<number | undefined> {
    const { promise, resolve, reject } = Promise.withResolvers<number | undefined>()
    const wsUrl = this.hostUrl.replace(/^http/, 'ws') + `/v1/tacos/${this.tacoId}/subscribe`
    const socket = this.adapterFactory()

    socket.onMessage((text) => {
      try {
        const frame = JSON.parse(text) as {
          kind: string
          cursor?: string
          sequence?: string
          error?: { code: string }
        }
        if (frame.kind === 'ready' && frame.cursor) {
          this.lastConfirmedCursor = frame.cursor
        } else if (frame.kind === 'event' && frame.sequence) {
          this.lastConfirmedCursor = frame.sequence
        } else if (frame.kind === 'checkpoint' && frame.cursor) {
          this.lastConfirmedCursor = frame.cursor
        } else if (frame.kind === 'error') {
          if (frame.error?.code === 'CURSOR_EXPIRED') {
            socket.close()
            resolve(6)
            return
          }
          if (frame.error?.code === 'TACO_CLOSED') {
            socket.close()
            resolve(4)
            return
          }
        }
        this.handler.onFrame(text)
      } catch {
        this.handler.onFrame(text)
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
      reject(err)
    })

    socket
      .connect(wsUrl)
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
      .catch(reject)

    return promise
  }

  stop() {
    this.running = false
  }
}
