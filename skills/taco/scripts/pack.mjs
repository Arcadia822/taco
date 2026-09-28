#!/usr/bin/env node
// Taco bundle assembler and verifier for the `taco` skill.
//
// Hand-maintained, dependency-free (Node >= 22). Unlike `checkpoints.mjs`, this file
// is source: edit it directly. It implements the write contract in
// `../references/bundle-format.md` so an agent never has to hand-roll the
// serialization rules.
//
//   node scripts/pack.mjs --dir <docDir> [--out <name.taco.html>] [--shell <shell.html>]
//                         [--title <text>] [--root <relpath>] [--entry <relpath>]
//                         [--group <Title>=<relPath,relPath>]... [--ignore <glob>]...
//                         [--dry-run]
//   node scripts/pack.mjs verify <file.taco.html>
//
// `pack` enumerates the directory, merges with the previous bundle at `--out`
// (preserving identity and review state), validates, escapes, and writes the data
// block atomically. `verify` parses an existing artifact and prints the structure a
// human will actually see. Both print a readable summary on stdout; a failure exits
// non-zero with the reason on stderr.

import { randomUUID } from 'node:crypto'
import { MAX_PNG_SIZE, PNG_DATA_URL_PREFIX, decodePng, validatePngBytes } from './png.mjs'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const FORMAT = 'taco/files'
const FORMAT_VERSION = 1
const DATA_CONTENT = /(<script\b(?=[^>]*\bid=["']taco-document["'])[^>]*>)([\s\S]*?)(<\/script>)/i
const DATA_BLOCK = /<script\b(?=[^>]*\bid=["']taco-document["'])[^>]*>[\s\S]*?<\/script>/i
const SHELL_TITLE = /<title\b[^>]*>[\s\S]*?<\/title>/i

// ---------------------------------------------------------------------------
// path and type rules (mirror of the runtime's model.ts / the extension CLI)
// ---------------------------------------------------------------------------

const SAFE_PATH_PATTERN =
  /^(?![a-zA-Z]:)(?!(?:\.{1,2}(?:\/|$)))[^/\\\0]+(?:\/(?!(?:\.{1,2}(?:\/|$)))[^/\\\0]+)*$/
const SAFE_ROOT_PATTERN =
  /^(?:\.|(?![a-zA-Z]:)(?!(?:\.{1,2}(?:\/|$)))[^/\\\0]+(?:\/(?!(?:\.{1,2}(?:\/|$)))[^/\\\0]+)*)$/

const isSafePath = (value) => typeof value === 'string' && value.length > 0 && SAFE_PATH_PATTERN.test(value)
const isSafeRootPath = (value) => typeof value === 'string' && value.length > 0 && SAFE_ROOT_PATTERN.test(value)
const posix = (value) => value.split(sep).join('/')

const mediaTypeOf = (path) => {
  const lower = path.toLowerCase()
  if (lower.endsWith('.md')) return 'text/markdown'
  if (/\.ya?ml$/.test(lower)) return 'application/yaml'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.mmd')) return 'text/plain'
  if (lower.endsWith('.png')) return 'image/png'
  return 'text/plain'
}

const portableTitleBase = (value) =>
  value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '') || 'Untitled'

const tacoFileBase = (path) => basename(path).replace(/\.taco\.html$/i, '').replace(/\.html$/i, '')

const sha256Hex = async (bytes) => {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(bytes).digest('hex')
}

// ---------------------------------------------------------------------------
// ignore patterns (same glob dialect as the extension CLI's --ignore)
// ---------------------------------------------------------------------------

const normalizeIgnorePattern = (value) => {
  const normalized = value.replace(/\/{2,}/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized.includes('\\') ||
    normalized.includes('\0') ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Unsafe --ignore pattern: ${value}`)
  }
  return normalized
}

const escapeRegex = (character) => (/[\\^$+?.()|{}[\]]/.test(character) ? `\\${character}` : character)

const globRegex = (pattern) => {
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        while (pattern[index + 1] === '*') index += 1
        if (pattern[index + 1] === '/') {
          index += 1
          source += '(?:.*/)?'
        } else if (source.endsWith('/')) {
          source = `${source.slice(0, -1)}(?:/.*)?`
        } else {
          source += '.*'
        }
      } else {
        source += '[^/]*'
      }
    } else if (character === '?') {
      source += '[^/]'
    } else {
      source += escapeRegex(character)
    }
  }
  return new RegExp(`${source}$`)
}

const ignoreMatcher = (patterns) => {
  const compiled = patterns.map((pattern) => ({ pattern, regex: globRegex(pattern) }))
  return (path) =>
    compiled.find(
      ({ pattern, regex }) =>
        regex.test(path) ||
        (!pattern.includes('*') && !pattern.includes('?') && path.startsWith(`${pattern}/`)),
    )?.pattern ?? null
}

// ---------------------------------------------------------------------------
// bundle assembly
// ---------------------------------------------------------------------------

const collectFiles = async (featureDir, rootPath, existingByPath, ignorePatterns) => {
  const files = []
  const skipped = []
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const match = ignoreMatcher(ignorePatterns)

  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const absolute = join(directory, entry.name)
      const relativePathKey = posix(relative(featureDir, absolute))
      const reason = (() => {
        if (entry.name.startsWith('.')) return 'dotfile'
        if (entry.name.toLowerCase().endsWith('.taco.html')) return 'taco artifact'
        const pattern = match(relativePathKey)
        if (pattern) return `--ignore ${pattern}`
        return null
      })()
      if (reason) {
        skipped.push({ path: relativePathKey, reason })
        continue
      }
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Unsupported symbolic link in document directory: ${relativePathKey}; exclude it with --ignore`,
        )
      }
      if (entry.isDirectory()) {
        await visit(absolute)
        continue
      }
      if (!entry.isFile()) {
        throw new Error(
          `Unsupported filesystem entry in document directory: ${relativePathKey}; exclude it with --ignore`,
        )
      }
      if (/\.html?$/i.test(entry.name)) {
        throw new Error(
          `HTML source files are not supported: ${relativePathKey}; exclude it with --ignore`,
        )
      }
      const mediaType = mediaTypeOf(relativePathKey)
      const isPng = mediaType === 'image/png'
      let content
      let hashInput
      if (isPng) {
        const bytes = await readFile(absolute)
        if (bytes.length > MAX_PNG_SIZE) {
          throw new Error(
            `PNG image exceeds 10 MiB limit: ${relativePathKey} (${bytes.length} bytes); optimize or exclude with --ignore`,
          )
        }
        validatePngBytes(bytes, relativePathKey)
        content = `${PNG_DATA_URL_PREFIX}${bytes.toString('base64')}`
        hashInput = bytes
      } else {
        try {
          content = decoder.decode(await readFile(absolute))
        } catch {
          throw new Error(`File is not valid UTF-8: ${relativePathKey}; exclude it with --ignore`)
        }
        hashInput = content
      }
      const previous = existingByPath.get(`${rootPath}/${relativePathKey}`)
      const unchanged = previous !== undefined && previous.content === content
      files.push({
        ...(previous?.id ? { id: previous.id } : {}),
        ...(previous?.title ? { title: previous.title } : {}),
        path: `${rootPath}/${relativePathKey}`,
        mediaType,
        content,
        sourceHash: await sha256Hex(hashInput),
        // `blocks` is a runtime render cache: only keep it while content is byte-identical.
        ...(unchanged && Array.isArray(previous.blocks) ? { blocks: previous.blocks } : {}),
      })
    }
  }

  await visit(featureDir)
  return { files, skipped }
}

const buildNavigation = (entries, rootPath, knownPaths) => {
  const groups = []
  const toBundlePath = (value, option) => {
    const path = value.startsWith(`${rootPath}/`) ? value : `${rootPath}/${value}`
    if (!isSafePath(path) || !path.startsWith(`${rootPath}/`)) {
      throw new Error(`${option} must be root-relative or a bundle path under ${rootPath}/: ${value}`)
    }
    return path
  }
  for (const entry of entries) {
    const separator = entry.indexOf('=')
    if (separator <= 0) throw new Error(`--group needs <Title>=<relPath,relPath>: ${entry}`)
    const title = entry.slice(0, separator).trim()
    if (!title) throw new Error(`--group needs a non-empty title: ${entry}`)
    const paths = entry
      .slice(separator + 1)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => toBundlePath(value, '--group'))
    for (const path of paths) {
      if (!knownPaths.has(path)) {
        throw new Error(`--group lists a file that is not in the bundle: ${path}`)
      }
    }
    // Store root-relative paths, the form the runtime's own navigation editor writes.
    groups.push({ id: `group-${groups.length + 1}`, title, paths: paths.map((path) => path.slice(rootPath.length + 1)) })
  }
  return groups
}

// ---------------------------------------------------------------------------
// validation (mirror of the runtime's parseBundle, so a bad bundle never ships)
// ---------------------------------------------------------------------------

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0
const isTimestamp = (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= 128 && !Number.isNaN(Date.parse(value))

const SUPPORTED_BLOCK_TYPES = new Set([
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
const MAX_BLOCK_HTML = 512 * 1024

const isBlock = (value) =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  typeof value.type === 'string' &&
  SUPPORTED_BLOCK_TYPES.has(value.type) &&
  typeof value.html === 'string' &&
  value.html.length <= MAX_BLOCK_HTML

const isCommentThread = (value) => {
  if (!isRecord(value) || !isRecord(value.anchor) || !isRecord(value.anchor.position) || !isRecord(value.anchor.quote)) {
    return false
  }
  const { anchor } = value
  const position = anchor.position
  const quote = anchor.quote
  const validPosition =
    Number.isInteger(position.start) &&
    Number.isInteger(position.end) &&
    Number(position.start) >= 0 &&
    Number(position.end) > Number(position.start)
  const validQuote =
    typeof quote.exact === 'string' &&
    quote.exact.length > 0 &&
    typeof quote.prefix === 'string' &&
    typeof quote.suffix === 'string'
  const block = anchor.block
  const validBlock =
    block === undefined ||
    (isRecord(block) &&
      typeof block.id === 'string' &&
      block.id.length > 0 &&
      block.type === 'codeBlock' &&
      typeof block.language === 'string')
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof anchor.path === 'string' &&
    validPosition &&
    validQuote &&
    validBlock &&
    (value.status === 'open' || value.status === 'resolved') &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt) &&
    Array.isArray(value.messages) &&
    value.messages.length > 0 &&
    value.messages.every(
      (message) =>
        isRecord(message) &&
        typeof message.id === 'string' &&
        typeof message.author === 'string' &&
        typeof message.body === 'string' &&
        message.body.trim().length > 0 &&
        isTimestamp(message.createdAt) &&
        (message.updatedAt === undefined || isTimestamp(message.updatedAt)) &&
        (message.deletedAt === undefined || isTimestamp(message.deletedAt)),
    )
  )
}

const isNavigationGroup = (value) =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  typeof value.title === 'string' &&
  Array.isArray(value.paths) &&
  value.paths.every((path) => typeof path === 'string')

const isNavigationManifest = (value) =>
  isRecord(value) &&
  value.version === 1 &&
  (value.entry === undefined || typeof value.entry === 'string') &&
  Array.isArray(value.groups) &&
  value.groups.every(isNavigationGroup)

const isCollabInvite = (value) =>
  isRecord(value) &&
  isNonEmptyString(value.pub) &&
  isNonEmptyString(value.priv) &&
  (value.role === 'writer' || value.role === 'commenter') &&
  (value.exp === undefined || (typeof value.exp === 'number' && Number.isFinite(value.exp) && value.exp >= 0)) &&
  isNonEmptyString(value.sig)

const isCollab = (value) => {
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

const KNOWN_BUNDLE_FIELDS = new Set([
  'format',
  'version',
  'docId',
  'title',
  'root',
  'files',
  'comments',
  'navigation',
  'checkpoints',
  'access',
  'collab',
  'packOptions',
])

const validateBundle = (raw) => {
  const fail = (detail) => {
    throw new Error(`Bundle does not match taco/files v1: ${detail}`)
  }
  if (!isRecord(raw)) fail('bundle must be an object')
  if (raw.format !== FORMAT) fail(`expected ${FORMAT}, found ${String(raw.format ?? 'nothing')}`)
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    fail('version must be a positive integer')
  }
  if (!isNonEmptyString(raw.docId)) fail('docId is required')
  if (!isNonEmptyString(raw.title)) fail('title is required')
  if (!isSafeRootPath(raw.root)) fail('root is not a safe relative path')
  if (!Array.isArray(raw.files)) fail('files must be an array')

  const seen = new Set()
  for (const value of raw.files) {
    if (!isRecord(value) || typeof value.path !== 'string' || typeof value.mediaType !== 'string' || typeof value.content !== 'string') {
      fail('every file requires path, mediaType and content strings')
    }
    if (!isSafePath(value.path) || !value.path.startsWith(`${raw.root}/`)) {
      fail(`file escapes bundle root: ${value.path}`)
    }
    if (seen.has(value.path)) fail(`duplicate file path: ${value.path}`)
    seen.add(value.path)
    if (value.id !== undefined && !isNonEmptyString(value.id)) fail(`file id is invalid: ${value.path}`)
    if (value.title !== undefined && (typeof value.title !== 'string' || !value.title.trim())) {
      fail(`file title is invalid: ${value.path}`)
    }
    if (value.sourceHash !== undefined && (typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash))) {
      fail(`file sourceHash is invalid: ${value.path}`)
    }
    if (value.mediaType === 'text/html' || /\.html?$/i.test(value.path)) {
      fail(`HTML source files are not supported: ${value.path}`)
    }
    if ('sourceUrl' in value) fail(`sourceUrl is no longer supported: ${value.path}`)
    if (value.blocks !== undefined && (!Array.isArray(value.blocks) || !value.blocks.every(isBlock))) {
      fail(`file blocks are invalid: ${value.path}`)
    }
    if (value.mediaType === 'image/png') {
      try {
        decodePng(value.content, value.path)
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error))
      }
    }
  }

  if (raw.comments !== undefined) {
    if (!Array.isArray(raw.comments) || !raw.comments.every(isCommentThread)) {
      fail('comments must contain valid local comment threads')
    }
    for (const thread of raw.comments) {
      if (!seen.has(thread.anchor.path)) fail(`comment references a missing file: ${thread.anchor.path}`)
    }
  }
  if (raw.access !== undefined && raw.access !== 'reader') fail('access must be reader when present')
  if (raw.collab !== undefined && !isCollab(raw.collab)) fail('collab contains invalid sharing credentials')
  if (raw.navigation !== undefined && !isNavigationManifest(raw.navigation)) {
    fail('navigation must be a v1 manifest with groups[].{id,title,paths}; fix it or remove the field to continue')
  }
  if (raw.packOptions !== undefined) {
    if (
      !isRecord(raw.packOptions) ||
      !Array.isArray(raw.packOptions.ignore) ||
      raw.packOptions.ignore.some((pattern) => typeof pattern !== 'string')
    ) {
      fail('packOptions.ignore must be an array of strings')
    }
    raw.packOptions.ignore.forEach(normalizeIgnorePattern)
  }
  return raw
}

// ---------------------------------------------------------------------------
// structure preview (mirrors the runtime's category + navigation derivation)
// ---------------------------------------------------------------------------

const UNASSIGNED = '未分类'

const checkpointState = (bundle) => {
  const checkpoints = bundle.checkpoints
  const problems = []
  if (!isRecord(checkpoints) || !Array.isArray(checkpoints.nodes)) return null
  const nodes = checkpoints.nodes.filter(
    (node) =>
      isRecord(node) &&
      isNonEmptyString(node.id) &&
      typeof node.title === 'string' &&
      Array.isArray(node.after) &&
      Array.isArray(node.documents),
  )
  if (!nodes.length) return null
  const ids = new Set()
  for (const node of nodes) {
    if (ids.has(node.id)) problems.push(`duplicate checkpoint node id: ${node.id}`)
    ids.add(node.id)
  }
  for (const node of nodes) {
    for (const predecessor of node.after) {
      if (!ids.has(predecessor)) {
        problems.push(`checkpoint "${node.id}" waits on an unknown predecessor: ${predecessor}`)
      }
    }
  }
  const seenDocuments = new Set()
  for (const node of nodes) {
    for (const document of node.documents) {
      if (!isRecord(document) || !isNonEmptyString(document.path)) {
        problems.push(`checkpoint "${node.id}" has a malformed document entry`)
        continue
      }
      const path = document.path.startsWith(`${bundle.root}/`) ? document.path : `${bundle.root}/${document.path}`
      if (seenDocuments.has(path)) problems.push(`a document belongs to more than one checkpoint: ${path}`)
      seenDocuments.add(path)
    }
  }
  const status = new Map()
  if (Array.isArray(checkpoints.documents)) {
    for (const record of checkpoints.documents) {
      if (isRecord(record) && isNonEmptyString(record.path)) status.set(record.path, record.status)
    }
  }
  // Topological order by `after`, so the preview matches the rendered sidebar.
  const remaining = new Map(nodes.map((node) => [node.id, node]))
  const ordered = []
  const satisfied = new Set()
  while (remaining.size) {
    const ready = [...remaining.values()].filter((node) => node.after.every((id) => satisfied.has(id)))
    if (!ready.length) {
      // A dependency cycle is the only way here; the runtime refuses the whole graph.
      problems.push(`checkpoint graph has a dependency cycle involving: ${[...remaining.keys()].join(', ')}`)
      break
    }
    ready.sort((a, b) => a.id.localeCompare(b.id))
    for (const node of ready) {
      ordered.push(node)
      satisfied.add(node.id)
      remaining.delete(node.id)
    }
  }
  return { nodes: ordered, status, template: typeof checkpoints.template === 'string' ? checkpoints.template : null, problems }
}

/** First-level directory groups, the sidebar's default when no manifest declares any. */
const directoryGroups = (files, rootPath) => {
  const byCategory = new Map()
  for (const file of files) {
    const relative = file.path.slice(rootPath.length + 1)
    const segments = relative.split('/')
    if (segments.length < 2) continue
    const title = segments[0]
    if (!byCategory.has(title)) byCategory.set(title, [])
    byCategory.get(title).push(relative)
  }
  return [...byCategory.entries()].map(([title, paths]) => ({ id: `category-${title}`, title, paths }))
}

const structureOf = (bundle) => {
  const warnings = []
  const paths = new Set(bundle.files.map((file) => file.path))
  const rel = (path) => (path.startsWith(`${bundle.root}/`) ? path.slice(bundle.root.length + 1) : path)
  const checkpoint = checkpointState(bundle)
  const checkpointPaths = new Set()
  const checkpointGroups = []
  if (checkpoint) {
    for (const problem of checkpoint.problems) warnings.push(problem)
    for (const node of checkpoint.nodes) {
      const entries = node.documents.map((document) => {
        const path = document.path.startsWith(`${bundle.root}/`)
          ? document.path
          : `${bundle.root}/${document.path}`
        checkpointPaths.add(path)
        if (!paths.has(path)) {
          warnings.push(`checkpoint "${node.id}" references a document that is not in the bundle: ${path}`)
        }
        return {
          path,
          optional: document.optional === true,
          status: checkpoint.status.get(path) ?? 'todo',
          created: paths.has(path),
        }
      })
      checkpointGroups.push({ id: `checkpoint-${node.id}`, title: node.title, files: entries })
    }
  }

  const manifest = isNavigationManifest(bundle.navigation) ? bundle.navigation : null
  const groups = []
  const assigned = new Set(checkpointPaths)
  if (manifest) {
    for (const group of manifest.groups) {
      const files = []
      for (const raw of group.paths) {
        const path = raw.startsWith(`${bundle.root}/`) ? raw : `${bundle.root}/${raw}`
        if (checkpointPaths.has(path)) {
          warnings.push(`navigation group "${group.title}" lists a checkpoint-owned path: ${path}`)
          continue
        }
        if (!paths.has(path)) {
          warnings.push(`navigation group "${group.title}" lists a path that is not in the bundle: ${path}`)
          continue
        }
        if (assigned.has(path)) {
          warnings.push(`navigation group "${group.title}" lists a path already grouped elsewhere: ${path}`)
          continue
        }
        assigned.add(path)
        files.push(path)
      }
      groups.push({ id: group.id, title: group.title, files })
      if (!files.length) warnings.push(`navigation group "${group.title}" is empty`)
    }
    if (manifest.entry) {
      const entry = manifest.entry.startsWith(`${bundle.root}/`) ? manifest.entry : `${bundle.root}/${manifest.entry}`
      if (!paths.has(entry)) warnings.push(`navigation.entry is not in the bundle: ${entry}`)
    }
  } else {
    for (const group of directoryGroups(bundle.files, bundle.root)) {
      groups.push({ id: group.id, title: group.title, files: group.paths.map((path) => `${bundle.root}/${path}`) })
      for (const path of group.paths) assigned.add(`${bundle.root}/${path}`)
    }
  }

  const unassigned = bundle.files.map((file) => file.path).filter((path) => !assigned.has(path))
  const declaredEntry = manifest?.entry
    ? manifest.entry.startsWith(`${bundle.root}/`)
      ? manifest.entry
      : `${bundle.root}/${manifest.entry}`
    : null
  const markdown = bundle.files.find((file) => /\.md$/i.test(file.path))
  const entry = (declaredEntry && paths.has(declaredEntry) ? declaredEntry : null) ?? markdown?.path ?? bundle.files[0]?.path ?? null

  const comments = bundle.comments ?? []
  const open = comments.filter((thread) => thread.status === 'open')
  for (const thread of comments) {
    if (!paths.has(thread.anchor.path)) {
      warnings.push(`comment ${thread.id} anchors a file that is not in the bundle: ${thread.anchor.path}`)
    }
  }

  return {
    entry,
    entryDeclared: Boolean(declaredEntry),
    checkpointGroups,
    groups,
    unassigned,
    comments: { total: comments.length, open: open.length, resolved: comments.length - open.length, threads: comments.map((thread) => ({ id: thread.id, status: thread.status, path: thread.anchor.path })) },
    warnings,
  }
}

const printStructure = (bundle, structure, lines, extraWarnings = []) => {
  lines.push(`  root: ${bundle.root}`)
  lines.push(`  files: ${bundle.files.length}`)
  lines.push(`  entry: ${structure.entry ?? '(none)'}${structure.entryDeclared ? ' (declared)' : ' (derived)'}`)
  if (structure.checkpointGroups.length) {
    lines.push('  checkpoints:')
    for (const group of structure.checkpointGroups) {
      lines.push(`    ${group.title}`)
      for (const file of group.files) {
        lines.push(`      - ${file.path}${file.created ? '' : ` (not created, ${file.status})`}`)
      }
    }
  }
  if (structure.groups.length) {
    lines.push('  groups:')
    for (const group of structure.groups) {
      lines.push(`    ${group.title}${group.files.length ? '' : ' (empty)'}`)
      for (const path of group.files) lines.push(`      - ${path}`)
    }
  } else {
    lines.push('  groups: (none)')
  }
  if (structure.unassigned.length) {
    lines.push('  unassigned:')
    for (const path of structure.unassigned) lines.push(`    - ${path}`)
  } else {
    lines.push('  unassigned: (none)')
  }
  lines.push(`  comments: ${structure.comments.open} open, ${structure.comments.resolved} resolved`)
  const warnings = [...extraWarnings, ...structure.warnings]
  if (warnings.length) {
    lines.push('  warnings:')
    for (const warning of warnings) lines.push(`    - ${warning}`)
  }
}

// ---------------------------------------------------------------------------
// serialization and atomic write
// ---------------------------------------------------------------------------

const encodeBundle = (bundle) =>
  JSON.stringify(bundle, null, 2).replace(
    /[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )

const embedBundle = (shell, bundle) => {
  if (!DATA_BLOCK.test(shell)) throw new Error('Taco shell does not contain #taco-document')
  const json = encodeBundle(bundle)
  // Callback replacement: `$&`, `` $` ``, `$'` and `$1` inside the JSON are literal.
  const withBundle = shell.replace(
    DATA_BLOCK,
    () => `<script type="application/taco+json" id="taco-document">\n${json}\n</script>`,
  )
  const escapedTitle = `${bundle.title} — Taco`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return SHELL_TITLE.test(withBundle)
    ? withBundle.replace(SHELL_TITLE, () => `<title>${escapedTitle}</title>`)
    : withBundle.replace('</head>', () => `<title>${escapedTitle}</title></head>`)
}

const atomicWrite = async (path, text) => {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  await writeFile(temporary, text, 'utf8')
  try {
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

const readBundleFrom = (html, label) => {
  const match = html.match(DATA_CONTENT)
  if (!match) throw new Error(`${label} has no #taco-document data block`)
  const text = match[2].trim()
  if (!text) throw new Error(`${label} has an empty #taco-document data block; assemble a bundle first`)
  let bundle
  try {
    bundle = JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} has invalid JSON in #taco-document: ${error.message}`)
  }
  return { html, bundle: validateBundle(bundle) }
}

const readBundleFromHtml = async (path) => readBundleFrom(await readFile(path, 'utf8'), resolve(path))

const shellVariantOf = (html) =>
  html.match(/<meta\b(?=[^>]*\bname=["']taco-shell-variant["'])[^>]*>/i)?.[0]?.match(/\bcontent=["'](complete|lite)["']/i)?.[1] ?? 'complete (unmarked)'

const securityVersionOf = (html) =>
  html.match(/<meta\b(?=[^>]*\bname=["']taco-security-version["'])[^>]*>/i)?.[0]?.match(/\bcontent=["']([^"']+)["']/i)?.[1] ?? null

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

const parseArgs = (argv) => {
  const options = new Map()
  const multi = new Map()
  const flags = new Set()
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) {
      positional.push(argument)
      continue
    }
    const name = argument.slice(2)
    if (name === 'dry-run' || name === 'help') {
      flags.add(name)
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`)
    index += 1
    if (name === 'group' || name === 'ignore') {
      if (!multi.has(name)) multi.set(name, [])
      multi.get(name).push(value)
    } else {
      options.set(name, value)
    }
  }
  return { options, multi, flags, positional }
}

const USAGE = `Usage:
  node scripts/pack.mjs --dir <docDir> [--out <name.taco.html>] [--shell <shell.html>]
                        [--title <text>] [--root <relpath>] [--entry <relpath>]
                        [--group <Title>=<relPath,relPath>]... [--ignore <glob>]... [--dry-run]
  node scripts/pack.mjs verify <file.taco.html>`

const pack = async ({ options, multi, flags }) => {
  const dirOption = options.get('dir')
  if (!dirOption) throw new Error(USAGE)
  const featureDir = resolve(dirOption)
  const stats = await stat(featureDir).catch(() => null)
  if (!stats?.isDirectory()) throw new Error(`Document directory not found: ${featureDir}`)

  const rootPath = options.get('root') ?? basename(featureDir)
  if (!isSafeRootPath(rootPath)) throw new Error(`--root is not a safe relative path: ${rootPath}`)

  const outputPath = resolve(options.get('out') ?? join(featureDir, `${portableTitleBase(options.get('title') ?? rootPath)}.taco.html`))
  if (!outputPath.toLowerCase().endsWith('.taco.html')) throw new Error('Output must be a .taco.html file')
  const outputStats = await lstat(outputPath).catch(() => null)
  if (outputStats?.isSymbolicLink()) throw new Error(`Refusing to write Taco through a symbolic link: ${outputPath}`)

  const priorHtml = outputStats ? await readFile(outputPath, 'utf8') : null
  const priorBundle = priorHtml ? readBundleFrom(priorHtml, outputPath).bundle : null
  if (priorBundle && priorBundle.root !== rootPath) {
    throw new Error(`Existing Taco root ${priorBundle.root} does not match ${rootPath}`)
  }
  if (priorBundle && priorBundle.version > FORMAT_VERSION) {
    throw new Error(
      `Existing Taco is taco/files v${priorBundle.version}; this packer writes v${FORMAT_VERSION} and will not downgrade it. Use a tool that understands v${priorBundle.version}`,
    )
  }

  let shell
  let shellSource
  if (options.get('shell')) {
    shellSource = resolve(options.get('shell'))
    shell = await readFile(shellSource, 'utf8').catch(() => {
      throw new Error(`Shell not found: ${shellSource}`)
    })
  } else if (priorHtml) {
    // A refresh reuses the artifact's own shell, so Complete stays Complete and Lite stays Lite.
    shellSource = outputPath
    shell = priorHtml
  } else {
    shellSource = join(import.meta.dirname, '../taco-shell.html')
    shell = await readFile(shellSource, 'utf8').catch(() => {
      throw new Error(`Shell not found: ${shellSource}`)
    })
  }

  const ignorePatterns = (multi.get('ignore')?.length ? multi.get('ignore') : priorBundle?.packOptions?.ignore ?? []).map(
    normalizeIgnorePattern,
  )
  const existingByPath = new Map((priorBundle?.files ?? []).map((file) => [file.path, file]))
  const { files, skipped } = await collectFiles(featureDir, rootPath, existingByPath, ignorePatterns)
  const packWarnings = []
  // A commented source that disappeared keeps its previous entry: the review history still exists
  // and dropping the file would make the bundle's own comments unresolvable.
  const present = new Set(files.map((file) => file.path))
  for (const thread of priorBundle?.comments ?? []) {
    if (present.has(thread.anchor.path)) continue
    const previous = existingByPath.get(thread.anchor.path)
    if (!previous) {
      throw new Error(`comment ${thread.id} anchors ${thread.anchor.path}, which is neither in the directory nor in the previous bundle`)
    }
    files.push(previous)
    present.add(previous.path)
    packWarnings.push(`commented source is gone from the directory; keeping its last known content: ${previous.path}`)
  }
  if (!files.length) throw new Error(`No supported source files found in ${featureDir}`)

  const title = options.get('title') ?? priorBundle?.title ?? portableTitleBase(rootPath)
  const expectedStem = portableTitleBase(title)
  if (tacoFileBase(outputPath) !== expectedStem) {
    throw new Error(`Taco title requires filename ${expectedStem}.taco.html, not ${basename(outputPath)}`)
  }

  const knownPaths = new Set(files.map((file) => file.path))
  const groups = buildNavigation(multi.get('group') ?? [], rootPath, knownPaths)
  let entry
  const declaredEntry = options.get('entry')
  if (declaredEntry) {
    const path = declaredEntry.startsWith(`${rootPath}/`) ? declaredEntry : `${rootPath}/${declaredEntry}`
    if (!knownPaths.has(path)) throw new Error(`--entry is not in the bundle: ${path}`)
    entry = path.slice(rootPath.length + 1)
  }

  const bundle = {
    // Preserve every stored field (docId, comments, checkpoints, access, collab,
    // packOptions, unknown fields) and replace only what this run owns.
    ...(priorBundle ?? {}),
    format: FORMAT,
    version: FORMAT_VERSION,
    docId: priorBundle?.docId ?? randomUUID(),
    title,
    root: rootPath,
    files,
    packOptions: { ignore: ignorePatterns },
  }
  const priorManifest = priorBundle?.navigation
  if (groups.length) {
    bundle.navigation = { version: 1, ...(entry ? { entry } : {}), groups }
  } else if (entry) {
    // An entry lives in the manifest, and a manifest suppresses directory grouping. Freeze the
    // groups the sidebar already shows so asking for an entry does not reshuffle the document.
    bundle.navigation = {
      version: 1,
      entry,
      groups: priorManifest?.groups?.length ? priorManifest.groups : directoryGroups(files, rootPath),
    }
  } else if (priorManifest) {
    bundle.navigation = priorManifest
  }

  validateBundle(bundle)
  const structure = structureOf(bundle)
  const lines = [`taco pack${flags.has('dry-run') ? ' (dry run)' : ''}: ${outputPath}`]
  lines.push(`  shell: ${shellVariantOf(shell)} (from ${shellSource})`)
  lines.push(`  title: ${bundle.title}`)
  lines.push(`  docId: ${bundle.docId}${priorBundle?.docId ? ' (preserved)' : ' (new)'}`)
  printStructure(bundle, structure, lines, packWarnings)
  if (skipped.length) {
    lines.push('  excluded:')
    for (const item of skipped) lines.push(`    - ${item.path} (${item.reason})`)
  }
  if (priorBundle) {
    const unknownFields = Object.keys(priorBundle).filter((key) => !KNOWN_BUNDLE_FIELDS.has(key)).length
    lines.push(
      `  preserved from the previous Taco: docId, ${priorBundle.comments?.length ?? 0} comment thread(s), ` +
        `${priorBundle.checkpoints ? 'checkpoint graph and status table, ' : ''}${unknownFields} unknown field(s)`,
    )
  }

  if (!flags.has('dry-run')) {
    await atomicWrite(outputPath, embedBundle(shell, bundle))
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

const verify = async (path) => {
  const { html, bundle } = await readBundleFromHtml(resolve(path))
  const structure = structureOf(bundle)
  const lines = [`taco verify: ${resolve(path)}`]
  lines.push(`  shell: ${shellVariantOf(html)}  security: ${securityVersionOf(html) ?? 'unknown'}`)
  lines.push(`  title: ${bundle.title}`)
  lines.push(`  docId: ${bundle.docId}`)
  printStructure(bundle, structure, lines)
  process.stdout.write(`${lines.join('\n')}\n`)
  if (structure.warnings.length) process.exitCode = 2
}

const main = async () => {
  const argv = process.argv.slice(2)
  if (argv[0] === 'verify') {
    if (!argv[1]) throw new Error(USAGE)
    return verify(argv[1])
  }
  const parsed = parseArgs(argv)
  if (parsed.flags.has('help') || (!parsed.options.has('dir') && !parsed.positional.length)) {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  return pack(parsed)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
