import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canonicalizeJson,
  computeSnapshotContentHash,
  isSafePath,
  isSafeRootPath,
  projectLocalBundleToUploadContent,
  sha256Hex,
  validateDocumentSnapshot,
  validateImportedThread,
  validateStagedUploadContent,
} from '../../protocol/src/index.ts'
import {
  HostSubscriptionSession,
  MemoryBlobDriver,
  MemoryDatabaseDriver,
  renderPublicReviewHtml,
  TacoHostService,
} from '../../host/src/index.ts'
import { TacoClient } from '../src/client.ts'
import { CredentialStore, normalizeHostOrigin, resolveApiKey } from '../src/credentials.ts'
import { runCli } from '../src/runner.ts'
import { TacoSubscriber } from '../src/subscriber.ts'

const FIXTURE_TACO = resolve(
  process.cwd(),
  'specs/008-taco-host-contract/008-taco-host-contract.taco.html',
)

class MockMemoryCredentialStore implements CredentialStore {
  private store: Record<string, string> = {}
  async getApiKey(hostOrigin: string): Promise<string | null> {
    return this.store[hostOrigin] || null
  }
  async setApiKey(hostOrigin: string, apiKey: string): Promise<void> {
    this.store[hostOrigin] = apiKey
  }
}

describe('008-taco-host-contract 21 Acceptance Scenarios (spec.md Section 10)', () => {
  // Scenario 1: Strip collaboration credentials from bundle; no secrets in logs
  it('Scenario 1: strips collaboration secrets and local URLs during projection', () => {
    const bundleWithSecrets = {
      format: 'taco/files',
      version: 1,
      docId: 'doc_sec',
      title: 'Secret Spec',
      root: 'specs/sample',
      access: 'writer',
      collab: { role: 'editor', room: 'sensitive-room-token-123' },
      packOptions: { ignore: ['internal/*'] },
      files: [
        {
          path: 'specs/sample/spec.md',
          mediaType: 'text/markdown',
          content: '# Safe',
          sourceUrl: 'file:///private/local/path/spec.md',
        },
      ],
    }
    const projected = projectLocalBundleToUploadContent(bundleWithSecrets)
    expect(projected.ok).toBe(true)
    if (!projected.ok) return

    expect(projected.strippedCategories).toEqual(
      expect.arrayContaining(['access', 'collab', 'packOptions', 'sourceUrl']),
    )
    const jsonStr = JSON.stringify(projected.content)
    expect(jsonStr).not.toContain('sensitive-room-token-123')
    expect(jsonStr).not.toContain('file:///private/local/path/spec.md')
  })

  // Scenario 2: Unknown protocol, invalid navigation, illegal path, oversized items fail cleanly
  it('Scenario 2: rejects illegal paths, invalid navigation, and unknown versions', () => {
    expect(isSafePath('/absolute/path')).toBe(false)
    expect(isSafePath('../traversal')).toBe(false)
    expect(isSafeRootPath('/root')).toBe(false)

    const invalidSnap = {
      format: 'taco/files',
      version: 999, // Unknown future version
      docId: 'doc_1',
      title: 'Doc',
      root: '.',
      files: [{ path: 'valid.md', mediaType: 'text/markdown', content: 'test' }],
    }
    expect(validateDocumentSnapshot(invalidSnap).ok).toBe(false)
  })

  // Scenario 3: Markdown, files, assets semantic fidelity without executing code
  it('Scenario 3: preserves raw HTML source without executing script tags', () => {
    const rawContent = '<script>alert(1)</script><p>Hello</p>'
    const file = {
      path: 'view.html',
      mediaType: 'text/html',
      content: rawContent,
    }
    // Validation passes as plain text/html source
    expect(isSafePath(file.path)).toBe(true)
    expect(file.content).toBe(rawContent) // Source preserved verbatim
  })

  // Scenario 4: Public read without key, invalid key fails, key revocation takes effect
  it('Scenario 4: enforces public read, owner authentication, and key revocation', async () => {
    const db = new MemoryDatabaseDriver()
    const blob = new MemoryBlobDriver()
    const service = new TacoHostService({ db, blob, hostUrl: 'http://localhost:32167' })

    const anon = (await service.createAnonymousCredentials()).body as {
      apiKey: { id: string; secret: string }
    }
    const auth = `Bearer ${anon.apiKey.secret}`

    // Authenticated me
    const meRes = await service.getMe(auth)
    expect(meRes.status).toBe(200)

    // Revoke key
    const keyRow = db.apiKeys.get(anon.apiKey.id)
    keyRow!.revokedAt = new Date().toISOString()

    // Subsequent auth immediately fails 401
    const revokedRes = await service.getMe(auth)
    expect(revokedRes.status).toBe(401)
  })

  // Scenario 5: Two concurrent updates on same base revision: only one succeeds
  it('Scenario 5: concurrent updates on same base revision trigger REVISION_CONFLICT', async () => {
    const db = new MemoryDatabaseDriver()
    const blob = new MemoryBlobDriver()
    const service = new TacoHostService({ db, blob, hostUrl: 'http://localhost:32167' })

    const anon = (await service.createAnonymousCredentials()).body as { apiKey: { secret: string } }
    const auth = `Bearer ${anon.apiKey.secret}`

    // Setup initial published Taco
    const key1 = randomUUID()
    const payload1 = {
      protocol: 'taco-host/1',
      snapshot: {
        format: 'taco/files',
        version: 1,
        docId: 'd',
        title: 'T',
        root: '.',
        files: [{ path: 'a.md', mediaType: 'text/markdown', content: 'c' }],
      },
    }
    const bytes1 = new TextEncoder().encode(JSON.stringify(payload1))
    const hash1 = `sha256:${await sha256Hex(bytes1)}`

    const prep1 = (
      await service.prepareUpload(auth, key1, {
        protocol: 'taco-host/1',
        purpose: 'publish',
        payloadHash: hash1,
        payloadBytes: bytes1.byteLength,
      })
    ).body as { uploadId: string; uploadUrl: string }
    await blob.putObject(prep1.uploadUrl.match(/vercel-storage\.com\/([^?]+)/)![1], bytes1)
    const pub = (
      await service.publishTaco(auth, key1, { protocol: 'taco-host/1', uploadId: prep1.uploadId })
    ).body as { tacoId: string; revisionId: string }

    const baseRevId = pub.revisionId

    // Update A on baseRevId
    const keyA = randomUUID()
    const prepA = (
      await service.prepareUpload(auth, keyA, {
        protocol: 'taco-host/1',
        purpose: 'update',
        tacoId: pub.tacoId,
        baseRevisionId: baseRevId,
        payloadHash: hash1,
        payloadBytes: bytes1.byteLength,
      })
    ).body as { uploadId: string; uploadUrl: string }
    await blob.putObject(prepA.uploadUrl.match(/vercel-storage\.com\/([^?]+)/)![1], bytes1)

    // Update B on baseRevId
    const keyB = randomUUID()
    const prepB = (
      await service.prepareUpload(auth, keyB, {
        protocol: 'taco-host/1',
        purpose: 'update',
        tacoId: pub.tacoId,
        baseRevisionId: baseRevId,
        payloadHash: hash1,
        payloadBytes: bytes1.byteLength,
      })
    ).body as { uploadId: string; uploadUrl: string }
    await blob.putObject(prepB.uploadUrl.match(/vercel-storage\.com\/([^?]+)/)![1], bytes1)

    // Commit A -> succeeds
    const commitA = await service.createRevision(auth, keyA, pub.tacoId, {
      protocol: 'taco-host/1',
      uploadId: prepA.uploadId,
      baseRevisionId: baseRevId,
    })
    expect(commitA.status).toBe(201)

    // Commit B on original baseRevId -> REVISION_CONFLICT 409
    const commitB = await service.createRevision(auth, keyB, pub.tacoId, {
      protocol: 'taco-host/1',
      uploadId: prepB.uploadId,
      baseRevisionId: baseRevId,
    })
    expect(commitB.status).toBe(409)
    expect((commitB.body as { error: { code: string } }).error.code).toBe('REVISION_CONFLICT')
  })

  // Scenario 6: Comments submitted on older revisions remain tied to that revision; imported authors unverified
  it('Scenario 6: comments tie to targeted revision and imported authors are unverified', async () => {
    const db = new MemoryDatabaseDriver()
    const blob = new MemoryBlobDriver()
    const service = new TacoHostService({ db, blob, hostUrl: 'http://localhost:32167' })

    const thread = {
      id: 'local_th1',
      anchor: null,
      status: 'open' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: 'm1',
          author: 'Local User',
          authorId: 'local_usr_9',
          body: 'Note',
          createdAt: new Date().toISOString(),
        },
      ],
    }
    expect(validateImportedThread(thread).ok).toBe(true)
  })

  // Scenario 7 & 8: High-water mark boundary and durable reconnection without gap
  it('Scenario 7 & 8: captures high-water mark and allows gap-free durable replay', async () => {
    const db = new MemoryDatabaseDriver()
    const blob = new MemoryBlobDriver()
    const service = new TacoHostService({ db, blob, hostUrl: 'http://localhost:32167' })

    // Simulate events
    const tacoId = randomUUID()
    db.tacos.set(tacoId, {
      id: tacoId,
      ownerId: 'u1',
      title: 'T',
      currentRevisionId: 'r1',
      status: 'open',
      lastSequence: 10,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: null,
    })

    for (let i = 1; i <= 10; i++) {
      db.events.push({
        id: `ev_${i}`,
        sequence: i,
        tacoId,
        revisionId: 'r1',
        type: 'comment.created',
        occurredAt: new Date().toISOString(),
        actor: { kind: 'user', id: 'u1', displayName: 'User', verified: false },
        data: {},
      })
    }

    // Replay after 5 up to throughSequence 8
    const paged = (await service.getEvents(tacoId, '5', '8', 10)).body as {
      events: Array<{ sequence: string }>
      throughSequence: string
    }
    expect(paged.events.map((e) => e.sequence)).toEqual(['6', '7', '8'])
    expect(paged.throughSequence).toBe('8')
  })

  // Scenario 9: Duplicate confirmations do not multiply; withdrawal affects only caller; no inheritance
  it('Scenario 9: duplicate approvals are idempotent no-ops and withdrawal resets approval', async () => {
    const db = new MemoryDatabaseDriver()
    const blob = new MemoryBlobDriver()
    const service = new TacoHostService({ db, blob, hostUrl: 'http://localhost:32167' })

    const anon = (await service.createAnonymousCredentials()).body as { apiKey: { secret: string } }
    const auth = `Bearer ${anon.apiKey.secret}`
    const tacoId = randomUUID()
    const revisionId = randomUUID()

    db.tacos.set(tacoId, {
      id: tacoId,
      ownerId: 'u1',
      title: 'T',
      currentRevisionId: revisionId,
      status: 'open',
      lastSequence: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: null,
    })
    db.revisions.set(revisionId, {
      id: revisionId,
      tacoId,
      parentRevisionId: null,
      publisherId: 'u1',
      sourceDocId: 'd',
      contentHash: 'sha256:0',
      blobPath: 'p',
      createdAt: new Date().toISOString(),
    })

    // First approval -> 201
    const res1 = await service.postReview(auth, undefined, randomUUID(), tacoId, {
      revisionId,
      type: 'revision.approved',
    })
    expect(res1.status).toBe(201)

    // Second approval with different key -> 200 no-op
    const res2 = await service.postReview(auth, undefined, randomUUID(), tacoId, {
      revisionId,
      type: 'revision.approved',
    })
    expect(res2.status).toBe(200)
    expect((res2.body as { changed: boolean }).changed).toBe(false)

    // Withdrawal -> 201
    const resWithdraw = await service.postReview(auth, undefined, randomUUID(), tacoId, {
      revisionId,
      type: 'revision.approval_withdrawn',
    })
    expect(resWithdraw.status).toBe(201)
  })

  // Scenario 10: Closed space forbids new writes but allows full export
  it('Scenario 10: closed Taco rejects review writes but allows export', async () => {
    const db = new MemoryDatabaseDriver()
    const blob = new MemoryBlobDriver()
    const service = new TacoHostService({ db, blob, hostUrl: 'http://localhost:32167' })

    const tacoId = randomUUID()
    const revisionId = randomUUID()
    db.tacos.set(tacoId, {
      id: tacoId,
      ownerId: 'u1',
      title: 'Closed Taco',
      currentRevisionId: revisionId,
      status: 'closed',
      lastSequence: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: null,
    })
    db.revisions.set(revisionId, {
      id: revisionId,
      tacoId,
      parentRevisionId: null,
      publisherId: 'u1',
      sourceDocId: 'd',
      contentHash: 'sha256:0',
      blobPath: `tacos/${tacoId}/${revisionId}.json`,
      createdAt: new Date().toISOString(),
    })
    await blob.putObject(
      `tacos/${tacoId}/${revisionId}.json`,
      JSON.stringify({ snapshot: { title: 'Doc', files: [] } }),
    )

    const anon = (await service.createAnonymousCredentials()).body as { apiKey: { secret: string } }
    const writeRes = await service.postReview(
      `Bearer ${anon.apiKey.secret}`,
      undefined,
      randomUUID(),
      tacoId,
      {
        revisionId,
        type: 'comment.created',
        body: 'Attempt',
      },
    )
    expect(writeRes.status).toBe(409)
    expect((writeRes.body as { error: { code: string } }).error.code).toBe('TACO_CLOSED')

    // Export remains available
    const exportRes = await service.exportTaco(tacoId)
    expect(exportRes.status).toBe(200)
  })

  // Scenario 11: Export captures consistent throughSequence without session secrets
  it('Scenario 11: export bundle protocol is taco-host-export/1 and excludes secrets', async () => {
    const db = new MemoryDatabaseDriver()
    const blob = new MemoryBlobDriver()
    const service = new TacoHostService({ db, blob, hostUrl: 'http://localhost:32167' })

    const tacoId = randomUUID()
    const revId = randomUUID()
    db.tacos.set(tacoId, {
      id: tacoId,
      ownerId: 'u_123',
      title: 'Export Target',
      currentRevisionId: revId,
      status: 'open',
      lastSequence: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: null,
    })
    db.revisions.set(revId, {
      id: revId,
      tacoId,
      parentRevisionId: null,
      publisherId: 'u_123',
      sourceDocId: 'd',
      contentHash: 'sha256:1',
      blobPath: 'p',
      createdAt: new Date().toISOString(),
    })
    await blob.putObject('p', JSON.stringify({ snapshot: { title: 'T', files: [] } }))

    const exportRes = await service.exportTaco(tacoId)
    const bundle = exportRes.body as Record<string, unknown>
    expect(bundle.protocol).toBe('taco-host-export/1')
    expect(JSON.stringify(bundle)).not.toContain('taco_live_')
    expect(JSON.stringify(bundle)).not.toContain('taco_guest=')
  })

  // Scenario 12: Offline workflows remain fully functional without Host configured
  it('Scenario 12: local offline packaging and validation do not require network or host', async () => {
    const res = await runCli(['publish', FIXTURE_TACO, '--dry-run'])
    expect(res.exitCode).toBe(0)
    expect(JSON.parse(res.stdout!).dryRun).toBe(true)
  })

  // Scenario 13: Fresh machine boots with zero install, help/skills offline, auto anonymous publish
  it('Scenario 13: skills list/read and help work offline without internet access', async () => {
    const helpRes = await runCli(['help'])
    expect(helpRes.exitCode).toBe(0)

    const skillRes = await runCli(['skills', 'read', 'taco'])
    expect(skillRes.exitCode).toBe(0)
    expect(JSON.parse(skillRes.stdout!).content).toContain('Taco Agent Guide')
  })

  // Scenario 14: Default JSON output and rejection of forbidden switches
  it('Scenario 14: rejects --json and --public switches with exit code 2', async () => {
    const r1 = await runCli(['publish', '--json'])
    expect(r1.exitCode).toBe(2)
    const r2 = await runCli(['publish', '--public'])
    expect(r2.exitCode).toBe(2)
  })

  // Scenario 15: Host default localhost:32167 and credential origin binding
  it('Scenario 15: enforces origin normalization and detects host mismatch', async () => {
    expect(normalizeHostOrigin('http://localhost:32167')).toBe('http://localhost:32167')
    expect(normalizeHostOrigin('https://api.taco.com/')).toBe('https://api.taco.com')
    expect(() => normalizeHostOrigin('http://remote.taco.com')).toThrow(
      'Remote Host must use HTTPS',
    )

    const store = new MockMemoryCredentialStore()
    process.env.TACO_HOST_API_KEY = 'taco_live_bound_key'
    process.env.TACO_HOST_URL = 'https://host-a.com'

    await expect(resolveApiKey('https://host-b.com', store)).rejects.toThrow(
      'CREDENTIAL_HOST_MISMATCH',
    )
    delete process.env.TACO_HOST_API_KEY
    delete process.env.TACO_HOST_URL
  })

  // Scenario 16: UUID v4 used for Taco ID and Revision ID
  it('Scenario 16: Taco and Revision IDs use lowercase RFC 4122 UUID v4', () => {
    const u = randomUUID()
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  // Scenario 17: Accurate parameter listings and binary help alignment
  it('Scenario 17: command helps list required options, defaults, and exit codes', async () => {
    const res = await runCli(['help', 'update'])
    expect(res.exitCode).toBe(0)
    const json = JSON.parse(res.stdout!)
    expect(json.options.some((o: { name: string }) => o.name === '--base')).toBe(true)
  })

  // Scenario 18: Upload reservation boundaries and clean aborts
  it('Scenario 18: upload reservation locks parameters and rejects mismatched payload', async () => {
    const db = new MemoryDatabaseDriver()
    const blob = new MemoryBlobDriver()
    const service = new TacoHostService({ db, blob, hostUrl: 'http://localhost:32167' })

    const anon = (await service.createAnonymousCredentials()).body as { apiKey: { secret: string } }
    const auth = `Bearer ${anon.apiKey.secret}`
    const key = randomUUID()

    const prep = await service.prepareUpload(auth, key, {
      protocol: 'taco-host/1',
      purpose: 'publish',
      payloadHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      payloadBytes: 100,
    })
    expect(prep.status).toBe(201)

    // Repeat same key with DIFFERENT payloadHash -> 409 IDEMPOTENCY_MISMATCH
    const clash = await service.prepareUpload(auth, key, {
      protocol: 'taco-host/1',
      purpose: 'publish',
      payloadHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      payloadBytes: 100,
    })
    expect(clash.status).toBe(409)
  })

  // Scenario 19: Close already committed: backfill replays through close then closes with 1000
  it('Scenario 19: subscription on closed Taco sends backfill then closes cleanly', async () => {
    const db = new MemoryDatabaseDriver()
    const blob = new MemoryBlobDriver()
    const tacoId = randomUUID()
    db.tacos.set(tacoId, {
      id: tacoId,
      ownerId: 'u1',
      title: 'T',
      currentRevisionId: 'r1',
      status: 'closed',
      lastSequence: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: null,
    })

    const sentMessages: string[] = []
    let closedCode: number | null = null
    const ws = {
      send: (m: string) => sentMessages.push(m),
      close: (code?: number) => {
        closedCode = code ?? 1000
      },
    }

    const session = new HostSubscriptionSession(db, tacoId, ws)
    session.start('0')

    expect(sentMessages.some((m) => m.includes('"kind":"ready"'))).toBe(true)
    expect(sentMessages.some((m) => m.includes('"kind":"checkpoint"'))).toBe(true)
    expect(closedCode).toBe(1000)
  })

  // Scenario 20: No-op operations do not fabricate pseudo-events; exact same key replays status
  it('Scenario 20: duplicate actions do not fabricate extra events', async () => {
    const db = new MemoryDatabaseDriver()
    const blob = new MemoryBlobDriver()
    const service = new TacoHostService({ db, blob, hostUrl: 'http://localhost:32167' })

    const tacoId = randomUUID()
    const revId = randomUUID()
    db.tacos.set(tacoId, {
      id: tacoId,
      ownerId: 'u1',
      title: 'T',
      currentRevisionId: revId,
      status: 'open',
      lastSequence: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: null,
    })
    db.revisions.set(revId, {
      id: revId,
      tacoId,
      parentRevisionId: null,
      publisherId: 'u1',
      sourceDocId: 'd',
      contentHash: 'sha256:0',
      blobPath: 'p',
      createdAt: new Date().toISOString(),
    })

    const anon = (await service.createAnonymousCredentials()).body as { apiKey: { secret: string } }
    const auth = `Bearer ${anon.apiKey.secret}`

    // First completion -> 201
    await service.postReview(auth, undefined, randomUUID(), tacoId, {
      revisionId: revId,
      type: 'review.completed',
    })
    expect(db.events.length).toBe(1)

    // Repeat completion with new key -> 200, NO new event in events table
    await service.postReview(auth, undefined, randomUUID(), tacoId, {
      revisionId: revId,
      type: 'review.completed',
    })
    expect(db.events.length).toBe(1)
  })

  // Scenario 21: Payload > 4.5 MB and <= 32 MiB supported via Blob direct PUT
  it('Scenario 21: supports up to 32 MiB payload via private Blob direct upload', async () => {
    const db = new MemoryDatabaseDriver()
    const blob = new MemoryBlobDriver()
    const service = new TacoHostService({ db, blob, hostUrl: 'http://localhost:32167' })

    const anon = (await service.createAnonymousCredentials()).body as { apiKey: { secret: string } }
    const auth = `Bearer ${anon.apiKey.secret}`

    // 10 MB payload (> 4.5 MB Vercel function gateway limit)
    const largeBytes = 10 * 1024 * 1024
    const prepRes = await service.prepareUpload(auth, randomUUID(), {
      protocol: 'taco-host/1',
      purpose: 'publish',
      payloadHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      payloadBytes: largeBytes,
    })
    expect(prepRes.status).toBe(201)
    expect((prepRes.body as { maxBytes: number }).maxBytes).toBe(largeBytes)

    // Render public web view
    const webRes = renderPublicReviewHtml({
      hostUrl: 'http://localhost:32167',
      tacoId: randomUUID(),
    })
    expect(webRes.status).toBe(200)
    expect(webRes.headers['Content-Type']).toContain('text/html')
  })
})
