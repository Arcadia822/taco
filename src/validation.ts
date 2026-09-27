// SPDX-License-Identifier: MIT
// Document integrity checks the runtime can answer without guessing: identity,
// comment anchor fidelity, cross-document links, navigation and Checkpoint
// consistency. Text-backed and render-backed findings share one shape so a
// reviewer (or an agent in the console) gets one report instead of several.

import { resolveCheckpoints } from '@taco/protocol'
import { isInternalFile, type TacoBundle } from './model.ts'
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
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

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
  const target = raw.replace(/\\/g, '/').trim()
  if (!target || target.startsWith('#') || target.startsWith('//') || HAS_SCHEME.test(target)) return null
  if (target.startsWith('/')) return null
  return target.split('#')[0] || null
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
    const file = filesByPath.get(thread.anchor.path)
    if (!file) {
      push('comment-anchor-missing-file', 'error', `comment ${thread.id} anchors a file that is not in the bundle`, thread.anchor.path)
      continue
    }
    if (file.mediaType === 'image/png') continue
    const { start, end } = thread.anchor.position
    const quoted = thread.anchor.quote.exact
    if (file.content.slice(start, end) === quoted) continue
    if (file.content.includes(quoted)) {
      push('comment-anchor-drifted', 'warning', `comment ${thread.id} still quotes "${quoted.slice(0, 40)}" but its position moved; re-anchor it`, file.path)
    } else {
      push('comment-anchor-stale', 'warning', `comment ${thread.id} quotes text that is no longer in the file: "${quoted.slice(0, 40)}"`, file.path)
    }
  }

  const checkpoints = resolveCheckpoints(bundle)
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
      let members = 0
      for (const raw of group.paths) {
        const path = raw.startsWith(`${bundle.root}/`) ? raw : `${bundle.root}/${raw}`
        if (!paths.has(path)) {
          push('navigation-path-missing', 'warning', `navigation group "${group.title}" lists a path that is not in the bundle: ${path}`, path)
          continue
        }
        members += 1
      }
      if (!members) push('navigation-group-empty', 'warning', `navigation group "${group.title}" has no file in the bundle`)
    }
    if (manifest.entry) {
      const entry = manifest.entry.startsWith(`${bundle.root}/`) ? manifest.entry : `${bundle.root}/${manifest.entry}`
      if (!paths.has(entry)) push('navigation-entry-missing', 'warning', `navigation.entry is not in the bundle: ${entry}`, entry)
    }
  }

  for (const file of bundle.files) {
    if (file.mediaType !== 'text/markdown' || isInternalFile(file.path)) continue
    MARKDOWN_LINK.lastIndex = 0
    for (const match of file.content.matchAll(MARKDOWN_LINK)) {
      const target = linkTarget(match[1])
      if (!target) continue
      const resolved = resolveLink(bundle.root, file.path, target)
      if (!resolved) {
        push('markdown-link-escapes-root', 'warning', `link target leaves the bundle root: ${match[1]}`, file.path)
        continue
      }
      if (!paths.has(resolved)) {
        push('markdown-link-missing', 'warning', `link target is not in the bundle: ${match[1]}`, file.path)
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
