import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CheckpointDefinitionDelta } from '@taco/protocol'
import { collectFiles, validateBundle, type TacoFile } from '../../../skills/taco/scripts/pack.mjs'
import { extractTacoBundleFromHtml } from './inspect.ts'

export interface FileDiffSummary {
  id?: string
  path: string
  previousPath?: string
  changeType: 'added' | 'modified' | 'deleted' | 'renamed'
  mediaType: string
  content?: string | null
  diff?: string | null
  binary?: boolean
  unverified?: boolean
  oldSize?: number
  newSize?: number
}

export interface CommentChange {
  id: string
  path: string
  changeType: 'new' | 'resolved' | 'reopened' | 'deleted' | 'modified'
  author?: string
  snippet?: string
}

export interface CheckpointChangeItem {
  path: string
  from: string | null
  to: string | null
}

export interface CheckpointDiffSummary {
  statusChanges: CheckpointChangeItem[]
  incrementalStatusChanges?: CheckpointChangeItem[]
  activeNodeChanges: Array<{
    nodeId: string
    changeType: 'added' | 'removed' | 'modified' | 'status_changed'
    from?: string
    to?: string
  }>
  graphChanged: boolean
  checkpointDefinitionDelta?: {
    from: unknown
    to: unknown
  }
  definitionChanges?: CheckpointDefinitionDelta
  incrementalDefinitionChanges?: CheckpointDefinitionDelta
}

export interface ConflictSummary {
  path: string
  reason: string
  baselineHash?: string
  reviewHash?: string
  canonicalHash?: string
  unverified?: boolean
}

export interface DiffOutput {
  source: string
  target?: string
  handoff?: string
  dir?: string
  mode: 'taco-vs-taco' | 'taco-vs-dir' | 'taco-vs-handoff' | 'handoff-vs-dir'
  trustedBaseline: boolean
  changedFiles: FileDiffSummary[]
  incrementalFiles?: FileDiffSummary[]
  commentChanges: CommentChange[]
  checkpointChanges: CheckpointDiffSummary
  conflicts: ConflictSummary[]
  unverifiedWarnings?: string[]
  summary: {
    additions: number
    modifications: number
    deletions: number
    totalChanges: number
    hasConflicts: boolean
    hasIncremental: boolean
  }
}

export interface DiffOptions {
  source: string
  target?: string
  handoff?: string
  dir?: string
}

interface SplitLinesResult {
  lines: string[]
  hasTrailingNewline: boolean
}

function splitLines(text: string): SplitLinesResult {
  if (text.length === 0) {
    return { lines: [], hasTrailingNewline: false }
  }
  const hasTrailingNewline = text.endsWith('\n')
  const stripped = hasTrailingNewline ? text.slice(0, -1) : text
  return { lines: stripped.split('\n'), hasTrailingNewline }
}

interface DiffChange {
  type: 'same' | 'add' | 'del'
  line: string
  noNewline?: boolean
}

type EditOp =
  | { type: 'same'; aIdx: number; bIdx: number }
  | { type: 'del'; aIdx: number }
  | { type: 'add'; bIdx: number }

function lcsLengths(
  a: string[],
  aStart: number,
  aEnd: number,
  b: string[],
  bStart: number,
  bEnd: number,
  reverse: boolean,
): Int32Array {
  const m = bEnd - bStart
  let prev = new Int32Array(m + 1)
  let curr = new Int32Array(m + 1)
  const aCount = aEnd - aStart

  for (let i = 0; i < aCount; i++) {
    const aLine = reverse ? a[aEnd - 1 - i] : a[aStart + i]
    for (let j = 0; j < m; j++) {
      const bLine = reverse ? b[bEnd - 1 - j] : b[bStart + j]
      if (aLine === bLine) {
        curr[j + 1] = prev[j] + 1
      } else {
        const left = curr[j]
        const up = prev[j + 1]
        curr[j + 1] = left > up ? left : up
      }
    }
    const temp = prev
    prev = curr
    curr = temp
  }
  return prev
}

function hirschberg(
  a: string[],
  aStart: number,
  aEnd: number,
  b: string[],
  bStart: number,
  bEnd: number,
  ops: EditOp[],
): void {
  while (aStart < aEnd && bStart < bEnd && a[aStart] === b[bStart]) {
    ops.push({ type: 'same', aIdx: aStart, bIdx: bStart })
    aStart++
    bStart++
  }

  let suffixCount = 0
  while (aStart < aEnd && bStart < bEnd && a[aEnd - 1] === b[bEnd - 1]) {
    suffixCount++
    aEnd--
    bEnd--
  }

  const n = aEnd - aStart
  const m = bEnd - bStart

  if (n === 0) {
    for (let j = bStart; j < bEnd; j++) {
      ops.push({ type: 'add', bIdx: j })
    }
  } else if (m === 0) {
    for (let i = aStart; i < aEnd; i++) {
      ops.push({ type: 'del', aIdx: i })
    }
  } else if (n === 1) {
    const single = a[aStart]
    let found = -1
    for (let j = bStart; j < bEnd; j++) {
      if (b[j] === single) {
        found = j
        break
      }
    }
    if (found !== -1) {
      for (let j = bStart; j < found; j++) {
        ops.push({ type: 'add', bIdx: j })
      }
      ops.push({ type: 'same', aIdx: aStart, bIdx: found })
      for (let j = found + 1; j < bEnd; j++) {
        ops.push({ type: 'add', bIdx: j })
      }
    } else {
      ops.push({ type: 'del', aIdx: aStart })
      for (let j = bStart; j < bEnd; j++) {
        ops.push({ type: 'add', bIdx: j })
      }
    }
  } else {
    const midA = aStart + Math.floor(n / 2)
    const scoreL = lcsLengths(a, aStart, midA, b, bStart, bEnd, false)
    const scoreR = lcsLengths(a, midA, aEnd, b, bStart, bEnd, true)

    let maxVal = -1
    let bestJ = 0
    for (let j = 0; j <= m; j++) {
      const total = scoreL[j] + scoreR[m - j]
      if (total > maxVal) {
        maxVal = total
        bestJ = j
      }
    }

    const midB = bStart + bestJ
    hirschberg(a, aStart, midA, b, bStart, midB, ops)
    hirschberg(a, midA, aEnd, b, midB, bEnd, ops)
  }

  for (let s = 0; s < suffixCount; s++) {
    ops.push({ type: 'same', aIdx: aEnd + s, bIdx: bEnd + s })
  }
}

function computeDiffChanges(
  oldLines: string[],
  oldHasNewline: boolean,
  newLines: string[],
  newHasNewline: boolean,
): DiffChange[] {
  const ops: EditOp[] = []
  hirschberg(oldLines, 0, oldLines.length, newLines, 0, newLines.length, ops)

  const changes: DiffChange[] = []
  const oldLen = oldLines.length
  const newLen = newLines.length

  for (const op of ops) {
    if (op.type === 'same') {
      const isLastOld = op.aIdx === oldLen - 1
      const isLastNew = op.bIdx === newLen - 1
      const oldEofNoNewline = isLastOld && !oldHasNewline
      const newEofNoNewline = isLastNew && !newHasNewline

      if (oldEofNoNewline !== newEofNoNewline) {
        changes.push({ type: 'del', line: oldLines[op.aIdx], noNewline: oldEofNoNewline })
        changes.push({ type: 'add', line: newLines[op.bIdx], noNewline: newEofNoNewline })
      } else {
        changes.push({ type: 'same', line: oldLines[op.aIdx], noNewline: oldEofNoNewline })
      }
    } else if (op.type === 'del') {
      const isLastOld = op.aIdx === oldLen - 1
      changes.push({ type: 'del', line: oldLines[op.aIdx], noNewline: isLastOld && !oldHasNewline })
    } else if (op.type === 'add') {
      const isLastNew = op.bIdx === newLen - 1
      changes.push({ type: 'add', line: newLines[op.bIdx], noNewline: isLastNew && !newHasNewline })
    }
  }

  return changes
}

export function createUnifiedDiff(oldText: string, newText: string, path: string): string {
  if (oldText === newText) return ''

  const oldSplit = splitLines(oldText)
  const newSplit = splitLines(newText)
  const diff = computeDiffChanges(
    oldSplit.lines,
    oldSplit.hasTrailingNewline,
    newSplit.lines,
    newSplit.hasTrailingNewline,
  )

  const context = 3
  const hunks: Array<{
    oldStart: number
    oldCount: number
    newStart: number
    newCount: number
    lines: string[]
  }> = []

  let k = 0
  let oldLineNum = 1
  let newLineNum = 1
  let curPos = 0

  while (k < diff.length) {
    while (k < diff.length && diff[k].type === 'same') k++
    if (k >= diff.length) break

    const start = Math.max(0, k - context)
    let end = k
    while (end < diff.length) {
      if (diff[end].type !== 'same') {
        end++
      } else {
        let nextEdit = end
        while (nextEdit < diff.length && diff[nextEdit].type === 'same') nextEdit++
        if (nextEdit < diff.length && nextEdit - end <= 2 * context) {
          end = nextEdit
        } else {
          end = Math.min(diff.length, end + context)
          break
        }
      }
    }

    while (curPos < start) {
      const t = diff[curPos].type
      if (t !== 'add') oldLineNum++
      if (t !== 'del') newLineNum++
      curPos++
    }

    const hunkOldStartLine = oldLineNum
    const hunkNewLineStartLine = newLineNum
    const hunkLines: string[] = []
    let oldCount = 0
    let newCount = 0
    let p = start

    while (p < end) {
      if (diff[p].type === 'same') {
        hunkLines.push(` ${diff[p].line}`)
        oldCount++
        newCount++
        if (diff[p].noNewline) hunkLines.push('\\ No newline at end of file')
        p++
      } else {
        const delItems: DiffChange[] = []
        const addItems: DiffChange[] = []
        while (p < end && diff[p].type !== 'same') {
          if (diff[p].type === 'del') delItems.push(diff[p])
          else if (diff[p].type === 'add') addItems.push(diff[p])
          p++
        }
        for (const item of delItems) {
          hunkLines.push(`-${item.line}`)
          oldCount++
        }
        if (delItems.length > 0 && delItems[delItems.length - 1].noNewline) {
          hunkLines.push('\\ No newline at end of file')
        }
        for (const item of addItems) {
          hunkLines.push(`+${item.line}`)
          newCount++
        }
        if (addItems.length > 0 && addItems[addItems.length - 1].noNewline) {
          hunkLines.push('\\ No newline at end of file')
        }
      }
    }

    while (curPos < end) {
      const t = diff[curPos].type
      if (t !== 'add') oldLineNum++
      if (t !== 'del') newLineNum++
      curPos++
    }

    const oldStart = oldCount === 0 ? (hunkOldStartLine === 1 ? 0 : hunkOldStartLine - 1) : hunkOldStartLine
    const newStart = newCount === 0 ? (hunkNewLineStartLine === 1 ? 0 : hunkNewLineStartLine - 1) : hunkNewLineStartLine

    hunks.push({
      oldStart,
      oldCount,
      newStart,
      newCount,
      lines: hunkLines,
    })

    k = end
  }

  if (hunks.length === 0) return ''

  const formattedHunks = hunks.map((hunk) => {
    const oldPart = hunk.oldCount === 1 ? `${hunk.oldStart}` : `${hunk.oldStart},${hunk.oldCount}`
    const newPart = hunk.newCount === 1 ? `${hunk.newStart}` : `${hunk.newStart},${hunk.newCount}`
    return `@@ -${oldPart} +${newPart} @@\n${hunk.lines.join('\n')}`
  })

  return `--- a/${path}\n+++ b/${path}\n${formattedHunks.join('\n')}\n`
}

interface GenericFileRecord {
  id?: string
  path: string
  mediaType: string
  content: string | null
}

interface GenericCommentRecord {
  id: string
  status: 'open' | 'resolved'
  anchor: { path: string } | null
  messages: Array<{ id: string; body?: string | null; author?: string }>
}

interface GenericBundle {
  docId: string
  title: string
  root: string
  files: GenericFileRecord[]
  comments: GenericCommentRecord[]
  checkpoints: {
    nodes?: Array<{ id: string; title?: string; after?: string[]; documents?: Array<{ path: string }> }>
    documents?: Array<{ path: string; status: string }>
  } | null
  ignorePatterns: string[]
}

function readIgnorePatterns(source: Record<string, unknown>): string[] {
  const packOptions = source.packOptions
  if (typeof packOptions !== 'object' || packOptions === null) return []
  const ignore = (packOptions as Record<string, unknown>).ignore
  return Array.isArray(ignore) ? ignore.filter((pattern): pattern is string => typeof pattern === 'string') : []
}

async function readTacoArtifact(filePath: string): Promise<GenericBundle> {
  const html = await readFile(filePath, 'utf8')
  const rawBundle = extractTacoBundleFromHtml(html)

  const docId = typeof rawBundle.docId === 'string' ? rawBundle.docId : ''
  const title = typeof rawBundle.title === 'string' ? rawBundle.title : ''
  const root = typeof rawBundle.root === 'string' ? rawBundle.root : '.'
  const rawFiles = Array.isArray(rawBundle.files) ? rawBundle.files : []
  const files: GenericFileRecord[] = []

  for (const f of rawFiles) {
    if (typeof f === 'object' && f !== null) {
      const rec = f as Record<string, unknown>
      files.push({
        id: typeof rec.id === 'string' ? rec.id : undefined,
        path: typeof rec.path === 'string' ? rec.path : '',
        mediaType: typeof rec.mediaType === 'string' ? rec.mediaType : 'text/plain',
        content: typeof rec.content === 'string' ? rec.content : null,
      })
    }
  }

  const rawComments = Array.isArray(rawBundle.comments) ? rawBundle.comments : []
  const comments: GenericCommentRecord[] = []
  for (const c of rawComments) {
    if (typeof c === 'object' && c !== null) {
      const rec = c as Record<string, unknown>
      const anchor = typeof rec.anchor === 'object' && rec.anchor !== null ? (rec.anchor as { path: string }) : null
      const rawMsgs = Array.isArray(rec.messages) ? rec.messages : []
      const messages = rawMsgs.map((m) => {
        const mr = m as Record<string, unknown>
        return {
          id: String(mr.id ?? ''),
          body: typeof mr.body === 'string' ? mr.body : null,
          author: typeof mr.author === 'string' ? mr.author : undefined,
        }
      })
      comments.push({
        id: String(rec.id ?? ''),
        status: rec.status === 'resolved' ? 'resolved' : 'open',
        anchor,
        messages,
      })
    }
  }

  const checkpoints = typeof rawBundle.checkpoints === 'object' && rawBundle.checkpoints !== null
    ? (rawBundle.checkpoints as GenericBundle['checkpoints'])
    : null

  return { docId, title, root, files, comments, checkpoints, ignorePatterns: readIgnorePatterns(rawBundle) }
}

interface HostedDeltaPayload {
  changedFiles?: FileDiffSummary[]
  incrementalFiles?: FileDiffSummary[]
  checkpointChanges?: CheckpointChangeItem[]
  incrementalCheckpointChanges?: CheckpointChangeItem[]
  checkpointDefinitionDelta?: CheckpointDefinitionDelta | null
  incrementalCheckpointDefinitionDelta?: CheckpointDefinitionDelta | null
  comments?: GenericCommentRecord[]
  checkpoints?: GenericBundle['checkpoints']
}

interface HandoffParseResult {
  baseline: GenericBundle | null
  snapshot: GenericBundle | null
  hostedPayload: HostedDeltaPayload | null
}

const CHANGE_TYPE_FLAGS: Record<FileDiffSummary['changeType'], true> = {
  added: true,
  modified: true,
  deleted: true,
  renamed: true,
}

function validationError(message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = 'VALIDATION_ERROR'
  return error
}

function conflictError(message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = 'CONFLICT_ERROR'
  return error
}

function baselineMatchesArtifact(baseline: GenericBundle, artifact: GenericBundle): boolean {
  const artifactFiles = new Map(artifact.files.map((f) => [f.path, f]))
  if (artifactFiles.size !== baseline.files.length) return false
  for (const file of baseline.files) {
    const current = artifactFiles.get(file.path)
    if (!current || current.content !== file.content) return false
  }
  return true
}

function parseLocalBundle(raw: Record<string, unknown>, label: string): GenericBundle {
  try {
    validateBundle(raw)
  } catch (err) {
    throw validationError(`Invalid ${label} bundle in handoff: ${(err as Error).message}`)
  }
  const docId = typeof raw.docId === 'string' ? raw.docId : ''
  const title = typeof raw.title === 'string' ? raw.title : ''
  const root = typeof raw.root === 'string' ? raw.root : '.'
  const files = (Array.isArray(raw.files) ? raw.files : []).map((f) => ({
    id: typeof f.id === 'string' ? f.id : undefined,
    path: String(f.path ?? ''),
    mediaType: String(f.mediaType ?? 'text/plain'),
    content: typeof f.content === 'string' ? f.content : null,
  }))
  const comments = (Array.isArray(raw.comments) ? raw.comments : []).map((c) => ({
    id: String(c.id ?? ''),
    status: (c.status === 'resolved' ? 'resolved' : 'open') as 'open' | 'resolved',
    anchor: c.anchor ? { path: String(c.anchor.path ?? '') } : null,
    messages: Array.isArray(c.messages) ? c.messages : [],
  }))
  const checkpoints = typeof raw.checkpoints === 'object' && raw.checkpoints !== null
    ? (raw.checkpoints as GenericBundle['checkpoints'])
    : null
  return { docId, title, root, files, comments, checkpoints, ignorePatterns: readIgnorePatterns(raw) }
}

function isHostedDeltaPayload(payload: Record<string, unknown>): boolean {
  return (
    Array.isArray(payload.changedFiles) ||
    Array.isArray(payload.incrementalFiles) ||
    Array.isArray(payload.checkpointChanges) ||
    Array.isArray(payload.incrementalCheckpointChanges) ||
    'checkpointDefinitionDelta' in payload ||
    'incrementalCheckpointDefinitionDelta' in payload ||
    'checkpoints' in payload ||
    Array.isArray(payload.comments)
  )
}

function parseHostedDeltaPayload(payload: Record<string, unknown>): HostedDeltaPayload {
  const mapFile = (f: unknown): FileDiffSummary => {
    const fr = f as Record<string, unknown>
    if (typeof fr.path !== 'string') {
      throw validationError('Hosted handoff file change is missing a string path')
    }
    const changeType = fr.changeType
    if (changeType !== undefined && !((changeType as string) in CHANGE_TYPE_FLAGS)) {
      throw validationError(`Hosted handoff file change has unsupported changeType: ${String(changeType)}`)
    }
    return {
      id: typeof fr.id === 'string' ? fr.id : undefined,
      path: fr.path,
      previousPath: typeof fr.previousPath === 'string' ? fr.previousPath : undefined,
      changeType: (changeType ?? 'modified') as FileDiffSummary['changeType'],
      mediaType: typeof fr.mediaType === 'string' ? fr.mediaType : 'text/plain',
      content: typeof fr.content === 'string' ? fr.content : null,
      diff: typeof fr.diff === 'string' ? fr.diff : null,
    }
  }
  const mapCp = (cp: unknown): CheckpointChangeItem => {
    const cpr = cp as Record<string, unknown>
    if (typeof cpr.path !== 'string') {
      throw validationError('Hosted handoff checkpoint change is missing a string path')
    }
    return {
      path: cpr.path,
      from: cpr.from ? String(cpr.from) : null,
      to: cpr.to ? String(cpr.to) : null,
    }
  }

  return {
    changedFiles: Array.isArray(payload.changedFiles) ? payload.changedFiles.map(mapFile) : undefined,
    incrementalFiles: Array.isArray(payload.incrementalFiles) ? payload.incrementalFiles.map(mapFile) : undefined,
    checkpointChanges: Array.isArray(payload.checkpointChanges) ? payload.checkpointChanges.map(mapCp) : undefined,
    incrementalCheckpointChanges: Array.isArray(payload.incrementalCheckpointChanges)
      ? payload.incrementalCheckpointChanges.map(mapCp)
      : undefined,
    checkpointDefinitionDelta: (payload.checkpointDefinitionDelta as CheckpointDefinitionDelta | undefined) ?? null,
    incrementalCheckpointDefinitionDelta:
      (payload.incrementalCheckpointDefinitionDelta as CheckpointDefinitionDelta | undefined) ?? null,
    comments: Array.isArray(payload.comments) ? (payload.comments as GenericCommentRecord[]) : undefined,
    checkpoints: (payload.checkpoints as GenericBundle['checkpoints']) ?? null,
  }
}

async function readHandoffPayload(sourceOrPath: string): Promise<HandoffParseResult> {
  let jsonText = ''
  if (sourceOrPath === '-') {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }
    jsonText = Buffer.concat(chunks).toString('utf8')
  } else {
    jsonText = await readFile(sourceOrPath, 'utf8')
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonText)
  } catch (err) {
    throw validationError(`Failed to parse handoff JSON: ${(err as Error).message}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw validationError('Handoff payload must be a JSON object')
  }

  const schema = typeof parsed.schema === 'string' ? parsed.schema : undefined
  if (schema === 'taco-local-receipt/1' || schema === 'taco-local-handoff/1') {
    const container = (schema === 'taco-local-receipt/1' ? parsed.payload : parsed) as
      | Record<string, unknown>
      | undefined
    const baselineRaw = container?.baseline as Record<string, unknown> | undefined
    const snapshotRaw = container?.snapshot as Record<string, unknown> | undefined
    if (!baselineRaw || !snapshotRaw) {
      throw validationError('Handoff payload must contain baseline and snapshot')
    }
    return {
      baseline: parseLocalBundle(baselineRaw, 'baseline'),
      snapshot: parseLocalBundle(snapshotRaw, 'snapshot'),
      hostedPayload: null,
    }
  }

  const payloadCandidate = parsed.payload
  const hostedSource =
    payloadCandidate && typeof payloadCandidate === 'object'
      ? (payloadCandidate as Record<string, unknown>)
      : schema === 'taco-handoff/1'
        ? parsed
        : null

  if (hostedSource && isHostedDeltaPayload(hostedSource)) {
    return { baseline: null, snapshot: null, hostedPayload: parseHostedDeltaPayload(hostedSource) }
  }

  throw validationError(
    schema
      ? `Unsupported handoff schema: ${schema}`
      : 'Unrecognized handoff payload: expected taco-local-handoff/1, taco-local-receipt/1, or a hosted handoff with a payload object',
  )
}

async function readDirectoryMap(
  dirPath: string,
  rootPath: string,
  ignorePatterns: string[],
): Promise<Map<string, { content: string; mediaType: string; size: number }>> {
  const resolvedRoot = resolve(dirPath)

  if (!existsSync(resolvedRoot)) {
    const error = new Error(`Directory not found: ${resolvedRoot}`) as Error & { code: string }
    error.code = 'LOCAL_IO_ERROR'
    throw error
  }
  const dirStat = await stat(resolvedRoot)
  if (!dirStat.isDirectory()) {
    const error = new Error(`Path is not a directory: ${resolvedRoot}`) as Error & { code: string }
    error.code = 'VALIDATION_ERROR'
    throw error
  }

  // Reuse the canonical pack enumerator so the diff sees exactly what `pack` would:
  // dotfiles, `.taco.html` artifacts and `--ignore` matches are skipped, while symlinks,
  // unsupported HTML and invalid PNG/UTF-8 entries are rejected instead of silently compared.
  const { files } = await collectFiles(resolvedRoot, rootPath, new Map<string, TacoFile>(), ignorePatterns)
  const fileMap = new Map<string, { content: string; mediaType: string; size: number }>()
  for (const file of files) {
    fileMap.set(file.path, {
      content: file.content,
      mediaType: file.mediaType,
      size: Buffer.byteLength(file.content, 'utf8'),
    })
  }
  return fileMap
}

function computeCommentDiffs(oldComments: GenericCommentRecord[], newComments: GenericCommentRecord[]): CommentChange[] {
  const oldMap = new Map(oldComments.map((c) => [c.id, c]))
  const newMap = new Map(newComments.map((c) => [c.id, c]))
  const changes: CommentChange[] = []

  for (const [id, newThread] of newMap.entries()) {
    const oldThread = oldMap.get(id)
    const anchorPath = newThread.anchor?.path ?? ''
    const snippet = newThread.messages[0]?.body?.slice(0, 80) ?? undefined
    const author = newThread.messages[0]?.author ?? undefined

    if (!oldThread) {
      changes.push({ id, path: anchorPath, changeType: 'new', author, snippet })
    } else if (oldThread.status === 'open' && newThread.status === 'resolved') {
      changes.push({ id, path: anchorPath, changeType: 'resolved', author, snippet })
    } else if (oldThread.status === 'resolved' && newThread.status === 'open') {
      changes.push({ id, path: anchorPath, changeType: 'reopened', author, snippet })
    } else if (
      oldThread.messages.length !== newThread.messages.length ||
      oldThread.messages[oldThread.messages.length - 1]?.body !== newThread.messages[newThread.messages.length - 1]?.body
    ) {
      changes.push({ id, path: anchorPath, changeType: 'modified', author, snippet })
    }
  }

  for (const [id, oldThread] of oldMap.entries()) {
    if (!newMap.has(id)) {
      changes.push({
        id,
        path: oldThread.anchor?.path ?? '',
        changeType: 'deleted',
        snippet: oldThread.messages[0]?.body?.slice(0, 80) ?? undefined,
      })
    }
  }

  return changes
}

function computeCheckpointDiffs(
  oldCp: GenericBundle['checkpoints'],
  newCp: GenericBundle['checkpoints'],
): CheckpointDiffSummary {
  const statusChanges: CheckpointChangeItem[] = []
  const oldDocs = new Map((oldCp?.documents ?? []).map((d) => [d.path, d.status]))
  const newDocs = new Map((newCp?.documents ?? []).map((d) => [d.path, d.status]))

  for (const [path, toStatus] of newDocs.entries()) {
    const fromStatus = oldDocs.get(path) ?? null
    if (fromStatus !== toStatus) {
      statusChanges.push({ path, from: fromStatus, to: toStatus })
    }
  }
  for (const [path, fromStatus] of oldDocs.entries()) {
    if (!newDocs.has(path)) {
      statusChanges.push({ path, from: fromStatus, to: null })
    }
  }

  const oldNodes = new Map((oldCp?.nodes ?? []).map((n) => [n.id, n]))
  const newNodes = new Map((newCp?.nodes ?? []).map((n) => [n.id, n]))
  const activeNodeChanges: CheckpointDiffSummary['activeNodeChanges'] = []

  for (const [id] of newNodes.entries()) {
    if (!oldNodes.has(id)) {
      activeNodeChanges.push({ nodeId: id, changeType: 'added' })
    }
  }
  for (const [id] of oldNodes.entries()) {
    if (!newNodes.has(id)) {
      activeNodeChanges.push({ nodeId: id, changeType: 'removed' })
    }
  }

  const graphChanged = (oldCp?.nodes?.length ?? 0) !== (newCp?.nodes?.length ?? 0) || activeNodeChanges.length > 0

  return {
    statusChanges,
    activeNodeChanges,
    graphChanged,
    checkpointDefinitionDelta: {
      from: oldCp,
      to: newCp,
    },
  }
}

export async function executeDiff(options: DiffOptions): Promise<DiffOutput> {
  const hasHandoff = Boolean(options.handoff)
  const hasDir = Boolean(options.dir)
  const hasTarget = Boolean(options.target)

  let mode: DiffOutput['mode'] = 'taco-vs-taco'
  if (hasHandoff && hasDir) {
    mode = 'handoff-vs-dir'
  } else if (hasTarget) {
    mode = 'taco-vs-taco'
  } else if (hasHandoff) {
    mode = 'taco-vs-handoff'
  } else if (hasDir) {
    mode = 'taco-vs-dir'
  } else {
    const error = new Error(
      'Diff requires a comparison target: provide --target <file>, --dir <dir>, or --handoff <file|->',
    ) as Error & { code: string }
    error.code = 'VALIDATION_ERROR'
    throw error
  }

  const changedFiles: FileDiffSummary[] = []
  let incrementalFiles: FileDiffSummary[] | undefined = undefined
  let commentChanges: CommentChange[] = []
  let checkpointChanges: CheckpointDiffSummary = {
    statusChanges: [],
    activeNodeChanges: [],
    graphChanged: false,
  }
  const conflicts: ConflictSummary[] = []
  const unverifiedWarnings: string[] = []
  let trustedBaseline = false

  if (mode === 'taco-vs-taco') {
    trustedBaseline = true
    const sourceBundle = await readTacoArtifact(options.source)
    const targetBundle = await readTacoArtifact(options.target!)

    const oldFilesMap = new Map(sourceBundle.files.map((f) => [f.path, f]))
    const newFilesMap = new Map(targetBundle.files.map((f) => [f.path, f]))

    for (const [path, newF] of newFilesMap.entries()) {
      const oldF = oldFilesMap.get(path)
      const isPng = newF.mediaType === 'image/png' || path.endsWith('.png')

      if (!oldF) {
        const diffText = isPng ? null : createUnifiedDiff('', newF.content ?? '', path)
        changedFiles.push({
          id: newF.id,
          path,
          changeType: 'added',
          mediaType: newF.mediaType,
          content: newF.content,
          diff: diffText,
          binary: isPng,
          newSize: newF.content ? Buffer.byteLength(newF.content, 'utf8') : 0,
        })
      } else if (oldF.content !== newF.content) {
        const diffText = isPng ? null : createUnifiedDiff(oldF.content ?? '', newF.content ?? '', path)
        changedFiles.push({
          id: newF.id,
          path,
          changeType: 'modified',
          mediaType: newF.mediaType,
          content: newF.content,
          diff: diffText,
          binary: isPng,
          oldSize: oldF.content ? Buffer.byteLength(oldF.content, 'utf8') : 0,
          newSize: newF.content ? Buffer.byteLength(newF.content, 'utf8') : 0,
        })
      }
    }

    for (const [path, oldF] of oldFilesMap.entries()) {
      if (!newFilesMap.has(path)) {
        const isPng = oldF.mediaType === 'image/png' || path.endsWith('.png')
        const diffText = isPng ? null : createUnifiedDiff(oldF.content ?? '', '', path)
        changedFiles.push({
          id: oldF.id,
          path,
          changeType: 'deleted',
          mediaType: oldF.mediaType,
          content: null,
          diff: diffText,
          binary: isPng,
          oldSize: oldF.content ? Buffer.byteLength(oldF.content, 'utf8') : 0,
        })
      }
    }

    commentChanges = computeCommentDiffs(sourceBundle.comments, targetBundle.comments)
    checkpointChanges = computeCheckpointDiffs(sourceBundle.checkpoints, targetBundle.checkpoints)
  } else if (mode === 'taco-vs-dir') {
    trustedBaseline = false
    unverifiedWarnings.push('Missing trusted review-start baseline: canonical conflict status is unverified; cannot guarantee safe apply.')

    const sourceBundle = await readTacoArtifact(options.source)
    const dirMap = await readDirectoryMap(options.dir!, sourceBundle.root, sourceBundle.ignorePatterns)

    const bundleFilesMap = new Map(sourceBundle.files.map((f) => [f.path, f]))

    for (const [path, bundleF] of bundleFilesMap.entries()) {
      const dirF = dirMap.get(path)
      const isPng = bundleF.mediaType === 'image/png' || path.endsWith('.png')

      if (!dirF) {
        const diffText = isPng ? null : createUnifiedDiff('', bundleF.content ?? '', bundleF.path)
        changedFiles.push({
          id: bundleF.id,
          path: bundleF.path,
          changeType: 'added',
          mediaType: bundleF.mediaType,
          content: bundleF.content,
          diff: diffText,
          binary: isPng,
          newSize: bundleF.content ? Buffer.byteLength(bundleF.content, 'utf8') : 0,
        })
      } else if (dirF.content !== bundleF.content) {
        const diffText = isPng ? null : createUnifiedDiff(dirF.content, bundleF.content ?? '', bundleF.path)
        changedFiles.push({
          id: bundleF.id,
          path: bundleF.path,
          changeType: 'modified',
          mediaType: bundleF.mediaType,
          content: bundleF.content,
          diff: diffText,
          binary: isPng,
          oldSize: dirF.size,
          newSize: bundleF.content ? Buffer.byteLength(bundleF.content, 'utf8') : 0,
        })
      }
    }

    for (const [path, dirF] of dirMap.entries()) {
      if (!bundleFilesMap.has(path)) {
        const isPng = dirF.mediaType === 'image/png' || path.endsWith('.png')
        const diffText = isPng ? null : createUnifiedDiff(dirF.content, '', path)
        changedFiles.push({
          path,
          changeType: 'deleted',
          mediaType: dirF.mediaType,
          content: null,
          diff: diffText,
          binary: isPng,
          oldSize: dirF.size,
        })
      }
    }
  } else if (mode === 'taco-vs-handoff') {
    const sourceBundle = await readTacoArtifact(options.source)
    const handoff = await readHandoffPayload(options.handoff!)

    if (handoff.hostedPayload) {
      trustedBaseline = false
      unverifiedWarnings.push('Hosted delta-only review payload has no local baseline text; baseline trust is unverified.')
      if (handoff.hostedPayload.changedFiles) {
        changedFiles.push(...handoff.hostedPayload.changedFiles)
      }
      if (handoff.hostedPayload.incrementalFiles) {
        incrementalFiles = handoff.hostedPayload.incrementalFiles
      }
      if (handoff.hostedPayload.checkpointChanges) {
        checkpointChanges.statusChanges = handoff.hostedPayload.checkpointChanges
      }
      if (handoff.hostedPayload.incrementalCheckpointChanges) {
        checkpointChanges.incrementalStatusChanges = handoff.hostedPayload.incrementalCheckpointChanges
      }
      if (handoff.hostedPayload.checkpointDefinitionDelta) {
        checkpointChanges.definitionChanges = handoff.hostedPayload.checkpointDefinitionDelta
        checkpointChanges.graphChanged = true
      }
      if (handoff.hostedPayload.incrementalCheckpointDefinitionDelta) {
        checkpointChanges.incrementalDefinitionChanges = handoff.hostedPayload.incrementalCheckpointDefinitionDelta
        checkpointChanges.graphChanged = true
      }
      if (handoff.hostedPayload.comments) {
        commentChanges = computeCommentDiffs(sourceBundle.comments, handoff.hostedPayload.comments)
      }
    } else if (handoff.snapshot) {
      const baseline = handoff.baseline
      if (baseline) {
        if (baseline.docId !== sourceBundle.docId || handoff.snapshot.docId !== sourceBundle.docId) {
          throw conflictError('Handoff baseline/snapshot docId does not match artifact docId')
        }
        if (baseline.root !== sourceBundle.root || handoff.snapshot.root !== sourceBundle.root) {
          throw conflictError('Handoff root does not match artifact root')
        }
        trustedBaseline = baselineMatchesArtifact(baseline, sourceBundle)
        if (!trustedBaseline) {
          unverifiedWarnings.push(
            'Review-start baseline text does not match the artifact; canonical conflict status is unverified.',
          )
        }
      } else {
        trustedBaseline = false
        unverifiedWarnings.push('Missing trusted review-start baseline: canonical conflict status is unverified.')
      }
      const baseFiles = baseline ? baseline.files : sourceBundle.files
      const snapFiles = handoff.snapshot.files

      const oldFilesMap = new Map(baseFiles.map((f) => [f.path, f]))
      const newFilesMap = new Map(snapFiles.map((f) => [f.path, f]))

      for (const [path, newF] of newFilesMap.entries()) {
        const oldF = oldFilesMap.get(path)
        const isPng = newF.mediaType === 'image/png' || path.endsWith('.png')
        const isHtml = /\.html?$/i.test(path) || newF.mediaType === 'text/html' || oldF?.mediaType === 'text/html'
        if (isHtml && oldF && newF && oldF.content !== newF.content) {
          throw conflictError(`Tampering detected: read-only HTML file '${path}' content was modified in review handoff`)
        }

        if (!oldF) {
          const diffText = isPng ? null : createUnifiedDiff('', newF.content ?? '', path)
          changedFiles.push({
            id: newF.id,
            path,
            changeType: 'added',
            mediaType: newF.mediaType,
            content: newF.content,
            diff: diffText,
            binary: isPng,
            newSize: newF.content ? Buffer.byteLength(newF.content, 'utf8') : 0,
          })
        } else if (oldF.content !== newF.content) {
          const diffText = isPng ? null : createUnifiedDiff(oldF.content ?? '', newF.content ?? '', path)
          changedFiles.push({
            id: newF.id,
            path,
            changeType: 'modified',
            mediaType: newF.mediaType,
            content: newF.content,
            diff: diffText,
            binary: isPng,
            oldSize: oldF.content ? Buffer.byteLength(oldF.content, 'utf8') : 0,
            newSize: newF.content ? Buffer.byteLength(newF.content, 'utf8') : 0,
          })
        }
      }

      for (const [path, oldF] of oldFilesMap.entries()) {
        if (!newFilesMap.has(path)) {

          const isPng = oldF.mediaType === 'image/png' || path.endsWith('.png')
          const diffText = isPng ? null : createUnifiedDiff(oldF.content ?? '', '', path)
          changedFiles.push({
            id: oldF.id,
            path,
            changeType: 'deleted',
            mediaType: oldF.mediaType,
            content: null,
            diff: diffText,
            binary: isPng,
            oldSize: oldF.content ? Buffer.byteLength(oldF.content, 'utf8') : 0,
          })
        }
      }

      const baseComments = handoff.baseline ? handoff.baseline.comments : sourceBundle.comments
      commentChanges = computeCommentDiffs(baseComments, handoff.snapshot.comments)
      checkpointChanges = computeCheckpointDiffs(
        handoff.baseline ? handoff.baseline.checkpoints : sourceBundle.checkpoints,
        handoff.snapshot.checkpoints,
      )
    }
  } else if (mode === 'handoff-vs-dir') {
    const handoffPath = options.handoff || options.source
    const handoff = await readHandoffPayload(handoffPath)

    if (handoff.baseline && handoff.snapshot) {
      if (handoff.baseline.docId !== handoff.snapshot.docId) {
        throw conflictError('Handoff baseline/snapshot docId does not match')
      }
      if (handoff.baseline.root !== handoff.snapshot.root) {
        throw conflictError('Handoff root does not match')
      }
      trustedBaseline = true
      const root = handoff.snapshot.root
      const dirMap = await readDirectoryMap(
        options.dir!,
        root,
        handoff.snapshot.ignorePatterns.length > 0
          ? handoff.snapshot.ignorePatterns
          : handoff.baseline.ignorePatterns,
      )

      const baselineFilesMap = new Map(handoff.baseline.files.map((f) => [f.path, f]))
      const snapshotFilesMap = new Map(handoff.snapshot.files.map((f) => [f.path, f]))

      for (const [path, snapF] of snapshotFilesMap.entries()) {
        const baseF = baselineFilesMap.get(path)
        const isPng = snapF.mediaType === 'image/png' || path.endsWith('.png')
        const isHtml = /\.html?$/i.test(path) || snapF.mediaType === 'text/html' || baseF?.mediaType === 'text/html'
        if (isHtml && baseF && snapF && baseF.content !== snapF.content) {
          throw conflictError(`Tampering detected: read-only HTML file '${path}' content was modified in review handoff`)
        }

        if (!baseF) {
          const diffText = isPng ? null : createUnifiedDiff('', snapF.content ?? '', snapF.path)
          changedFiles.push({
            id: snapF.id,
            path: snapF.path,
            changeType: 'added',
            mediaType: snapF.mediaType,
            content: snapF.content,
            diff: diffText,
            binary: isPng,
            newSize: snapF.content ? Buffer.byteLength(snapF.content, 'utf8') : 0,
          })
        } else if (baseF.content !== snapF.content) {
          const diffText = isPng ? null : createUnifiedDiff(baseF.content ?? '', snapF.content ?? '', snapF.path)
          changedFiles.push({
            id: snapF.id,
            path: snapF.path,
            changeType: 'modified',
            mediaType: snapF.mediaType,
            content: snapF.content,
            diff: diffText,
            binary: isPng,
            oldSize: baseF.content ? Buffer.byteLength(baseF.content, 'utf8') : 0,
            newSize: snapF.content ? Buffer.byteLength(snapF.content, 'utf8') : 0,
          })
        }
      }

      for (const [path, baseF] of baselineFilesMap.entries()) {
        if (!snapshotFilesMap.has(path)) {

          const isPng = baseF.mediaType === 'image/png' || path.endsWith('.png')
          const diffText = isPng ? null : createUnifiedDiff(baseF.content ?? '', '', baseF.path)
          changedFiles.push({
            id: baseF.id,
            path: baseF.path,
            changeType: 'deleted',
            mediaType: baseF.mediaType,
            content: null,
            diff: diffText,
            binary: isPng,
            oldSize: baseF.content ? Buffer.byteLength(baseF.content, 'utf8') : 0,
          })
        }
      }

      commentChanges = computeCommentDiffs(handoff.baseline.comments, handoff.snapshot.comments)
      checkpointChanges = computeCheckpointDiffs(handoff.baseline.checkpoints, handoff.snapshot.checkpoints)

      const allKnownPaths = new Set([...baselineFilesMap.keys(), ...snapshotFilesMap.keys(), ...dirMap.keys()])
      for (const path of allKnownPaths) {
        const baseF = baselineFilesMap.get(path)
        const snapF = snapshotFilesMap.get(path)
        const dirF = dirMap.get(path)

        const bContent = baseF ? baseF.content : null
        const rContent = snapF ? snapF.content : null
        const cContent = dirF ? dirF.content : null

        if (rContent !== bContent && cContent !== bContent && rContent !== cContent) {
          const bHash = bContent ? createHash('sha256').update(bContent).digest('hex') : undefined
          const rHash = rContent ? createHash('sha256').update(rContent).digest('hex') : undefined
          const cHash = cContent ? createHash('sha256').update(cContent).digest('hex') : undefined
          conflicts.push({
            path,
            reason: `Canonical directory content for '${path}' conflicts with both baseline and review snapshot`,
            baselineHash: bHash,
            reviewHash: rHash,
            canonicalHash: cHash,
          })
        }
      }
    } else if (handoff.hostedPayload) {
      trustedBaseline = false
      unverifiedWarnings.push('Hosted delta-only review payload has no local baseline text; 3-way canonical conflict detection is unverified.')
      if (handoff.hostedPayload.changedFiles) {
        changedFiles.push(...handoff.hostedPayload.changedFiles)
      }
      if (handoff.hostedPayload.incrementalFiles) {
        incrementalFiles = handoff.hostedPayload.incrementalFiles
      }
      if (handoff.hostedPayload.checkpointChanges) {
        checkpointChanges.statusChanges = handoff.hostedPayload.checkpointChanges
      }
      if (handoff.hostedPayload.incrementalCheckpointChanges) {
        checkpointChanges.incrementalStatusChanges = handoff.hostedPayload.incrementalCheckpointChanges
      }
      if (handoff.hostedPayload.checkpointDefinitionDelta) {
        checkpointChanges.definitionChanges = handoff.hostedPayload.checkpointDefinitionDelta
        checkpointChanges.graphChanged = true
      }
      if (handoff.hostedPayload.incrementalCheckpointDefinitionDelta) {
        checkpointChanges.incrementalDefinitionChanges = handoff.hostedPayload.incrementalCheckpointDefinitionDelta
        checkpointChanges.graphChanged = true
      }
      if (handoff.hostedPayload.comments) {
        commentChanges = computeCommentDiffs([], handoff.hostedPayload.comments)
      }
    } else {
      trustedBaseline = false
      unverifiedWarnings.push('Missing trusted review-start baseline: 3-way canonical conflict detection is unverified.')
    }
  }
  for (const cf of changedFiles) {
    if (cf.binary && (cf.changeType === 'added' || cf.changeType === 'modified')) {
      if (!cf.content || !cf.content.startsWith('data:image/png;base64,')) {
        cf.unverified = true
        unverifiedWarnings.push(`Binary PNG file '${cf.path}' missing verified content; cannot apply.`)
      }
    }
  }

  let additions = 0
  let modifications = 0
  let deletions = 0

  for (const f of changedFiles) {
    if (f.changeType === 'added') additions++
    else if (f.changeType === 'modified') modifications++
    else if (f.changeType === 'deleted') deletions++
  }

  return {
    source: options.source,
    target: options.target,
    handoff: options.handoff,
    dir: options.dir,
    mode,
    trustedBaseline,
    changedFiles,
    ...(incrementalFiles ? { incrementalFiles } : {}),
    commentChanges,
    checkpointChanges,
    conflicts,
    ...(unverifiedWarnings.length > 0 ? { unverifiedWarnings } : {}),
    summary: {
      additions,
      modifications,
      deletions,
      totalChanges: changedFiles.length,
      hasConflicts: conflicts.length > 0,
      hasIncremental:
        Boolean(incrementalFiles && incrementalFiles.length > 0) ||
        Boolean(checkpointChanges.incrementalStatusChanges && checkpointChanges.incrementalStatusChanges.length > 0) ||
        Boolean(checkpointChanges.incrementalDefinitionChanges),
    },
  }
}
