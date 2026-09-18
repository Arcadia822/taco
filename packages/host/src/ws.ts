import type { MemoryDatabaseDriver } from './storage.ts'

export interface MockWebSocketClient {
  send(data: string): void
  close(code?: number, reason?: string): void
  onMessage?: (data: string) => void
  onClose?: (code: number, reason: string) => void
}

/**
 * Server-side subscription session managing high-water mark capture,
 * replay backfill, ~1s durable polling, and graceful 240s rotation (1012).
 */
export class HostSubscriptionSession {
  private active = true
  private pollTimer: NodeJS.Timeout | null = null
  private rotationTimer: NodeJS.Timeout | null = null
  private lastCursor = 0

  constructor(
    private readonly db: MemoryDatabaseDriver,
    private readonly tacoId: string,
    private readonly ws: MockWebSocketClient,
    private readonly options?: { pollIntervalMs?: number; rotationDurationMs?: number },
  ) {}

  start(initialAfter: string | null) {
    const taco = this.db.tacos.get(this.tacoId)
    if (!taco || taco.status === 'deleted' || taco.status === 'expired') {
      this.ws.send(
        JSON.stringify({
          kind: 'error',
          error: {
            code: 'NOT_FOUND',
            message: 'Taco not found',
            retryable: false,
            requestId: 'ws_err',
          },
        }),
      )
      this.ws.close(1008, 'Policy Violation')
      return
    }

    const currentH = taco.lastSequence

    // 1. Initial ready frame
    if (initialAfter === null) {
      // Live mode
      this.lastCursor = currentH
      this.ws.send(
        JSON.stringify({
          kind: 'ready',
          protocol: 'taco-host/1',
          tacoId: this.tacoId,
          cursor: String(currentH),
          mode: 'live',
        }),
      )
    } else {
      // Replay mode
      const afterSeq = Number.parseInt(initialAfter, 10)
      if (afterSeq > currentH) {
        this.ws.send(
          JSON.stringify({
            kind: 'error',
            error: {
              code: 'BAD_REQUEST',
              message: 'after sequence exceeds high-water mark',
              retryable: false,
            },
          }),
        )
        this.ws.close(1008, 'Invalid cursor')
        return
      }

      this.lastCursor = afterSeq
      this.ws.send(
        JSON.stringify({
          kind: 'ready',
          protocol: 'taco-host/1',
          tacoId: this.tacoId,
          cursor: String(afterSeq),
          mode: 'replay',
          replayThrough: String(currentH),
        }),
      )

      // Replay events (after, currentH]
      const backfill = this.db.events
        .filter((e) => e.tacoId === this.tacoId && e.sequence > afterSeq && e.sequence <= currentH)
        .sort((a, b) => a.sequence - b.sequence)

      for (const ev of backfill) {
        this.ws.send(
          JSON.stringify({
            kind: 'event',
            id: ev.id,
            sequence: String(ev.sequence),
            tacoId: ev.tacoId,
            revisionId: ev.revisionId,
            type: ev.type,
            occurredAt: ev.occurredAt,
            actor: ev.actor,
            data: ev.data,
          }),
        )
        this.lastCursor = ev.sequence
      }

      // Checkpoint at H
      this.ws.send(
        JSON.stringify({
          kind: 'checkpoint',
          tacoId: this.tacoId,
          cursor: String(currentH),
        }),
      )
      this.lastCursor = currentH
    }

    // Check if Taco was closed
    if (taco.status === 'closed') {
      this.ws.close(1000, 'taco.closed')
      this.destroy()
      return
    }

    // 2. Schedule ~1s durable log tail polling
    const pollInterval = this.options?.pollIntervalMs || 1000
    this.pollTimer = setInterval(() => {
      if (!this.active) return
      this.pollNextEvents()
    }, pollInterval)

    // 3. Schedule graceful rotation at 240s (close code 1012 Service Restart)
    const rotationDuration = this.options?.rotationDurationMs || 240 * 1000
    this.rotationTimer = setTimeout(() => {
      if (!this.active) return
      this.ws.close(1012, 'Service Restart (Instance Rotation)')
      this.destroy()
    }, rotationDuration)
  }

  private pollNextEvents() {
    const taco = this.db.tacos.get(this.tacoId)
    if (!taco) return

    const newEvents = this.db.events
      .filter((e) => e.tacoId === this.tacoId && e.sequence > this.lastCursor)
      .sort((a, b) => a.sequence - b.sequence)

    for (const ev of newEvents) {
      this.ws.send(
        JSON.stringify({
          kind: 'event',
          id: ev.id,
          sequence: String(ev.sequence),
          tacoId: ev.tacoId,
          revisionId: ev.revisionId,
          type: ev.type,
          occurredAt: ev.occurredAt,
          actor: ev.actor,
          data: ev.data,
        }),
      )
      this.lastCursor = ev.sequence

      if (ev.type === 'taco.closed') {
        this.ws.send(
          JSON.stringify({
            kind: 'checkpoint',
            tacoId: this.tacoId,
            cursor: String(this.lastCursor),
          }),
        )
        this.ws.close(1000, 'taco.closed')
        this.destroy()
        return
      }
    }
  }

  destroy() {
    this.active = false
    clearInterval(this.pollTimer!)
    clearTimeout(this.rotationTimer!)
  }
}
