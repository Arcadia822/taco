#!/usr/bin/env node
/**
 * update-pr-body.mjs
 *
 * Insert or replace the demarcated UI preview block in a pull request body.
 *
 * Guarantees:
 * - Everything outside `<!-- taco:ui-preview:start -->` and
 *   `<!-- taco:ui-preview:end -->` is preserved byte for byte.
 * - Exactly one marker pair is required; zero, one-sided, duplicated, or
 *   inverted markers are rejected instead of being guessed at.
 * - When the block is absent it is appended after two newlines.
 */

import { FIXED_VIEWS, previewAssetPath } from './view-registry.mjs'

export const MARKER_START = '<!-- taco:ui-preview:start -->'
export const MARKER_END = '<!-- taco:ui-preview:end -->'

const TARGET_LABELS = Object.freeze({ taco: 'Complete Taco', host: 'Host / Demo' })

export class PrBodyMarkerError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PrBodyMarkerError'
  }
}

export function validateMarkers(body) {
  if (!body) return { hasBlock: false, startIndex: -1, endIndex: -1 }
  const startCount = body.split(MARKER_START).length - 1
  const endCount = body.split(MARKER_END).length - 1

  if (startCount === 0 && endCount === 0) {
    return { hasBlock: false, startIndex: -1, endIndex: -1 }
  }

  if (startCount !== 1 || endCount !== 1) {
    throw new PrBodyMarkerError(
      `Malformed UI preview markers in the pull request body: ${startCount} start markers and ${endCount} end markers.`,
    )
  }

  const startIndex = body.indexOf(MARKER_START)
  const endIndex = body.indexOf(MARKER_END)
  if (endIndex < startIndex) {
    throw new PrBodyMarkerError(
      'Malformed UI preview markers: the end marker precedes the start marker.',
    )
  }

  return { hasBlock: true, startIndex, endIndex: endIndex + MARKER_END.length }
}

export function updatePrBodyWithBlock(currentBody, blockContent) {
  const safeBody = currentBody ?? ''
  const fullBlock = `${MARKER_START}\n${blockContent.trim()}\n${MARKER_END}`

  const markers = validateMarkers(safeBody)
  if (!markers.hasBlock) {
    if (!safeBody) return fullBlock
    return `${safeBody}\n\n${fullBlock}\n`
  }

  const before = safeBody.slice(0, markers.startIndex)
  const after = safeBody.slice(markers.endIndex)
  return `${before}${fullBlock}${after}`
}

/**
 * Renders the published block from the trusted view registry so the links can
 * never drift from the paths the publisher writes.
 */
export function generatePreviewBlockMarkdown({
  headSha,
  prNumber,
  repo,
  assetCommitSha,
  runId = null,
  timestamp = null,
}) {
  const shortSha = headSha.slice(0, 7)
  const isoTime = timestamp ?? new Date().toISOString()
  const baseUrl = `https://raw.githubusercontent.com/${repo}/${assetCommitSha}`

  const cell = (view) => {
    if (!view) return '-'
    const url = `${baseUrl}/${previewAssetPath(view, prNumber, headSha)}`
    return `[![${view.title}](${url})](${url})`
  }

  const desktopView = FIXED_VIEWS.find((view) => !view.viewport.isMobile)
  const mobileView = FIXED_VIEWS.find((view) => view.viewport.isMobile)
  const rows = new Map()
  for (const view of FIXED_VIEWS) {
    if (!rows.has(view.target)) rows.set(view.target, [])
    rows.get(view.target).push(view)
  }

  const lines = [
    `### 🌮 UI Preview (commit \`${shortSha}\`)`,
    '',
    `| Surface | Desktop (${desktopView.viewport.width}x${desktopView.viewport.height}) | Mobile (${mobileView.viewport.width}x${mobileView.viewport.height}) |`,
    '| :--- | :---: | :---: |',
  ]
  for (const [target, views] of rows) {
    const label = TARGET_LABELS[target] ?? target
    const desktop = views.find((view) => !view.viewport.isMobile)
    const mobile = views.find((view) => view.viewport.isMobile)
    lines.push(`| ${label} | ${cell(desktop)} | ${cell(mobile)} |`)
  }

  let markdown = `${lines.join('\n')}\n\n`
  markdown += `*Updated at ${isoTime} for commit \`${shortSha}\`.`
  markdown += runId
    ? ` Actions run [${runId}](https://github.com/${repo}/actions/runs/${runId})*`
    : '*'

  return markdown
}
