import { isSafePath, isSafeRootPath } from './validation.ts'

export type DocumentStatus = 'todo' | 'in_progress' | 'complete' | 'freeze'

export interface CheckpointDocumentRef {
  path: string
  optional?: boolean
}

export interface CheckpointNode {
  id: string
  title: string
  after: string[]
  documents: CheckpointDocumentRef[]
}

export interface DocumentStatusRecord {
  path: string
  status: DocumentStatus
  updatedAt: string
}

export interface CheckpointsState {
  version: 1
  template?: string
  nodes: CheckpointNode[]
  documents: DocumentStatusRecord[]
}

export interface ResolvedCheckpointDocument {
  path: string
  optional: boolean
  status: DocumentStatus
  exists: boolean
  updatedAt?: string
}

export interface ResolvedCheckpointNode {
  id: string
  title: string
  after: string[]
  documents: ResolvedCheckpointDocument[]
  aggregate: DocumentStatus
  available: boolean
  missing: string[]
}

interface ResolvedCheckpointBase {
  raw: unknown
  nodes: ResolvedCheckpointNode[]
  documents: ResolvedCheckpointDocument[]
  layout: string[][]
  frontier: string[]
  unlinked: ResolvedCheckpointDocument[]
}

export type ResolvedCheckpoints =
  | (ResolvedCheckpointBase & { valid: true; state?: CheckpointsState; error?: never })
  | (ResolvedCheckpointBase & { valid: false; error: string; state?: never })


const isStatus = (value: unknown): value is DocumentStatus =>
  value === 'todo' || value === 'in_progress' || value === 'complete' || value === 'freeze'

// The persisted timestamp is UTC RFC3339, not an arbitrary date accepted by Date.parse.
const isUtcTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value)
  if (!match) return false
  const date = new Date(value)
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3]) &&
    date.getUTCHours() === Number(match[4]) &&
    date.getUTCMinutes() === Number(match[5]) &&
    date.getUTCSeconds() === Number(match[6])
  )
}

const inRoot = (path: string, root: string): boolean =>
  isSafePath(path) && (root === '.' || path.startsWith(`${root}/`))

const fail = (path: string, err: string): { ok: false; err: string; path: string } => ({
  ok: false,
  err,
  path,
})

// Kahn's algorithm emits each ready wave together, rather than depending on input order.
const layoutNodes = (nodes: readonly CheckpointNode[]): { levels: string[][]; cycle?: string } => {
  const pending = new Map<string, number>()
  const successors = new Map<string, string[]>()
  for (const node of nodes) {
    pending.set(node.id, node.after.length)
    successors.set(node.id, [])
  }
  for (const node of nodes) {
    for (const predecessor of node.after) successors.get(predecessor)?.push(node.id)
  }
  let ready = [...pending].filter(([, count]) => count === 0).map(([id]) => id).sort()
  const levels: string[][] = []
  let visited = 0
  while (ready.length) {
    levels.push(ready)
    visited += ready.length
    const next: string[] = []
    for (const id of ready) {
      for (const successor of successors.get(id) ?? []) {
        const remaining = pending.get(successor)! - 1
        pending.set(successor, remaining)
        if (remaining === 0) next.push(successor)
      }
    }
    ready = next.sort()
  }
  return visited === nodes.length
    ? { levels }
    : { levels: [], cycle: [...pending].filter(([, count]) => count > 0).map(([id]) => id).sort()[0] }
}

export function checkpointLayout(state: CheckpointsState): string[][] {
  return layoutNodes(state.nodes).levels
}

export function validateCheckpoints(
  value: unknown,
  root: string,
): { ok: true; value: CheckpointsState } | { ok: false; err: string; path: string } {
  if (!isSafeRootPath(root)) return fail('root', 'Root must be a safe relative path')
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('checkpoints', 'Checkpoints must be an object')
  }
  const checkpoint = value as Record<string, unknown>
  if (checkpoint.version !== 1) return fail('checkpoints.version', 'Version must be 1')
  if (checkpoint.template !== undefined && typeof checkpoint.template !== 'string') {
    return fail('checkpoints.template', 'Template must be a string')
  }
  if (!Array.isArray(checkpoint.nodes)) return fail('checkpoints.nodes', 'Nodes must be an array')
  if (!Array.isArray(checkpoint.documents)) {
    return fail('checkpoints.documents', 'Status records must be an array')
  }

  const ids = new Set<string>()
  const paths = new Set<string>()
  for (let i = 0; i < checkpoint.nodes.length; i++) {
    const node = checkpoint.nodes[i]
    const at = `checkpoints.nodes[${i}]`
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      return fail(at, 'Node must be an object')
    }
    if (typeof node.id !== 'string' || !node.id.trim()) {
      return fail(`${at}.id`, 'Id must be a non-empty string')
    }
    if (ids.has(node.id)) return fail(`${at}.id`, `Duplicate checkpoint id: ${node.id}`)
    ids.add(node.id)
    if (typeof node.title !== 'string' || !node.title.trim()) {
      return fail(`${at}.title`, 'Title must be a non-empty string')
    }
    if (!Array.isArray(node.after)) return fail(`${at}.after`, 'After must be an array')
    if (!Array.isArray(node.documents)) {
      return fail(`${at}.documents`, 'Documents must be an array')
    }
    const predecessors = new Set<string>()
    for (let j = 0; j < node.after.length; j++) {
      const predecessor = node.after[j]
      if (typeof predecessor !== 'string' || !predecessor.trim()) {
        return fail(`${at}.after[${j}]`, 'Predecessor must be a non-empty id')
      }
      if (predecessors.has(predecessor)) {
        return fail(`${at}.after[${j}]`, `Duplicate predecessor: ${predecessor}`)
      }
      predecessors.add(predecessor)
    }
    for (let j = 0; j < node.documents.length; j++) {
      const document = node.documents[j]
      const atDocument = `${at}.documents[${j}]`
      if (document === null || typeof document !== 'object' || Array.isArray(document)) {
        return fail(atDocument, 'Document reference must be an object')
      }
      if (typeof document.path !== 'string' || !inRoot(document.path, root)) {
        return fail(`${atDocument}.path`, 'Path must be safe and within root')
      }
      if (paths.has(document.path)) {
        return fail(`${atDocument}.path`, `Duplicate checkpoint document path: ${document.path}`)
      }
      paths.add(document.path)
      if (document.optional !== undefined && typeof document.optional !== 'boolean') {
        return fail(`${atDocument}.optional`, 'Optional must be a boolean')
      }
    }
  }
  for (let i = 0; i < checkpoint.nodes.length; i++) {
    const node = checkpoint.nodes[i] as CheckpointNode
    for (let j = 0; j < node.after.length; j++) {
      if (!ids.has(node.after[j])) {
        return fail(`checkpoints.nodes[${i}].after[${j}]`, `Unknown predecessor: ${node.after[j]}`)
      }
    }
  }
  const cycle = layoutNodes(checkpoint.nodes as CheckpointNode[]).cycle
  if (cycle) {
    const index = (checkpoint.nodes as CheckpointNode[]).findIndex((node) => node.id === cycle)
    return fail(`checkpoints.nodes[${index}].after`, 'Checkpoint dependency cycle detected')
  }

  const statusPaths = new Set<string>()
  for (let i = 0; i < checkpoint.documents.length; i++) {
    const record = checkpoint.documents[i]
    const at = `checkpoints.documents[${i}]`
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      return fail(at, 'Status record must be an object')
    }
    if (typeof record.path !== 'string' || !inRoot(record.path, root)) {
      return fail(`${at}.path`, 'Path must be safe and within root')
    }
    if (statusPaths.has(record.path)) return fail(`${at}.path`, `Duplicate status path: ${record.path}`)
    statusPaths.add(record.path)
    if (!isStatus(record.status)) return fail(`${at}.status`, 'Invalid document status')
    if (!isUtcTimestamp(record.updatedAt)) {
      return fail(`${at}.updatedAt`, 'UpdatedAt must be a valid RFC3339 UTC timestamp')
    }
  }
  return { ok: true, value: value as unknown as CheckpointsState }
}

export function checkpointMembership(
  state: CheckpointsState,
): ReadonlyMap<string, { nodeId: string; optional: boolean }> {
  const membership = new Map<string, { nodeId: string; optional: boolean }>()
  for (const node of state.nodes) {
    for (const document of node.documents) {
      membership.set(document.path, { nodeId: node.id, optional: document.optional === true })
    }
  }
  return membership
}

export function resolveCheckpoints(bundle: {
  root: string
  files: { path: string }[]
  checkpoints?: unknown
}): ResolvedCheckpoints {
  const raw = bundle.checkpoints
  const empty = { raw, nodes: [], documents: [], layout: [], frontier: [], unlinked: [] }
  if (raw === undefined) return { ...empty, valid: true }
  const result = validateCheckpoints(raw, bundle.root)
  if (!result.ok) return { ...empty, valid: false, error: `${result.path}: ${result.err}` }

  const state = result.value
  const exists = new Set(bundle.files.map((file) => file.path))
  const records = new Map(state.documents.map((record) => [record.path, record]))
  const membership = checkpointMembership(state)
  const layout = checkpointLayout(state)
  const orderedNodes = new Map(state.nodes.map((node) => [node.id, node]))
  const resolved = new Map<string, ResolvedCheckpointNode>()
  const documents: ResolvedCheckpointDocument[] = []
  const nodes: ResolvedCheckpointNode[] = []
  for (const level of layout) {
    for (const id of level) {
      const node = orderedNodes.get(id)!
      const refs = [...node.documents].sort(
        (a, b) => Number(a.optional === true) - Number(b.optional === true) ||
          (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
      )
      const derived = refs.map((ref): ResolvedCheckpointDocument => {
        const record = records.get(ref.path)
        return {
          path: ref.path,
          optional: ref.optional === true,
          status: record?.status ?? 'todo',
          exists: exists.has(ref.path),
          ...(record && { updatedAt: record.updatedAt }),
        }
      })
      documents.push(...derived)
      const required = derived.filter((document) => !document.optional)
      const participating = required.length ? required : derived
      const aggregate: DocumentStatus = participating.length === 0
        ? 'todo'
        : participating.every((document) => document.status === 'freeze')
          ? 'freeze'
          : participating.every((document) => document.status === 'complete' || document.status === 'freeze')
            ? 'complete'
            : participating.every((document) => document.status === 'todo')
              ? 'todo'
              : 'in_progress'
      const item: ResolvedCheckpointNode = {
        id: node.id,
        title: node.title,
        after: [...node.after].sort(),
        documents: derived,
        aggregate,
        available: node.after.every((predecessor) => resolved.get(predecessor)?.aggregate === 'freeze'),
        missing: participating.filter((document) => document.status !== 'todo' && !document.exists)
          .map((document) => document.path),
      }
      resolved.set(id, item)
      nodes.push(item)
    }
  }
  const unlinked = state.documents.filter((record) => !membership.has(record.path))
    .map((record): ResolvedCheckpointDocument => ({
      path: record.path,
      optional: false,
      status: record.status,
      updatedAt: record.updatedAt,
      exists: exists.has(record.path),
    })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  documents.push(...unlinked)
  documents.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return {
    raw,
    valid: true,
    state,
    nodes,
    documents,
    layout,
    frontier: nodes.filter((node) => node.available && node.aggregate !== 'freeze').map((node) => node.id),
    unlinked,
  }
}

export function setDocumentStatus(
  state: CheckpointsState,
  path: string,
  status: DocumentStatus,
  now: string,
): CheckpointsState {
  if (!isSafePath(path)) throw new Error(`Invalid document path: ${path}`)
  if (!isStatus(status)) throw new Error(`Invalid document status: ${status}`)
  const index = state.documents.findIndex((record) => record.path === path)
  if ((index < 0 ? 'todo' : state.documents[index].status) === status) return state
  if (!isUtcTimestamp(now)) throw new Error('UpdatedAt must be a valid RFC3339 UTC timestamp')
  const documents = [...state.documents]
  const record: DocumentStatusRecord = { path, status, updatedAt: now }
  if (index < 0) documents.push(record)
  else documents[index] = record
  return { ...state, documents }
}
