import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HostedSession } from '../packages/host/src/browser/hosted-session.ts'
import { HostApiError, HostClient, HostTransportError } from '../packages/host/src/browser/host-client.ts'
import type {
  HostAutosaveResult,
  HostCommentMutation,
  HostCommentThread,
  HostHandoffCommit,
  HostSnapshot,
  HostStateResponse,
} from '../packages/host/src/browser/host-client.ts'
import type { TacoBundle } from '../src/model.ts'
import { FileBrowser } from '../src/file-browser.ts'
import { attachHostedSession } from '../packages/host/src/browser/index.ts'
import type { TacoFileApi } from '../src/main-common.ts'

describe('HostedSession contract fixes (Findings 1, 3, 4 and concurrency protections)', () => {
  const sampleSnapshot: HostSnapshot = {
    format: 'taco/files',
    version: 1,
    docId: 'test-doc',
    title: 'Test Doc',
    root: 'specs/sample',
    files: [
      {
        id: 'file-spec',
        path: 'specs/sample/spec.md',
        mediaType: 'text/markdown',
        content: '# Baseline Spec\n',
      },
    ],
  }

  const createMockClient = () => {
    let stateVersion = '1'
    let commentsSequence = '1'
    const mutations: HostCommentMutation[] = []

    return {
      capability: { tacoId: 'taco-123', apiBase: 'https://host.example.com/api' },
      get stateVersion() { return stateVersion },
      get commentsSequence() { return commentsSequence },
      mutations,
      readState: vi.fn(async (): Promise<HostStateResponse | null> => ({
        stateVersion,
        commentsThroughSequence: commentsSequence,
        snapshot: structuredClone(sampleSnapshot),
      })),
      readComments: vi.fn(async (): Promise<HostCommentThread[]> => []),
      autosave: vi.fn(async (): Promise<HostAutosaveResult> => {
        stateVersion = String(Number(stateVersion) + 1)
        return { stateVersion, savedAt: new Date().toISOString(), historyWindowId: 'win-1' }
      }),
      mutateComment: vi.fn(async (mutation: HostCommentMutation): Promise<string> => {
        mutations.push(mutation)
        commentsSequence = String(Number(commentsSequence) + 1)
        return commentsSequence
      }),
      commitHandoff: vi.fn(async (): Promise<HostHandoffCommit> => ({
        changed: true,
        handoffId: 'handoff-1',
        event: null,
      })),
      listListeners: vi.fn(async () => ({ observedAt: new Date().toISOString(), listeners: [] })),
    }
  }

  it('Finding 1: preserves edits made while the handoff refresh is in flight', async () => {
    const client = createMockClient()
    const bundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId: 'test-doc',
      title: 'Test Doc',
      root: 'specs/sample',
      files: [
        {
          id: 'file-spec',
          path: 'specs/sample/spec.md',
          mediaType: 'text/markdown',
          content: '# Baseline Spec\n',
        },
      ],
      comments: [],
    }

    const session = new HostedSession({
      client: client as unknown as HostClient,
      bridge: {
        bundle,
        author: () => 'Alice',
        onStatus: () => {},
        adoptListeners: () => {},
        adoptContent: (content) => {
          bundle.files = content.files.map((f) => ({ ...f }))
          if (content.comments) bundle.comments = content.comments
        },
      },
      saveDebounceMs: 10,
      commentDebounceMs: 10,
    })

    try {
      await session.start()
      expect(session.ready).toBe(true)

      let syncStarted = false
      client.readComments.mockImplementation(async () => {
        if (syncStarted) {
          bundle.files[0].content = '# New unsaved reviewer edit mid-refresh\n'
          session.markContentChanged()
        }
        return []
      })

      syncStarted = true
      const outcome = await session.handoff()

      expect(outcome).toEqual({ kind: 'blocked', save: 'dirty' })
      expect(bundle.files[0].content).toBe('# New unsaved reviewer edit mid-refresh\n')
      expect(session.currentStatus.save).toBe('dirty')
    } finally {
      session.destroy()
    }
  })

  it('preserves edits made while discardLocalDraft is in flight', async () => {
    const client = createMockClient()
    const bundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId: 'test-doc',
      title: 'Test Doc',
      root: 'specs/sample',
      files: [
        {
          id: 'file-spec',
          path: 'specs/sample/spec.md',
          mediaType: 'text/markdown',
          content: '# Baseline Spec\n',
        },
      ],
      comments: [],
    }

    const session = new HostedSession({
      client: client as unknown as HostClient,
      bridge: {
        bundle,
        author: () => 'Alice',
        onStatus: () => {},
        adoptListeners: () => {},
        adoptContent: (content) => {
          bundle.files = content.files.map((f) => ({ ...f }))
          if (content.comments) bundle.comments = content.comments
        },
      },
      saveDebounceMs: 10,
      commentDebounceMs: 10,
    })

    try {
      await session.start()

      let discardInFlight = false
      client.readComments.mockImplementation(async () => {
        if (discardInFlight) {
          bundle.files[0].content = '# Typed while discard was fetching\n'
          session.markContentChanged()
        }
        return []
      })

      discardInFlight = true
      await session.discardLocalDraft()

      // The new edit must NOT be discarded by force-refresh
      expect(bundle.files[0].content).toBe('# Typed while discard was fetching\n')
      expect(session.currentStatus.save).toBe('dirty')
    } finally {
      session.destroy()
    }
  })

  it('preserves pre-ready edits made while initial load is in flight', async () => {
    const client = createMockClient()
    const bundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId: 'test-doc',
      title: 'Test Doc',
      root: 'specs/sample',
      files: [
        {
          id: 'file-spec',
          path: 'specs/sample/spec.md',
          mediaType: 'text/markdown',
          content: '# Embedded Initial Spec\n',
        },
      ],
      comments: [],
    }

    let finishReadState!: () => void
    const readStatePromise = new Promise<HostStateResponse | null>((resolve) => {
      finishReadState = () => resolve({
        stateVersion: '1',
        commentsThroughSequence: '1',
        snapshot: structuredClone(sampleSnapshot),
      })
    })
    client.readState.mockReturnValue(readStatePromise)

    const session = new HostedSession({
      client: client as unknown as HostClient,
      bridge: {
        bundle,
        author: () => 'Alice',
        onStatus: () => {},
        adoptListeners: () => {},
        adoptContent: (content) => {
          bundle.files = content.files.map((f) => ({ ...f }))
          if (content.comments) bundle.comments = content.comments
        },
      },
      saveDebounceMs: 10,
      commentDebounceMs: 10,
    })

    try {
      // Start loading in the background
      const startPromise = session.start()
      expect(session.ready).toBe(false)

      // User immediately types before ready
      bundle.files[0].content = '# Edited before host ready\n'
      session.markContentChanged()
      expect(session.hasPendingWrites()).toBe(true)

      // Host response arrives
      finishReadState()
      await startPromise

      expect(session.ready).toBe(true)
      // The pre-ready edit must NOT have been overwritten by snapshot adoption!
      expect(bundle.files[0].content).toBe('# Edited before host ready\n')
      // Pre-ready edits are marked as conflict to prevent silent autosave without known initial stateVersion
      expect(session.currentStatus.save).toBe('conflict')
      // Handoff must be blocked with kind 'conflict'
      const outcome = await session.handoff()
      expect(outcome).toEqual({ kind: 'conflict' })
      // No silent autosave was sent to host
      expect(client.autosave).not.toHaveBeenCalled()

      // User can explicitly discard the local draft to adopt the host's version
      await session.discardLocalDraft()
      expect(bundle.files[0].content).toBe('# Baseline Spec\n')
      expect(session.currentStatus.save).toBe('saved')
      expect(session.hasPendingWrites()).toBe(false)
    } finally {
      session.destroy()
    }
  })

  it("Finding 3: persists a new thread's status change in the same save batch", async () => {
    const client = createMockClient()
    const bundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId: 'test-doc',
      title: 'Test Doc',
      root: 'specs/sample',
      files: [
        {
          id: 'file-spec',
          path: 'specs/sample/spec.md',
          mediaType: 'text/markdown',
          content: '# Baseline Spec\n',
        },
      ],
      comments: [],
    }

    const session = new HostedSession({
      client: client as unknown as HostClient,
      bridge: {
        bundle,
        author: () => 'Reviewer',
        onStatus: () => {},
        adoptListeners: () => {},
        adoptContent: (content) => {
          bundle.files = content.files.map((f) => ({ ...f }))
          if (content.comments) bundle.comments = content.comments
        },
      },
      saveDebounceMs: 10,
      commentDebounceMs: 10,
    })

    try {
      await session.start()

      // Add a new comment thread and resolve it immediately before debounce/flush
      bundle.comments = [
        {
          id: 'thread-new',
          anchor: null,
          status: 'resolved',
          messages: [
            {
              id: 'msg-1',
              author: 'Reviewer',
              body: 'Document-level feedback already addressed.',
              createdAt: '2026-09-29T10:00:00.000Z',
            },
          ],
          createdAt: '2026-09-29T10:00:00.000Z',
          updatedAt: '2026-09-29T10:00:01.000Z',
        },
      ]
      session.markCommentsChanged()

      // Flush comments to trigger saveComments
      const status = await session.flush()
      expect(status.comments).toBe('saved')

      // Both 'create' AND 'resolve' mutations must have been sent to host!
      expect(client.mutations).toHaveLength(2)
      expect(client.mutations[0]).toMatchObject({
        action: 'create',
        threadId: 'thread-new',
        messageId: 'msg-1',
        body: 'Document-level feedback already addressed.',
      })
      expect(client.mutations[1]).toMatchObject({
        action: 'resolve',
        threadId: 'thread-new',
      })
    } finally {
      session.destroy()
    }
  })

  it('Finding 4: warns before leaving a page with pending or failed hosted writes', async () => {
    const client = createMockClient()
    const bundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId: 'test-doc',
      title: 'Test Doc',
      root: 'specs/sample',
      files: [
        {
          id: 'file-spec',
          path: 'specs/sample/spec.md',
          mediaType: 'text/markdown',
          content: '# Baseline Spec\n',
        },
      ],
      comments: [],
    }

    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const session = new HostedSession({
      client: client as unknown as HostClient,
      bridge: {
        bundle,
        author: () => 'Reviewer',
        onStatus: () => {},
        adoptListeners: () => {},
        adoptContent: (content) => {
          bundle.files = content.files.map((f) => ({ ...f }))
          if (content.comments) bundle.comments = content.comments
        },
      },
      saveDebounceMs: 50,
      commentDebounceMs: 50,
    })

    try {
      await session.start()

      // Initially clean: no pending writes, unload not guarded
      expect(session.hasPendingWrites()).toBe(false)
      expect(session['unloadGuarded']).toBe(false)

      // User makes a content edit
      bundle.files[0].content = '# Edited Spec\n'
      session.markContentChanged()
      expect(session.hasPendingWrites()).toBe(true)
      expect(session['unloadGuarded']).toBe(true)
      expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', session['onBeforeUnload'])

      // Directly verify handler prevents default
      const dirtyEvent = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
      session['onBeforeUnload'](dirtyEvent)
      expect(dirtyEvent.defaultPrevented).toBe(true)

      // Flush saves to host
      await session.flush()
      expect(session.hasPendingWrites()).toBe(false)
      expect(session['unloadGuarded']).toBe(false)
      expect(removeEventListenerSpy).toHaveBeenCalledWith('beforeunload', session['onBeforeUnload'])

      // If a save fails with an error:
      client.autosave.mockRejectedValueOnce(new Error('Network disconnected'))
      bundle.files[0].content = '# Failed Spec\n'
      session.markContentChanged()
      await session.flush()
      expect(session.currentStatus.save).toBe('error')
      expect(session.hasPendingWrites()).toBe(true)
      expect(session['unloadGuarded']).toBe(true)

      const errorEvent = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
      session['onBeforeUnload'](errorEvent)
      expect(errorEvent.defaultPrevented).toBe(true)
    } finally {
      session.destroy()
      expect(session['unloadGuarded']).toBe(false)
      expect(removeEventListenerSpy).toHaveBeenCalledWith('beforeunload', session['onBeforeUnload'])
      addEventListenerSpy.mockRestore()
      removeEventListenerSpy.mockRestore()
    }
  })

  it('preserves metadata edits made while an autosave is in flight', async () => {
    const client = createMockClient()
    const bundle: TacoBundle = {
      format: 'taco/files', version: 1, docId: sampleSnapshot.docId,
      title: sampleSnapshot.title, root: sampleSnapshot.root,
      files: sampleSnapshot.files.map((file) => ({ ...file })), comments: [],
    }
    const writes: Array<{ title?: string; navigation?: unknown }> = []
    const session = new HostedSession({
      client: client as unknown as HostClient,
      bridge: { bundle, author: () => 'Alice', onStatus: () => {}, adoptContent: () => {}, adoptListeners: () => {} },
    })
    client.autosave.mockImplementation(async (...args: unknown[]) => {
      writes.push(structuredClone(args[0]) as { title?: string; navigation?: unknown })
      if (writes.length === 1) {
        bundle.title = 'Second title'
        delete bundle.navigation
        session.markContentChanged()
      }
      return { stateVersion: String(writes.length + 1), savedAt: new Date().toISOString(), historyWindowId: 'win' }
    })
    try {
      await session.start()
      bundle.title = 'First title'
      bundle.navigation = { version: 1, groups: [{ id: 'review', title: 'Review', paths: ['spec.md'] }] }
      session.markContentChanged()
      await session.flush()
      expect(session.currentStatus.save).toBe('dirty')
      await session.flush()
      expect(writes[0]).toMatchObject({ title: 'First title', navigation: { groups: [{ title: 'Review', paths: ['specs/sample/spec.md'] }] } })
      expect(writes[1]).toMatchObject({ title: 'Second title', navigation: null })
      expect(session.currentStatus.save).toBe('saved')
    } finally { session.destroy() }
  })
  const recoverySession = (client: HostClient) => {
    const snapshot = structuredClone(sampleSnapshot)
    const bundle: TacoBundle = { ...snapshot, files: snapshot.files.map((file) => ({ ...file })), navigation: undefined, comments: [] }
    const session = new HostedSession({
      client: client as unknown as HostClient,
      bridge: {
        bundle, author: () => 'Alice', onStatus: () => {}, adoptListeners: () => {},
        adoptContent: (content) => Object.assign(bundle, content),
      },
    })
    return { bundle, session }
  }

  it('confirms the original handoff after a lost response before handing off a newer version', async () => {
    const client = createMockClient()
    const { bundle, session } = recoverySession(client as unknown as HostClient)
    const accepted = new Map<string, { payload: unknown; result: HostHandoffCommit }>()
    let lose = true
    const commit = vi.fn(async (payload: unknown, key: string) => {
      const previous = accepted.get(key)
      if (previous && JSON.stringify(previous.payload) !== JSON.stringify(payload)) throw new HostApiError(409, 'KEY_REUSED', 'payload changed')
      const result = previous?.result ?? { changed: true, handoffId: `h${accepted.size + 1}`, event: null }
      accepted.set(key, { payload: structuredClone(payload), result })
      if (lose) throw new HostTransportError('response lost')
      return result
    })
    client.commitHandoff = commit as typeof client.commitHandoff
    try {
      await session.start()
      expect((await session.handoff()).kind).toBe('failed')
      expect(session.hasPendingWrites()).toBe(true)
      bundle.title = 'New version'
      session.markContentChanged()
      await session.flush()
      lose = false
      expect(await session.handoff()).toEqual({ kind: 'done', handoffId: 'h2' })
      expect([...accepted.values()].map(({ payload }) => payload)).toEqual([
        { author: 'Alice', expectedStateVersion: '1', expectedCommentsThroughSequence: '1' },
        { author: 'Alice', expectedStateVersion: '2', expectedCommentsThroughSequence: '1' },
      ])
    } finally { session.destroy() }
  })

  it('confirms a comment create across flushes before sending its newer resolved status', async () => {
    const client = createMockClient()
    const { bundle, session } = recoverySession(client as unknown as HostClient)
    const accepted = new Map<string, HostCommentMutation>()
    let lose = true
    client.mutateComment.mockImplementation(async (op: HostCommentMutation, key?: string) => {
      if (!accepted.has(key!)) {
        if (op.action === 'create' && [...accepted.values()].some((old) => old.threadId === op.threadId)) throw new Error('duplicate thread')
        accepted.set(key!, structuredClone(op))
      }
      if (lose) throw new HostTransportError('response lost')
      return String(accepted.size + 1)
    })
    try {
      await session.start()
      bundle.comments = [{ id: 't', status: 'open', anchor: null, createdAt: '2026-10-01', updatedAt: '2026-10-01', messages: [{ id: 'm', author: 'Alice', body: 'Review', createdAt: '2026-10-01' }] }]
      session.markCommentsChanged()
      await session.flush()
      expect(session.currentStatus.comments).toBe('error')
      bundle.comments[0].status = 'resolved'
      session.markCommentsChanged()
      lose = false
      await session.flush()
      expect([...accepted.values()].map((op) => op.action)).toEqual(['create', 'resolve'])
      expect(session.currentStatus.comments).toBe('saved')
    } finally { session.destroy() }
  })

  it('retains stable rendered block identities and converts hosted navigation to browser paths', async () => {
    const client = createMockClient()
    const snapshot = structuredClone(sampleSnapshot)
    snapshot.files[0].blocks = [{ id: 'stable-code', type: 'code', html: '<pre>const a = 1</pre>' }]
    snapshot.navigation = { version: 1, entry: snapshot.files[0].path, groups: [{ id: 'g', title: 'Review', paths: [snapshot.files[0].path] }] }
    client.readState.mockResolvedValue({ stateVersion: '1', commentsThroughSequence: '1', snapshot })
    const { bundle, session } = recoverySession(client as unknown as HostClient)
    try {
      await session.start()
      expect(bundle.files[0].blocks?.[0].id).toBe('stable-code')
      expect(bundle.navigation).toEqual({ version: 1, entry: 'spec.md', groups: [{ id: 'g', title: 'Review', paths: ['spec.md'] }] })
      bundle.title = 'Updated'
      session.markContentChanged()
      await session.flush()
      expect(client.autosave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Updated' }), expect.any(String))
    } finally { session.destroy() }
  })
})

describe('HostedBrowserController & attachHostedSession', () => {
  const createSampleBundle = (): TacoBundle => ({
    format: 'taco/files',
    version: 1,
    docId: 'test-doc',
    title: 'Test Doc',
    root: 'specs/sample',
    files: [{ path: 'specs/sample/spec.md', mediaType: 'text/markdown', content: '# Hello\n' }],
  })
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  })


  it('returns null when document carries no host capability', () => {
    const root = document.createElement('div')
    const browser = new FileBrowser(root, createSampleBundle())
    const api = {} as TacoFileApi
    const controller = attachHostedSession(browser, api)
    expect(controller).toBeNull()
    expect(api.hosted).toBeUndefined()
    expect(api.handoff).toBeUndefined()
    browser.destroy()
  })

  it('initializes host session and wires up api when capability is present in head', () => {
    const script = document.createElement('script')
    script.id = 'taco-host-capability'
    script.type = 'application/taco+host'
    script.textContent = JSON.stringify({
      version: 1,
      tacoId: 'test-taco-id',
      apiBase: '/v1/tacos/test-taco-id',
    })
    document.head.append(script)

    try {
      const root = document.createElement('div')
      const browser = new FileBrowser(root, createSampleBundle())
      const api = {} as TacoFileApi
      const controller = attachHostedSession(browser, api)

      expect(controller).not.toBeNull()
      expect(typeof api.hosted).toBe('function')
      expect(typeof api.handoff).toBe('function')
      expect(api.hosted?.()).toEqual({ tacoId: 'test-taco-id', apiBase: '/v1/tacos/test-taco-id' })
      expect(document.getElementById('taco-host-styles')).not.toBeNull()
      expect(root.querySelector('.host-presence-button')).not.toBeNull()
      const handoff = vi.fn(async () => {})
      browser.setPrimaryHandoffHandler(handoff, 'Submit review', 'bot-handoff', browser.currentLocale === 'zh-Hans' ? '交接' : 'Handoff')
      browser.rebuild()
      const presence = root.querySelector('.host-presence-button')!
      const spacer = root.querySelector('.workspace-header-spacer')!
      expect(spacer.compareDocumentPosition(presence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(presence.classList.contains('control-button-primary')).toBe(false)
      const primary = root.querySelector<HTMLButtonElement>('.copy-review-main')!
      primary.click()
      expect(handoff).toHaveBeenCalledOnce()
      const menuToggle = root.querySelector<HTMLButtonElement>('.copy-review-more')!
      menuToggle.click()
      const firstAction = document.querySelector<HTMLButtonElement>('.copy-review-menu button')!
      expect(primary.textContent).toBe(firstAction.textContent)
      expect(primary.querySelector('svg')?.innerHTML).toBe(firstAction.querySelector('svg')?.innerHTML)
      browser.destroy()
    } finally {
      script.remove()
      document.getElementById('taco-host-styles')?.remove()
    }
  })

  it('blocks handoff and opens no-listeners install modal when zero listeners are connected', async () => {
    const script = document.createElement('script')
    script.id = 'taco-host-capability'
    script.type = 'application/taco+host'
    script.textContent = JSON.stringify({
      version: 1,
      tacoId: 'test-taco-id',
      apiBase: '/v1/tacos/test-taco-id',
    })
    document.head.append(script)

    try {
      const root = document.createElement('div')
      const browser = new FileBrowser(root, createSampleBundle())
      const api = {} as TacoFileApi
      const controller = attachHostedSession(browser, api)!
      expect(controller).not.toBeNull()

      // Mock refreshListeners returning empty listeners list
      vi.spyOn(controller.session, 'start').mockResolvedValue(undefined)
      vi.spyOn(controller.session, 'refreshListeners').mockImplementation(async () => {
        controller.listeners = { observedAt: new Date().toISOString(), listeners: [] }
        return controller.listeners
      })
      const handoffSpy = vi.spyOn(controller.session, 'handoff')

      await controller.primaryHandoff()

      // handoff should NOT be called
      expect(handoffSpy).not.toHaveBeenCalled()

      // dialog should be rendered with install commands
      const dialog = document.querySelector<HTMLDialogElement>('.host-no-listeners-dialog')
      expect(dialog).not.toBeNull()
      const codeElements = Array.from(dialog?.querySelectorAll('code') ?? []).map((c) => c.textContent)
      expect(codeElements).toContain('npx skills@latest add arcadia822/taco --skill=taco')
      expect(codeElements).toContain('npm install -g @tacobin/cli')
      expect(codeElements).toContain(`taco-cli subscribe test-taco-id --host ${location.origin}`)

      dialog?.remove()
      vi.spyOn(controller.session, 'refreshListeners').mockResolvedValue(null)
      await controller.primaryHandoff()
      expect(document.querySelector('.host-no-listeners-dialog')).toBeNull()
      expect(handoffSpy).not.toHaveBeenCalled()
      browser.destroy()
    } finally {
      script.remove()
      document.getElementById('taco-host-styles')?.remove()
    }
  })

  it('displays personalized listener toast on successful handoff with 1 listener and multiple listeners', async () => {
    const script = document.createElement('script')
    script.id = 'taco-host-capability'
    script.type = 'application/taco+host'
    script.textContent = JSON.stringify({
      version: 1,
      tacoId: 'test-taco-id',
      apiBase: '/v1/tacos/test-taco-id',
    })
    document.head.append(script)

    try {
      const root = document.createElement('div')
      const browser = new FileBrowser(root, createSampleBundle())
      const api = {} as TacoFileApi
      const controller = attachHostedSession(browser, api)!
      const toastSpy = vi.spyOn(browser, 'toast').mockImplementation(() => {})

      vi.spyOn(controller.session, 'start').mockResolvedValue(undefined)

      // Case 1: 1 listener with name
      vi.spyOn(controller.session, 'refreshListeners').mockImplementation(async () => {
        controller.listeners = {
          observedAt: new Date().toISOString(),
          listeners: [
            { listenerId: 'l1', name: 'Claude Code', lastSeenAt: new Date().toISOString(), expiresAt: new Date().toISOString() },
          ],
        }
        return controller.listeners
      })
      vi.spyOn(controller.session, 'handoff').mockImplementation(async () => {
        controller.listeners = { observedAt: new Date().toISOString(), listeners: [] }
        return { kind: 'done', handoffId: 'h1' }
      })

      await controller.primaryHandoff()
      const expectedSingleToast = browser.currentLocale === 'zh-Hans' ? '已交接给Claude Code' : 'Handed off to Claude Code'
      expect(toastSpy).toHaveBeenCalledWith(expectedSingleToast)

      // Case 2: multiple listeners
      vi.spyOn(controller.session, 'refreshListeners').mockImplementation(async () => {
        controller.listeners = {
          observedAt: new Date().toISOString(),
          listeners: [
            { listenerId: 'l1', name: 'Claude Code', lastSeenAt: new Date().toISOString(), expiresAt: new Date().toISOString() },
            { listenerId: 'l2', name: 'Codex', lastSeenAt: new Date().toISOString(), expiresAt: new Date().toISOString() },
          ],
        }
        return controller.listeners
      })

      await controller.primaryHandoff()
      const expectedMultiToast = browser.currentLocale === 'zh-Hans' ? '已交接给2个监听者' : 'Handed off to 2 listeners'
      expect(toastSpy).toHaveBeenCalledWith(expectedMultiToast)

      browser.destroy()
    } finally {
      script.remove()
      document.getElementById('taco-host-styles')?.remove()
    }
  })
  it('offers retry and a cancellable discard control', async () => {
    const readState = vi.spyOn(HostClient.prototype, 'readState').mockResolvedValue({ stateVersion: '1', commentsThroughSequence: '0', snapshot: { ...createSampleBundle(), version: 1, docId: 'test-doc' } })
    const readComments = vi.spyOn(HostClient.prototype, 'readComments').mockResolvedValue([])
    const listListeners = vi.spyOn(HostClient.prototype, 'listListeners').mockResolvedValue({ observedAt: '', listeners: [] })
    const script = document.createElement('script')
    script.id = 'taco-host-capability'
    script.type = 'application/taco+host'
    script.textContent = JSON.stringify({ version: 1, tacoId: 'test-taco-id', apiBase: '/v1/tacos/test-taco-id' })
    document.head.append(script)
    const root = document.createElement('div')
    const browser = new FileBrowser(root, createSampleBundle())
    const controller = attachHostedSession(browser)!
    const discard = vi.spyOn(controller.session, 'discardLocalDraft').mockResolvedValue(undefined)
    const retry = vi.spyOn(controller.session, 'retry').mockImplementation(() => {})
    vi.spyOn(controller.session, 'flush').mockResolvedValue({ readiness: 'ready', save: 'saved', comments: 'saved' })
    try {
      await controller.session.start()
      controller['renderStatus']({ readiness: 'ready', save: 'conflict', comments: 'saved' })
      const button = root.querySelector<HTMLButtonElement>('.host-recovery-button')!
      expect(button.closest<HTMLElement>('.host-recovery-control')!.hidden).toBe(false)
      button.click()
      document.querySelector<HTMLButtonElement>('.confirmation-dialog-actions button:first-child')!.click()
      await vi.waitFor(() => expect(button.disabled).toBe(false))
      expect(discard).not.toHaveBeenCalled()
      button.click()
      document.querySelector<HTMLButtonElement>('.confirmation-dialog-actions button:last-child')!.click()
      await vi.waitFor(() => expect(discard).toHaveBeenCalledOnce())
      await vi.waitFor(() => expect(button.disabled).toBe(false))
      controller['renderStatus']({ readiness: 'ready', save: 'saved', comments: 'error' })
      button.click()
      await vi.waitFor(() => expect(retry).toHaveBeenCalledOnce())
    } finally {
      browser.destroy()
      script.remove()
      readState.mockRestore()
      readComments.mockRestore()
      listListeners.mockRestore()
      document.getElementById('taco-host-styles')?.remove()
    }
  })
})
