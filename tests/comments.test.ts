import { describe, expect, it } from 'vitest'
import {
  canDeleteMessage,
  canEditMessage,
  createTextAnchor,
  DELETED_COMMENT_BODY,
  deleteCommentMessage,
  editCommentMessage,
  isDeletedMessage,
  normalizeCommentMessage,
  resolveTextAnchor,
  sortCommentMessages,
} from '../src/comments.ts'
import {
  COMMENT_LANE_GAP,
  commentLineReference,
  formatLineRange,
  lineNumberAt,
  lineRangeForOffsets,
  packCommentLane,
  resolveCommentPlacement,
  type CommentLaneEntry,
} from '../src/comment-position.ts'
import type { TacoCommentThread } from '../src/model.ts'

const sample = 'First paragraph.\nSecond paragraph.\nThird paragraph.'

const thread = (overrides: Partial<TacoCommentThread> = {}): TacoCommentThread => ({
  id: 'thread-1',
  anchor: createTextAnchor('spec.md', sample, 0, 16),
  status: 'open',
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
  messages: [
    { id: 'message-a', author: 'Ada', authorId: 'principal-a', body: 'First thought', createdAt: '2026-08-10T00:00:00.000Z' },
    { id: 'message-b', author: 'Grace', authorId: 'principal-b', body: 'Second thought', createdAt: '2026-08-10T00:00:01.000Z' },
  ],
  ...overrides,
})

describe('comments model', () => {
  it('creates an exact quote with bounded context', () => {
    const anchor = createTextAnchor('spec.md', sample, 17, 33)
    expect(anchor).toEqual({
      path: 'spec.md',
      position: { start: 17, end: 33 },
      quote: {
        exact: 'Second paragraph',
        prefix: 'First paragraph.\n',
        suffix: '.\nThird paragraph.',
      },
    })
  })

  it('re-anchors exact text when content shifts', () => {
    const anchor = createTextAnchor('spec.md', sample, 17, 33)
    const shifted = `Inserted preamble.\n${sample}`
    expect(resolveTextAnchor(shifted, anchor)).toEqual({ start: 36, end: 52 })
  })

  it('disambiguates identical quotes using prefix and suffix context', () => {
    const repeated = 'target\nmiddle\ntarget\n'
    const second = createTextAnchor('spec.md', repeated, 14, 20)
    expect(second.quote.exact).toBe('target')
    expect(resolveTextAnchor(repeated, second)).toEqual({ start: 14, end: 20 })
  })

  it('returns null when a quote cannot be resolved', () => {
    const anchor = createTextAnchor('spec.md', sample, 17, 33)
    expect(resolveTextAnchor('Completely different content', anchor)).toBeNull()
  })
})

describe('comment message state', () => {
  it('updates an active message and updates thread and message timestamps', () => {
    const value = thread()
    expect(editCommentMessage(value, 'message-a', 'Edited thought', '2026-08-10T00:00:02.000Z')).toBe(true)
    expect(value.messages[0]).toMatchObject({
      body: 'Edited thought',
      updatedAt: '2026-08-10T00:00:02.000Z',
    })
    expect(value.updatedAt).toBe('2026-08-10T00:00:02.000Z')
    expect(isDeletedMessage(value.messages[0])).toBe(false)
  })

  it('uses one tombstone rule for root, reply and only-message threads', () => {
    for (const id of ['message-b', 'message-a']) {
      const value = thread()
      expect(deleteCommentMessage(value, id, '2026-08-10T00:00:03.000Z')).toBe(true)
      expect(value.messages).toHaveLength(2)
      expect(value.messages.find((message) => message.id === id)).toMatchObject({
        body: DELETED_COMMENT_BODY,
        deletedAt: '2026-08-10T00:00:03.000Z',
        updatedAt: '2026-08-10T00:00:03.000Z',
      })
    }
    const only = thread()
    only.messages.splice(1)
    deleteCommentMessage(only, 'message-b', '2026-08-10T00:00:03.000Z')
    expect(only.messages).toHaveLength(1)
    expect(only.status).toBe('open')
  })

  it('normalizes inconsistent tombstones and sorts only by creation then id', () => {
    const value = thread()
    const inconsistent = { ...value.messages[0], body: 'resurrected', deletedAt: '2026-08-10T00:00:04.000Z' }
    expect(normalizeCommentMessage(inconsistent).body).toBe(DELETED_COMMENT_BODY)
    value.messages = [
      { ...value.messages[0], id: 'z', createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z' },
      { ...value.messages[1], id: 'a', createdAt: '2026-08-10T00:00:00.000Z' },
    ]
    expect(sortCommentMessages(value.messages).map(({ id }) => id)).toEqual(['a', 'z'])
  })

  it('keeps edits principal-scoped while writable deletion ignores authorship', () => {
    const message = thread().messages[0]
    expect(canEditMessage(message, 'principal-a', true)).toBe(true)
    expect(canEditMessage(message, 'principal-b', true)).toBe(false)
    expect(canEditMessage({ ...message, authorId: undefined }, 'principal-a', true)).toBe(false)
    expect(canDeleteMessage({ ...message, authorId: undefined }, true)).toBe(true)
    expect(canDeleteMessage(message, false)).toBe(false)
    const deleted = { ...message, deletedAt: '2026-08-10T00:00:02.000Z' }
    expect(canEditMessage(deleted, 'principal-a', true)).toBe(false)
    expect(canDeleteMessage(deleted, true)).toBe(false)
  })
})

describe('comment position and line calculations (TACO-6, TACO-7)', () => {
  const doc = 'Line 1: preamble\nLine 2: target block starts\nLine 3: target block ends\nLine 4: trailing note\n'

  /** Absolute lane tops for the margins `packCommentLane` returns, using the panel's margin model. */
  const laneTops = (entries: readonly CommentLaneEntry[], margins: readonly number[]): number[] => {
    const tops: number[] = []
    let cursor = 0
    for (const [index, entry] of entries.entries()) {
      const top = cursor + margins[index]
      tops.push(top)
      cursor = top + entry.height + COMMENT_LANE_GAP
    }
    return tops
  }

  it('computes 1-based line numbers from character offsets', () => {
    expect(lineNumberAt(doc, 0)).toBe(1)
    expect(lineNumberAt(doc, 10)).toBe(1)
    expect(lineNumberAt(doc, 17)).toBe(2)
    expect(lineNumberAt(doc, 1000)).toBe(5)
  })

  it('formats single lines and multi-line ranges with en dash', () => {
    expect(formatLineRange({ start: 3, end: 3 })).toBe('3')
    expect(formatLineRange({ start: 42, end: 46 })).toBe('42–46')
    expect(formatLineRange(lineRangeForOffsets(doc, 17, 44))).toBe('2')
    // Spanning line 2 and line 3:
    expect(formatLineRange(lineRangeForOffsets(doc, 17, 70))).toBe('2–3')
  })

  it('computes live comment line references from the body text', () => {
    const anchor = createTextAnchor('spec.md', doc, 17, 70)
    expect(commentLineReference(doc, anchor)).toBe('2–3')

    // Modified document with shifted text:
    const shifted = `Header inserted\n${doc}`
    expect(commentLineReference(shifted, anchor)).toBe('3–4')

    // Destroyed anchor yields null:
    expect(commentLineReference('Totally unrelated content', anchor)).toBeNull()
  })

  it('orders threads by document position and separates stale threads', () => {
    // Thread on line 3 (created first):
    const laterThread = thread({
      id: 'thread-later',
      anchor: createTextAnchor('spec.md', doc, 45, 69),
      createdAt: '2026-08-01T00:00:00Z',
    })
    // Thread on line 1 (created second):
    const earlierThread = thread({
      id: 'thread-earlier',
      anchor: createTextAnchor('spec.md', doc, 0, 16),
      createdAt: '2026-08-02T00:00:00Z',
    })
    // Thread whose quote no longer exists:
    const staleThread = thread({
      id: 'thread-stale',
      anchor: {
        path: 'spec.md',
        position: { start: 200, end: 220 },
        quote: { exact: 'Nonexistent text', prefix: '', suffix: '' },
      },
      createdAt: '2026-08-03T00:00:00Z',
    })

    const placement = resolveCommentPlacement([laterThread, earlierThread, staleThread], {
      text: doc,
      blockRange: () => null,
    })

    // Earlier in document comes first regardless of createdAt:
    expect(placement.placed.map((p) => p.thread.id)).toEqual(['thread-earlier', 'thread-later'])
    // Stale thread is in stale list:
    expect(placement.stale.map((t) => t.id)).toEqual(['thread-stale'])
  })

  it('tie-breaks threads at identical positions deterministically', () => {
    const t1 = thread({
      id: 't-1',
      anchor: createTextAnchor('spec.md', doc, 0, 16),
      createdAt: '2026-08-01T00:00:00Z',
    })
    const t2 = thread({
      id: 't-2',
      anchor: createTextAnchor('spec.md', doc, 0, 16),
      createdAt: '2026-08-02T00:00:00Z',
    })

    const placement = resolveCommentPlacement([t2, t1], {
      text: doc,
      blockRange: () => null,
    })
    expect(placement.placed.map((p) => p.thread.id)).toEqual(['t-1', 't-2'])
  })

  it('resolves a rendered-text quote that inline markup or block boundaries hide from the source', () => {
    // The reviewer selected the rendered text, which drops emphasis markers and joins blocks.
    const markdown = '# Title\n\nThe **spec** is ready for review.\n'
    const inline = createTextAnchor('spec.md', 'The spec is ready for review.', 0, 29)
    expect(commentLineReference(markdown, inline)).toBe('3')

    const paragraphs = 'Alpha paragraph.\n\nBeta paragraph.\n'
    const spanning = createTextAnchor('spec.md', 'Alpha paragraph.Beta paragraph.', 0, 31)
    expect(commentLineReference(paragraphs, spanning)).toBe('1–3')

    // A quote that exists nowhere is still reported as lost rather than mapped onto a guess.
    expect(commentLineReference(markdown, createTextAnchor('spec.md', 'Unrelated words', 0, 15))).toBeNull()
  })

  it('stacks comment cards down the lane and keeps them off their neighbours', () => {
    // Anchors far enough apart: each card holds its own anchor top.
    const spread = [
      { top: 0, height: 100 },
      { top: 300, height: 50 },
    ]
    const spreadMargins = packCommentLane(spread)
    expect(spreadMargins).toEqual([0, 188])
    expect(laneTops(spread, spreadMargins)).toEqual([0, 300])

    // Anchors closer together than a card: the later card is pushed below the earlier one.
    const crowded = [
      { top: 40, height: 120 },
      { top: 60, height: 30 },
      { top: 300, height: 20 },
    ]
    expect(laneTops(crowded, packCommentLane(crowded))).toEqual([40, 172, 300])

    // A card whose anchor scrolled above the lane origin stays at the origin.
    const above = [{ top: -80, height: 20 }, { top: 200, height: 20 }]
    expect(laneTops(above, packCommentLane(above))).toEqual([0, 200])
  })
})
