import type { CheckpointsState, DocumentStatus } from './checkpoints.ts'

export const FORMAT = 'taco/files'
export const FORMAT_VERSION = 1

export const MAX_BLOCK_HTML = 512 * 1024
export const MAX_SYNC_FILES = 2_000
export const MAX_SNAPSHOT_FILES = 2_000
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024
export const MAX_CONTROL_REQUEST_BYTES = 64 * 1024
export const MAX_COMMENT_BYTES = 16 * 1024

export const SUPPORTED_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
  'taskList',
  'horizontalRule',
  'image',
  'table',
  'documentProperties',
  'centeredBlock',
])

export interface PositionRange {
  start: number
  end: number
}

export interface QuoteContext {
  exact: string
  prefix: string
  suffix: string
}

export interface BlockAnchor {
  id: string
  type: 'codeBlock'
  language: string
  nodeId?: string
  nodeLabel?: string
  lineNumber?: number
  lineText?: string
}

export interface TextAnchor {
  path: string
  position: PositionRange
  quote: QuoteContext
  block?: BlockAnchor
}

export interface RenderedBlock {
  id: string
  type: string
  html: string
}

export interface SnapshotFile {
  id?: string
  title?: string
  path: string
  mediaType: string
  content: string
  sourceHash?: string
  blocks?: RenderedBlock[]
}

export interface NavigationGroup {
  id: string
  title: string
  paths: string[]
}

export interface NavigationConfig {
  version: 1
  entry?: string
  groups: NavigationGroup[]
}

export interface DocumentSnapshot {
  format: 'taco/files'
  version: 1
  docId: string
  title: string
  root: string
  files: SnapshotFile[]
  navigation?: NavigationConfig
  checkpoints?: CheckpointsState
}

export interface ImportedCommentMessage {
  id: string
  author: string
  authorId?: string
  body: string
  createdAt: string
  updatedAt?: string
  deletedAt?: string
}

export interface ImportedCommentThread {
  id: string
  anchor: TextAnchor | null
  status: 'open' | 'resolved'
  createdAt: string
  updatedAt: string
  messages: ImportedCommentMessage[]
}

export interface StagedUploadContent {
  protocol: 'taco-host/1'
  snapshot: DocumentSnapshot
  importedComments?: ImportedCommentThread[]
}

type ChangedDocumentStatus = DocumentStatus | null

export interface FilePatch {
  id?: string
  path: string
  previousPath?: string
  changeType: 'added' | 'modified' | 'deleted' | 'renamed'
  mediaType?: string
  content?: string | null
  uploadId?: string
}

export interface AutoSavePatch {
  protocol: 'taco-state/1'
  expectedStateVersion: string
  author: string
  fileChanges: FilePatch[]
  checkpoints?: CheckpointsState | null
}

export interface ChangedFile {
  id?: string
  path: string
  previousPath?: string
  changeType: 'added' | 'modified' | 'deleted' | 'renamed'
  mediaType: string
  content: string | null
  diff: string | null
}

export interface CheckpointChange {
  path: string
  from: ChangedDocumentStatus
  to: ChangedDocumentStatus
}

export interface CheckpointDefinitionDelta {
  from: CheckpointsState | null
  to: CheckpointsState | null
}

export interface CommentMessage {
  id: string
  author: string
  body: string | null
  createdAt: string
  deletedAt: string | null
}

export interface CommentAction {
  sequence: string
  type: 'create' | 'reply' | 'resolve' | 'reopen' | 'delete'
  author: string
  occurredAt: string
  messageId?: string
}

export interface CommentThread {
  id: string
  status: 'open' | 'resolved'
  anchor: TextAnchor | null
  isAnchorStale: boolean
  createdAt: string
  updatedAt: string
  messages: CommentMessage[]
  actions: CommentAction[]
}

export interface HandoffPayload {
  root: string
  changedFiles: ChangedFile[]
  incrementalFiles: ChangedFile[]
  checkpointChanges: CheckpointChange[]
  incrementalCheckpointChanges: CheckpointChange[]
  checkpoints: CheckpointsState | null
  checkpointDefinitionDelta: CheckpointDefinitionDelta
  incrementalCheckpointDefinitionDelta: CheckpointDefinitionDelta
  comments: CommentThread[]
  commentsThroughSequence: string
}

export interface HandoffRecord {
  id: string
  tacoId: string
  author: string
  createdAt: string
  payload: HandoffPayload
}

export interface HandoffEvent {
  kind: 'event'
  id: string
  sequence: string
  tacoId: string
  type: 'review.handed_off'
  occurredAt: string
  actor: string
  data: {
    handoffId: string
  }
}

export interface HandoffCommit {
  changed: boolean
  handoffId: string | null
  event: HandoffEvent | null
}
