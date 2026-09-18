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
