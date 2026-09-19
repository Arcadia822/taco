import { resolveTextAnchor } from './comments.ts'
import type { TacoCommentThread, TacoTextAnchor } from './model.ts'

/** Half-open start/end pair, in UTF-16 offsets or in 1-based line numbers depending on the helper. */
export interface CommentRange {
  start: number
  end: number
}

/** Live position of one comment thread inside the document currently being read. */
export interface PlacedCommentThread {
  thread: TacoCommentThread
  /** Ordering key: start offset of the anchored text in the current document. */
  offset: number
  /**
   * Anchored text range for in-document marks. Null for code-block anchors, which are marked on their
   * block element, and while the document text cannot be read at all.
   */
  range: CommentRange | null
}

export interface CommentPlacement {
  /** Resolved threads in document order: the panel lists them in exactly this order. */
  placed: PlacedCommentThread[]
  /** Threads whose anchor no longer resolves in the current document. */
  stale: TacoCommentThread[]
}

export interface CommentAnchorProbe {
  /** Plain text of the document currently being read, or null while it cannot be read yet. */
  text: string | null
  /** Live range of a code-block / Mermaid anchor, or null when its block is gone. */
  blockRange: (anchor: TacoTextAnchor) => CommentRange | null
}

const byStoredPosition = (left: TacoCommentThread, right: TacoCommentThread): number =>
  left.anchor.position.start - right.anchor.position.start
  || left.createdAt.localeCompare(right.createdAt)
  || left.id.localeCompare(right.id)

/**
 * Resolve every thread to its live document position and order them the way the document reads.
 * Threads whose anchor was destroyed by an edit are kept apart so they never attach to the wrong
 * paragraph; replies keep their own chronological order and are never reordered here.
 */
export const resolveCommentPlacement = (
  threads: readonly TacoCommentThread[],
  probe: CommentAnchorProbe,
): CommentPlacement => {
  const placed: PlacedCommentThread[] = []
  const stale: TacoCommentThread[] = []
  const readable = probe.text !== null
  for (const thread of threads) {
    const { anchor } = thread
    const range = readable
      ? (anchor.block ? probe.blockRange(anchor) : resolveTextAnchor(probe.text ?? '', anchor))
      : null
    if (range) placed.push({ thread, offset: range.start, range })
    // Unreadable text is not a lost anchor: keep the stored position until the document is rendered.
    else if (!readable) placed.push({ thread, offset: anchor.position.start, range: null })
    else stale.push(thread)
  }
  return {
    placed: placed.sort((left, right) => left.offset - right.offset || byStoredPosition(left.thread, right.thread)),
    stale: stale.sort(byStoredPosition),
  }
}

export const lineNumberAt = (text: string, offset: number): number => {
  const safe = Math.max(0, Math.min(offset, text.length))
  let line = 1
  for (let index = text.indexOf('\n'); index !== -1 && index < safe; index = text.indexOf('\n', index + 1)) line += 1
  return line
}

/** 1-based inclusive line range covered by the half-open offset range [start, end). */
export const lineRangeForOffsets = (text: string, start: number, end: number): CommentRange => ({
  start: lineNumberAt(text, start),
  end: lineNumberAt(text, end > start ? end - 1 : start),
})

/** `42` for a single line, `42–46` for a range. */
export const formatLineRange = (range: CommentRange): string =>
  range.start === range.end ? String(range.start) : `${range.start}–${range.end}`

/**
 * Line reference for an anchor resolved against the current body text, e.g. `42–46`.
 * Null when the quote cannot be located, so callers never print a guessed position.
 */
export const commentLineReference = (text: string, anchor: TacoTextAnchor): string | null => {
  if (!anchor.quote.exact) return null
  const range = resolveTextAnchor(text, anchor)
  return range ? formatLineRange(lineRangeForOffsets(text, range.start, range.end)) : null
}
