import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { isSafePath } from '@taco/protocol'
import { decodePng } from '../../../skills/taco/scripts/png.mjs'
import {
  securityVersionOf,
  shellVariantOf,
  structureOf,
  validateBundle,
} from '../../../skills/taco/scripts/pack.mjs'
import type { TacoBundle } from '../../../skills/taco/scripts/pack.mjs'
import {
  bypassSanitize,
  fencedUnits,
  importPayload,
  validateUnit,
} from '../../../skills/taco/scripts/lint-mermaid.mjs'
import { COMPLETE_SHELL_HTML } from './generated/assets.ts'

export interface InspectDiagnostic {
  path?: string
  severity: 'error' | 'warning'
  message: string
  kind?: string
}

export interface InspectCommentInfo {
  id: string
  path: string | null
  line?: number
  contentSnippet: string
}

export interface InspectFileInfo {
  path: string
  mediaType: string
  size: number
}

export interface InspectGroupInfo {
  id: string
  title: string
  files: string[]
}

export interface InspectOutput {
  docId: string
  title: string
  root: string
  format: string
  version: number
  variant: 'complete' | 'lite' | string
  securityVersion: string | null
  entry: string | null
  entryDeclared: boolean
  groups: InspectGroupInfo[]
  unassigned: string[]
  files: {
    count: number
    details: InspectFileInfo[]
  }
  comments: {
    count: number
    openCount: number
    resolvedCount: number
    openComments: InspectCommentInfo[]
  }
  checkpoints: {
    present: boolean
    nodesCount: number
    currentCheckpoint: string | null
    statusDistribution: Record<string, number>
  }
  diagnostics: InspectDiagnostic[]
  credentials?: {
    present: boolean
    paths: string[]
    notice?: string
  }
}

export interface InspectOptions {
  filePath: string
  credentials?: boolean
}

interface BundleStructure {
  entry?: string | null
  entryDeclared?: boolean
  groups?: InspectGroupInfo[]
  unassigned?: string[]
  warnings?: string[]
}

const PAYLOAD_TAG = /<script\b(?=[^>]*\bid=["']taco-asset-mermaid["'])[^>]*>([\s\S]*?)<\/script>/i

interface MermaidParser {
  parse(text: string): Promise<unknown> | unknown
  initialize?(options: unknown): void
}

let cachedInspectMermaidParser: MermaidParser | null = null

async function getTrustedMermaidParser(): Promise<MermaidParser | null> {
  if (cachedInspectMermaidParser) return cachedInspectMermaidParser
  const match = PAYLOAD_TAG.exec(COMPLETE_SHELL_HTML)
  if (!match) return null

  try {
    const decompressed = inflateRawSync(Buffer.from(match[1].trim(), 'base64')).toString('utf8')
    const source = bypassSanitize(decompressed, 'canonical complete shell')
    const api: MermaidParser = await importPayload(source, 'canonical complete shell')
    if (typeof api.initialize === 'function') {
      api.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: 'default',
        flowchart: { htmlLabels: false },
      })
    }
    cachedInspectMermaidParser = api
    return api
  } catch {
    return null
  }
}

export const extractTacoBundleFromHtml = (htmlContent: string): Record<string, unknown> => {
  const match =
    htmlContent.match(/<script\b(?=[^>]*\bid=["']taco-document["'])[^>]*>([\s\S]*?)<\/script>/i) ??
    htmlContent.match(/<script\b[^>]*\bid=["']taco-document["'][^>]*>([\s\S]*?)<\/script>/i)

  if (!match) {
    const error = new Error(
      'Invalid Taco file: missing <script id="taco-document"> container',
    ) as Error & { code: string }
    error.code = 'VALIDATION_ERROR'
    throw error
  }

  const jsonText = match[1].trim()
  try {
    return JSON.parse(jsonText) as Record<string, unknown>
  } catch {
    const error = new Error('Invalid Taco file: JSON parse error in #taco-document') as Error & {
      code: string
    }
    error.code = 'VALIDATION_ERROR'
    throw error
  }
}

const SECRET_KEY_PATTERN =
  /^(token|secret|apiKey|api_key|password|authToken|auth_token|accessToken|access_token|privateKey|deviceKey|roomKey|signingKey|invitationKey)$/i

/** `collab` scalars validated as non-secret by `isCollab`; everything else under it may be key material. */
const NON_SECRET_COLLAB_KEYS: Record<string, true> = {
  role: true,
  on: true,
  v: true,
  exp: true,
}

const SECRET_PATTERNS = [
  /\b(?:sk-[a-zA-Z0-9_-]{20,})\b/g,
  /\b(?:ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{50,})\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
  /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password)\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
]

function collectKnownSecrets(bundle: Record<string, unknown>, rawFiles: unknown[]): Set<string> {
  const secrets = new Set<string>()

  const addSecret = (val: unknown) => {
    if (typeof val === 'string') {
      const trimmed = val.trim()
      if (trimmed.length >= 4) {
        secrets.add(trimmed)
      }
    }
  }

  const scanObj = (obj: unknown, isSecretContext: boolean) => {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      for (const item of obj) {
        scanObj(item, isSecretContext)
      }
      return
    }
    for (const [k, v] of Object.entries(obj)) {
      const isSecretKey =
        isSecretContext || SECRET_KEY_PATTERN.test(k) || k === 'credentials' || k === 'collab'
      if (isSecretKey && typeof v === 'string' && NON_SECRET_COLLAB_KEYS[k] !== true) {
        addSecret(v)
      }
      if (typeof v === 'string') {
        for (const pat of SECRET_PATTERNS) {
          pat.lastIndex = 0
          let m: RegExpExecArray | null
          while ((m = pat.exec(v)) !== null) {
            addSecret(m[1] ?? m[0])
          }
        }
      } else if (typeof v === 'object' && v !== null) {
        scanObj(v, isSecretKey)
      }
    }
  }

  scanObj(bundle, false)

  for (const rawFile of rawFiles) {
    if (
      rawFile &&
      typeof rawFile === 'object' &&
      'content' in rawFile &&
      typeof rawFile.content === 'string'
    ) {
      const content = rawFile.content
      for (const pat of SECRET_PATTERNS) {
        pat.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = pat.exec(content)) !== null) {
          addSecret(m[1] ?? m[0])
        }
      }
    }
  }

  return secrets
}

function redactString(text: string, secrets: Set<string>): string {
  let result = text
  for (const secret of secrets) {
    if (secret && result.includes(secret)) {
      result = result.split(secret).join('[REDACTED]')
    }
  }
  for (const pat of SECRET_PATTERNS) {
    pat.lastIndex = 0
    result = result.replace(pat, '[REDACTED]')
  }
  return result
}

function sanitizeSnippet(text: string, secrets: Set<string>): string {
  // 1. Redact known secrets and patterns on the full string first
  let full = redactString(text, secrets)

  // 2. Truncate to 100 chars
  let snippet = full.slice(0, 100)

  // If cut ended inside [REDACTED], complete it
  const partialRedacted = /\[R(?:E(?:D(?:A(?:C(?:T(?:E(?:D)?)?)?)?)?)?)?$/
  if (partialRedacted.test(snippet)) {
    snippet = snippet.replace(partialRedacted, '[REDACTED]')
  }

  // 3. Ensure a truncated prefix of a known secret can never appear:
  // Redact any substring of length >= 8 that is a prefix of a known secret
  for (const secret of secrets) {
    if (!secret || secret.length < 8) continue
    for (let len = secret.length; len >= 8; len--) {
      const prefix = secret.slice(0, len)
      if (snippet.includes(prefix)) {
        snippet = snippet.split(prefix).join('[REDACTED]')
      }
    }
    // Also redact if snippet ends with a partial secret at the cut boundary
    for (let len = Math.min(secret.length - 1, snippet.length); len >= 4; len--) {
      const prefix = secret.slice(0, len)
      if (snippet.endsWith(prefix)) {
        snippet = snippet.slice(0, snippet.length - len) + '[REDACTED]'
        break
      }
    }
  }

  for (const pat of SECRET_PATTERNS) {
    pat.lastIndex = 0
    snippet = snippet.replace(pat, '[REDACTED]')
  }

  return snippet
}

/** Walk the emitted summary and replace every known secret or pattern match. */
function redactValue(value: unknown, secrets: Set<string>): unknown {
  if (typeof value === 'string') {
    return redactString(value, secrets)
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets))
  }
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      copy[k] = redactValue(v, secrets)
    }
    return copy
  }
  return value
}

/** Freeze the emitted report so later mutation of a returned field cannot alter it. */
function deepFreeze(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  Object.freeze(value)
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === 'object' && !Object.isFrozen(nested)) {
      deepFreeze(nested)
    }
  }
  return value
}

export async function executeInspect(options: InspectOptions): Promise<InspectOutput> {
  let rawHtml: string
  try {
    rawHtml = readFileSync(options.filePath, 'utf8')
  } catch (err) {
    const error = new Error(
      `Failed to read input file '${options.filePath}': ${(err as Error).message}`,
    ) as Error & { code: string }
    error.code = 'LOCAL_IO_ERROR'
    throw error
  }

  const bundle = extractTacoBundleFromHtml(rawHtml)
  const variant = shellVariantOf(rawHtml)
  const securityVersion = securityVersionOf(rawHtml)

  const docId = typeof bundle.docId === 'string' ? bundle.docId : ''
  const title = typeof bundle.title === 'string' ? bundle.title : ''
  const root = typeof bundle.root === 'string' ? bundle.root : '.'
  const format = typeof bundle.format === 'string' ? bundle.format : 'taco/files'
  const version = typeof bundle.version === 'number' ? bundle.version : 1

  const rawFiles: unknown[] = Array.isArray(bundle.files) ? bundle.files : []
  const knownSecrets = collectKnownSecrets(bundle, rawFiles)
  const fileDetails: InspectFileInfo[] = []
  const fileContentMap = new Map<string, string>()
  const diagnostics: InspectDiagnostic[] = []

  for (const rawFile of rawFiles) {
    if (rawFile && typeof rawFile === 'object') {
      const filePath = 'path' in rawFile && typeof rawFile.path === 'string' ? rawFile.path : ''
      const content =
        'content' in rawFile && typeof rawFile.content === 'string' ? rawFile.content : ''
      const mediaType =
        'mediaType' in rawFile && typeof rawFile.mediaType === 'string'
          ? rawFile.mediaType
          : 'text/plain'

      fileContentMap.set(filePath, content)
      let size = Buffer.byteLength(content, 'utf8')

      if (mediaType === 'image/png' || /\.png$/i.test(filePath)) {
        try {
          const decoded = decodePng(content, filePath)
          size = decoded.byteLength
        } catch (err) {
          const b64Match = content.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/i)
          if (b64Match) {
            size = Math.floor((b64Match[1].length * 3) / 4)
          }
          diagnostics.push({
            path: filePath,
            severity: 'error',
            // `decodePng` reports only the path, never the image bytes.
            message: (err as Error).message.slice(0, 500),
            kind: 'png-validity',
          })
        }
      }

      fileDetails.push({
        path: filePath,
        mediaType,
        size,
      })
    }
  }

  for (const file of fileDetails) {
    if (!isSafePath(file.path)) {
      diagnostics.push({
        path: file.path,
        severity: 'error',
        message: `File path is not safe (traversal or invalid characters): ${file.path}`.slice(
          0,
          500,
        ),
        kind: 'safe-path',
      })
    }
    if (root !== '.' && !file.path.startsWith(`${root}/`)) {
      diagnostics.push({
        path: file.path,
        severity: 'warning',
        message: `File path does not reside within root '${root}': ${file.path}`.slice(0, 500),
        kind: 'safe-path',
      })
    }
  }

  let validatedBundle: TacoBundle | null = null
  try {
    validatedBundle = validateBundle(bundle)
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      message: (err as Error).message.slice(0, 500),
      kind: 'bundle-validation',
    })
  }

  let structure: BundleStructure | null = null
  if (validatedBundle) {
    try {
      // `structureOf` is plain JS declared as an open `{ warnings, [key: string]: unknown }` bag;
      // the concrete fields it returns are the ones read here (pack.mjs `structureOf`).
      structure = structureOf(validatedBundle) as unknown as BundleStructure
      if (Array.isArray(structure.warnings)) {
        for (const warning of structure.warnings) {
          diagnostics.push({
            severity: 'warning',
            message: warning.slice(0, 500),
            kind: 'structure',
          })
        }
      }
    } catch (err) {
      diagnostics.push({
        severity: 'warning',
        message: `Bundle structure analysis warning: ${(err as Error).message}`.slice(0, 500),
        kind: 'structure',
      })
    }
  }

  const groups: InspectGroupInfo[] = structure?.groups ?? []
  const unassigned: string[] = structure?.unassigned ?? fileDetails.map((f) => f.path)
  const entry: string | null =
    structure?.entry ??
    fileDetails.find((file) => /\.md$/i.test(file.path))?.path ??
    fileDetails[0]?.path ??
    null
  const entryDeclared: boolean = Boolean(structure?.entryDeclared)

  const parser = await getTrustedMermaidParser()

  for (const rawFile of rawFiles) {
    if (rawFile && typeof rawFile === 'object') {
      const filePath = 'path' in rawFile && typeof rawFile.path === 'string' ? rawFile.path : ''
      const content =
        'content' in rawFile && typeof rawFile.content === 'string' ? rawFile.content : ''

      const diagramUnits: Array<{ body: string; lineOffset: number }> = []
      if (filePath.toLowerCase().endsWith('.mmd')) {
        diagramUnits.push({ body: content, lineOffset: 0 })
      } else if (/\.(md|markdown)$/i.test(filePath)) {
        const units = fencedUnits(filePath, content)
        for (const u of units) {
          diagramUnits.push({ body: u.body, lineOffset: u.lineOffset })
        }
      }

      for (const unit of diagramUnits) {
        const hasContent = unit.body.replace(/%%[^\n]*/g, '').trim().length > 0
        if (!hasContent) {
          diagnostics.push({
            path: filePath,
            severity: 'warning',
            message: `Empty Mermaid diagram at line ${unit.lineOffset + 1}`,
            kind: 'mermaid-structure',
          })
          continue
        }

        if (!parser) {
          diagnostics.push({
            path: filePath,
            severity: 'error',
            message: 'Mermaid validation is unavailable',
            kind: 'mermaid-unavailable',
          })
          continue
        }

        try {
          const diag = await validateUnit(parser, {
            file: filePath,
            body: unit.body,
            lineOffset: unit.lineOffset,
          })
          if (diag && typeof diag === 'object') {
            const diagLine = 'line' in diag && typeof diag.line === 'number' ? diag.line : undefined
            const line = diagLine !== undefined ? diagLine + unit.lineOffset : unit.lineOffset + 1
            const detailStr =
              'detail' in diag && typeof diag.detail === 'string' ? diag.detail : undefined
            const msgStr =
              'message' in diag && typeof diag.message === 'string' ? diag.message : undefined
            const detailMsg = detailStr || msgStr || 'Syntax error'
            diagnostics.push({
              path: filePath,
              severity: 'error',
              message: `Mermaid parser diagnostic at line ${line}: ${detailMsg}`.slice(0, 500),
              kind: 'mermaid-syntax',
            })
          }
        } catch (err) {
          diagnostics.push({
            path: filePath,
            severity: 'error',
            message:
              `Mermaid parser diagnostic at line ${unit.lineOffset + 1}: ${(err as Error).message || String(err)}`.slice(
                0,
                500,
              ),
            kind: 'mermaid-syntax',
          })
        }
      }
    }
  }

  const rawComments: unknown[] = Array.isArray(bundle.comments) ? bundle.comments : []
  let openCount = 0
  let resolvedCount = 0
  const openComments: InspectCommentInfo[] = []

  for (const rawThread of rawComments) {
    if (rawThread && typeof rawThread === 'object') {
      const isOpen = 'status' in rawThread && rawThread.status === 'open'
      if (isOpen) {
        openCount++
        const anchor =
          'anchor' in rawThread && rawThread.anchor && typeof rawThread.anchor === 'object'
            ? rawThread.anchor
            : undefined
        const anchorPath =
          anchor && 'path' in anchor && typeof anchor.path === 'string' ? anchor.path : null
        let line: number | undefined = undefined

        const pos =
          anchor && 'position' in anchor && anchor.position && typeof anchor.position === 'object'
            ? anchor.position
            : undefined
        const startPos =
          pos && 'start' in pos && typeof pos.start === 'number' ? pos.start : undefined
        if (anchorPath && fileContentMap.has(anchorPath) && typeof startPos === 'number') {
          const fileText = fileContentMap.get(anchorPath)!
          line = fileText.slice(0, Math.min(startPos, fileText.length)).split('\n').length
        }

        const messages: unknown[] =
          'messages' in rawThread && Array.isArray(rawThread.messages) ? rawThread.messages : []
        const first =
          messages.length > 0 && messages[0] && typeof messages[0] === 'object' ? messages[0] : null
        const firstMsg = first && 'body' in first ? String(first.body ?? '') : ''
        const quote =
          anchor && 'quote' in anchor && anchor.quote && typeof anchor.quote === 'object'
            ? anchor.quote
            : undefined
        const quoteExact =
          quote && 'exact' in quote && typeof quote.exact === 'string' ? quote.exact : ''
        const rawSnippet = firstMsg || quoteExact
        const snippet = sanitizeSnippet(rawSnippet, knownSecrets)

        const threadId = 'id' in rawThread ? String(rawThread.id ?? '') : ''
        openComments.push({
          id: threadId,
          path: anchorPath,
          ...(line !== undefined ? { line } : {}),
          contentSnippet: snippet,
        })
      } else {
        resolvedCount++
      }
    }
  }

  const checkpointsState = bundle.checkpoints
  const statusDist: Record<string, number> = {
    todo: 0,
    in_progress: 0,
    complete: 0,
    freeze: 0,
  }
  let nodesCount = 0
  let currentCheckpoint: string | null = null
  const checkpointsPresent = Boolean(checkpointsState && typeof checkpointsState === 'object')

  if (checkpointsPresent && checkpointsState && typeof checkpointsState === 'object') {
    const nodes: unknown[] =
      'nodes' in checkpointsState && Array.isArray(checkpointsState.nodes)
        ? checkpointsState.nodes
        : []
    nodesCount = nodes.length

    const docs: unknown[] =
      'documents' in checkpointsState && Array.isArray(checkpointsState.documents)
        ? checkpointsState.documents
        : []
    for (const rawDoc of docs) {
      if (rawDoc && typeof rawDoc === 'object') {
        const s = 'status' in rawDoc && typeof rawDoc.status === 'string' ? rawDoc.status : 'todo'
        statusDist[s] = (statusDist[s] ?? 0) + 1
      }
    }

    for (const rawNode of nodes) {
      if (rawNode && typeof rawNode === 'object') {
        const nodeId = 'id' in rawNode && typeof rawNode.id === 'string' ? rawNode.id : ''
        const nodeDocs: unknown[] =
          'documents' in rawNode && Array.isArray(rawNode.documents) ? rawNode.documents : []
        const isCompleted =
          nodeDocs.length > 0 &&
          nodeDocs.every((d) => {
            const dPath =
              d && typeof d === 'object' && 'path' in d && typeof d.path === 'string' ? d.path : ''
            const found = docs.find(
              (r) => r && typeof r === 'object' && 'path' in r && r.path === dPath,
            )
            const s =
              found &&
              typeof found === 'object' &&
              'status' in found &&
              typeof found.status === 'string'
                ? found.status
                : null
            return s === 'complete' || s === 'freeze'
          })
        if (!isCompleted && !currentCheckpoint && nodeId) {
          currentCheckpoint = nodeId
        }
      }
    }
    const firstNode = nodes.length > 0 ? nodes[0] : null
    if (!currentCheckpoint && firstNode && typeof firstNode === 'object') {
      currentCheckpoint = 'id' in firstNode ? String(firstNode.id ?? '') : ''
    }
  }

  let credentials: { present: boolean; paths: string[]; notice?: string } | undefined = undefined

  if (options.credentials) {
    const foundPaths: string[] = []

    if (bundle.collab !== undefined && bundle.collab !== null) {
      foundPaths.push('collab')
    }
    if (bundle.access !== undefined && bundle.access !== null) {
      foundPaths.push('access')
    }
    if (bundle.credentials !== undefined && bundle.credentials !== null) {
      foundPaths.push('credentials')
    }
    if (bundle.packOptions !== undefined && bundle.packOptions !== null) {
      const po = bundle.packOptions
      if (typeof po === 'object' && po !== null) {
        if ('token' in po || 'secret' in po || 'apiKey' in po || 'credentials' in po) {
          foundPaths.push('packOptions')
        }
      }
    }

    const checkObjectKeys = (obj: unknown, prefix: string) => {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return
      for (const [k, v] of Object.entries(obj)) {
        const currentPath = prefix ? `${prefix}.${k}` : k
        if (SECRET_KEY_PATTERN.test(k)) {
          foundPaths.push(currentPath)
        } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          checkObjectKeys(v, currentPath)
        }
      }
    }
    checkObjectKeys(bundle, '')

    for (const rawFile of rawFiles) {
      if (rawFile && typeof rawFile === 'object') {
        const filePath = 'path' in rawFile && typeof rawFile.path === 'string' ? rawFile.path : ''
        const content =
          'content' in rawFile && typeof rawFile.content === 'string' ? rawFile.content : ''
        for (const pat of SECRET_PATTERNS) {
          pat.lastIndex = 0
          if (pat.test(content)) {
            foundPaths.push(`files[${filePath}]`)
            break
          }
        }
      }
    }

    const uniquePaths = Array.from(new Set(foundPaths))
    credentials = {
      present: uniquePaths.length > 0,
      paths: uniquePaths,
      notice:
        'Known scanner scans declared collab/access/token fields and common secret patterns without printing values. A negative result does not guarantee arbitrary text contains no secrets.',
    }
  }

  // knownSecrets was collected earlier to sanitize comment snippets safely

  const output: InspectOutput = {
    docId,
    title,
    root,
    format,
    version,
    variant,
    securityVersion,
    entry,
    entryDeclared,
    groups,
    unassigned,
    files: {
      count: fileDetails.length,
      details: fileDetails,
    },
    comments: {
      count: rawComments.length,
      openCount,
      resolvedCount,
      openComments,
    },
    checkpoints: {
      present: checkpointsPresent,
      nodesCount,
      currentCheckpoint,
      statusDistribution: statusDist,
    },
    diagnostics,
    ...(credentials !== undefined ? { credentials } : {}),
  }

  // The walk preserves the output's shape; the cast restores the contract the compiler cannot re-derive.
  return deepFreeze(redactValue(output, knownSecrets)) as InspectOutput
}
