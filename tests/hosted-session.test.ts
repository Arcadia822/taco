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
  describe('TACO-54 dirty indicator and review baseline assertions', () => {
    it('Clean on open: ready/saved/saved with empty comments or resolved history leaves buttons clean and beforeunload quiet', async () => {
      const initialBundle = createSampleBundle()
      const readState = vi.spyOn(HostClient.prototype, 'readState').mockResolvedValue({
        stateVersion: '1',
        commentsThroughSequence: '1',
        snapshot: { ...initialBundle, version: 1, docId: 'test-doc' },
      })
      const readComments = vi.spyOn(HostClient.prototype, 'readComments').mockResolvedValue([
        {
          id: 'thread-resolved-1',
          status: 'resolved',
          anchor: null,
          isAnchorStale: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [{ id: 'm1', author: 'Bob', body: 'Old resolved comment', createdAt: new Date().toISOString(), deletedAt: null }],
          actions: [],
        },
      ])
      const listListeners = vi.spyOn(HostClient.prototype, 'listListeners').mockResolvedValue({ observedAt: '', listeners: [] })
      const script = document.createElement('script')
      script.id = 'taco-host-capability'
      script.type = 'application/taco+host'
      script.textContent = JSON.stringify({ version: 1, tacoId: 'test-taco-id', apiBase: '/v1/tacos/test-taco-id' })
      document.head.append(script)

      const root = document.createElement('div')
      const browser = new FileBrowser(root, initialBundle)
      const controller = attachHostedSession(browser)!
      try {
        await controller.session.start()
        const saveBtn = root.querySelector<HTMLButtonElement>('.save-button')!
        const copyBtn = root.querySelector<HTMLButtonElement>('.copy-review-main')!

        expect(controller.session.hasPendingWrites()).toBe(false)
        expect(saveBtn.classList.contains('is-dirty')).toBe(false)
        expect(copyBtn.classList.contains('is-dirty')).toBe(false)
        expect(saveBtn.title).not.toContain('Unsaved')
        expect(saveBtn.title).not.toContain('未保存')

        // Beforeunload check
        const beforeunloadEvent = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
        window.dispatchEvent(beforeunloadEvent)
        expect(beforeunloadEvent.defaultPrevented).toBe(false)
      } finally {
        browser.destroy()
        script.remove()
        readState.mockRestore()
        readComments.mockRestore()
        listListeners.mockRestore()
        document.getElementById('taco-host-styles')?.remove()
      }
    })

    it('Clean with durable open comments: open thread from GET does not mark buttons dirty, but keeps thread in panel and handoff', async () => {
      const initialBundle = createSampleBundle()
      const readState = vi.spyOn(HostClient.prototype, 'readState').mockResolvedValue({
        stateVersion: '1',
        commentsThroughSequence: '1',
        snapshot: { ...initialBundle, version: 1, docId: 'test-doc' },
      })
      const readComments = vi.spyOn(HostClient.prototype, 'readComments').mockResolvedValue([
        {
          id: 'thread-open-1',
          status: 'open',
          anchor: null,
          isAnchorStale: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [{ id: 'm1', author: 'Carol', body: 'Active feedback', createdAt: new Date().toISOString(), deletedAt: null }],
          actions: [],
        },
      ])
      const listListeners = vi.spyOn(HostClient.prototype, 'listListeners').mockResolvedValue({ observedAt: '', listeners: [] })
      const script = document.createElement('script')
      script.id = 'taco-host-capability'
      script.type = 'application/taco+host'
      script.textContent = JSON.stringify({ version: 1, tacoId: 'test-taco-id', apiBase: '/v1/tacos/test-taco-id' })
      document.head.append(script)

      const root = document.createElement('div')
      const browser = new FileBrowser(root, initialBundle)
      const controller = attachHostedSession(browser)!
      try {
        await controller.session.start()
        const saveBtn = root.querySelector<HTMLButtonElement>('.save-button')!
        const copyBtn = root.querySelector<HTMLButtonElement>('.copy-review-main')!

        expect(controller.session.hasPendingWrites()).toBe(false)
        expect(saveBtn.classList.contains('is-dirty')).toBe(false)
        expect(copyBtn.classList.contains('is-dirty')).toBe(false)

        // The open thread is still present in browser bundle comments
        expect(browser.currentBundle.comments?.some((t) => t.id === 'thread-open-1' && t.status === 'open')).toBe(true)
        // Initial load without reviewer edits must not produce modified review files diff
        expect(browser.getModifiedReviewFiles()).toHaveLength(0)
      } finally {
        browser.destroy()
        script.remove()
        readState.mockRestore()
        readComments.mockRestore()
        listListeners.mockRestore()
        document.getElementById('taco-host-styles')?.remove()
      }
    })

    it('Edits turn dirty, delayed autosave clears back to clean, and manual review diff is preserved', async () => {
      let stateVersion = '1'
      const initialBundle = createSampleBundle()
      const readState = vi.spyOn(HostClient.prototype, 'readState').mockResolvedValue({
        stateVersion,
        commentsThroughSequence: '0',
        snapshot: { ...initialBundle, version: 1, docId: 'test-doc' },
      })
      const readComments = vi.spyOn(HostClient.prototype, 'readComments').mockResolvedValue([])
      let resolveAutosave: ((val: HostAutosaveResult) => void) | null = null
      const autosave = vi.spyOn(HostClient.prototype, 'autosave').mockImplementation(() => {
        return new Promise<HostAutosaveResult>((resolve) => {
          resolveAutosave = resolve
        })
      })
      const listListeners = vi.spyOn(HostClient.prototype, 'listListeners').mockResolvedValue({ observedAt: '', listeners: [] })
      const script = document.createElement('script')
      script.id = 'taco-host-capability'
      script.type = 'application/taco+host'
      script.textContent = JSON.stringify({ version: 1, tacoId: 'test-taco-id', apiBase: '/v1/tacos/test-taco-id' })
      document.head.append(script)

      const root = document.createElement('div')
      const browser = new FileBrowser(root, initialBundle)
      const controller = attachHostedSession(browser)!
      try {
        await controller.session.start()
        const saveBtn = root.querySelector<HTMLButtonElement>('.save-button')!
        const copyBtn = root.querySelector<HTMLButtonElement>('.copy-review-main')!
        expect(saveBtn.classList.contains('is-dirty')).toBe(false)

        // Make an edit via updateFileContent
        browser['updateFileContent'](browser.currentBundle.files[0].path, '# Hello Edited\n', undefined)

        expect(controller.session.hasPendingWrites()).toBe(true)
        expect(saveBtn.classList.contains('is-dirty')).toBe(true)
        expect(copyBtn.classList.contains('is-dirty')).toBe(true)

        // Fast-forward debounce timer
        const flushPromise = controller.session.flush()
        await vi.waitFor(() => expect(autosave).toHaveBeenCalledOnce())

        // While autosave is in flight, buttons stay dirty
        expect(controller.session.hasPendingWrites()).toBe(true)
        expect(saveBtn.classList.contains('is-dirty')).toBe(true)

        // Autosave completes
        stateVersion = '2'
        resolveAutosave!({ stateVersion, savedAt: new Date().toISOString(), historyWindowId: 'win-1' })
        await flushPromise
        await vi.waitFor(() => expect(controller.session.hasPendingWrites()).toBe(false))

        expect(saveBtn.classList.contains('is-dirty')).toBe(false)
        expect(copyBtn.classList.contains('is-dirty')).toBe(false)

        // Preserves manual review diff (design invariant §3.5)
        const modified = browser.getModifiedReviewFiles()
        expect(modified).toHaveLength(1)
        expect(modified[0].content).toBe('# Hello Edited\n')
        expect(modified[0].diff).toContain('+# Hello Edited')
      } finally {
        browser.destroy()
        script.remove()
        readState.mockRestore()
        readComments.mockRestore()
        autosave.mockRestore()
        listListeners.mockRestore()
        document.getElementById('taco-host-styles')?.remove()
      }
    })

    it('In-flight race: editing version B while saving A keeps indicator dirty until B is acknowledged', async () => {
      let stateVersion = '1'
      const initialBundle = createSampleBundle()
      const readState = vi.spyOn(HostClient.prototype, 'readState').mockResolvedValue({
        stateVersion,
        commentsThroughSequence: '0',
        snapshot: { ...initialBundle, version: 1, docId: 'test-doc' },
      })
      const readComments = vi.spyOn(HostClient.prototype, 'readComments').mockResolvedValue([])
      const autosaveResolvers: Array<(val: HostAutosaveResult) => void> = []
      const autosave = vi.spyOn(HostClient.prototype, 'autosave').mockImplementation(() => {
        return new Promise<HostAutosaveResult>((resolve) => {
          autosaveResolvers.push(resolve)
        })
      })
      const listListeners = vi.spyOn(HostClient.prototype, 'listListeners').mockResolvedValue({ observedAt: '', listeners: [] })
      const script = document.createElement('script')
      script.id = 'taco-host-capability'
      script.type = 'application/taco+host'
      script.textContent = JSON.stringify({ version: 1, tacoId: 'test-taco-id', apiBase: '/v1/tacos/test-taco-id' })
      document.head.append(script)

      const root = document.createElement('div')
      const browser = new FileBrowser(root, initialBundle)
      const controller = attachHostedSession(browser)!
      try {
        await controller.session.start()
        const saveBtn = root.querySelector<HTMLButtonElement>('.save-button')!
        const copyBtn = root.querySelector<HTMLButtonElement>('.copy-review-main')!

        // Edit A
        browser['updateFileContent'](browser.currentBundle.files[0].path, '# Edit A\n', undefined)
        const saveAPromise = controller.session.flush()
        await vi.waitFor(() => expect(autosave).toHaveBeenCalledTimes(1))

        // While A is saving, edit B
        browser['updateFileContent'](browser.currentBundle.files[0].path, '# Edit B\n', undefined)

        // A resolves
        stateVersion = '2'
        autosaveResolvers[0]({ stateVersion, savedAt: new Date().toISOString(), historyWindowId: 'win-1' })
        await saveAPromise

        // Flag must still be dirty because B is pending
        expect(controller.session.hasPendingWrites()).toBe(true)
        expect(saveBtn.classList.contains('is-dirty')).toBe(true)
        expect(copyBtn.classList.contains('is-dirty')).toBe(true)

        // Flush and resolve B
        const saveBPromise = controller.session.flush()
        await vi.waitFor(() => expect(autosave).toHaveBeenCalledTimes(2))
        stateVersion = '3'
        autosaveResolvers[1]({ stateVersion, savedAt: new Date().toISOString(), historyWindowId: 'win-2' })
        await saveBPromise

        // Now clean
        expect(controller.session.hasPendingWrites()).toBe(false)
        expect(saveBtn.classList.contains('is-dirty')).toBe(false)
        expect(copyBtn.classList.contains('is-dirty')).toBe(false)
      } finally {
        browser.destroy()
        script.remove()
        readState.mockRestore()
        readComments.mockRestore()
        autosave.mockRestore()
        listListeners.mockRestore()
        document.getElementById('taco-host-styles')?.remove()
      }
    })

    it('Restores local tracker on unsupported host status and controller destroy', async () => {
      const initialBundle = createSampleBundle()
      const readState = vi.spyOn(HostClient.prototype, 'readState').mockResolvedValue(null) // unsupported
      const readComments = vi.spyOn(HostClient.prototype, 'readComments').mockResolvedValue([])
      const listListeners = vi.spyOn(HostClient.prototype, 'listListeners').mockResolvedValue({ observedAt: '', listeners: [] })
      const script = document.createElement('script')
      script.id = 'taco-host-capability'
      script.type = 'application/taco+host'
      script.textContent = JSON.stringify({ version: 1, tacoId: 'test-taco-id', apiBase: '/v1/tacos/test-taco-id' })
      document.head.append(script)

      const root = document.createElement('div')
      const browser = new FileBrowser(root, initialBundle)
      const controller = attachHostedSession(browser)!
      try {
        await controller.session.start()
        expect(controller.session.currentStatus.readiness).toBe('unsupported')

        // On unsupported, controller marks bundle access = reader and rebuilds
        expect(controller.session.currentStatus.readiness).toBe('unsupported')
        // Direct edit to dirty tracker or bundle content
        browser.currentBundle.files[0].content = '# Local Edit\n'
        browser['dirtyTracker'].note({ kind: 'all' })
        browser['syncDirtyState']()

        const saveBtn = root.querySelector<HTMLButtonElement>('.save-button')!
        // Local tracker takes effect!
        expect(saveBtn.classList.contains('is-dirty')).toBe(true)
      } finally {
        browser.destroy()
        script.remove()
        readState.mockRestore()
        readComments.mockRestore()
        listListeners.mockRestore()
        document.getElementById('taco-host-styles')?.remove()
      }
    })
    it('Reflects dirty indicator when pendingHandoff is created on unknown transport result and clears when resolved', async () => {
      const initialBundle = createSampleBundle()
      let stateVersion = '1'
      const readState = vi.spyOn(HostClient.prototype, 'readState').mockResolvedValue({
        stateVersion,
        commentsThroughSequence: '0',
        snapshot: { ...initialBundle, version: 1, docId: 'test-doc' },
      })
      const readComments = vi.spyOn(HostClient.prototype, 'readComments').mockResolvedValue([])
      const listListeners = vi.spyOn(HostClient.prototype, 'listListeners').mockResolvedValue({
        observedAt: new Date().toISOString(),
        listeners: [{ listenerId: 'l1', name: 'Agent', lastSeenAt: new Date().toISOString(), expiresAt: new Date().toISOString() }],
      })
      const autosave = vi.spyOn(HostClient.prototype, 'autosave').mockImplementation(async () => {
        stateVersion = '2'
        return { stateVersion, savedAt: new Date().toISOString(), historyWindowId: 'win-1' }
      })
      let resolveHandoff: ((val: HostHandoffCommit) => void) | null = null
      let rejectHandoff: ((err: Error) => void) | null = null
      const commitHandoff = vi.spyOn(HostClient.prototype, 'commitHandoff').mockImplementation(() => {
        return new Promise<HostHandoffCommit>((resolve, reject) => {
          resolveHandoff = resolve
          rejectHandoff = reject
        })
      })

      const script = document.createElement('script')
      script.id = 'taco-host-capability'
      script.type = 'application/taco+host'
      script.textContent = JSON.stringify({ version: 1, tacoId: 'test-taco-id', apiBase: '/v1/tacos/test-taco-id' })
      document.head.append(script)

      const root = document.createElement('div')
      const browser = new FileBrowser(root, initialBundle)
      const controller = attachHostedSession(browser)!
      try {
        await controller.session.start()
        const saveBtn = root.querySelector<HTMLButtonElement>('.save-button')!
        const copyBtn = root.querySelector<HTMLButtonElement>('.copy-review-main')!
        expect(saveBtn.classList.contains('is-dirty')).toBe(false)
        expect(copyBtn.classList.contains('is-dirty')).toBe(false)

        // Edit content first so handoff has something to commit
        browser['updateFileContent'](initialBundle.files[0].path, '# Handoff Content\n', undefined)
        expect(saveBtn.classList.contains('is-dirty')).toBe(true)
        await controller.session.flush()
        expect(saveBtn.classList.contains('is-dirty')).toBe(false)

        // Start handoff
        const handoffPromise = controller.session.handoff()
        await vi.waitFor(() => expect(commitHandoff).toHaveBeenCalledTimes(1))
        expect(controller.session.hasPendingWrites()).toBe(true)
        expect(root.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(true)
        expect(root.querySelector('.copy-review-main')?.classList.contains('is-dirty')).toBe(true)

        rejectHandoff!(new HostTransportError('network disconnected'))

        // Retry starts
        await vi.waitFor(() => expect(commitHandoff).toHaveBeenCalledTimes(2))
        expect(controller.session.hasPendingWrites()).toBe(true)
        expect(root.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(true)

        // Settle retry successfully
        resolveHandoff!({ handoffId: 'h-1', changed: true, event: null })
        const outcome = await handoffPromise
        expect(outcome.kind).toBe('done')
        expect(controller.session.hasPendingWrites()).toBe(false)
        expect(root.querySelector('.save-button')?.classList.contains('is-dirty')).toBe(false)
        expect(root.querySelector('.copy-review-main')?.classList.contains('is-dirty')).toBe(false)
      } finally {
        browser.destroy()
        script.remove()
        readState.mockRestore()
        readComments.mockRestore()
        listListeners.mockRestore()
        autosave.mockRestore()
        commitHandoff.mockRestore()
        document.getElementById('taco-host-styles')?.remove()
      }
    })

    it('Cleans up session unload listener on unsupported status without warning on local save', async () => {
      const initialBundle = createSampleBundle()
      const readState = vi.spyOn(HostClient.prototype, 'readState').mockResolvedValue(null)
      const readComments = vi.spyOn(HostClient.prototype, 'readComments').mockResolvedValue([])
      const listListeners = vi.spyOn(HostClient.prototype, 'listListeners').mockResolvedValue({ observedAt: '', listeners: [] })
      const script = document.createElement('script')
      script.id = 'taco-host-capability'
      script.type = 'application/taco+host'
      script.textContent = JSON.stringify({ version: 1, tacoId: 'test-taco-id', apiBase: '/v1/tacos/test-taco-id' })
      document.head.append(script)

      const root = document.createElement('div')
      const browser = new FileBrowser(root, initialBundle)
      const controller = attachHostedSession(browser)!

      // Add pre-ready edit
      controller.session.markContentChanged()
      expect(controller.session['unloadGuarded']).toBe(true)

      try {
        await controller.session.start()
        expect(controller.session.currentStatus.readiness).toBe('unsupported')
        // Session unload guard must be released!
        expect(controller.session['unloadGuarded']).toBe(false)
        expect(controller.session.hasPendingWrites()).toBe(false)

        // Local beforeunload event simulation
        const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
        browser['handleBeforeUnload'](event)
        // With no local dirty edits on tracker, no unload warning
        expect(event.defaultPrevented).toBe(false)
      } finally {
        browser.destroy()
        script.remove()
        readState.mockRestore()
        readComments.mockRestore()
        listListeners.mockRestore()
        document.getElementById('taco-host-styles')?.remove()
      }
    })

    it('Keeps buttons dirty when comments are pending or in error, and preserves checkpoint diff after autosave', async () => {
      const initialBundle = createSampleBundle()
      initialBundle.checkpoints = {
        version: 1,
        nodes: [{ id: 'gate', title: 'Gate', after: [], documents: [{ path: initialBundle.files[0].path }] }],
        documents: [],
      }
      let stateVersion = '1'
      const readState = vi.spyOn(HostClient.prototype, 'readState').mockResolvedValue({
        stateVersion,
        commentsThroughSequence: '0',
        snapshot: { ...initialBundle, version: 1, docId: 'test-doc' },
      })
      const readComments = vi.spyOn(HostClient.prototype, 'readComments').mockResolvedValue([])
      const listListeners = vi.spyOn(HostClient.prototype, 'listListeners').mockResolvedValue({ observedAt: '', listeners: [] })
      const autosave = vi.spyOn(HostClient.prototype, 'autosave').mockImplementation(async () => {
        stateVersion = '2'
        return { stateVersion, savedAt: new Date().toISOString(), historyWindowId: 'win-1' }
      })
      const mutateComment = vi.spyOn(HostClient.prototype, 'mutateComment').mockRejectedValue(new Error('comment network error'))
      const script = document.createElement('script')
      script.id = 'taco-host-capability'
      script.type = 'application/taco+host'
      script.textContent = JSON.stringify({ version: 1, tacoId: 'test-taco-id', apiBase: '/v1/tacos/test-taco-id' })
      document.head.append(script)

      const root = document.createElement('div')
      const browser = new FileBrowser(root, initialBundle)
      const controller = attachHostedSession(browser)!
      try {
        await controller.session.start()
        const saveBtn = root.querySelector<HTMLButtonElement>('.save-button')!
        const copyBtn = root.querySelector<HTMLButtonElement>('.copy-review-main')!
        expect(saveBtn.classList.contains('is-dirty')).toBe(false)

        // Update checkpoint status
        browser['changeCheckpointStatus'](initialBundle.files[0].path, 'complete')
        expect(saveBtn.classList.contains('is-dirty')).toBe(true)

        // Also trigger comment change
        // Add a new comment thread to bundle comments so computeCommentOps has an op
        browser.currentBundle.comments = [
          {
            id: 'new-thread-1',
            status: 'open',
            anchor: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [{ id: 'nm-1', author: 'Carol', body: 'New comment', createdAt: new Date().toISOString() }],
          },
        ]
        controller.session.markCommentsChanged()
        expect(saveBtn.classList.contains('is-dirty')).toBe(true)
        // Content autosaves, but comments fail with error
        await controller.session.flush()
        expect(controller.session.currentStatus.save).toBe('saved')
        expect(controller.session.currentStatus.comments).toBe('error')

        // Even though save is saved, comments is error -> buttons remain dirty!
        expect(controller.session.hasPendingWrites()).toBe(true)
        expect(saveBtn.classList.contains('is-dirty')).toBe(true)
        expect(copyBtn.classList.contains('is-dirty')).toBe(true)

        // Checkpoint changes are preserved for manual review diff
        expect(browser.getCheckpointChanges()).toEqual([
          { path: initialBundle.files[0].path, from: 'todo', to: 'complete' },
        ])
      } finally {
        browser.destroy()
        script.remove()
        readState.mockRestore()
        readComments.mockRestore()
        listListeners.mockRestore()
        autosave.mockRestore()
        mutateComment.mockRestore()
      }
    })

    it('Enters conflict state on 409 and keeps dirty indicator lit', async () => {
      const initialBundle = createSampleBundle()
      let stateVersion = '1'
      const readState = vi.spyOn(HostClient.prototype, 'readState').mockResolvedValue({
        stateVersion,
        commentsThroughSequence: '0',
        snapshot: { ...initialBundle, version: 1, docId: 'test-doc' },
      })
      const readComments = vi.spyOn(HostClient.prototype, 'readComments').mockResolvedValue([])
      const listListeners = vi.spyOn(HostClient.prototype, 'listListeners').mockResolvedValue({ observedAt: '', listeners: [] })
        const autosave = vi.spyOn(HostClient.prototype, 'autosave').mockRejectedValue(
          new HostApiError(409, 'STATE_CONFLICT', 'State changed remotely')
        )

      const script = document.createElement('script')
      script.id = 'taco-host-capability'
      script.type = 'application/taco+host'
      script.textContent = JSON.stringify({ version: 1, tacoId: 'test-taco-id', apiBase: '/v1/tacos/test-taco-id' })
      document.head.append(script)

      const root = document.createElement('div')
      const browser = new FileBrowser(root, initialBundle)
      const controller = attachHostedSession(browser)!
      try {
        await controller.session.start()
        const saveBtn = root.querySelector<HTMLButtonElement>('.save-button')!
        const copyBtn = root.querySelector<HTMLButtonElement>('.copy-review-main')!

        // Edit content
        browser['updateFileContent'](initialBundle.files[0].path, '# Edit for conflict\n', undefined)
        expect(saveBtn.classList.contains('is-dirty')).toBe(true)

        // Trigger save which results in 409 conflict
        await controller.session.flush()
        expect(controller.session.currentStatus.save).toBe('conflict')
        expect(controller.session.hasPendingWrites()).toBe(true)
        expect(saveBtn.classList.contains('is-dirty')).toBe(true)
        expect(copyBtn.classList.contains('is-dirty')).toBe(true)
      } finally {
        browser.destroy()
        script.remove()
        readState.mockRestore()
        readComments.mockRestore()
        listListeners.mockRestore()
        autosave.mockRestore()
        document.getElementById('taco-host-styles')?.remove()
      }
    })
  })
})
