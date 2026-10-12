// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  embedBundle,
  readBundleFromHtml,
  validateBundle,
  type TacoBundle,
} from '../../../skills/taco/scripts/pack.mjs'
import { runCli } from '../src/runner.ts'

const FIXTURE_TACO = resolve(
  import.meta.dirname,
  '../../../specs/008-taco-host-contract/008-taco-host-contract.taco.html',
)
const FIXTURE_DIR = resolve(import.meta.dirname, '../../../specs/008-taco-host-contract')

describe('comment shape & null anchor safety (Finding 1 & 2)', () => {
  it('verify and inspect on a Taco with an anchor:null open comment exit 0 and report it', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'taco-comment-null-'))
    try {
      const tacoPath = join(tmp, '008-taco-host-contract.taco.html')
      const { html, bundle } = await readBundleFromHtml(FIXTURE_TACO)

      // Saved-comment fixture shape matching tests/model.test.ts ~209-217
      const globalThread = {
        id: 'thread-global-1',
        anchor: null,
        status: 'open' as const,
        messages: [
          {
            id: 'message-1',
            author: 'Reviewer',
            body: 'Overall impression on the whole document.',
            createdAt: '2026-08-10T00:00:00.000Z',
          },
        ],
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-10T00:00:00.000Z',
      }

      bundle.comments = [globalThread]
      const updatedHtml = embedBundle(html, bundle)
      writeFileSync(tacoPath, updatedHtml, 'utf8')

      // 1. Verify exits 0, no warnings about missing anchor file, reports commentCount: 1
      const verifyRes = await runCli(['verify', tacoPath])
      expect(verifyRes.exitCode).toBe(0)
      const verifyData = JSON.parse(verifyRes.stdout!)
      expect(verifyData.schema).toBe('taco-cli-verify/1')
      expect(verifyData.commentCount).toBe(1)
      expect(verifyData.warnings).toEqual([])
      expect(verifyData.lines).toContain('  comments: 1 open, 0 resolved')

      // 2. Inspect exits 0, reports open comment with path: null and no structure warning
      const inspectRes = await runCli(['inspect', tacoPath])
      expect(inspectRes.exitCode).toBe(0)
      const inspectData = JSON.parse(inspectRes.stdout!)
      expect(inspectData.docId).toBe(bundle.docId)
      expect(inspectData.format).toBe('taco/files')
      expect(inspectData.comments.count).toBe(1)
      expect(inspectData.comments.openCount).toBe(1)
      expect(inspectData.comments.resolvedCount).toBe(0)
      expect(inspectData.comments.openComments).toHaveLength(1)
      expect(inspectData.comments.openComments[0]).toMatchObject({
        id: 'thread-global-1',
        path: null,
        contentSnippet: 'Overall impression on the whole document.',
      })
      const structureWarnings = inspectData.diagnostics.filter(
        (d: { kind?: string }) => d.kind === 'structure',
      )
      expect(structureWarnings).toEqual([])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('refresh rejects a handoff snapshot containing {anchor:{path}} without position/quote (VALIDATION_ERROR) and original Taco stays byte-identical', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'taco-comment-bad-anchor-'))
    try {
      const tacoPath = join(tmp, '008-taco-host-contract.taco.html')
      const handoffPath = join(tmp, 'handoff.json')
      const { html, bundle } = await readBundleFromHtml(FIXTURE_TACO)

      writeFileSync(tacoPath, html, 'utf8')
      const originalBytes = readFileSync(tacoPath, 'utf8')

      // Snapshot with incomplete anchor (has path, but missing position and quote)
      const badSnapshot: TacoBundle = {
        ...bundle,
        comments: [
          {
            id: 'thread-incomplete-anchor',
            anchor: {
              path: bundle.files[0].path,
            } as unknown as NonNullable<TacoBundle['comments']>[number]['anchor'],
            status: 'open',
            messages: [
              {
                id: 'msg-1',
                author: 'Reviewer',
                body: 'Should be rejected',
                createdAt: '2026-08-10T00:00:00.000Z',
              },
            ],
            createdAt: '2026-08-10T00:00:00.000Z',
            updatedAt: '2026-08-10T00:00:00.000Z',
          },
        ],
      }

      const handoffPayload = {
        schema: 'taco-local-handoff/1',
        handoffId: 'h-test-1',
        sessionId: 's-test-1',
        docId: bundle.docId,
        baseline: bundle,
        snapshot: badSnapshot,
      }
      writeFileSync(handoffPath, JSON.stringify(handoffPayload, null, 2), 'utf8')

      const res = await runCli([
        'refresh',
        tacoPath,
        '--handoff',
        handoffPath,
        '--dir',
        FIXTURE_DIR,
      ])
      expect(res.exitCode).toBe(2)
      const err = JSON.parse(res.stderr!)
      expect(err.error.code).toBe('VALIDATION_ERROR')
      expect(err.error.message).toContain('comments must contain valid local comment threads')

      // File must be byte-identical
      expect(readFileSync(tacoPath, 'utf8')).toBe(originalBytes)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('refresh rejects snapshot where end == start or quote.exact is empty and leaves Taco byte-identical', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'taco-comment-invalid-anchor-'))
    try {
      const tacoPath = join(tmp, '008-taco-host-contract.taco.html')
      const handoffPath = join(tmp, 'handoff.json')
      const { html, bundle } = await readBundleFromHtml(FIXTURE_TACO)

      writeFileSync(tacoPath, html, 'utf8')
      const originalBytes = readFileSync(tacoPath, 'utf8')

      // 1. end === start
      const endEqualsStartSnapshot: TacoBundle = {
        ...bundle,
        comments: [
          {
            id: 'thread-zero-length',
            anchor: {
              path: bundle.files[0].path,
              position: { start: 10, end: 10 },
              quote: { exact: 'sample', prefix: '', suffix: '' },
            },
            status: 'open',
            messages: [
              {
                id: 'msg-1',
                author: 'Reviewer',
                body: 'zero length anchor',
                createdAt: '2026-08-10T00:00:00.000Z',
              },
            ],
            createdAt: '2026-08-10T00:00:00.000Z',
            updatedAt: '2026-08-10T00:00:00.000Z',
          },
        ],
      }

      writeFileSync(
        handoffPath,
        JSON.stringify({
          schema: 'taco-local-handoff/1',
          handoffId: 'h-1',
          sessionId: 's-1',
          docId: bundle.docId,
          baseline: bundle,
          snapshot: endEqualsStartSnapshot,
        }),
        'utf8',
      )

      const res1 = await runCli([
        'refresh',
        tacoPath,
        '--handoff',
        handoffPath,
        '--dir',
        FIXTURE_DIR,
      ])
      expect(res1.exitCode).toBe(2)
      expect(JSON.parse(res1.stderr!).error.code).toBe('VALIDATION_ERROR')
      expect(readFileSync(tacoPath, 'utf8')).toBe(originalBytes)

      // 2. empty quote.exact
      const emptyQuoteSnapshot: TacoBundle = {
        ...bundle,
        comments: [
          {
            id: 'thread-empty-quote',
            anchor: {
              path: bundle.files[0].path,
              position: { start: 0, end: 5 },
              quote: { exact: '', prefix: '', suffix: '' },
            },
            status: 'open',
            messages: [
              {
                id: 'msg-1',
                author: 'Reviewer',
                body: 'empty quote',
                createdAt: '2026-08-10T00:00:00.000Z',
              },
            ],
            createdAt: '2026-08-10T00:00:00.000Z',
            updatedAt: '2026-08-10T00:00:00.000Z',
          },
        ],
      }

      writeFileSync(
        handoffPath,
        JSON.stringify({
          schema: 'taco-local-handoff/1',
          handoffId: 'h-2',
          sessionId: 's-2',
          docId: bundle.docId,
          baseline: bundle,
          snapshot: emptyQuoteSnapshot,
        }),
        'utf8',
      )

      const res2 = await runCli([
        'refresh',
        tacoPath,
        '--handoff',
        handoffPath,
        '--dir',
        FIXTURE_DIR,
      ])
      expect(res2.exitCode).toBe(2)
      expect(JSON.parse(res2.stderr!).error.code).toBe('VALIDATION_ERROR')
      expect(readFileSync(tacoPath, 'utf8')).toBe(originalBytes)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('browser-shaped full anchor still validates and successfully refreshes Taco', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'taco-comment-valid-anchor-'))
    try {
      const tacoPath = join(tmp, '008-taco-host-contract.taco.html')
      const handoffPath = join(tmp, 'handoff.json')
      const { html, bundle } = await readBundleFromHtml(FIXTURE_TACO)

      writeFileSync(tacoPath, html, 'utf8')

      // Saved-comment fixture shape directly from tests/model.test.ts ~187-201
      const validThread = {
        id: 'thread-browser-valid',
        anchor: {
          path: bundle.files[0].path,
          position: { start: 0, end: 6 },
          quote: { exact: bundle.files[0].content.slice(0, 6), prefix: '', suffix: '' },
          block: { id: 'block-code', type: 'codeBlock' as const, language: 'markdown' },
        },
        status: 'open' as const,
        messages: [
          {
            id: 'msg-valid-1',
            author: 'Reviewer',
            body: 'Valid browser-shaped anchored comment.',
            createdAt: '2026-08-10T00:00:00.000Z',
            updatedAt: '2026-08-11T00:00:00.000Z',
          },
        ],
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
      }

      const validSnapshot: TacoBundle = {
        ...bundle,
        comments: [validThread],
      }

      writeFileSync(
        handoffPath,
        JSON.stringify({
          schema: 'taco-local-handoff/1',
          handoffId: 'h-valid',
          sessionId: 's-valid',
          docId: bundle.docId,
          baseline: bundle,
          snapshot: validSnapshot,
        }),
        'utf8',
      )

      const refreshRes = await runCli([
        'refresh',
        tacoPath,
        '--handoff',
        handoffPath,
        '--dir',
        FIXTURE_DIR,
      ])
      expect(refreshRes.exitCode).toBe(0)
      const refreshData = JSON.parse(refreshRes.stdout!)
      expect(refreshData.schema).toBe('taco-cli-refresh/1')
      expect(refreshData.commentCount).toBe(1)

      // Verify and inspect on refreshed artifact exit 0 and find the anchored comment
      const verifyRes = await runCli(['verify', tacoPath])
      expect(verifyRes.exitCode).toBe(0)
      const verifyData = JSON.parse(verifyRes.stdout!)
      expect(verifyData.commentCount).toBe(1)

      const inspectRes = await runCli(['inspect', tacoPath])
      expect(inspectRes.exitCode).toBe(0)
      const inspectData = JSON.parse(inspectRes.stdout!)
      expect(inspectData.comments.openCount).toBe(1)
      expect(inspectData.comments.openComments[0].path).toBe(bundle.files[0].path)
      expect(inspectData.comments.openComments[0].id).toBe('thread-browser-valid')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('validateBundle directly validates comment thread anchor rules matching src/model.ts', () => {
    const makeBundleWithComment = (comment: unknown): TacoBundle => ({
      format: 'taco/files',
      version: 1,
      docId: 'doc-test',
      title: 'Title',
      root: 'specs/test',
      files: [{ path: 'specs/test/doc.md', mediaType: 'text/markdown', content: '# Hello' }],
      comments: [comment as unknown as NonNullable<TacoBundle['comments']>[number]],
    })

    // 1. null anchor is accepted
    expect(() =>
      validateBundle(
        makeBundleWithComment({
          id: 'th-1',
          anchor: null,
          status: 'open',
          messages: [
            { id: 'm1', author: 'A', body: 'Doc comment', createdAt: '2026-08-10T00:00:00.000Z' },
          ],
          createdAt: '2026-08-10T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:00.000Z',
        }),
      ),
    ).not.toThrow()

    // 2. undefined anchor is rejected
    expect(() =>
      validateBundle(
        makeBundleWithComment({
          id: 'th-2',
          anchor: undefined,
          status: 'open',
          messages: [
            {
              id: 'm1',
              author: 'A',
              body: 'Missing anchor',
              createdAt: '2026-08-10T00:00:00.000Z',
            },
          ],
          createdAt: '2026-08-10T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:00.000Z',
        }),
      ),
    ).toThrow('comments must contain valid local comment threads')

    // 3. anchor missing position/quote is rejected
    expect(() =>
      validateBundle(
        makeBundleWithComment({
          id: 'th-3',
          anchor: { path: 'specs/test/doc.md' },
          status: 'open',
          messages: [
            { id: 'm1', author: 'A', body: 'No pos/quote', createdAt: '2026-08-10T00:00:00.000Z' },
          ],
          createdAt: '2026-08-10T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:00.000Z',
        }),
      ),
    ).toThrow('comments must contain valid local comment threads')

    // 4. anchor with end == start is rejected
    expect(() =>
      validateBundle(
        makeBundleWithComment({
          id: 'th-4',
          anchor: {
            path: 'specs/test/doc.md',
            position: { start: 2, end: 2 },
            quote: { exact: 'abc', prefix: '', suffix: '' },
          },
          status: 'open',
          messages: [
            { id: 'm1', author: 'A', body: 'Zero width', createdAt: '2026-08-10T00:00:00.000Z' },
          ],
          createdAt: '2026-08-10T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:00.000Z',
        }),
      ),
    ).toThrow('comments must contain valid local comment threads')

    // 5. anchor with empty quote.exact is rejected
    expect(() =>
      validateBundle(
        makeBundleWithComment({
          id: 'th-5',
          anchor: {
            path: 'specs/test/doc.md',
            position: { start: 0, end: 3 },
            quote: { exact: '', prefix: '', suffix: '' },
          },
          status: 'open',
          messages: [
            {
              id: 'm1',
              author: 'A',
              body: 'Empty exact quote',
              createdAt: '2026-08-10T00:00:00.000Z',
            },
          ],
          createdAt: '2026-08-10T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:00.000Z',
        }),
      ),
    ).toThrow('comments must contain valid local comment threads')

    // 6. anchor with invalid block type is rejected
    expect(() =>
      validateBundle(
        makeBundleWithComment({
          id: 'th-6',
          anchor: {
            path: 'specs/test/doc.md',
            position: { start: 0, end: 3 },
            quote: { exact: 'Hel', prefix: '', suffix: '' },
            block: { id: 'b1', type: 'paragraph', language: 'markdown' },
          },
          status: 'open',
          messages: [
            {
              id: 'm1',
              author: 'A',
              body: 'Bad block type',
              createdAt: '2026-08-10T00:00:00.000Z',
            },
          ],
          createdAt: '2026-08-10T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:00.000Z',
        }),
      ),
    ).toThrow('comments must contain valid local comment threads')

    // 7. full browser-shaped anchor is accepted
    expect(() =>
      validateBundle(
        makeBundleWithComment({
          id: 'th-7',
          anchor: {
            path: 'specs/test/doc.md',
            position: { start: 0, end: 3 },
            quote: { exact: 'Hel', prefix: '', suffix: '' },
            block: { id: 'b1', type: 'codeBlock', language: 'markdown' },
          },
          status: 'open',
          messages: [
            { id: 'm1', author: 'A', body: 'Valid anchor', createdAt: '2026-08-10T00:00:00.000Z' },
          ],
          createdAt: '2026-08-10T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:00.000Z',
        }),
      ),
    ).not.toThrow()
  })
})
