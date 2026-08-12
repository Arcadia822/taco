import { isSafePath } from '../model.ts'
import {
  assertBoundedJson,
  assertOptionalBoundedJson,
  MAX_SYNC_FILES,
  MAX_SYNC_NODES,
  sanitizeEditorHtml,
  SUPPORTED_BLOCK_TYPES,
} from '../security.ts'
import type { TacoBundle } from '../model.ts'
import type { SyncNode, TacoSyncDoc } from '../store.ts'
import { SYNC_V, type Op, type SyncStateJSON } from './crdt.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const string = (value: unknown, max = 16_384): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
const boundedString = (value: unknown, max = 16_384): value is string => typeof value === 'string' && value.length <= max
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const timestamp = (value: unknown): value is string => string(value, 128) && !Number.isNaN(Date.parse(value))
const reg = (value: unknown): value is [number, string] => Array.isArray(value) && value.length === 2 && integer(value[0]) && boundedString(value[1], 256)
const ord = (value: unknown): value is string => string(value, 512) && /^[0-9A-Za-z]+$/.test(value)

const DOC_SET_KEYS = new Set(['title'])
const FILE_SET_KEYS = new Set(['path', 'mediaType', 'title', 'sourceHash'])
const NODE_SET_KEYS = new Set([
  'type', 'html', 'anchor', 'status', 'createdAt', 'updatedAt', 'threadId', 'author',
  'authorId', 'body',
])

const rebuildNode = (value: unknown, path: string): SyncNode => {
  if (!isRecord(value) || !string(value.id, 256) || !string(value.kind, 64)) throw new Error('security:invalid-sync-node')
  if (value.kind === 'block') {
    if (!string(value.type, 64) || !SUPPORTED_BLOCK_TYPES.has(value.type) || typeof value.html !== 'string') {
      throw new Error('security:invalid-block-node')
    }
    return { id: value.id, kind: 'block', type: value.type, html: sanitizeEditorHtml(value.html) }
  }
  if (value.kind === 'comment-thread') {
    const anchor = value.anchor
    if (!isRecord(anchor) || anchor.path !== path || !isRecord(anchor.position) || !isRecord(anchor.quote)
      || !integer(anchor.position.start) || !integer(anchor.position.end) || Number(anchor.position.end) <= Number(anchor.position.start)
      || !string(anchor.quote.exact, 100_000) || !boundedString(anchor.quote.prefix, 10_000) || !boundedString(anchor.quote.suffix, 10_000)
      || (value.status !== 'open' && value.status !== 'resolved') || !timestamp(value.createdAt) || !timestamp(value.updatedAt)) {
      throw new Error('security:invalid-comment-thread')
    }
    const block = anchor.block
    if (block !== undefined && (!isRecord(block) || !string(block.id, 256)
      || block.type !== 'codeBlock' || !boundedString(block.language, 256))) {
      throw new Error('security:invalid-comment-thread')
    }
    return {
      id: value.id,
      kind: 'comment-thread',
      anchor: {
        path,
        position: { start: Number(anchor.position.start), end: Number(anchor.position.end) },
        quote: { exact: anchor.quote.exact, prefix: anchor.quote.prefix, suffix: anchor.quote.suffix },
        ...(block ? { block: { id: String(block.id), type: 'codeBlock', language: String(block.language) } } : {}),
      },
      status: value.status,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    }
  }
  if (value.kind === 'comment-message') {
    if (!string(value.threadId, 256) || !string(value.author, 512) || !string(value.body, 100_000) || !timestamp(value.createdAt)) {
      throw new Error('security:invalid-comment-message')
    }
    return {
      id: value.id,
      kind: 'comment-message',
      threadId: value.threadId,
      author: value.author,
      ...(string(value.authorId, 256) ? { authorId: value.authorId } : {}),
      body: value.body,
      createdAt: value.createdAt,
    }
  }
  throw new Error('security:unknown-sync-node')
}

export const rebuildSyncDoc = (
  value: unknown,
  expected: Pick<TacoBundle, 'docId' | 'root' | 'access'>,
): TacoSyncDoc => {
  assertBoundedJson(value, 'snapshot')
  if (!isRecord(value) || value.format !== 'taco/files' || value.version !== 1
    || value.docId !== expected.docId || value.root !== expected.root || !string(value.title, 4096)
    || !Array.isArray(value.files) || value.files.length > MAX_SYNC_FILES) {
    throw new Error('security:invalid-sync-document')
  }
  const fileIds = new Set<string>()
  const paths = new Set<string>()
  let nodeCount = 0
  const files = value.files.map((candidate) => {
    if (!isRecord(candidate) || !string(candidate.id, 256) || !string(candidate.path, 4096)
      || !isSafePath(candidate.path) || !candidate.path.startsWith(`${expected.root}/`)
      || !string(candidate.mediaType, 256) || !Array.isArray(candidate.nodes)) {
      throw new Error('security:invalid-sync-file')
    }
    if (fileIds.has(candidate.id) || paths.has(candidate.path)) throw new Error('security:duplicate-sync-file')
    fileIds.add(candidate.id)
    paths.add(candidate.path)
    const path = candidate.path
    nodeCount += candidate.nodes.length
    if (nodeCount > MAX_SYNC_NODES) throw new Error('security:too-many-sync-nodes')
    const nodeIds = new Set<string>()
    const nodes = candidate.nodes.map((node) => {
      const rebuilt = rebuildNode(node, path)
      if (nodeIds.has(rebuilt.id)) throw new Error('security:duplicate-sync-node')
      nodeIds.add(rebuilt.id)
      return rebuilt
    })
    const threadIds = new Set(nodes.filter((node) => node.kind === 'comment-thread').map((node) => node.id))
    if (nodes.some((node) => node.kind === 'comment-message' && !threadIds.has(node.threadId))) {
      throw new Error('security:orphan-comment-message')
    }
    return {
      id: candidate.id,
      path,
      mediaType: candidate.mediaType,
      ...(string(candidate.title, 4096) ? { title: candidate.title } : {}),
      ...(typeof candidate.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(candidate.sourceHash) ? { sourceHash: candidate.sourceHash } : {}),
      nodes,
    }
  })
  return {
    format: 'taco/files',
    version: Number(value.version),
    docId: expected.docId,
    title: value.title,
    root: expected.root,
    ...(expected.access === 'reader' ? { access: 'reader' } : {}),
    files,
  }
}

const validBase = (op: Record<string, unknown>): boolean => string(op.a, 256) && integer(op.s) && integer(op.l)
const validId = (value: unknown): value is string => string(value, 512)
const validKind = (value: unknown): value is 'slide' | 'element' => value === 'slide' || value === 'element'
const validElementIdentity = (id: unknown, parent: unknown): id is string =>
  validId(id) && validId(parent) && id.startsWith(`${parent}\u001f`) && id.length > String(parent).length + 1

const validateInsertedNode = (candidate: Record<string, unknown>, expected?: Pick<TacoBundle, 'root'>): void => {
  if (candidate.kind === 'slide') {
    const node = candidate.node
    if (!isRecord(node) || node.id !== candidate.id || !string(node.path, 4096) || !isSafePath(node.path)
      || (expected && !node.path.startsWith(`${expected.root}/`)) || !string(node.mediaType, 256)
      || !Array.isArray(node.nodes) || node.nodes.length > MAX_SYNC_NODES) {
      throw new Error('security:invalid-ins-node')
    }
    const ids = new Set<string>()
    for (const child of node.nodes) {
      const rebuilt = rebuildNode(child, node.path)
      if (ids.has(rebuilt.id)) throw new Error('security:duplicate-sync-node')
      ids.add(rebuilt.id)
    }
    return
  }
  const node = candidate.node
  if (!isRecord(node) || node.id !== String(candidate.id).split('\u001f').at(-1)) throw new Error('security:invalid-ins-node')
  const path = isRecord(node.anchor) && typeof node.anchor.path === 'string' ? node.anchor.path : ''
  rebuildNode(node, path)
}

export const validateOps = (value: unknown, expected?: Pick<TacoBundle, 'root'>): Op[] => {
  assertBoundedJson(value, 'ops')
  if (!Array.isArray(value) || value.length > 10_000) throw new Error('security:invalid-ops')
  for (const candidate of value) {
    if (!isRecord(candidate) || !validBase(candidate) || !string(candidate.op, 16)) throw new Error('security:invalid-op')
    if (candidate.op === 'set') {
      if (!string(candidate.k, 256)) throw new Error('security:invalid-set-op')
      const allowed = candidate.el !== undefined
        ? validElementIdentity(candidate.el, candidate.sl) && NODE_SET_KEYS.has(candidate.k)
        : candidate.sl !== undefined
          ? validId(candidate.sl) && FILE_SET_KEYS.has(candidate.k)
          : DOC_SET_KEYS.has(candidate.k)
      if (!allowed) throw new Error('security:invalid-set-op')
      assertOptionalBoundedJson(candidate.v, 'op-value')
    } else if (candidate.op === 'ins') {
      if (!validKind(candidate.kind) || !validId(candidate.id) || !ord(candidate.ord) || !isRecord(candidate.node)
        || (candidate.kind === 'element' && !validElementIdentity(candidate.id, candidate.sl))
        || (candidate.kind === 'slide' && candidate.sl !== undefined)) throw new Error('security:invalid-ins-op')
      validateInsertedNode(candidate, expected)
    } else if (candidate.op === 'del') {
      if (!validKind(candidate.kind) || !validId(candidate.id)
        || (candidate.kind === 'element' && !candidate.id.includes('\u001f'))
        || (candidate.cas !== undefined && (!Array.isArray(candidate.cas) || candidate.cas.length > MAX_SYNC_NODES || !candidate.cas.every(validId)))) throw new Error('security:invalid-del-op')
    } else if (candidate.op === 'ord') {
      if (!validKind(candidate.kind) || !validId(candidate.id) || !ord(candidate.ord)
        || (candidate.kind === 'element' && !validElementIdentity(candidate.id, candidate.sl))) throw new Error('security:invalid-ord-op')
    } else if (candidate.op === 'txt') {
      if (!validId(candidate.el) || !Array.isArray(candidate.sd) || candidate.sd.length !== 2
        || !integer(candidate.sd[0]) || !string(candidate.sd[1], 256)
        || (candidate.base !== undefined && !boundedString(candidate.base, 512 * 1024))
        || (candidate.del !== undefined && (!Array.isArray(candidate.del) || !candidate.del.every(validId)))
        || (candidate.ins !== undefined && (!Array.isArray(candidate.ins) || !candidate.ins.every((entry) => isRecord(entry)
          && validId(entry.at) && Array.isArray(entry.toks) && entry.toks.every((token) => typeof token === 'string' && token.length <= 16_384))))) {
        throw new Error('security:invalid-txt-op')
      }
    } else throw new Error('security:unknown-op')
  }
  return structuredClone(value) as Op[]
}

const recordValues = (value: unknown, predicate: (entry: unknown) => boolean): boolean =>
  isRecord(value) && Object.values(value).every(predicate)

const validPosition = (value: unknown): boolean => isRecord(value)
  && validId(value.p) && ord(value.o) && reg(value.r)

const validStash = (value: unknown): boolean => isRecord(value) && Object.values(value).every((entries) =>
  isRecord(entries) && Object.entries(entries).every(([key, entry]) => NODE_SET_KEYS.has(key)
    && isRecord(entry) && reg(entry.r) && (entry.v === undefined || (() => {
      try { assertOptionalBoundedJson(entry.v, 'stash-value'); return true } catch { return false }
    })())))

const validTextState = (value: unknown): boolean => isRecord(value) && reg(value.sd)
  && Array.isArray(value.toks) && value.toks.length <= MAX_SYNC_NODES
  && value.toks.every((token) => isRecord(token) && validId(token.id)
    && boundedString(token.t, 16_384) && (token.d === undefined || token.d === 1))
  && (value.pd === undefined || (Array.isArray(value.pd) && value.pd.length <= MAX_SYNC_NODES && value.pd.every(validId)))

const validLimboNode = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  const path = isRecord(value.anchor) && typeof value.anchor.path === 'string' ? value.anchor.path : ''
  try { rebuildNode(value, path); return true } catch { return false }
}

export const validateSyncState = (value: unknown): SyncStateJSON => {
  assertBoundedJson(value, 'sync-state')
  if (!isRecord(value) || value.v !== SYNC_V || !integer(value.lamport)
    || !recordValues(value.vv, integer) || !recordValues(value.regs, reg)
    || !recordValues(value.births, reg) || !recordValues(value.tombs, reg)
    || !recordValues(value.pos, validPosition) || !validStash(value.stash)
    || !recordValues(value.limbo, validLimboNode)
    || (value.txt !== undefined && !recordValues(value.txt, validTextState))) {
    throw new Error('security:invalid-sync-state')
  }
  return structuredClone(value) as unknown as SyncStateJSON
}

export interface ValidatedPresence {
  name: string
  color: string
  fileId: string
  from: number
  to: number
  focused: boolean
  hasCursor: boolean
  pub?: string
  role?: 'owner' | 'editor' | 'viewer'
}

export const validatePresence = (value: unknown): ValidatedPresence => {
  if (!isRecord(value) || !boundedString(value.name, 512) || !/^#[0-9a-f]{6}$/i.test(String(value.color))
    || !boundedString(value.fileId, 256) || !integer(value.from) || !integer(value.to)
    || typeof value.focused !== 'boolean' || typeof value.hasCursor !== 'boolean'
    || (value.pub !== undefined && !string(value.pub, 1024))
    || (value.role !== undefined && !['owner', 'editor', 'viewer'].includes(String(value.role)))) {
    throw new Error('security:invalid-presence')
  }
  return {
    name: value.name,
    color: value.color as string,
    fileId: value.fileId,
    from: value.from as number,
    to: value.to as number,
    focused: value.focused,
    hasCursor: value.hasCursor,
    ...(value.pub ? { pub: value.pub as string } : {}),
    ...(value.role ? { role: value.role as ValidatedPresence['role'] } : {}),
  }
}

export const validateVersionVector = (value: unknown): Record<string, number> => {
  if (!isRecord(value) || Object.keys(value).length > 10_000
    || Object.entries(value).some(([actor, sequence]) => !string(actor, 256) || !integer(sequence))) {
    throw new Error('security:invalid-version-vector')
  }
  return structuredClone(value) as Record<string, number>
}
