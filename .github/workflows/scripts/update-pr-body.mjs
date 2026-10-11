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

/**
 * Escapes text for general Markdown rendering and disarms reserved HTML markers.
 */
export function sanitizeMarkdownText(text) {
  if (!text) return ''
  return String(text)
    .replace(/<!--\s*taco:ui-preview:start\s*-->/gi, '&lt;!-- taco:ui-preview:start --&gt;')
    .replace(/<!--\s*taco:ui-preview:end\s*-->/gi, '&lt;!-- taco:ui-preview:end --&gt;')
}

/**
 * Escapes text for placement inside a Markdown table cell:
 * Replaces pipe '|' with '\|' and replaces newlines with spaces.
 */
export function sanitizeTableCell(text) {
  if (!text) return ''
  const disarmed = sanitizeMarkdownText(text)
  return disarmed
    .replace(/\r?\n+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .trim()
}

/**
 * Escapes text for placement inside a Markdown image alt attribute:
 * Replaces square brackets '[' and ']' and replaces newlines with spaces.
 */
export function sanitizeImageAlt(text) {
  if (!text) return ''
  const disarmed = sanitizeMarkdownText(text)
  return disarmed
    .replace(/\r?\n+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .trim()
}
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
  const sanitizedBlock = sanitizeMarkdownText(blockContent.trim())
  const fullBlock = `${MARKER_START}\n${sanitizedBlock}\n${MARKER_END}`

  const markers = validateMarkers(safeBody)
  let nextBody
  if (!markers.hasBlock) {
    if (!safeBody) nextBody = fullBlock
    else nextBody = `${safeBody}\n\n${fullBlock}\n`
  } else {
    const before = safeBody.slice(0, markers.startIndex)
    const after = safeBody.slice(markers.endIndex)
    nextBody = `${before}${fullBlock}${after}`
  }

  // Invariant check: The resulting body MUST have exactly one valid marker pair!
  const resultValidation = validateMarkers(nextBody)
  if (!resultValidation.hasBlock) {
    throw new PrBodyMarkerError('Final body does not contain a valid marker pair')
  }

  return nextBody
}

/**
 * Renders the published block from the manifest or fallback fixed views.
 */
export function generatePreviewBlockMarkdown({
  headSha,
  prNumber,
  repo,
  assetCommitSha,
  runId = null,
  timestamp = null,
  manifest = null,
}) {
  const shortSha = headSha.slice(0, 7)
  const isoTime = timestamp ?? new Date().toISOString()
  const baseUrl = `https://raw.githubusercontent.com/${repo}/${assetCommitSha}`

  let markdown = `### 🌮 UI Preview (commit \`${shortSha}\`)\n\n`

  if (manifest) {
    const statusEmoji =
      manifest.status === 'passed' ? '✅' : manifest.status === 'failed' ? '❌' : 'ℹ️'
    markdown += `**Status:** ${statusEmoji} ${manifest.status.toUpperCase()} (${sanitizeMarkdownText(manifest.planSource)})\n`
    markdown += `**Summary:** ${sanitizeMarkdownText(manifest.summary)}\n\n`

    if (manifest.mismatch) {
      markdown += `> ⚠️ **Mismatch:** ${sanitizeMarkdownText(manifest.mismatch)}\n\n`
    }
    if (manifest.unseen) {
      markdown += `> ℹ️ **Unseen:** ${sanitizeMarkdownText(manifest.unseen)}\n\n`
    }

    if (manifest.errors && manifest.errors.length > 0) {
      markdown += `> ❌ **Errors:**\n`
      for (const err of manifest.errors) {
        markdown += `> - ${sanitizeMarkdownText(err)}\n`
      }
      markdown += '\n'
    }

    const hasScreenshots = (manifest.scenes || []).some((s) => (s.screenshots || []).length > 0)
    if (hasScreenshots) {
      markdown += '| Scene | Status | Caption | Preview (Desktop 1280x800) |\n'
      markdown += '| :--- | :---: | :--- | :---: |\n'

      for (const scene of manifest.scenes || []) {
        for (const shot of scene.screenshots || []) {
          const assetPath = `previews/pr-${prNumber}/${shot.filename.replace(/\.png$/, '')}-${headSha}.png`
          const url = `${baseUrl}/${assetPath}`
          const shotStatus = shot.status === 'passed' ? 'Passed' : 'Failed'
          const altText = sanitizeImageAlt(shot.caption || shot.name || 'preview')
          const imgCell = `[![${altText}](${url})](${url})`
          const sceneTitle = sanitizeTableCell(scene.title)
          const shotCaption = sanitizeTableCell(shot.caption || '-')
          markdown += `| **${sceneTitle}** | ${shotStatus} | ${shotCaption} | ${imgCell} |\n`
        }
      }
      markdown += '\n'
    } else {
      markdown += `*No UI preview screenshots were captured for this revision.*\n\n`
    }
  } else {
    // When no manifest is supplied at all (e.g. fixed legacy views test), render registered desktop views
    const cell = (view) => {
      if (!view) return '-'
      const url = `${baseUrl}/${previewAssetPath(view, prNumber, headSha)}`
      return `[![${view.title}](${url})](${url})`
    }

    markdown += '| Surface | Desktop (1280x800) |\n'
    markdown += '| :--- | :---: |\n'
    for (const view of FIXED_VIEWS) {
      const label = TARGET_LABELS[view.target] ?? view.target
      markdown += `| ${label} | ${cell(view)} |\n`
    }
    markdown += '\n'
  }

  markdown += `*Updated at ${isoTime} for commit \`${shortSha}\`.`
  markdown += runId
    ? ` Actions run [${runId}](https://github.com/${repo}/actions/runs/${runId})*`
    : '*'

  return markdown
}
