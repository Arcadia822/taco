#!/usr/bin/env node
/**
 * publish-preview.mjs
 *
 * Trusted publisher: it is the only stage allowed to write to the repository, so
 * it works exclusively from the sanitized artifact handed over by the record job
 * and from trusted event metadata. It never executes pull-request code and never
 * decodes an image: `validate-preview-png.mjs` performs structural byte checks
 * only.
 *
 * Required environment:
 *   GITHUB_TOKEN           contents: write, pull-requests: write
 *   GITHUB_REPOSITORY      owner/repo
 *   PR_NUMBER              pull request number
 *   HEAD_SHA               full 40-character head recorded during capture
 *   ARTIFACTS_DIR          directory holding the sanitized screenshots
 *   GITHUB_RUN_ID          optional Actions run id
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateDirectory } from './validate-preview-png.mjs'
import { FIXED_VIEWS, previewAssetPath } from './view-registry.mjs'
import { updatePrBodyWithBlock, generatePreviewBlockMarkdown } from './update-pr-body.mjs'

const GITHUB_API_URL = process.env.GITHUB_API_URL || 'https://api.github.com'
const ASSETS_BRANCH = 'ui-preview-assets'
const REF_CONFLICT_STATUSES = new Set([409, 422])

export class GitHubApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'GitHubApiError'
    this.status = status
  }
}

async function ghFetch(endpoint, options = {}) {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new GitHubApiError('GITHUB_TOKEN environment variable is required', 0)

  const url = endpoint.startsWith('http') ? endpoint : `${GITHUB_API_URL}${endpoint}`
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'taco-ui-preview-publisher',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new GitHubApiError(
      `GitHub API ${response.status} ${response.statusText} for ${url}: ${detail}`,
      response.status,
    )
  }

  const text = await response.text()
  return text ? JSON.parse(text) : null
}

export async function checkLivePrHeadSha(repo, prNumber, expectedHeadSha) {
  const pr = await ghFetch(`/repos/${repo}/pulls/${prNumber}`)
  if (pr.state !== 'open') {
    return { canPublish: false, reason: `pull request #${prNumber} is ${pr.state}` }
  }
  const liveSha = pr.head?.sha
  if (!liveSha || liveSha !== expectedHeadSha) {
    return {
      canPublish: false,
      reason: `pull request head moved: live ${liveSha}, recorded ${expectedHeadSha}`,
    }
  }
  return { canPublish: true, body: pr.body ?? '' }
}

async function readAssetsTip(repo) {
  try {
    const ref = await ghFetch(`/repos/${repo}/git/ref/heads/${ASSETS_BRANCH}`)
    return { exists: true, sha: ref.object.sha }
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) return { exists: false, sha: null }
    throw err
  }
}

async function createAssetsBranch(repo) {
  const initialTree = await ghFetch(`/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      tree: [
        {
          path: 'README.md',
          mode: '100644',
          type: 'blob',
          content:
            '# UI preview assets\n\nGenerated sanitized screenshots for pull request previews.\n',
        },
      ],
    }),
  })
  const initialCommit = await ghFetch(`/repos/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: 'chore(ci): initialize the ui-preview-assets branch',
      tree: initialTree.sha,
      parents: [],
    }),
  })

  try {
    await ghFetch(`/repos/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${ASSETS_BRANCH}`, sha: initialCommit.sha }),
    })
    return initialCommit.sha
  } catch (err) {
    if (err instanceof GitHubApiError && REF_CONFLICT_STATUSES.has(err.status)) {
      const raced = await readAssetsTip(repo)
      if (raced.exists) return raced.sha
    }
    throw err
  }
}

export async function ensureAssetsBranch(repo) {
  const tip = await readAssetsTip(repo)
  if (tip.exists) return tip.sha
  return await createAssetsBranch(repo)
}

async function createBlobs(repo, artifactsDir, prNumber, headSha) {
  const tree = []
  for (const view of FIXED_VIEWS) {
    const content = readFileSync(join(artifactsDir, view.filename)).toString('base64')
    const blob = await ghFetch(`/repos/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content, encoding: 'base64' }),
    })
    tree.push({
      path: previewAssetPath(view, prNumber, headSha),
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    })
  }
  return tree
}

export async function uploadAssetsAndCommit({
  repo,
  prNumber,
  headSha,
  artifactsDir,
  maxAttempts = 4,
}) {
  const dir = resolve(artifactsDir)
  const tree = await createBlobs(repo, dir, prNumber, headSha)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const parentSha = await ensureAssetsBranch(repo)
    const parentCommit = await ghFetch(`/repos/${repo}/git/commits/${parentSha}`)
    const newTree = await ghFetch(`/repos/${repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree }),
    })
    const newCommit = await ghFetch(`/repos/${repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: `chore(ci): record UI preview assets for #${prNumber} at ${headSha.slice(0, 7)}`,
        tree: newTree.sha,
        parents: [parentSha],
      }),
    })

    try {
      await ghFetch(`/repos/${repo}/git/refs/heads/${ASSETS_BRANCH}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: newCommit.sha, force: false }),
      })
      return newCommit.sha
    } catch (err) {
      const isConflict = err instanceof GitHubApiError && REF_CONFLICT_STATUSES.has(err.status)
      if (!isConflict || attempt === maxAttempts) throw err

      const current = await readAssetsTip(repo)
      if (!current.exists || current.sha === parentSha) {
        // The ref did not actually move, so this is not an optimistic-concurrency
        // race; surface the original failure instead of looping on it.
        throw err
      }
    }
  }

  throw new GitHubApiError(`${ASSETS_BRANCH} stayed contested after ${maxAttempts} attempts`, 409)
}

export async function updatePrDescription({
  repo,
  prNumber,
  headSha,
  assetCommitSha,
  currentBody,
  runId,
}) {
  const block = generatePreviewBlockMarkdown({ headSha, prNumber, repo, assetCommitSha, runId })
  await ghFetch(`/repos/${repo}/pulls/${prNumber}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: updatePrBodyWithBlock(currentBody, block) }),
  })
}

export async function runPublisher() {
  const repo = process.env.GITHUB_REPOSITORY
  const prNumber = process.env.PR_NUMBER
  const headSha = process.env.HEAD_SHA
  const artifactsDir = process.env.ARTIFACTS_DIR || './artifacts/previews'
  const runId = process.env.GITHUB_RUN_ID || null

  if (!repo || !prNumber || !headSha) {
    throw new Error('GITHUB_REPOSITORY, PR_NUMBER and HEAD_SHA are required')
  }

  const initial = await checkLivePrHeadSha(repo, prNumber, headSha)
  if (!initial.canPublish) return { skipped: true, reason: initial.reason }

  validateDirectory(artifactsDir)

  const assetCommitSha = await uploadAssetsAndCommit({ repo, prNumber, headSha, artifactsDir })

  // The capture can run for minutes and the body can change at any time. Re-read
  // identity and body immediately before mutating so a human edit made during
  // publication is preserved rather than clobbered by a stale snapshot.
  const beforePatch = await checkLivePrHeadSha(repo, prNumber, headSha)
  if (!beforePatch.canPublish) {
    return { skipped: true, assets: assetCommitSha, reason: beforePatch.reason }
  }

  await updatePrDescription({
    repo,
    prNumber,
    headSha,
    assetCommitSha,
    currentBody: beforePatch.body,
    runId,
  })

  return { success: true, assetCommitSha }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublisher()
    .then((result) => {
      if (result?.skipped) {
        console.log(`Publication skipped: ${result.reason}`)
      } else {
        console.log(`Publication complete at assets commit ${result.assetCommitSha}.`)
      }
    })
    .catch((err) => {
      console.error(`Publisher failure: ${err.message}`)
      process.exit(1)
    })
}
