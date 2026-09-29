import { describe, expect, it, vi } from 'vitest'
import { HostedSession } from '../src/hosted-session.ts'
import type {
  HostAutosaveResult,
  HostClient,
  HostCommentMutation,
  HostCommentThread,
  HostHandoffCommit,
  HostSnapshot,
  HostStateResponse,
} from '../src/host-client.ts'
import type { TacoBundle } from '../src/model.ts'

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
})
