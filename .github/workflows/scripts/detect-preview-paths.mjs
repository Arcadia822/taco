#!/usr/bin/env node

/**
 * detect-preview-paths.mjs
 *
 * Deterministic, trusted detection of whether a pull request requires UI preview
 * capture: the `ui-preview` label, or changed paths under `packages/host/` or
 * `specs/`.
 *
 * Usage:
 *   node detect-preview-paths.mjs [--target <ref>] [--labels <comma-separated>] [--json] [--outfile <path>]
 */

import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const PREVIEW_TRIGGER_PREFIXES = ['packages/host/', 'specs/']
const PREVIEW_LABEL = 'ui-preview'

function runGit(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    return ''
  }
}

export function shouldTriggerFromPaths(paths) {
  if (!Array.isArray(paths)) return false
  return paths.some((filePath) => {
    const normalized = filePath.replace(/\\/g, '/').trim()
    return PREVIEW_TRIGGER_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  })
}

export function shouldTriggerFromLabels(labels) {
  if (!labels) return false
  const list = Array.isArray(labels) ? labels : String(labels).split(',')
  return list.some((label) => label.trim().toLowerCase() === PREVIEW_LABEL)
}

export function evaluatePreviewDecision({ paths = [], labels = [] }) {
  const labelTriggered = shouldTriggerFromLabels(labels)
  const pathsTriggered = shouldTriggerFromPaths(paths)
  const matchedPaths = paths.filter((p) =>
    PREVIEW_TRIGGER_PREFIXES.some((prefix) => p.replace(/\\/g, '/').startsWith(prefix)),
  )

  return {
    run_preview: labelTriggered || pathsTriggered,
    label_triggered: labelTriggered,
    paths_triggered: pathsTriggered,
    matched_count: matchedPaths.length,
    matched_paths: matchedPaths,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  let targetRef = 'origin/main'
  let labelsArg = ''
  let jsonOutput = false
  let outputFile = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) {
      targetRef = args[++i]
    } else if (args[i] === '--labels' && args[i + 1]) {
      labelsArg = args[++i]
    } else if (args[i] === '--json') {
      jsonOutput = true
    } else if (args[i] === '--outfile' && args[i + 1]) {
      outputFile = args[++i]
    }
  }

  let changedFiles = []
  const diffOutput = runGit(`git diff --name-only ${targetRef}...HEAD`)
  if (diffOutput) {
    changedFiles = diffOutput.split('\n').filter(Boolean)
  }

  const decision = evaluatePreviewDecision({
    paths: changedFiles,
    labels: labelsArg ? labelsArg.split(',') : [],
  })

  if (outputFile) {
    writeFileSync(outputFile, JSON.stringify(decision, null, 2), 'utf8')
  }

  if (jsonOutput) {
    console.log(JSON.stringify(decision, null, 2))
  } else {
    console.log(`run_preview=${decision.run_preview}`)
    console.log(`label_triggered=${decision.label_triggered}`)
    console.log(`paths_triggered=${decision.paths_triggered}`)
    console.log(`matched_paths=${decision.matched_count}`)
  }
}
