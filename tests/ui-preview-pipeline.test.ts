// @vitest-environment node

import { linkSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  evaluatePreviewDecision,
  shouldTriggerFromLabels,
  shouldTriggerFromPaths,
} from '../.github/workflows/scripts/detect-preview-paths.mjs'
import {
  generatePreviewBlockMarkdown,
  MARKER_END,
  MARKER_START,
  PrBodyMarkerError,
  updatePrBodyWithBlock,
  validateMarkers,
} from '../.github/workflows/scripts/update-pr-body.mjs'
import {
  assertCleanChunks,
  parsePngIhdr,
  PngValidationError,
  validateDirectory,
  validateSinglePng,
} from '../.github/workflows/scripts/validate-preview-png.mjs'
import { FIXED_VIEWS, previewAssetPath } from '../.github/workflows/scripts/view-registry.mjs'
import { captureViews } from '../.github/workflows/scripts/capture-preview.mjs'
import {
  ensureAssetsBranch,
  GitHubApiError,
  runPublisher,
} from '../.github/workflows/scripts/publish-preview.mjs'

const HEAD_SHA = '438d0844c07649feab04e738ef63c7bff8294660'
const REPO = 'Arcadia822/taco'
const ASSETS_SHA = 'e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4'
const fixtures: string[] = []

beforeEach(() => {
  process.env.GITHUB_TOKEN = 'test-token'
  process.env.GITHUB_REPOSITORY = REPO
  process.env.PR_NUMBER = '119'
  process.env.HEAD_SHA = HEAD_SHA
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.ARTIFACTS_DIR
  while (fixtures.length > 0) rmSync(fixtures.pop() as string, { recursive: true, force: true })
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  fixtures.push(dir)
  return dir
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  chunk.write(type, 4, 4, 'ascii')
  data.copy(chunk, 8)
  chunk.writeUInt32BE(0, 8 + data.length)
  return chunk
}

/**
 * Structurally clean PNG. The validator never decodes pixels, so the IDAT
 * payload is filler; it only has to be a well-formed PNG container.
 */
function cleanPng(width: number, height: number, colorType = 2): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)
  ihdr.writeUInt8(colorType, 9)
  ihdr.writeUInt8(0, 10)
  ihdr.writeUInt8(0, 11)
  ihdr.writeUInt8(0, 12)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', Buffer.alloc(24, 0x78)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function writeArtifactSet(dir: string, colorType = 2): void {
  mkdirSync(dir, { recursive: true })
  for (const view of FIXED_VIEWS) {
    writeFileSync(
      join(dir, view.filename),
      cleanPng(view.viewport.width, view.viewport.height, colorType),
    )
  }
}

/** Reads a field off an unvalidated JSON payload without widening to `any`. */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected a JSON object payload, received ${typeof value}`)
  }
  return value as Record<string, unknown>
}

function asList(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('expected a JSON array payload')
  return value
}

interface FetchCall {
  method: string
  path: string
  body: unknown
  url: string
}

type FetchHandler = (call: FetchCall) => { status?: number; body?: unknown }

/** Routes the publisher's REST calls and records exactly what it sent. */
function installFetch(handler: FetchHandler): FetchCall[] {
  const calls: FetchCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = String(input)
      const method = String(init.method ?? 'GET').toUpperCase()
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null
      const call: FetchCall = { method, path: new URL(url).pathname, body, url }
      calls.push(call)

      const result = handler(call)
      const status = result.status ?? 200
      const text = result.body === undefined ? '' : JSON.stringify(result.body)
      return new Response(text, { status, statusText: String(status) })
    }),
  )
  return calls
}

describe('UI Preview: view registry', () => {
  it('pins exactly the four fixed views including both mobile targets', () => {
    expect(FIXED_VIEWS.map((view) => view.id)).toEqual([
      'taco-desktop',
      'taco-mobile',
      'host-desktop',
      'host-mobile',
    ])
    expect(FIXED_VIEWS.map((view) => view.filename)).toEqual([
      'taco-desktop.png',
      'taco-mobile.png',
      'host-desktop.png',
      'host-mobile.png',
    ])
    expect(FIXED_VIEWS.map((view) => view.target)).toEqual(['taco', 'taco', 'host', 'host'])
    expect(
      FIXED_VIEWS.filter((view) => view.viewport.isMobile).map((view) => view.viewport),
    ).toEqual([
      { width: 375, height: 812, isMobile: true, hasTouch: true },
      { width: 375, height: 812, isMobile: true, hasTouch: true },
    ])
  })

  it('derives the published asset path from the view id and the full head sha', () => {
    expect(previewAssetPath(FIXED_VIEWS[0], 119, HEAD_SHA)).toBe(
      `previews/pr-119/taco-desktop-${HEAD_SHA}.png`,
    )
    expect(previewAssetPath(FIXED_VIEWS[3], 119, HEAD_SHA)).toBe(
      `previews/pr-119/host-mobile-${HEAD_SHA}.png`,
    )
  })
})

describe('UI Preview: path and label detection', () => {
  it('triggers on packages/host and specs paths', () => {
    expect(shouldTriggerFromPaths(['packages/host/src/app/page.tsx'])).toBe(true)
    expect(shouldTriggerFromPaths(['specs/018-ui-preview/spec.md'])).toBe(true)
    expect(shouldTriggerFromPaths(['src/model.ts', 'README.md'])).toBe(false)
  })

  it('triggers on the ui-preview label regardless of paths', () => {
    expect(shouldTriggerFromLabels('ui-preview')).toBe(true)
    expect(shouldTriggerFromLabels(['UI-PREVIEW'])).toBe(true)
    expect(shouldTriggerFromLabels(['bug'])).toBe(false)
  })

  it('reports the decision payload the workflow writes to GITHUB_OUTPUT', () => {
    const decision = evaluatePreviewDecision({
      paths: ['specs/018-ui-preview/spec.md'],
      labels: [],
    })
    expect(decision).toMatchObject({
      run_preview: true,
      label_triggered: false,
      paths_triggered: true,
      matched_count: 1,
    })
    expect(evaluatePreviewDecision({ paths: ['README.md'], labels: [] }).run_preview).toBe(false)
  })
})

describe('UI Preview: pull request body markers', () => {
  it('appends the block after two newlines when no markers exist', () => {
    const body = 'Body line one.\nBody line two.  \n'
    expect(updatePrBodyWithBlock(body, 'BLOCK')).toBe(
      `${body}\n\n${MARKER_START}\nBLOCK\n${MARKER_END}\n`,
    )
  })

  it('replaces only the marked region and preserves the rest byte for byte', () => {
    const before = 'Intro that must survive.\n'
    const after = '\nOutro checklist:\n- [x] done'
    const body = `${before}${MARKER_START}\nstale block\n${MARKER_END}${after}`

    expect(updatePrBodyWithBlock(body, 'FRESH')).toBe(
      `${before}${MARKER_START}\nFRESH\n${MARKER_END}${after}`,
    )
  })

  it('rejects zero-sided, duplicated, and inverted markers', () => {
    expect(() => validateMarkers(`only start ${MARKER_START}`)).toThrow(PrBodyMarkerError)
    expect(() => validateMarkers(`${MARKER_END} then ${MARKER_START}`)).toThrow(PrBodyMarkerError)
    expect(() =>
      validateMarkers(`${MARKER_START}a${MARKER_END}${MARKER_START}b${MARKER_END}`),
    ).toThrow(PrBodyMarkerError)
    expect(validateMarkers('plain body').hasBlock).toBe(false)
  })

  it('renders all four raw links at the full head sha', () => {
    const markdown = generatePreviewBlockMarkdown({
      headSha: HEAD_SHA,
      prNumber: 119,
      repo: REPO,
      assetCommitSha: ASSETS_SHA,
      runId: '998877',
      timestamp: '2026-10-10T12:00:00Z',
    })

    const base = `https://raw.githubusercontent.com/${REPO}/${ASSETS_SHA}/previews/pr-119`
    expect(markdown).toContain('### 🌮 UI Preview (commit `438d084`)')
    for (const viewId of ['taco-desktop', 'taco-mobile', 'host-desktop', 'host-mobile']) {
      expect(markdown).toContain(`${base}/${viewId}-${HEAD_SHA}.png`)
    }
    expect(markdown).toContain('[998877](https://github.com/Arcadia822/taco/actions/runs/998877)')
    expect(markdown).toContain('*Updated at 2026-10-10T12:00:00Z for commit `438d084`.')
  })
})

describe('UI Preview: structural PNG validation', () => {
  it('accepts the exact registered set', () => {
    const dir = makeTempDir('taco-preview-ok-')
    writeArtifactSet(dir)

    const result = validateDirectory(dir)

    expect(result.valid).toBe(true)
    expect(result.views.map((view) => view.filename)).toEqual([
      'taco-desktop.png',
      'taco-mobile.png',
      'host-desktop.png',
      'host-mobile.png',
    ])
    expect(result.totalBytes).toBeGreaterThan(0)
  })

  it('rejects a missing view, an extra file, and a dimension mismatch', () => {
    const missing = makeTempDir('taco-preview-missing-')
    writeArtifactSet(missing)
    unlinkSync(join(missing, 'host-mobile.png'))
    expect(() => validateDirectory(missing)).toThrow(
      /Required view screenshot missing: host-mobile\.png/,
    )

    const extra = makeTempDir('taco-preview-extra-')
    writeArtifactSet(extra)
    writeFileSync(join(extra, 'notes.txt'), 'hello')
    expect(() => validateDirectory(extra)).toThrow(
      /Unexpected files in the preview directory: notes\.txt/,
    )

    const wrong = makeTempDir('taco-preview-wrong-')
    writeArtifactSet(wrong)
    writeFileSync(join(wrong, 'host-mobile.png'), cleanPng(800, 600))
    expect(() => validateDirectory(wrong)).toThrow(/Dimension mismatch for host-mobile\.png/)
  })

  it('rejects hard links, ancillary chunks, trailing bytes, and non-RGB layouts', () => {
    const linked = makeTempDir('taco-preview-link-')
    writeArtifactSet(linked)
    unlinkSync(join(linked, 'taco-mobile.png'))
    linkSync(join(linked, 'taco-desktop.png'), join(linked, 'taco-mobile.png'))
    expect(() => validateSinglePng(join(linked, 'taco-desktop.png'), 'taco-desktop.png')).toThrow(
      /hard links/,
    )

    const ancillary = makeTempDir('taco-preview-ancillary-')
    writeArtifactSet(ancillary)
    const base = cleanPng(1280, 800)
    const iend = pngChunk('IEND', Buffer.alloc(0))
    writeFileSync(
      join(ancillary, 'taco-desktop.png'),
      Buffer.concat([
        base.subarray(0, base.length - iend.length),
        pngChunk('tEXt', Buffer.from('k\0v')),
        iend,
      ]),
    )
    expect(() =>
      validateSinglePng(join(ancillary, 'taco-desktop.png'), 'taco-desktop.png'),
    ).toThrow(PngValidationError)

    expect(() =>
      assertCleanChunks(Buffer.concat([cleanPng(1280, 800), Buffer.from('payload')])),
    ).toThrow(/Trailing bytes after IEND/)

    expect(() => parsePngIhdr(cleanPng(1280, 800, 0))).toThrow(/Unsupported PNG layout/)
  })
})

describe('UI Preview: capture driver guards', () => {
  it('requires a taco bundle and a host url before touching Playwright', async () => {
    await expect(captureViews({})).rejects.toThrow(/--taco-file is required/)
    await expect(captureViews({ tacoFile: 'package.json' })).rejects.toThrow(
      /--host-url is required/,
    )
  })

  it('fails loudly when the explicit Playwright module cannot be resolved', async () => {
    await expect(
      captureViews({
        tacoFile: 'package.json',
        hostUrl: 'http://127.0.0.1:4174',
        playwrightModule: '/nonexistent/playwright',
        outDir: makeTempDir('taco-preview-capture-'),
      }),
    ).rejects.toThrow(/Could not resolve the Playwright module/)
  })
})

describe('UI Preview: publisher', () => {
  beforeEach(() => {
    const artifacts = makeTempDir('taco-preview-publish-input-')
    writeArtifactSet(artifacts)
    process.env.ARTIFACTS_DIR = artifacts
  })

  it('skips publication when the pull request head moved', async () => {
    const calls = installFetch(() => ({
      body: { state: 'open', head: { sha: 'other-sha' }, body: '' },
    }))

    const result = await runPublisher()

    expect(result).toEqual({
      skipped: true,
      reason: `pull request head moved: live other-sha, recorded ${HEAD_SHA}`,
    })
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })

  it('does not silently initialize the assets branch on a server error', async () => {
    const calls = installFetch((call) => {
      if (call.path === '/repos/Arcadia822/taco/pulls/119') {
        return { body: { state: 'open', head: { sha: HEAD_SHA }, body: '' } }
      }
      return { status: 500, body: { message: 'boom' } }
    })

    await expect(runPublisher()).rejects.toBeInstanceOf(GitHubApiError)
    expect(calls.some((call) => call.path === '/repos/Arcadia822/taco/git/trees')).toBe(false)
    expect(calls.some((call) => call.path === '/repos/Arcadia822/taco/git/refs')).toBe(false)
  })

  it('bootstraps an absent assets branch with a valid orphan tree', async () => {
    let createdTree: unknown
    let createdCommit: unknown
    installFetch((call) => {
      if (call.path.endsWith('/git/ref/heads/ui-preview-assets')) return { status: 404, body: {} }
      if (call.path.endsWith('/git/trees')) {
        createdTree = call.body
        if (asList(asRecord(call.body).tree).length === 0) {
          return { status: 422, body: { message: 'Invalid tree info' } }
        }
        return { body: { sha: 'initial-tree' } }
      }
      if (call.path.endsWith('/git/commits')) {
        createdCommit = call.body
        return { body: { sha: 'initial-commit' } }
      }
      if (call.path.endsWith('/git/refs')) return { body: {} }
      throw new Error(`Unexpected request: ${call.path}`)
    })

    expect(await ensureAssetsBranch(REPO)).toBe('initial-commit')
    expect(asRecord(createdCommit)).toMatchObject({ tree: 'initial-tree', parents: [] })
    const entries = asList(asRecord(createdTree).tree).map(asRecord)
    expect(entries).toEqual([
      expect.objectContaining({ path: 'README.md', mode: '100644', type: 'blob' }),
    ])
  })

  it('resolves a create-ref race by re-reading the branch that won', async () => {
    let refReads = 0
    const calls = installFetch((call) => {
      if (call.path === '/repos/Arcadia822/taco/pulls/119') {
        return { body: { state: 'open', head: { sha: HEAD_SHA }, body: '' } }
      }
      if (call.path === '/repos/Arcadia822/taco/git/ref/heads/ui-preview-assets') {
        refReads += 1
        return refReads === 1
          ? { status: 404, body: { message: 'Not Found' } }
          : { body: { object: { sha: 'raced-tip' } } }
      }
      if (call.path === '/repos/Arcadia822/taco/git/refs') {
        return { status: 422, body: { message: 'Reference already exists' } }
      }
      if (call.path === '/repos/Arcadia822/taco/git/trees' && call.method === 'POST')
        return { body: { sha: 'tree-sha' } }
      if (call.path === '/repos/Arcadia822/taco/git/commits' && call.method === 'POST')
        return { body: { sha: 'new-commit' } }
      if (call.path === '/repos/Arcadia822/taco/git/commits/raced-tip')
        return { body: { tree: { sha: 'raced-tree' } } }
      if (call.path === '/repos/Arcadia822/taco/git/blobs') return { body: { sha: 'blob-sha' } }
      if (call.path === '/repos/Arcadia822/taco/git/refs/heads/ui-preview-assets')
        return { body: {} }
      return { body: {} }
    })

    const result = await runPublisher()

    expect(refReads).toBe(2)
    expect(result).toEqual({ success: true, assetCommitSha: 'new-commit' })
    expect(calls.some((call) => call.path.endsWith('/git/commits/raced-tip'))).toBe(true)
  })

  it('retries the ref update only when the tip actually moved', async () => {
    let patchAttempts = 0
    const calls = installFetch((call) => {
      if (call.path === '/repos/Arcadia822/taco/pulls/119') {
        return { body: { state: 'open', head: { sha: HEAD_SHA }, body: '' } }
      }
      if (call.path === '/repos/Arcadia822/taco/git/ref/heads/ui-preview-assets') {
        return { body: { object: { sha: patchAttempts === 0 ? 'tip-a' : 'tip-b' } } }
      }
      if (call.path === '/repos/Arcadia822/taco/git/commits/tip-a')
        return { body: { tree: { sha: 'tree-a' } } }
      if (call.path === '/repos/Arcadia822/taco/git/commits/tip-b')
        return { body: { tree: { sha: 'tree-b' } } }
      if (call.path === '/repos/Arcadia822/taco/git/trees') return { body: { sha: 'new-tree' } }
      if (call.path === '/repos/Arcadia822/taco/git/commits')
        return { body: { sha: `commit-${patchAttempts}` } }
      if (call.path === '/repos/Arcadia822/taco/git/blobs') return { body: { sha: 'blob-sha' } }
      if (call.path === '/repos/Arcadia822/taco/git/refs/heads/ui-preview-assets') {
        patchAttempts += 1
        return patchAttempts === 1 ? { status: 409, body: { message: 'conflict' } } : { body: {} }
      }
      return { body: {} }
    })

    expect(await runPublisher()).toEqual({ success: true, assetCommitSha: 'commit-1' })
    expect(patchAttempts).toBe(2)
    expect(calls.filter((call) => call.path.endsWith('/git/commits/tip-b'))).toHaveLength(1)
  })

  it('surfaces a ref conflict when the tip did not move', async () => {
    installFetch((call) => {
      if (call.path === '/repos/Arcadia822/taco/pulls/119') {
        return { body: { state: 'open', head: { sha: HEAD_SHA }, body: '' } }
      }
      if (call.path === '/repos/Arcadia822/taco/git/ref/heads/ui-preview-assets') {
        return { body: { object: { sha: 'tip-a' } } }
      }
      if (call.path === '/repos/Arcadia822/taco/git/commits/tip-a')
        return { body: { tree: { sha: 'tree-a' } } }
      if (call.path === '/repos/Arcadia822/taco/git/trees') return { body: { sha: 'new-tree' } }
      if (call.path === '/repos/Arcadia822/taco/git/commits') return { body: { sha: 'commit-x' } }
      if (call.path === '/repos/Arcadia822/taco/git/blobs') return { body: { sha: 'blob-sha' } }
      if (call.path === '/repos/Arcadia822/taco/git/refs/heads/ui-preview-assets') {
        return { status: 409, body: { message: 'conflict' } }
      }
      return { body: {} }
    })

    await expect(runPublisher()).rejects.toMatchObject({ status: 409 })
  })

  it('writes the four asset blobs, a conventional commit, and the freshly read body', async () => {
    const staleBody = `${MARKER_START}\nstale block text\n${MARKER_END}`
    const currentBody = `Intro paragraph.\n\n${staleBody}\n\nOutro paragraph.\n\nEdited by a human mid-run.\n`

    let pullReads = 0
    const calls = installFetch((call) => {
      if (call.path === '/repos/Arcadia822/taco/pulls/119' && call.method === 'GET') {
        pullReads += 1
        return {
          body: {
            state: 'open',
            head: { sha: HEAD_SHA },
            body: pullReads === 1 ? `${staleBody}\n` : currentBody,
          },
        }
      }
      if (call.path === '/repos/Arcadia822/taco/git/ref/heads/ui-preview-assets') {
        return { body: { object: { sha: 'tip-a' } } }
      }
      if (call.path === '/repos/Arcadia822/taco/git/commits/tip-a')
        return { body: { tree: { sha: 'tree-a' } } }
      if (call.path === '/repos/Arcadia822/taco/git/trees' && call.method === 'POST')
        return { body: { sha: 'composed-tree' } }
      if (call.path === '/repos/Arcadia822/taco/git/blobs') return { body: { sha: 'blob-sha' } }
      if (call.path === '/repos/Arcadia822/taco/git/commits' && call.method === 'POST')
        return { body: { sha: ASSETS_SHA } }
      if (call.path === '/repos/Arcadia822/taco/git/refs/heads/ui-preview-assets')
        return { body: {} }
      if (call.path === '/repos/Arcadia822/taco/pulls/119' && call.method === 'PATCH')
        return { body: {} }
      throw new Error(`unexpected request ${call.method} ${call.path}`)
    })

    expect(await runPublisher()).toEqual({ success: true, assetCommitSha: ASSETS_SHA })

    const treePost = calls.find(
      (call) => call.path.endsWith('/git/trees') && call.method === 'POST',
    )
    const treeBody = asRecord(treePost?.body)
    const treeEntries = asList(treeBody.tree).map((entry) => asRecord(entry))
    expect(treeEntries.map((entry) => entry.path)).toEqual([
      `previews/pr-119/taco-desktop-${HEAD_SHA}.png`,
      `previews/pr-119/taco-mobile-${HEAD_SHA}.png`,
      `previews/pr-119/host-desktop-${HEAD_SHA}.png`,
      `previews/pr-119/host-mobile-${HEAD_SHA}.png`,
    ])
    expect(treeBody.base_tree).toBe('tree-a')
    expect(
      treeEntries.every(
        (entry) => entry.mode === '100644' && entry.type === 'blob' && entry.sha === 'blob-sha',
      ),
    ).toBe(true)

    const refPatch = calls.find(
      (call) => call.path.endsWith('/git/refs/heads/ui-preview-assets') && call.method === 'PATCH',
    )
    expect(refPatch?.body).toEqual({ sha: ASSETS_SHA, force: false })

    const commitPost = calls.find(
      (call) => call.path.endsWith('/git/commits') && call.method === 'POST',
    )
    const commitBody = asRecord(commitPost?.body)
    expect(commitBody.message).toBe('chore(ci): record UI preview assets for #119 at 438d084')
    expect(commitBody.tree).toBe('composed-tree')
    expect(commitBody.parents).toEqual(['tip-a'])

    const bodyPatch = calls.find(
      (call) => call.path.endsWith('/pulls/119') && call.method === 'PATCH',
    )
    const rawPublished = asRecord(bodyPatch?.body).body
    const published = typeof rawPublished === 'string' ? rawPublished : JSON.stringify(rawPublished)
    expect(published).toContain('Intro paragraph.')
    expect(published).toContain('Outro paragraph.')
    expect(published).toContain('Edited by a human mid-run.')
    expect(published).not.toContain('stale block text')
    expect(published).toContain(
      `https://raw.githubusercontent.com/${REPO}/${ASSETS_SHA}/previews/pr-119/host-mobile-${HEAD_SHA}.png`,
    )
    expect(published.match(/<!-- taco:ui-preview:start -->/g)).toHaveLength(1)
    expect(published.match(/<!-- taco:ui-preview:end -->/g)).toHaveLength(1)
  })

  it('skips the body update when the head moves during asset upload', async () => {
    let pullReads = 0
    const calls = installFetch((call) => {
      if (call.path === '/repos/Arcadia822/taco/pulls/119' && call.method === 'GET') {
        pullReads += 1
        return {
          body: {
            state: 'open',
            head: { sha: pullReads === 1 ? HEAD_SHA : 'moved-sha' },
            body: '',
          },
        }
      }
      if (call.path === '/repos/Arcadia822/taco/git/ref/heads/ui-preview-assets') {
        return { body: { object: { sha: 'tip-a' } } }
      }
      if (call.path === '/repos/Arcadia822/taco/git/commits/tip-a')
        return { body: { tree: { sha: 'tree-a' } } }
      if (call.path === '/repos/Arcadia822/taco/git/trees')
        return { body: { sha: 'composed-tree' } }
      if (call.path === '/repos/Arcadia822/taco/git/blobs') return { body: { sha: 'blob-sha' } }
      if (call.path === '/repos/Arcadia822/taco/git/commits') return { body: { sha: ASSETS_SHA } }
      if (call.path === '/repos/Arcadia822/taco/git/refs/heads/ui-preview-assets')
        return { body: {} }
      return { body: {} }
    })

    expect(await runPublisher()).toEqual({
      skipped: true,
      assets: ASSETS_SHA,
      reason: `pull request head moved: live moved-sha, recorded ${HEAD_SHA}`,
    })
    expect(calls.some((call) => call.path.endsWith('/pulls/119') && call.method === 'PATCH')).toBe(
      false,
    )
  })
})
