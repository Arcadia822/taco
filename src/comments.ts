import type { TacoCommentThread, TacoTextAnchor } from './model.ts'

const CONTEXT_LENGTH = 32

export const createTextAnchor = (path: string, text: string, start: number, end: number): TacoTextAnchor => ({
  path,
  position: { start, end },
  quote: {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + CONTEXT_LENGTH),
  },
})

export const resolveTextAnchor = (text: string, anchor: TacoTextAnchor): { start: number; end: number } | null => {
  const { exact, prefix, suffix } = anchor.quote
  const { start, end } = anchor.position
  if (text.slice(start, end) === exact) return { start, end }

  const candidates: number[] = []
  let cursor = text.indexOf(exact)
  while (cursor !== -1) {
    candidates.push(cursor)
    cursor = text.indexOf(exact, cursor + 1)
  }
  if (!candidates.length) return null

  const contextScore = (candidate: number): number => {
    let score = 0
    const before = text.slice(Math.max(0, candidate - prefix.length), candidate)
    const after = text.slice(candidate + exact.length, candidate + exact.length + suffix.length)
    for (let index = 1; index <= Math.min(prefix.length, before.length); index += 1) {
      if (prefix.at(-index) !== before.at(-index)) break
      score += 2
    }
    for (let index = 0; index < Math.min(suffix.length, after.length); index += 1) {
      if (suffix[index] !== after[index]) break
      score += 2
    }
    return score - Math.abs(candidate - start) / Math.max(text.length, 1)
  }

  const best = candidates.sort((a, b) => contextScore(b) - contextScore(a))[0]
  return { start: best, end: best + exact.length }
}

export const commentsForPath = (threads: TacoCommentThread[] | undefined, path: string): TacoCommentThread[] =>
  (threads ?? [])
    .filter((thread) => thread.anchor.path === path)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
