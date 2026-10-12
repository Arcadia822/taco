import type { CheckpointsState } from './checkpoints.ts'
import type { NavigationConfig } from './types.ts'

export interface TacoDocumentFile {
  id?: string
  title?: string
  path: string
  mediaType: string
  content: string
  sourceHash?: string
  [key: string]: unknown
}

export interface TacoDocument {
  format: string
  version: number
  docId: string
  title: string
  root: string
  files: TacoDocumentFile[]
  comments?: unknown[]
  checkpoints?: CheckpointsState | unknown
  navigation?: NavigationConfig | unknown
  [key: string]: unknown
}

export interface LocalHandoff {
  schema: 'taco-local-handoff/1'
  handoffId: string
  sessionId: string
  docId: string
  createdAt: string
  baseline: TacoDocument
  snapshot: TacoDocument
}

export interface LocalReceipt {
  schema: 'taco-local-receipt/1'
  docId: string
  sessionId: string
  handoffId: string
  receivedAt: string
  path: string
  payload: LocalHandoff
}

export interface LocalHandoffAck {
  ok: boolean
  handoffId: string
  receiptId?: string
  error?: string
}
