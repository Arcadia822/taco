// SPDX-License-Identifier: MIT
// Document integrity checks the runtime can answer without guessing: identity,
// comment anchor fidelity, cross-document links, navigation and Checkpoint
// consistency. Text-backed and render-backed findings share one shape so a
// reviewer (or an agent in the console) gets one report instead of several.

import { resolveCheckpoints } from '@taco/protocol'
import { resolveAnchorRange } from './comment-position.ts'
import { isInternalFile, type TacoBundle } from './model.ts'
import { resolveDocumentNavigation } from './navigation.ts'
import { TACO_SECURITY_VERSION, validateTacoSecurity, type SecurityIssueCode } from './security.ts'

export type FindingSeverity = 'error' | 'warning' | 'info'

export interface DocumentFinding {
  code: string
  severity: FindingSeverity
  message: string
  path?: string
}

export interface DocumentValidation {
  ok: boolean
  securityVersion: string
  issues: SecurityIssueCode[]
  findings: DocumentFinding[]
  counts: { error: number; warning: number; info: number }
}

export interface RenderFinding {
  path: string
  message: string
}

const KNOWN_BUNDLE_FIELDS: Record<string, true> = {
  format: true,
  version: true,
  docId: true,
  title: true,
  root: true,
  files: true,
  comments: true,
  navigation: true,
  checkpoints: true,
  access: true,
  collab: true,
  packOptions: true,
}

const MARKDOWN_LINK = /\[[^\]]*\]\(([^()\s]+)(?:\s+"[^"]*")?\)/g
const MARKDOWN_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*(\S+)/gm
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/** Blank out fenced code blocks and inline code spans, where link-shaped text is not a link. */
const stripCode = (content: string): string => {
  const out: string[] = []
  let fence: string | null = null
  for (const line of content.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (marker) {
      if (fence && line.trimStart().startsWith(fence)) fence = null
      else if (!fence) fence = marker[1]
      out.push('')
      continue
    }
    out.push(fence ? '' : line.replace(/`[^`\n]*`/g, ' '))
  }
  return out.join('\n')
}

/** Resolve `target` against the directory of `from`, returning null when it leaves the bundle root. */
const resolveLink = (root: string, from: string, target: string): string | null => {
  const segments = from.slice(root.length + 1).split('/').slice(0, -1)
  for (const part of target.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!segments.length) return null
      segments.pop()
      continue
    }
    segments.push(part)
  }
  return segments.length ? `${root}/${segments.join('/')}` : null
}

const linkTarget = (raw: string): string | null => {
  const withoutFragment = raw.trim().replace(/\\/g, '/').split('#')[0].split('?')[0]
  if (!withoutFragment || withoutFragment.startsWith('//') || HAS_SCHEME.test(withoutFragment)) return null
  if (withoutFragment.startsWith('/')) return null
  try {
    return decodeURIComponent(withoutFragment) || null
  } catch {
    return withoutFragment
  }
}

export function validateDocument(bundle: TacoBundle, renderErrors: readonly RenderFinding[] = []): DocumentValidation {
  const findings: DocumentFinding[] = []
  const push = (code: string, severity: FindingSeverity, message: string, path?: string): void => {
    findings.push({ code, severity, message, ...(path ? { path } : {}) })
  }
  const filesByPath = new Map(bundle.files.map((file) => [file.path, file]))
  const paths = new Set(filesByPath.keys())

  const seenIds = new Map<string, string>()
  for (const file of bundle.files) {
    if (!file.id) continue
    const previous = seenIds.get(file.id)
    if (previous) {
      push('duplicate-file-id', 'error', `file id "${file.id}" is used by both ${previous} and ${file.path}`, file.path)
    } else {
      seenIds.set(file.id, file.path)
    }
  }

  for (const field of Object.keys(bundle)) {
    if (!KNOWN_BUNDLE_FIELDS[field]) {
      push('unknown-bundle-field', 'info', `"${field}" is not a taco/files v1 field and will be preserved unchanged`)
    }
  }

  for (const thread of bundle.comments ?? []) {
    const anchor = thread.anchor
    // A whole-document comment anchors no file, so it has nothing to resolve against.
    if (!anchor) continue
    const file = filesByPath.get(anchor.path)
    if (!file) {
      push('comment-anchor-missing-file', 'error', `comment ${thread.id} anchors a file that is not in the bundle`, anchor.path)
      continue
    }
    if (file.mediaType === 'image/png') continue
    if (!resolveAnchorRange(file.content, anchor)) {
      push('comment-anchor-stale', 'warning', `comment ${thread.id} quotes text that is no longer in the file: "${anchor.quote.exact.slice(0, 40)}"`, file.path)
    }
  }

  const checkpoints = resolveCheckpoints(bundle)
  const navigation = resolveDocumentNavigation(bundle)
  if (!checkpoints.valid) {
    push('checkpoints-invalid', 'warning', `checkpoint graph is not usable: ${checkpoints.error}`)
  } else {
    for (const node of checkpoints.nodes) {
      for (const document of node.documents) {
        if (!document.exists) {
          push('checkpoint-document-missing', 'warning', `checkpoint "${node.id}" expects a document that is not in the bundle: ${document.path}`, document.path)
        }
      }
    }
    for (const document of checkpoints.unlinked) {
      push('checkpoint-status-unlinked', 'warning', `a status record exists for a file no Checkpoint references: ${document.path}`, document.path)
    }
  }

  const manifest = bundle.navigation
  if (manifest) {
    for (const group of manifest.groups) {
      for (const raw of group.paths) {
        const path = raw.startsWith(`${bundle.root}/`) ? raw : `${bundle.root}/${raw}`
        if (!paths.has(path)) {
          push('navigation-path-missing', 'warning', `navigation group "${group.title}" lists a path that is not in the bundle: ${path}`, path)
        }
      }
    }
    if (manifest.entry) {
      const entry = manifest.entry.startsWith(`${bundle.root}/`) ? manifest.entry : `${bundle.root}/${manifest.entry}`
      if (!paths.has(entry)) push('navigation-entry-missing', 'warning', `navigation.entry is not in the bundle: ${entry}`, entry)
    }
  }
  // Emptiness is what the sidebar will show, so ask the resolver rather than counting declared
  // paths: a group whose only member is Checkpoint-owned or claimed by an earlier group is empty.
  for (const warning of navigation.warnings) {
    push(warning.reason, 'warning', `navigation: ${warning.reason} at ${warning.path}`, warning.path)
  }
  for (const group of navigation.groups) {
    if (!group.files.length) push('navigation-group-empty', 'warning', `navigation group "${group.title}" renders empty`)
  }

  for (const file of bundle.files) {
    if (file.mediaType !== 'text/markdown' || isInternalFile(file.path)) continue
    const scannable = stripCode(file.content)
    const targets = [
      ...[...scannable.matchAll(MARKDOWN_LINK)].map((match) => match[1]),
      ...[...scannable.matchAll(MARKDOWN_DEFINITION)].map((match) => match[1]),
    ]
    for (const raw of targets) {
      const target = linkTarget(raw)
      if (!target) continue
      const resolved = resolveLink(bundle.root, file.path, target)
      if (!resolved) {
        push('markdown-link-escapes-root', 'warning', `link target leaves the bundle root: ${raw}`, file.path)
        continue
      }
      if (!paths.has(resolved)) {
        push('markdown-link-missing', 'warning', `link target is not in the bundle: ${raw}`, file.path)
      }
    }
  }

  for (const error of renderErrors) {
    push('render-failed', 'error', error.message, error.path)
  }

  const counts = { error: 0, warning: 0, info: 0 }
  for (const finding of findings) counts[finding.severity] += 1

  const security = validateTacoSecurity(bundle)
  return {
    ok: counts.error === 0 && security.issues.length === 0,
    securityVersion: security.securityVersion || TACO_SECURITY_VERSION,
    issues: security.issues,
    findings,
    counts,
  }
}
