import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MemoryBlobDriver, MemoryDatabaseDriver, TacoHostService } from '../src/index.ts'

describe('@taco/host Service (Phase 2)', () => {
  const createTestHost = () => {
    const db = new MemoryDatabaseDriver()
    const blob = new MemoryBlobDriver()
    const service = new TacoHostService({ db, blob, hostUrl: 'http://localhost:32167' })
    return { db, blob, service }
  }

  it('provides capabilities compliant with OpenAPI limits and retention', async () => {
    const { service } = createTestHost()
    const res = await service.getCapabilities()
    expect(res.status).toBe(200)
    const body = res.body as Record<string, unknown>
    expect(body.protocol).toBe('taco-host/1')
    expect((body.limits as Record<string, unknown>).maxPayloadBytes).toBe(32 * 1024 * 1024)
  })

  it('creates anonymous credentials and authenticates /v1/me', async () => {
    const { service } = createTestHost()
    const anonRes = await service.createAnonymousCredentials()
    expect(anonRes.status).toBe(201)
    const anonBody = anonRes.body as { user: { id: string }; apiKey: { secret: string } }
    expect(anonBody.apiKey.secret).toMatch(/^taco_live_/)

    // /v1/me with bearer
    const meRes = await service.getMe(`Bearer ${anonBody.apiKey.secret}`)
    expect(meRes.status).toBe(200)
    expect((meRes.body as { id: string }).id).toBe(anonBody.user.id)
  })

  it('completes two-phase publish (prepare -> blob PUT -> commit)', async () => {
    const { service, blob } = createTestHost()
    const anon = (await service.createAnonymousCredentials()).body as { apiKey: { secret: string } }
    const auth = `Bearer ${anon.apiKey.secret}`
    const idempotencyKey = randomUUID()

    const stagedPayload = {
      protocol: 'taco-host/1',
      snapshot: {
        format: 'taco/files',
        version: 1,
        docId: 'doc_init',
        title: 'Initial Document',
        root: 'specs/sample',
        files: [
          {
            path: 'specs/sample/spec.md',
            mediaType: 'text/markdown',
            content: '# Initial Spec\n\nContent here',
          },
        ],
      },
    }
    const stagedBytes = new TextEncoder().encode(JSON.stringify(stagedPayload))
    const cryptoHash = await crypto.subtle.digest('SHA-256', stagedBytes)
    const payloadHash = `sha256:${Array.from(new Uint8Array(cryptoHash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`

    // 1. Prepare upload
    const prepRes = await service.prepareUpload(auth, idempotencyKey, {
      protocol: 'taco-host/1',
      purpose: 'publish',
      payloadHash,
      payloadBytes: stagedBytes.byteLength,
    })
    expect(prepRes.status).toBe(201)
    const prepBody = prepRes.body as { uploadId: string; uploadUrl: string }
    expect(prepBody.uploadUrl).toContain('mock-blob')

    // 2. Direct PUT to Blob
    const matchPath = prepBody.uploadUrl.match(/vercel-storage\.com\/([^?]+)/)
    const blobPath = matchPath![1]
    await blob.putObject(blobPath, stagedBytes)

    // 3. Commit publish
    const commitRes = await service.publishTaco(auth, idempotencyKey, {
      protocol: 'taco-host/1',
      uploadId: prepBody.uploadId,
    })
    expect(commitRes.status).toBe(201)
    const pubBody = commitRes.body as { tacoId: string; revisionId: string; contentHash: string }
    expect(pubBody.tacoId).toBeDefined()
    expect(pubBody.contentHash).toMatch(/^sha256:/)

    // Verify Taco metadata
    const tacoRes = await service.getTaco(pubBody.tacoId)
    expect(tacoRes.status).toBe(200)
    expect((tacoRes.body as { title: string }).title).toBe('Initial Document')
  })

  it('rejects update with base revision conflict', async () => {
    const { service, blob } = createTestHost()
    const anon = (await service.createAnonymousCredentials()).body as { apiKey: { secret: string } }
    const auth = `Bearer ${anon.apiKey.secret}`

    // Initial publish
    const pubKey = randomUUID()
    const staged = {
      protocol: 'taco-host/1',
      snapshot: {
        format: 'taco/files',
        version: 1,
        docId: 'doc_1',
        title: 'Doc',
        root: 'specs/test',
        files: [{ path: 'specs/test/spec.md', mediaType: 'text/markdown', content: '# T' }],
      },
    }
    const bytes = new TextEncoder().encode(JSON.stringify(staged))
    const cryptoHash = await crypto.subtle.digest('SHA-256', bytes)
    const hash = `sha256:${Array.from(new Uint8Array(cryptoHash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`

    const prep1 = (
      await service.prepareUpload(auth, pubKey, {
        protocol: 'taco-host/1',
        purpose: 'publish',
        payloadHash: hash,
        payloadBytes: bytes.byteLength,
      })
    ).body as { uploadId: string; uploadUrl: string }
    await blob.putObject(prep1.uploadUrl.match(/vercel-storage\.com\/([^?]+)/)![1], bytes)
    const published = (
      await service.publishTaco(auth, pubKey, { protocol: 'taco-host/1', uploadId: prep1.uploadId })
    ).body as { tacoId: string; revisionId: string }

    // Prepare update with WRONG baseRevisionId
    const wrongBaseId = randomUUID()
    const updateKey = randomUUID()
    const prepUpdate = (
      await service.prepareUpload(auth, updateKey, {
        protocol: 'taco-host/1',
        purpose: 'update',
        tacoId: published.tacoId,
        baseRevisionId: wrongBaseId,
        payloadHash: hash,
        payloadBytes: bytes.byteLength,
      })
    ).body as { uploadId: string; uploadUrl: string }

    await blob.putObject(prepUpdate.uploadUrl.match(/vercel-storage\.com\/([^?]+)/)![1], bytes)

    const conflictRes = await service.createRevision(auth, updateKey, published.tacoId, {
      protocol: 'taco-host/1',
      uploadId: prepUpdate.uploadId,
      baseRevisionId: wrongBaseId,
    })
    expect(conflictRes.status).toBe(409)
    expect((conflictRes.body as { error: { code: string } }).error.code).toBe('REVISION_CONFLICT')
  })

  it('handles review mutations with 201 for real changes and 200 for no-op idempotency', async () => {
    const { service, blob } = createTestHost()
    const anon = (await service.createAnonymousCredentials()).body as { apiKey: { secret: string } }
    const auth = `Bearer ${anon.apiKey.secret}`

    // Publish
    const key = randomUUID()
    const staged = {
      protocol: 'taco-host/1',
      snapshot: {
        format: 'taco/files',
        version: 1,
        docId: 'doc',
        title: 'Title',
        root: 'specs/test',
        files: [{ path: 'specs/test/spec.md', mediaType: 'text/markdown', content: '# T' }],
      },
    }
    const bytes = new TextEncoder().encode(JSON.stringify(staged))
    const cryptoHash = await crypto.subtle.digest('SHA-256', bytes)
    const hash = `sha256:${Array.from(new Uint8Array(cryptoHash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`
    const prep = (
      await service.prepareUpload(auth, key, {
        protocol: 'taco-host/1',
        purpose: 'publish',
        payloadHash: hash,
        payloadBytes: bytes.byteLength,
      })
    ).body as { uploadId: string; uploadUrl: string }
    await blob.putObject(prep.uploadUrl.match(/vercel-storage\.com\/([^?]+)/)![1], bytes)
    const pub = (
      await service.publishTaco(auth, key, { protocol: 'taco-host/1', uploadId: prep.uploadId })
    ).body as { tacoId: string; revisionId: string }

    // Create comment -> 201
    const commentRes = await service.postReview(auth, undefined, randomUUID(), pub.tacoId, {
      revisionId: pub.revisionId,
      type: 'comment.created',
      body: 'Need clarification on architecture',
    })
    expect(commentRes.status).toBe(201)
    const commentBody = commentRes.body as { changed: boolean; event: { id: string } }
    expect(commentBody.changed).toBe(true)
    expect(commentBody.event.id).toBeDefined()

    // Approve revision -> 201
    const approveKey = randomUUID()
    const approveRes = await service.postReview(auth, undefined, approveKey, pub.tacoId, {
      revisionId: pub.revisionId,
      type: 'revision.approved',
    })
    expect(approveRes.status).toBe(201)

    // Repeat approval with different key -> 200 no-op
    const noOpRes = await service.postReview(auth, undefined, randomUUID(), pub.tacoId, {
      revisionId: pub.revisionId,
      type: 'revision.approved',
    })
    expect(noOpRes.status).toBe(200)
    expect((noOpRes.body as { changed: boolean; event: null }).changed).toBe(false)
    expect((noOpRes.body as { changed: boolean; event: null }).event).toBeNull()

    // Replay with exact same key -> replays 201
    const replayRes = await service.postReview(auth, undefined, approveKey, pub.tacoId, {
      revisionId: pub.revisionId,
      type: 'revision.approved',
    })
    expect(replayRes.status).toBe(201)

    // Verify persistent events log
    const eventsRes = await service.getEvents(pub.tacoId)
    expect(eventsRes.status).toBe(200)
    const events = (eventsRes.body as { events: Array<{ sequence: string; type: string }> }).events
    // 1 initial publication + 1 comment + 1 approval = 3 events total (no-op generated 0 events)
    expect(events.length).toBe(3)
    expect(events[0].type).toBe('revision.published')
    expect(events[1].type).toBe('comment.created')
    expect(events[2].type).toBe('revision.approved')
  })

  it('exports complete bundle including all revisions and events up to high-water mark', async () => {
    const { service, blob } = createTestHost()
    const anon = (await service.createAnonymousCredentials()).body as { apiKey: { secret: string } }
    const auth = `Bearer ${anon.apiKey.secret}`

    const key = randomUUID()
    const staged = {
      protocol: 'taco-host/1',
      snapshot: {
        format: 'taco/files',
        version: 1,
        docId: 'export_doc',
        title: 'Export Test',
        root: 'specs/test',
        files: [{ path: 'specs/test/spec.md', mediaType: 'text/markdown', content: '# To Export' }],
      },
    }
    const bytes = new TextEncoder().encode(JSON.stringify(staged))
    const cryptoHash = await crypto.subtle.digest('SHA-256', bytes)
    const hash = `sha256:${Array.from(new Uint8Array(cryptoHash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`
    const prep = (
      await service.prepareUpload(auth, key, {
        protocol: 'taco-host/1',
        purpose: 'publish',
        payloadHash: hash,
        payloadBytes: bytes.byteLength,
      })
    ).body as { uploadId: string; uploadUrl: string }
    await blob.putObject(prep.uploadUrl.match(/vercel-storage\.com\/([^?]+)/)![1], bytes)
    const pub = (
      await service.publishTaco(auth, key, { protocol: 'taco-host/1', uploadId: prep.uploadId })
    ).body as { tacoId: string; revisionId: string }

    // Read revision detail
    const revRes = await service.getRevision(pub.tacoId, pub.revisionId)
    expect(revRes.status).toBe(200)
    expect((revRes.body as { contentHash: string }).contentHash).toMatch(/^sha256:/)

    // Export Taco
    const exportRes = await service.exportTaco(pub.tacoId)
    expect(exportRes.status).toBe(200)
    const bundle = exportRes.body as {
      protocol: string
      taco: { id: string }
      revisions: Array<{ id: string }>
      events: Array<{ sequence: string }>
    }
    expect(bundle.protocol).toBe('taco-host-export/1')
    expect(bundle.taco.id).toBe(pub.tacoId)
    expect(bundle.revisions.length).toBe(1)
    expect(bundle.events.length).toBe(1)
  })
})
