import { MAX_BLOCK_HTML, SUPPORTED_BLOCK_TYPES } from './security.ts'

export const FORMAT = 'taco/files'
export const FORMAT_VERSION = 1

export interface TacoFile {
  id?: string
  title?: string
  path: string
  mediaType: string
  content: string
  sourceHash?: string
  blocks?: TacoBlock[]
  [extra: string]: unknown
}

export interface TacoBlock {
  id: string
  type: string
  html: string
  [extra: string]: unknown
}

export interface TacoTextAnchor {
  path: string
  position: {
    start: number
    end: number
  }
  quote: {
    exact: string
    prefix: string
    suffix: string
  }
  block?: {
    id: string
    type: 'codeBlock'
    language: string
  }
}

export interface TacoCommentMessage {
  id: string
  author: string
  authorId?: string
  body: string
  createdAt: string
}

export interface TacoCommentThread {
  id: string
  anchor: TacoTextAnchor
  status: 'open' | 'resolved'
  messages: TacoCommentMessage[]
  createdAt: string
  updatedAt: string
}

export interface TacoCollabInvite {
  pub: string
  priv: string
  role: 'writer' | 'commenter'
  exp?: number
  sig: string
}

export interface TacoCollab {
  room?: string
  key?: string
  on?: boolean
  v?: number
  owner?: string
  ownerPriv?: string
  invite?: TacoCollabInvite
  role?: 'writer' | 'reader'
  sync?: unknown
}

export interface TacoBundle {
  format: typeof FORMAT
  version: number
  docId: string
  title: string
  root: string
  files: TacoFile[]
  comments?: TacoCommentThread[]
  access?: 'reader'
  collab?: TacoCollab
  [extra: string]: unknown
}

export type ParseResult =
  | { ok: true; bundle: TacoBundle; frozen?: 'version' }
  | { ok: false; err: 'empty' }
  | { ok: false; err: 'json' | 'format' | 'shape'; detail: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const isSafePath = (path: string): boolean => {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false
  const parts = path.split('/')
  return parts.every((part) => part !== '' && part !== '.' && part !== '..')
}

export function parseBundle(json: string): ParseResult {
  if (!json.trim()) return { ok: false, err: 'empty' }
  let raw: unknown
  try { raw = JSON.parse(json) }
  catch (error) { return { ok: false, err: 'json', detail: (error as Error).message } }

  if (!isRecord(raw)) return { ok: false, err: 'shape', detail: 'bundle must be an object' }
  if (raw.format !== FORMAT) {
    return { ok: false, err: 'format', detail: `expected ${FORMAT}, found ${String(raw.format ?? 'nothing')}` }
  }
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    return { ok: false, err: 'shape', detail: 'version must be a positive integer' }
  }
  if (typeof raw.docId !== 'string' || !raw.docId) return { ok: false, err: 'shape', detail: 'docId is required' }
  if (typeof raw.title !== 'string' || !raw.title) return { ok: false, err: 'shape', detail: 'title is required' }
  if (typeof raw.root !== 'string' || !isSafePath(raw.root)) return { ok: false, err: 'shape', detail: 'root is not a safe relative path' }
  if (!Array.isArray(raw.files)) return { ok: false, err: 'shape', detail: 'files must be an array' }

  const seen = new Set<string>()
  for (const value of raw.files) {
    if (!isRecord(value)
      || typeof value.path !== 'string'
      || typeof value.mediaType !== 'string'
      || typeof value.content !== 'string') {
      return { ok: false, err: 'shape', detail: 'every file requires path, mediaType and content strings' }
    }
    if (!isSafePath(value.path) || !value.path.startsWith(`${raw.root}/`)) {
      return { ok: false, err: 'shape', detail: `file escapes bundle root: ${value.path}` }
    }
    if (seen.has(value.path)) return { ok: false, err: 'shape', detail: `duplicate file path: ${value.path}` }
    seen.add(value.path)
    if (value.id !== undefined && (typeof value.id !== 'string' || !value.id)) {
      return { ok: false, err: 'shape', detail: `file id is invalid: ${value.path}` }
    }
    if (value.title !== undefined && (typeof value.title !== 'string' || !value.title.trim())) {
      return { ok: false, err: 'shape', detail: `file title is invalid: ${value.path}` }
    }
    if (value.sourceHash !== undefined && (typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash))) {
      return { ok: false, err: 'shape', detail: `file sourceHash is invalid: ${value.path}` }
    }
    if (value.blocks !== undefined && (!Array.isArray(value.blocks) || !value.blocks.every(isBlock))) {
      return { ok: false, err: 'shape', detail: `file blocks are invalid: ${value.path}` }
    }
  }

  if (raw.comments !== undefined) {
    if (!Array.isArray(raw.comments) || !raw.comments.every(isCommentThread)) {
      return { ok: false, err: 'shape', detail: 'comments must contain valid local comment threads' }
    }
    for (const thread of raw.comments) {
      if (!seen.has(thread.anchor.path)) {
        return { ok: false, err: 'shape', detail: `comment references a missing file: ${thread.anchor.path}` }
      }
    }
  }

  if (raw.access !== undefined && raw.access !== 'reader') {
    return { ok: false, err: 'shape', detail: 'access must be reader when present' }
  }
  if (raw.collab !== undefined && !isCollab(raw.collab)) {
    return { ok: false, err: 'shape', detail: 'collab contains invalid sharing credentials' }
  }

  const bundle = raw as unknown as TacoBundle
  return { ok: true, bundle, ...(bundle.version > FORMAT_VERSION ? { frozen: 'version' as const } : {}) }
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

const isCollabInvite = (value: unknown): value is TacoCollabInvite => isRecord(value)
  && isNonEmptyString(value.pub)
  && isNonEmptyString(value.priv)
  && (value.role === 'writer' || value.role === 'commenter')
  && (value.exp === undefined || (typeof value.exp === 'number' && Number.isFinite(value.exp) && value.exp >= 0))
  && isNonEmptyString(value.sig)

const isCollab = (value: unknown): value is TacoCollab => {
  if (!isRecord(value)) return false
  if (value.room !== undefined && (!isNonEmptyString(value.room) || !/^wss?:\/\//.test(value.room))) return false
  if (value.key !== undefined && !isNonEmptyString(value.key)) return false
  if (value.on !== undefined && typeof value.on !== 'boolean') return false
  if (value.v !== undefined && (!Number.isInteger(value.v) || Number(value.v) < 1)) return false
  if (value.owner !== undefined && !isNonEmptyString(value.owner)) return false
  if (value.ownerPriv !== undefined && !isNonEmptyString(value.ownerPriv)) return false
  if (value.invite !== undefined && !isCollabInvite(value.invite)) return false
  if (value.role !== undefined && value.role !== 'writer' && value.role !== 'reader') return false
  return true
}

export const bundleCanWrite = (bundle: TacoBundle): boolean =>
  bundle.access !== 'reader' && bundle.collab?.role !== 'reader'

const isBlock = (value: unknown): value is TacoBlock => isRecord(value)
  && typeof value.id === 'string'
  && value.id.length > 0
  && typeof value.type === 'string'
  && SUPPORTED_BLOCK_TYPES.has(value.type)
  && typeof value.html === 'string'
  && value.html.length <= MAX_BLOCK_HTML

const stablePathId = (path: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `file-${hash.toString(36)}`
}

export const ensureFileIds = (bundle: TacoBundle): void => {
  const used = new Set<string>()
  for (const file of bundle.files) {
    let id = file.id || stablePathId(file.path)
    let suffix = 1
    while (used.has(id)) id = `${stablePathId(file.path)}-${suffix++}`
    file.id = id
    used.add(id)
  }
}

const isCommentThread = (value: unknown): value is TacoCommentThread => {
  if (!isRecord(value) || !isRecord(value.anchor) || !isRecord(value.anchor.position) || !isRecord(value.anchor.quote)) return false
  const { anchor } = value
  const position = anchor.position as Record<string, unknown>
  const quote = anchor.quote as Record<string, unknown>
  const validPosition = Number.isInteger(position.start)
    && Number.isInteger(position.end)
    && Number(position.start) >= 0
    && Number(position.end) > Number(position.start)
  const validQuote = typeof quote.exact === 'string'
    && quote.exact.length > 0
    && typeof quote.prefix === 'string'
    && typeof quote.suffix === 'string'
  const block = anchor.block
  const validBlock = block === undefined || (isRecord(block)
    && typeof block.id === 'string'
    && block.id.length > 0
    && block.type === 'codeBlock'
    && typeof block.language === 'string')
  return typeof value.id === 'string'
    && value.id.length > 0
    && typeof anchor.path === 'string'
    && validPosition
    && validQuote
    && validBlock
    && (value.status === 'open' || value.status === 'resolved')
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && Array.isArray(value.messages)
    && value.messages.length > 0
    && value.messages.every((message) => isRecord(message)
      && typeof message.id === 'string'
      && typeof message.author === 'string'
      && typeof message.body === 'string'
      && message.body.trim().length > 0
      && typeof message.createdAt === 'string')
}

export const fileByPath = (bundle: TacoBundle, path: string): TacoFile | null =>
  bundle.files.find((file) => file.path === path) ?? null

export const relativePath = (bundle: TacoBundle, file: TacoFile): string =>
  file.path.slice(bundle.root.length + 1)

export const fileName = (path: string): string => path.split('/').at(-1) ?? path

export type FileKind = 'markdown' | 'html' | 'yaml' | 'json' | 'text'

export function fileKind(file: TacoFile): FileKind {
  const lower = file.path.toLowerCase()
  if (file.mediaType === 'text/markdown' || lower.endsWith('.md')) return 'markdown'
  if (file.mediaType === 'text/html' || lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (file.mediaType.includes('yaml') || /\.ya?ml$/.test(lower)) return 'yaml'
  if (file.mediaType.includes('json') || lower.endsWith('.json')) return 'json'
  return 'text'
}

export function defaultFile(bundle: TacoBundle): TacoFile | null {
  return fileByPath(bundle, `${bundle.root}/README.md`)
    ?? fileByPath(bundle, `${bundle.root}/spec.md`)
    ?? bundle.files.find((file) => fileKind(file) === 'markdown')
    ?? bundle.files[0]
    ?? null
}
