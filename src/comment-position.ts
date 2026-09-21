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

/** Gap between two comment cards, matching the `.comment-composer, .comment-thread` bottom margin. */
export const COMMENT_LANE_GAP = 12

/** Measured geometry of one comment card in the panel, in lane scroll coordinates. */
export interface CommentLaneEntry {
  /** Anchor top of the card. */
  top: number
  /** Rendered card height. */
  height: number
}

/**
 * Stack cards down the lane in the given order: each card holds its anchor top unless the previous
 * card and its gap reach further, and no card is ever placed above the lane origin. Returns the top
 * margin to apply per entry, in the same order, so a caller with real elements only writes styles.
 */
export const packCommentLane = (entries: readonly CommentLaneEntry[], gap = COMMENT_LANE_GAP): number[] => {
  const margins: number[] = []
  let bottom = 0
  for (const { top, height } of entries) {
    const target = Math.max(0, top, bottom)
    margins.push(target - bottom)
    bottom = target + height + gap
  }
  return margins
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
 *
 * Comments are captured from the reading surface, whose plain text differs from Markdown at inline
 * markup and block boundaries. An exact match against the source is tried first; when it fails, the
 * quote is retried against a markup-stripped projection of the same source and the match is mapped
 * back to source offsets, so a live comment is never reported as position-lost merely because the
 * reviewer selected rendered text. Null when neither attempt locates the quote, so callers never
 * print a guessed position.
 */
export const commentLineReference = (text: string, anchor: TacoTextAnchor): string | null => {
  if (!anchor.quote.exact) return null
  const range = resolveTextAnchor(text, anchor) ?? mapNormalizedAnchor(text, anchor)
  return range ? formatLineRange(lineRangeForOffsets(text, range.start, range.end)) : null
}

const THEMATIC_BREAK = /^ {0,3}(?:[-*_][ \t]*){3,}$/
const BLOCK_QUOTE = /^ {0,3}>[ \t]?/
const BLOCK_MARKER = /^(?:#{1,6}(?:[ \t]+|$)|(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)|\[[ xX]\][ \t]+)/
const TAG = /<\/?[A-Za-z][^>\n]*>/y
const LINK = /\[(?<label>[^\]\n]*)\]\([^()\n]*\)/y
const IMAGE = /!\[[^\]\n]*\]\([^()\n]*\)/y
const ESCAPE = /\\(?<char>.)/y
const DELIMITER = /(?:\*{1,3}|_{1,3}|~~|`+)/y

const isSpace = (char: string | undefined): boolean => char === undefined || /\s/.test(char)
// Approximates CommonMark flanking so only real emphasis delimiters are stripped: `file_name` and
// the `*` in `2 * 3` stay in the projection, while both delimiters of `**spec**` go.
const isDelimiterSyntax = (source: string, start: number, end: number): boolean =>
  (isSpace(source[start - 1]) && !isSpace(source[end])) || (!isSpace(source[start - 1]) && isSpace(source[end]))

const stripBlockSyntax = (source: string, start: number): number => {
  let index = start
  for (let pass = 0; pass < 3; pass += 1) {
    const quoted = BLOCK_QUOTE.exec(source.slice(index))
    if (quoted) { index += quoted[0].length; continue }
    const marker = BLOCK_MARKER.exec(source.slice(index))
    if (!marker) break
    index += marker[0].length
  }
  return index
}

/**
 * Project Markdown onto the text its reading surface shows: block prefixes, emphasis and code
 * delimiters, link and image syntax, and HTML tags contribute no characters, and block boundaries
 * lose their separating newline. Every kept character records its source offset, so a match here can
 * be reported as a real source position. Table pipes stay literal: guessing there would trade a
 * missing reference for a wrong one.
 */
const normalizeForMatching = (source: string): { text: string; offsets: number[] } => {
  const kept: string[] = []
  const offsets: number[] = []
  const keep = (value: string, from: number): void => {
    for (let offset = 0; offset < value.length; offset += 1) {
      kept.push(value[offset])
      offsets.push(from + offset)
    }
  }
  let lineStart = 0
  while (lineStart <= source.length) {
    const breakAt = source.indexOf('\n', lineStart)
    const lineEnd = breakAt === -1 ? source.length : breakAt
    let index = THEMATIC_BREAK.test(source.slice(lineStart, lineEnd)) ? lineEnd : stripBlockSyntax(source, lineStart)
    while (index < lineEnd) {
      ESCAPE.lastIndex = index
      const escaped = ESCAPE.exec(source)
      if (escaped) { keep(escaped.groups!.char, index + 1); index += escaped[0].length; continue }
      IMAGE.lastIndex = index
      if (IMAGE.test(source)) { index = IMAGE.lastIndex; continue }
      LINK.lastIndex = index
      const link = LINK.exec(source)
      if (link) { keep(link.groups!.label, index + 1); index += link[0].length; continue }
      TAG.lastIndex = index
      if (TAG.test(source)) { index = TAG.lastIndex; continue }
      DELIMITER.lastIndex = index
      const delimiter = DELIMITER.exec(source)
      if (delimiter && isDelimiterSyntax(source, index, index + delimiter[0].length)) { index += delimiter[0].length; continue }
      keep(source[index], index)
      index += 1
    }
    if (breakAt === -1) break
    lineStart = breakAt + 1
  }
  return { text: kept.join(''), offsets }
}

/** Resolve an anchor against the markup-stripped projection, then map the hit back to source offsets. */
const mapNormalizedAnchor = (text: string, anchor: TacoTextAnchor): CommentRange | null => {
  const { text: plain, offsets } = normalizeForMatching(text)
  const hit = resolveTextAnchor(plain, anchor)
  if (!hit) return null
  const start = offsets[hit.start]
  const end = offsets[hit.end - 1]
  return start === undefined || end === undefined ? null : { start, end: end + 1 }
}
