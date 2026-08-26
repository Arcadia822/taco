import { describe, expect, it } from 'vitest'
import {
  canDeleteMessage,
  canEditMessage,
  createTextAnchor,
  DELETED_COMMENT_BODY,
  deleteCommentMessage,
  editCommentMessage,
  normalizeCommentMessage,
  resolveTextAnchor,
  sortCommentMessages,
} from '../src/comments.ts'
import type { TacoCommentThread } from '../src/model.ts'

const thread = (): TacoCommentThread => ({
  id: 'thread-1',
  anchor: { path: 'spec/spec.md', position: { start: 0, end: 1 }, quote: { exact: 'A', prefix: '', suffix: '' } },
  status: 'open',
  messages: [
    { id: 'message-b', author: 'Ada', authorId: 'principal-a', body: 'Root', createdAt: '2026-08-10T00:00:00.000Z' },
    { id: 'message-a', author: 'Grace', authorId: 'principal-b', body: 'Reply', createdAt: '2026-08-10T00:00:01.000Z' },
  ],
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:01.000Z',
})

describe('local comment anchors', () => {
  it('stores exact text with surrounding context', () => {
    const text = 'Alpha repeated phrase omega'
    const anchor = createTextAnchor('spec/spec.md', text, 6, 21)
    expect(anchor.quote).toEqual({ exact: 'repeated phrase', prefix: 'Alpha ', suffix: ' omega' })
  })

  it('reanchors a quote after text is inserted before it', () => {
    const anchor = createTextAnchor('spec/spec.md', 'Before target text after', 7, 18)
    expect(resolveTextAnchor('Inserted. Before target text after', anchor)).toEqual({ start: 17, end: 28 })
  })

  it('uses quote context to disambiguate repeated text', () => {
    const text = 'first target end. second target finish.'
    const anchor = createTextAnchor('spec/spec.md', text, 25, 31)
    const changed = `prefix ${text}`
    expect(resolveTextAnchor(changed, anchor)).toEqual({ start: 32, end: 38 })
  })

  it('returns null when the quoted text was removed', () => {
    const anchor = createTextAnchor('spec/spec.md', 'Before target after', 7, 13)
    expect(resolveTextAnchor('Before replacement after', anchor)).toBeNull()
  })
})

describe('comment message state', () => {
  it('edits in place while preserving identity, attribution, creation, siblings and order', () => {
    const value = thread()
    const sibling = structuredClone(value.messages[1])
    expect(editCommentMessage(value, 'message-b', '  Corrected  ', '2026-08-10T00:00:02.000Z')).toBe(true)
    expect(value.messages[0]).toEqual({
      id: 'message-b', author: 'Ada', authorId: 'principal-a', body: 'Corrected',
      createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:02.000Z',
    })
    expect(value.messages[1]).toEqual(sibling)
    expect(value.updatedAt).toBe('2026-08-10T00:00:02.000Z')
    expect(editCommentMessage(value, 'message-b', ' Corrected ', '2026-08-10T00:00:03.000Z')).toBe(false)
    expect(value.updatedAt).toBe('2026-08-10T00:00:02.000Z')
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
