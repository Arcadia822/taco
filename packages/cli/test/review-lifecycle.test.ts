// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/runner.ts'
import { EXIT_CODES } from '../src/errors.ts'
import { COMPLETE_SHELL_HTML } from '../src/generated/assets.ts'
import {
  embedBundle,
  readBundleFromHtml,
  type TacoBundle,
  type TacoFile,
  type TacoCommentThread,
} from '../../../skills/taco/scripts/pack.mjs'

let workDir: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'taco-review-lifecycle-'))
})

afterEach(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true })
  }
})

function makeCommentThread(options: {
  id: string
  path?: string
  status?: 'open' | 'resolved'
  createdAt?: string
  updatedAt?: string
  messages: Array<{
    id: string
    author?: string
    authorId?: string
    body: string
    createdAt?: string
    updatedAt?: string
    deletedAt?: string
  }>
}): TacoCommentThread {
  const createdAt = options.createdAt ?? '2026-10-12T01:00:00.000Z'
  const updatedAt = options.updatedAt ?? createdAt
  const thread: Record<string, unknown> = {
    id: options.id,
    anchor: options.path
      ? {
          path: options.path,
          position: { start: 0, end: 10 },
          quote: { exact: 'first text', prefix: '', suffix: '' },
        }
      : null,
    status: options.status ?? 'open',
    createdAt,
    updatedAt,
    messages: options.messages.map((m) => {
      const msg: Record<string, unknown> = {
        id: m.id,
        author: m.author ?? 'Alice',
        authorId: m.authorId ?? 'user-alice-1',
        body: m.body,
        createdAt: m.createdAt ?? createdAt,
      }
      if (m.updatedAt) msg.updatedAt = m.updatedAt
      if (m.deletedAt) msg.deletedAt = m.deletedAt
      return msg
    }),
  }
  return thread as unknown as TacoCommentThread
}

function createTacoHtml(
  bundle: Partial<TacoBundle> & { docId: string; title: string; files: TacoFile[] },
): string {
  const fullBundle: TacoBundle = {
    format: 'taco/files',
    version: 1,
    root: 'doc',
    ...bundle,
  }
  return embedBundle(COMPLETE_SHELL_HTML, fullBundle)
}

function writeHandoffJson(
  filePath: string,
  baseline: TacoBundle,
  snapshot: TacoBundle,
  docId: string,
): void {
  const payload = {
    schema: 'taco-local-handoff/1',
    handoffId: 'handoff-test-1',
    sessionId: 'session-test-1',
    docId,
    baseline,
    snapshot,
  }
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
}

// inspect cold-loads the embedded Mermaid build: ~4s locally, longer on CI runners.
describe('Review Lifecycle & Safety regression suite', { timeout: 30_000 }, () => {
  it('1. refresh: binds baseline comments and checkpoints to current artifact, rejecting stale review baseline', async () => {
    const docId = 'doc-lifecycle-1'
    const files: TacoFile[] = [
      {
        id: 'file-1',
        path: 'doc/doc.md',
        mediaType: 'text/markdown',
        content: '# Doc Title\nInitial content.',
      },
    ]

    const initialThread = makeCommentThread({
      id: 'thread-1',
      path: 'doc/doc.md',
      status: 'open',
      createdAt: '2026-10-12T01:00:00.000Z',
      updatedAt: '2026-10-12T01:00:00.000Z',
      messages: [
        {
          id: 'msg-1',
          author: 'Alice',
          authorId: 'user-alice-1',
          body: 'Original review question',
          createdAt: '2026-10-12T01:00:00.000Z',
        },
      ],
    })

    const baselineBundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId,
      title: 'Lifecycle Doc',
      root: 'doc',
      files,
      comments: [initialThread],
    }

    // Artifact has moved ahead to round 2 with a reply and resolved status
    const evolvedThread = makeCommentThread({
      id: 'thread-1',
      path: 'doc/doc.md',
      status: 'resolved',
      createdAt: '2026-10-12T01:00:00.000Z',
      updatedAt: '2026-10-12T02:00:00.000Z',
      messages: [
        {
          id: 'msg-1',
          author: 'Alice',
          authorId: 'user-alice-1',
          body: 'Original review question',
          createdAt: '2026-10-12T01:00:00.000Z',
        },
        {
          id: 'msg-2',
          author: 'Bob',
          authorId: 'user-bob-1',
          body: 'Addressed in round 2',
          createdAt: '2026-10-12T02:00:00.000Z',
        },
      ],
    })

    const currentArtifactPath = join(workDir, 'artifact.taco.html')
    writeFileSync(
      currentArtifactPath,
      createTacoHtml({
        docId,
        title: 'Lifecycle Doc',
        root: 'doc',
        files,
        comments: [evolvedThread],
      }),
      'utf8',
    )

    // Canonical source directory with matching content
    const canonicalDir = join(workDir, 'src')
    mkdirSync(canonicalDir, { recursive: true })
    writeFileSync(join(canonicalDir, 'doc.md'), '# Doc Title\nInitial content.', 'utf8')

    // Stale receipt from round 1 (baseline has msg-1 open, snapshot has resolved without msg-2)
    const snapshotBundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId,
      title: 'Lifecycle Doc',
      root: 'doc',
      files,
      comments: [
        makeCommentThread({
          id: 'thread-1',
          path: 'doc/doc.md',
          status: 'resolved',
          createdAt: '2026-10-12T01:00:00.000Z',
          updatedAt: '2026-10-12T01:30:00.000Z',
          messages: [
            {
              id: 'msg-1',
              author: 'Alice',
              authorId: 'user-alice-1',
              body: 'Original review question',
              createdAt: '2026-10-12T01:00:00.000Z',
            },
          ],
        }),
      ],
    }

    const staleHandoffPath = join(workDir, 'stale-handoff.json')
    writeHandoffJson(staleHandoffPath, baselineBundle, snapshotBundle, docId)

    const staleRes = await runCli([
      'refresh',
      currentArtifactPath,
      '--handoff',
      staleHandoffPath,
      '--dir',
      canonicalDir,
    ])

    expect(staleRes.exitCode).toBe(EXIT_CODES.CONFLICT_ERROR)
    const staleErr = JSON.parse(staleRes.stderr!)
    expect(staleErr.error.code).toBe('CONFLICT_ERROR')
    expect(staleErr.error.message).toContain('stale review baseline')

    // Also test checkpoint state drift rejection
    const cpArtifactPath = join(workDir, 'cp-artifact.taco.html')
    writeFileSync(
      cpArtifactPath,
      createTacoHtml({
        docId,
        title: 'Lifecycle Doc',
        root: 'doc',
        files,
        checkpoints: {
          version: 1,
          nodes: [{ id: 'node-1', title: 'Step 1' }],
        },
      }),
      'utf8',
    )

    const staleCpHandoffPath = join(workDir, 'stale-cp-handoff.json')
    const cpBaseline: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId,
      title: 'Lifecycle Doc',
      root: 'doc',
      files,
      checkpoints: { version: 1, nodes: [] },
    }
    writeHandoffJson(staleCpHandoffPath, cpBaseline, cpBaseline, docId)

    const cpRes = await runCli([
      'refresh',
      cpArtifactPath,
      '--handoff',
      staleCpHandoffPath,
      '--dir',
      canonicalDir,
    ])

    expect(cpRes.exitCode).toBe(EXIT_CODES.CONFLICT_ERROR)
    const cpErr = JSON.parse(cpRes.stderr!)
    expect(cpErr.error.code).toBe('CONFLICT_ERROR')
    expect(cpErr.error.message).toContain('stale review baseline')

    // Valid refresh with matching baseline merges snapshot threads + absent original threads
    const thread2 = makeCommentThread({
      id: 'thread-2',
      path: 'doc/doc.md',
      status: 'open',
      createdAt: '2026-10-12T03:00:00.000Z',
      messages: [
        {
          id: 'msg-3',
          body: 'Thread 2 untouched in snapshot',
          createdAt: '2026-10-12T03:00:00.000Z',
        },
      ],
    })

    const matchingBaseline: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId,
      title: 'Lifecycle Doc',
      root: 'doc',
      files,
      comments: [evolvedThread, thread2],
    }

    const updatedSnapshot: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId,
      title: 'Lifecycle Doc',
      root: 'doc',
      files,
      comments: [
        makeCommentThread({
          id: 'thread-1',
          path: 'doc/doc.md',
          status: 'resolved',
          createdAt: '2026-10-12T01:00:00.000Z',
          updatedAt: '2026-10-12T04:00:00.000Z',
          messages: [
            {
              id: 'msg-1',
              author: 'Alice',
              authorId: 'user-alice-1',
              body: 'Original review question',
              createdAt: '2026-10-12T01:00:00.000Z',
            },
            {
              id: 'msg-2',
              author: 'Bob',
              authorId: 'user-bob-1',
              body: 'Addressed in round 2',
              createdAt: '2026-10-12T02:00:00.000Z',
            },
            {
              id: 'msg-4',
              author: 'Alice',
              authorId: 'user-alice-1',
              body: 'Confirmed resolved',
              createdAt: '2026-10-12T04:00:00.000Z',
            },
          ],
        }),
      ],
    }

    const matchingArtifactPath = join(workDir, 'matching-artifact.taco.html')
    writeFileSync(
      matchingArtifactPath,
      createTacoHtml({
        docId,
        title: 'Lifecycle Doc',
        root: 'doc',
        files,
        comments: [evolvedThread, thread2],
      }),
      'utf8',
    )

    const validHandoffPath = join(workDir, 'valid-handoff.json')
    writeHandoffJson(validHandoffPath, matchingBaseline, updatedSnapshot, docId)

    const validRes = await runCli([
      'refresh',
      matchingArtifactPath,
      '--handoff',
      validHandoffPath,
      '--dir',
      canonicalDir,
    ])

    expect(validRes.exitCode).toBe(EXIT_CODES.OK)
    const { bundle: refreshedBundle } = await readBundleFromHtml(matchingArtifactPath)
    expect(refreshedBundle.comments?.length).toBe(2)
    const t1 = refreshedBundle.comments?.find((c) => c.id === 'thread-1')
    const t2 = refreshedBundle.comments?.find((c) => c.id === 'thread-2')
    expect(t1?.messages.length).toBe(3)
    expect(t2?.id).toBe('thread-2')
  })

  it('2. refresh: deletes blocks in handled branch when snapshot omits blocks', async () => {
    const docId = 'doc-blocks-test'
    const origFile: TacoFile = {
      id: 'file-guide',
      path: 'doc/guide.md',
      mediaType: 'text/markdown',
      content: '# Old Guide Text',
      blocks: [{ id: 'b1', type: 'heading', html: '<h1>Old Guide Text</h1>' }],
    }

    const artifactPath = join(workDir, 'guide-artifact.taco.html')
    writeFileSync(
      artifactPath,
      createTacoHtml({
        docId,
        title: 'Guide Doc',
        root: 'doc',
        files: [origFile],
      }),
      'utf8',
    )

    const canonicalDir = join(workDir, 'canonical-guide')
    mkdirSync(canonicalDir, { recursive: true })
    writeFileSync(join(canonicalDir, 'guide.md'), '# New Reviewed Guide Text', 'utf8')

    const baselineBundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId,
      title: 'Guide Doc',
      root: 'doc',
      files: [
        {
          id: 'file-guide',
          path: 'doc/guide.md',
          mediaType: 'text/markdown',
          content: '# Old Guide Text',
        },
      ],
    }

    // Snapshot has new content but NO blocks property
    const snapshotBundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId,
      title: 'Guide Doc',
      root: 'doc',
      files: [
        {
          id: 'file-guide',
          path: 'doc/guide.md',
          mediaType: 'text/markdown',
          content: '# New Reviewed Guide Text',
        },
      ],
    }

    const handoffPath = join(workDir, 'guide-handoff.json')
    writeHandoffJson(handoffPath, baselineBundle, snapshotBundle, docId)

    const res = await runCli([
      'refresh',
      artifactPath,
      '--handoff',
      handoffPath,
      '--dir',
      canonicalDir,
    ])

    expect(res.exitCode).toBe(EXIT_CODES.OK)
    const { bundle: refreshedBundle } = await readBundleFromHtml(artifactPath)
    const file = refreshedBundle.files.find((f) => f.path === 'doc/guide.md')
    expect(file?.content).toBe('# New Reviewed Guide Text')
    expect(file?.blocks).toBeUndefined()
  })

  it('3. read-only HTML tampering check pairs baseline and snapshot files by id across rename', async () => {
    const docId = 'doc-html-tamper'
    const originalHtmlFile: TacoFile = {
      id: 'html-id-stable-123',
      path: 'doc/index.html',
      mediaType: 'text/html',
      content: '<h1>Original Readonly HTML</h1>',
    }

    const artifactPath = join(workDir, 'html-artifact.taco.html')
    writeFileSync(
      artifactPath,
      createTacoHtml({
        docId,
        title: 'HTML Doc',
        root: 'doc',
        files: [originalHtmlFile],
      }),
      'utf8',
    )

    const canonicalDir = join(workDir, 'canonical-html')
    mkdirSync(canonicalDir, { recursive: true })
    writeFileSync(join(canonicalDir, 'renamed.html'), '<h1>Tampered Readonly HTML</h1>', 'utf8')

    const baselineBundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId,
      title: 'HTML Doc',
      root: 'doc',
      files: [originalHtmlFile],
    }

    // Snapshot renames the HTML file under same id and changes content
    const tamperedSnapshotBundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId,
      title: 'HTML Doc',
      root: 'doc',
      files: [
        {
          id: 'html-id-stable-123',
          path: 'doc/renamed.html',
          mediaType: 'text/html',
          content: '<h1>Tampered Readonly HTML</h1>',
        },
      ],
    }

    const handoffPath = join(workDir, 'tampered-html-handoff.json')
    writeHandoffJson(handoffPath, baselineBundle, tamperedSnapshotBundle, docId)

    // A. refresh detects rename + content tampering
    const refreshRes = await runCli([
      'refresh',
      artifactPath,
      '--handoff',
      handoffPath,
      '--dir',
      canonicalDir,
    ])

    expect(refreshRes.exitCode).toBe(EXIT_CODES.CONFLICT_ERROR)
    const refreshErr = JSON.parse(refreshRes.stderr!)
    expect(refreshErr.error.code).toBe('CONFLICT_ERROR')
    expect(refreshErr.error.message).toContain('Tampering detected')

    // B. diff (taco-vs-handoff) detects rename + content tampering
    const diffHandoffRes = await runCli(['diff', artifactPath, '--handoff', handoffPath])
    expect(diffHandoffRes.exitCode).toBe(EXIT_CODES.CONFLICT_ERROR)
    const diffHandoffErr = JSON.parse(diffHandoffRes.stderr!)
    expect(diffHandoffErr.error.code).toBe('CONFLICT_ERROR')
    expect(diffHandoffErr.error.message).toContain('Tampering detected')

    // C. diff (handoff-vs-dir) detects rename + content tampering
    const diffDirRes = await runCli(['diff', '--handoff', handoffPath, '--dir', canonicalDir])
    expect(diffDirRes.exitCode).toBe(EXIT_CODES.CONFLICT_ERROR)
    const diffDirErr = JSON.parse(diffDirRes.stderr!)
    expect(diffDirErr.error.code).toBe('CONFLICT_ERROR')
    expect(diffDirErr.error.message).toContain('Tampering detected')

    // Pure rename with unchanged content remains allowed
    const pureRenameSnapshot: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId,
      title: 'HTML Doc',
      root: 'doc',
      files: [
        {
          id: 'html-id-stable-123',
          path: 'doc/renamed.html',
          mediaType: 'text/html',
          content: '<h1>Original Readonly HTML</h1>',
        },
      ],
    }
    const pureRenameHandoff = join(workDir, 'pure-rename-handoff.json')
    writeHandoffJson(pureRenameHandoff, baselineBundle, pureRenameSnapshot, docId)
    writeFileSync(join(canonicalDir, 'renamed.html'), '<h1>Original Readonly HTML</h1>', 'utf8')

    const pureRenameRes = await runCli([
      'refresh',
      artifactPath,
      '--handoff',
      pureRenameHandoff,
      '--dir',
      canonicalDir,
    ])
    expect(pureRenameRes.exitCode).toBe(EXIT_CODES.OK)
  })

  it('4. diff: comment change detection compares all messages by id (body, updatedAt, deletedAt) and reports modified', async () => {
    const docId = 'doc-comments-diff'
    const files: TacoFile[] = [
      {
        id: 'f1',
        path: 'doc/readme.txt',
        mediaType: 'text/plain',
        content: 'content',
      },
    ]

    const threadV1 = makeCommentThread({
      id: 'thread-diff-1',
      path: 'doc/readme.txt',
      status: 'open',
      createdAt: '2026-10-12T01:00:00.000Z',
      messages: [
        {
          id: 'm1',
          author: 'Alice',
          authorId: 'u1',
          body: 'First message original',
          createdAt: '2026-10-12T01:00:00.000Z',
        },
        {
          id: 'm2',
          author: 'Bob',
          authorId: 'u2',
          body: 'Second message reply',
          createdAt: '2026-10-12T01:10:00.000Z',
        },
      ],
    })

    // Modify the FIRST message body, while keeping count and last body identical
    const threadV2EditedFirst = makeCommentThread({
      id: 'thread-diff-1',
      path: 'doc/readme.txt',
      status: 'open',
      createdAt: '2026-10-12T01:00:00.000Z',
      messages: [
        {
          id: 'm1',
          author: 'Alice',
          authorId: 'u1',
          body: 'First message EDITED',
          createdAt: '2026-10-12T01:00:00.000Z',
        },
        {
          id: 'm2',
          author: 'Bob',
          authorId: 'u2',
          body: 'Second message reply',
          createdAt: '2026-10-12T01:10:00.000Z',
        },
      ],
    })

    const taco1Path = join(workDir, 'comments-v1.taco.html')
    const taco2Path = join(workDir, 'comments-v2.taco.html')

    writeFileSync(
      taco1Path,
      createTacoHtml({
        docId,
        title: 'Comments Diff',
        root: 'doc',
        files,
        comments: [threadV1],
      }),
      'utf8',
    )

    writeFileSync(
      taco2Path,
      createTacoHtml({
        docId,
        title: 'Comments Diff',
        root: 'doc',
        files,
        comments: [threadV2EditedFirst],
      }),
      'utf8',
    )

    const diffRes = await runCli(['diff', taco1Path, taco2Path])
    expect(diffRes.exitCode).toBe(EXIT_CODES.OK)
    const diffJson = JSON.parse(diffRes.stdout!)
    const commentMod = diffJson.commentChanges?.find(
      (c: { id: string }) => c.id === 'thread-diff-1',
    )
    expect(commentMod).toBeDefined()
    expect(commentMod.changeType).toBe('modified')

    // Also test updating updatedAt on first message
    const threadV3Timestamp = makeCommentThread({
      id: 'thread-diff-1',
      path: 'doc/readme.txt',
      status: 'open',
      createdAt: '2026-10-12T01:00:00.000Z',
      messages: [
        {
          id: 'm1',
          author: 'Alice',
          authorId: 'u1',
          body: 'First message original',
          createdAt: '2026-10-12T01:00:00.000Z',
          updatedAt: '2026-10-12T01:25:00.000Z',
        },
        {
          id: 'm2',
          author: 'Bob',
          authorId: 'u2',
          body: 'Second message reply',
          createdAt: '2026-10-12T01:10:00.000Z',
        },
      ],
    })
    const taco3Path = join(workDir, 'comments-v3.taco.html')
    writeFileSync(
      taco3Path,
      createTacoHtml({
        docId,
        title: 'Comments Diff',
        root: 'doc',
        files,
        comments: [threadV3Timestamp],
      }),
      'utf8',
    )
    const diffResTs = await runCli(['diff', taco1Path, taco3Path])
    expect(diffResTs.exitCode).toBe(EXIT_CODES.OK)
    const diffJsonTs = JSON.parse(diffResTs.stdout!)
    expect(
      diffJsonTs.commentChanges?.some(
        (c: { id: string; changeType: string }) =>
          c.id === 'thread-diff-1' && c.changeType === 'modified',
      ),
    ).toBe(true)
  })

  it('5. diff handoff-vs-dir binds options.source and verifies baseline', async () => {
    const docId = 'doc-handoff-dir-test'
    const files: TacoFile[] = [
      {
        id: 'f1',
        path: 'doc/app.txt',
        mediaType: 'text/plain',
        content: 'app text',
      },
    ]

    const baselineBundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId,
      title: 'Handoff Dir Doc',
      root: 'doc',
      files,
    }

    const snapshotBundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId,
      title: 'Handoff Dir Doc',
      root: 'doc',
      files: [
        {
          id: 'f1',
          path: 'doc/app.txt',
          mediaType: 'text/plain',
          content: 'app text modified',
        },
      ],
    }

    const handoffPath = join(workDir, 'handoff.json')
    writeHandoffJson(handoffPath, baselineBundle, snapshotBundle, docId)

    const dirPath = join(workDir, 'app-dir')
    mkdirSync(dirPath, { recursive: true })
    writeFileSync(join(dirPath, 'app.txt'), 'app text modified', 'utf8')

    // A. Missing source Taco => LOCAL_IO_ERROR
    const missingRes = await runCli([
      'diff',
      join(workDir, 'missing.taco.html'),
      '--handoff',
      handoffPath,
      '--dir',
      dirPath,
    ])
    expect(missingRes.exitCode).toBe(EXIT_CODES.LOCAL_IO_ERROR)
    const missingErr = JSON.parse(missingRes.stderr!)
    expect(missingErr.error.code).toBe('LOCAL_IO_ERROR')

    // B. Mismatched source Taco (different docId or content) => CONFLICT_ERROR
    const mismatchTacoPath = join(workDir, 'mismatch.taco.html')
    writeFileSync(
      mismatchTacoPath,
      createTacoHtml({
        docId: 'different-doc-id',
        title: 'Different Doc',
        root: 'doc',
        files,
      }),
      'utf8',
    )
    const mismatchRes = await runCli([
      'diff',
      mismatchTacoPath,
      '--handoff',
      handoffPath,
      '--dir',
      dirPath,
    ])
    expect(mismatchRes.exitCode).toBe(EXIT_CODES.CONFLICT_ERROR)
    const mismatchErr = JSON.parse(mismatchRes.stderr!)
    expect(mismatchErr.error.code).toBe('CONFLICT_ERROR')

    // C. Valid source Taco => trustedBaseline true
    const validTacoPath = join(workDir, 'valid.taco.html')
    writeFileSync(
      validTacoPath,
      createTacoHtml({
        docId,
        title: 'Handoff Dir Doc',
        root: 'doc',
        files,
      }),
      'utf8',
    )
    const validRes = await runCli([
      'diff',
      validTacoPath,
      '--handoff',
      handoffPath,
      '--dir',
      dirPath,
    ])
    expect(validRes.exitCode).toBe(EXIT_CODES.OK)
    const validJson = JSON.parse(validRes.stdout!)
    expect(validJson.trustedBaseline).toBe(true)
    expect(
      (validJson.unverifiedWarnings ?? []).some((w: string) =>
        w.includes('Missing trusted review-start baseline'),
      ),
    ).toBe(false)

    // D. No source Taco provided => trustedBaseline false + unverified warning
    const noSourceRes = await runCli(['diff', '--handoff', handoffPath, '--dir', dirPath])
    expect(noSourceRes.exitCode).toBe(EXIT_CODES.OK)
    const noSourceJson = JSON.parse(noSourceRes.stdout!)
    expect(noSourceJson.trustedBaseline).toBe(false)
    expect(
      (noSourceJson.unverifiedWarnings ?? []).some((w: string) =>
        w.includes('Missing trusted review-start baseline'),
      ),
    ).toBe(true)
  })

  it('6. inspect: redacts secrets before truncating snippet to avoid leaking secret prefixes', async () => {
    const docId = 'doc-inspect-secret'
    const longSecret =
      'sk-supersecretkey-abcdef-1234567890-abcdef-1234567890-very-long-secret-key-exceeding-one-hundred-characters-long'

    const commentThread = makeCommentThread({
      id: 'thread-secret-leak',
      path: 'doc/index.ts',
      status: 'open',
      createdAt: '2026-10-12T01:00:00.000Z',
      messages: [
        {
          id: 'msg-leak',
          author: 'Alice',
          authorId: 'u1',
          body: `Notice the auth token is: ${longSecret}`,
          createdAt: '2026-10-12T01:00:00.000Z',
        },
      ],
    })

    const files: TacoFile[] = [
      {
        id: 'f1',
        path: 'doc/index.ts',
        mediaType: 'text/typescript',
        content: 'export const token = "sk-placeholder";',
      },
    ]

    const artifactPath = join(workDir, 'secret-inspect.taco.html')
    const bundle: Partial<TacoBundle> & { docId: string; title: string; files: TacoFile[] } = {
      docId,
      title: 'Secret Inspect Doc',
      root: 'doc',
      files,
      comments: [commentThread],
      collab: {
        key: longSecret,
      },
    }

    writeFileSync(artifactPath, createTacoHtml(bundle), 'utf8')

    const inspectRes = await runCli(['inspect', artifactPath])
    expect(inspectRes.exitCode).toBe(EXIT_CODES.OK)
    const inspectJson = JSON.parse(inspectRes.stdout!)
    const snippet: string = inspectJson.comments.openComments[0].contentSnippet

    // The snippet must contain [REDACTED] and MUST NOT contain any substantial substring of longSecret
    expect(snippet).toContain('[REDACTED]')
    expect(snippet).not.toContain('supersecretkey')
    expect(snippet).not.toContain('1234567890')
    expect(snippet).not.toContain(longSecret.slice(0, 50))
  })
})
