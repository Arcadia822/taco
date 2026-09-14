/**
 * Internal line diff representation.
 */
interface DiffChange {
  type: 'same' | 'add' | 'del'
  line: string
  noNewline?: boolean
}

interface SplitResult {
  lines: string[]
  hasTrailingNewline: boolean
}

function splitLines(text: string): SplitResult {
  if (text.length === 0) {
    return { lines: [], hasTrailingNewline: false }
  }
  const hasTrailingNewline = text.endsWith('\n')
  const stripped = hasTrailingNewline ? text.slice(0, -1) : text
  const lines = stripped.split('\n')
  return { lines, hasTrailingNewline }
}

type EditOp =
  | { type: 'same'; aIdx: number; bIdx: number }
  | { type: 'del'; aIdx: number }
  | { type: 'add'; bIdx: number }

/**
 * Computes the length of LCS row-by-row using linear space O(m).
 * Can traverse `a` and `b` in forward (reverse=false) or reverse (reverse=true) direction
 * directly over the source arrays without allocating intermediate reversed copies.
 */
function lcsLengths(
  a: string[],
  aStart: number,
  aEnd: number,
  b: string[],
  bStart: number,
  bEnd: number,
  reverse: boolean,
): Int32Array {
  const m = bEnd - bStart
  let prev = new Int32Array(m + 1)
  let curr = new Int32Array(m + 1)

  const aCount = aEnd - aStart
  for (let i = 0; i < aCount; i++) {
    const aLine = reverse ? a[aEnd - 1 - i] : a[aStart + i]
    for (let j = 0; j < m; j++) {
      const bLine = reverse ? b[bEnd - 1 - j] : b[bStart + j]
      if (aLine === bLine) {
        curr[j + 1] = prev[j] + 1
      } else {
        const left = curr[j]
        const up = prev[j + 1]
        curr[j + 1] = left > up ? left : up
      }
    }
    // Swap rows; curr[0] is always 0 and all curr[j+1] are overwritten on every iteration
    const temp = prev
    prev = curr
    curr = temp
  }

  return prev
}

/**
 * Hirschberg's linear-memory algorithm for finding the Longest Common Subsequence.
 * Time complexity: O(n * m)
 * Space complexity: O(m)
 */
function hirschberg(
  a: string[],
  aStart: number,
  aEnd: number,
  b: string[],
  bStart: number,
  bEnd: number,
  ops: EditOp[],
): void {
  // Trim common prefix
  while (aStart < aEnd && bStart < bEnd && a[aStart] === b[bStart]) {
    ops.push({ type: 'same', aIdx: aStart, bIdx: bStart })
    aStart++
    bStart++
  }

  // Trim common suffix
  let suffixCount = 0
  while (aStart < aEnd && bStart < bEnd && a[aEnd - 1] === b[bEnd - 1]) {
    suffixCount++
    aEnd--
    bEnd--
  }

  const n = aEnd - aStart
  const m = bEnd - bStart

  if (n === 0) {
    for (let j = bStart; j < bEnd; j++) {
      ops.push({ type: 'add', bIdx: j })
    }
  } else if (m === 0) {
    for (let i = aStart; i < aEnd; i++) {
      ops.push({ type: 'del', aIdx: i })
    }
  } else if (n === 1) {
    const single = a[aStart]
    let found = -1
    for (let j = bStart; j < bEnd; j++) {
      if (b[j] === single) {
        found = j
        break
      }
    }
    if (found !== -1) {
      for (let j = bStart; j < found; j++) {
        ops.push({ type: 'add', bIdx: j })
      }
      ops.push({ type: 'same', aIdx: aStart, bIdx: found })
      for (let j = found + 1; j < bEnd; j++) {
        ops.push({ type: 'add', bIdx: j })
      }
    } else {
      ops.push({ type: 'del', aIdx: aStart })
      for (let j = bStart; j < bEnd; j++) {
        ops.push({ type: 'add', bIdx: j })
      }
    }
  } else {
    // Split a in half
    const midA = aStart + Math.floor(n / 2)

    // Forward LCS from aStart..midA against bStart..bEnd
    const scoreL = lcsLengths(a, aStart, midA, b, bStart, bEnd, false)

    // Backward LCS from midA..aEnd against bStart..bEnd (in reverse without copying)
    const scoreR = lcsLengths(a, midA, aEnd, b, bStart, bEnd, true)

    // Find optimal split point in b: max(scoreL[j] + scoreR[m - j])
    let maxVal = -1
    let bestJ = 0
    for (let j = 0; j <= m; j++) {
      const total = scoreL[j] + scoreR[m - j]
      if (total > maxVal) {
        maxVal = total
        bestJ = j
      }
    }

    const midB = bStart + bestJ

    // Conquer left and right
    hirschberg(a, aStart, midA, b, bStart, midB, ops)
    hirschberg(a, midA, aEnd, b, midB, bEnd, ops)
  }

  // Add back trimmed common suffix
  for (let s = 0; s < suffixCount; s++) {
    ops.push({ type: 'same', aIdx: aEnd + s, bIdx: bEnd + s })
  }
}

/**
 * Computes diff changes list with accurate trailing newline tracking.
 */
function computeDiffChanges(
  oldLines: string[],
  oldHasNewline: boolean,
  newLines: string[],
  newHasNewline: boolean,
): DiffChange[] {
  const ops: EditOp[] = []
  hirschberg(oldLines, 0, oldLines.length, newLines, 0, newLines.length, ops)

  const changes: DiffChange[] = []
  const oldLen = oldLines.length
  const newLen = newLines.length

  for (const op of ops) {
    if (op.type === 'same') {
      const isLastOld = op.aIdx === oldLen - 1
      const isLastNew = op.bIdx === newLen - 1

      const oldEofNoNewline = isLastOld && !oldHasNewline
      const newEofNoNewline = isLastNew && !newHasNewline

      if (oldEofNoNewline !== newEofNoNewline) {
        // Newline status differs at EOF for this line!
        changes.push({
          type: 'del',
          line: oldLines[op.aIdx],
          noNewline: oldEofNoNewline,
        })
        changes.push({
          type: 'add',
          line: newLines[op.bIdx],
          noNewline: newEofNoNewline,
        })
      } else {
        changes.push({
          type: 'same',
          line: oldLines[op.aIdx],
          noNewline: oldEofNoNewline,
        })
      }
    } else if (op.type === 'del') {
      const isLastOld = op.aIdx === oldLen - 1
      changes.push({
        type: 'del',
        line: oldLines[op.aIdx],
        noNewline: isLastOld && !oldHasNewline,
      })
    } else if (op.type === 'add') {
      const isLastNew = op.bIdx === newLen - 1
      changes.push({
        type: 'add',
        line: newLines[op.bIdx],
        noNewline: isLastNew && !newHasNewline,
      })
    }
  }

  return changes
}

interface HunkRange {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: string[]
}

/**
 * Computes a standard unified diff between two multi-line texts.
 */
export function createUnifiedDiff(oldText: string, newText: string, path: string): string {
  if (oldText === newText) return ''

  const oldSplit = splitLines(oldText)
  const newSplit = splitLines(newText)

  const diff = computeDiffChanges(
    oldSplit.lines,
    oldSplit.hasTrailingNewline,
    newSplit.lines,
    newSplit.hasTrailingNewline,
  )

  const context = 3
  const hunks: HunkRange[] = []
  let k = 0

  // Incremental line number tracking across all hunks: O(diff.length) total
  let oldLineNum = 1
  let newLineNum = 1
  let curPos = 0

  while (k < diff.length) {
    // Find next change
    while (k < diff.length && diff[k].type === 'same') k++
    if (k >= diff.length) break

    const start = Math.max(0, k - context)
    let end = k
    while (end < diff.length) {
      if (diff[end].type !== 'same') {
        end++
      } else {
        // Look ahead to see if another edit is within 2 * context
        let nextEdit = end
        while (nextEdit < diff.length && diff[nextEdit].type === 'same') nextEdit++
        if (nextEdit < diff.length && nextEdit - end <= 2 * context) {
          end = nextEdit
        } else {
          end = Math.min(diff.length, end + context)
          break
        }
      }
    }

    // Advance line numbers incrementally from curPos to start
    while (curPos < start) {
      const t = diff[curPos].type
      if (t !== 'add') oldLineNum++
      if (t !== 'del') newLineNum++
      curPos++
    }

    const hunkOldStartLine = oldLineNum
    const hunkNewLineStartLine = newLineNum

    const hunkLines: string[] = []
    let oldCount = 0
    let newCount = 0

    // Group consecutive edits into del and add blocks so all deletions come before additions
    let p = start
    while (p < end) {
      if (diff[p].type === 'same') {
        hunkLines.push(` ${diff[p].line}`)
        oldCount++
        newCount++
        if (diff[p].noNewline) {
          hunkLines.push('\\ No newline at end of file')
        }
        p++
      } else {
        // Collect consecutive diff edits
        const delItems: DiffChange[] = []
        const addItems: DiffChange[] = []
        while (p < end && diff[p].type !== 'same') {
          if (diff[p].type === 'del') {
            delItems.push(diff[p])
          } else if (diff[p].type === 'add') {
            addItems.push(diff[p])
          }
          p++
        }
        // Output deletions first
        for (const item of delItems) {
          hunkLines.push(`-${item.line}`)
          oldCount++
        }
        if (delItems.length > 0 && delItems[delItems.length - 1].noNewline) {
          hunkLines.push('\\ No newline at end of file')
        }
        // Output additions next
        for (const item of addItems) {
          hunkLines.push(`+${item.line}`)
          newCount++
        }
        if (addItems.length > 0 && addItems[addItems.length - 1].noNewline) {
          hunkLines.push('\\ No newline at end of file')
        }
      }
    }

    // Advance line numbers across this hunk (start to end)
    while (curPos < end) {
      const t = diff[curPos].type
      if (t !== 'add') oldLineNum++
      if (t !== 'del') newLineNum++
      curPos++
    }

    // Standard patch convention: if count is 0, start is line before, or 0 if start was line 1
    const oldStart = oldCount === 0 ? (hunkOldStartLine === 1 ? 0 : hunkOldStartLine - 1) : hunkOldStartLine
    const newStart = newCount === 0 ? (hunkNewLineStartLine === 1 ? 0 : hunkNewLineStartLine - 1) : hunkNewLineStartLine

    hunks.push({
      oldStart,
      oldCount,
      newStart,
      newCount,
      lines: hunkLines,
    })

    k = end
  }

  if (hunks.length === 0) return ''

  const formattedHunks = hunks.map((hunk) => {
    const oldPart = hunk.oldCount === 1 ? `${hunk.oldStart}` : `${hunk.oldStart},${hunk.oldCount}`
    const newPart = hunk.newCount === 1 ? `${hunk.newStart}` : `${hunk.newStart},${hunk.newCount}`
    return `@@ -${oldPart} +${newPart} @@\n${hunk.lines.join('\n')}`
  })

  return `--- a/${path}\n+++ b/${path}\n${formattedHunks.join('\n')}\n`
}
