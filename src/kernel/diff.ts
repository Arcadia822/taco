export interface FileDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

/**
 * Computes a standard unified diff between two multi-line texts.
 */
export function createUnifiedDiff(oldText: string, newText: string, path: string): string {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  if (oldText === newText) return ''

  // LCS (Longest Common Subsequence) DP or Myers diff for lines
  const n = oldLines.length
  const m = newLines.length

  // Build edit distance matrix for reasonable-sized files
  const maxLines = 4000
  if (n > maxLines || m > maxLines) {
    // For very large files, return summary diff
    return `--- a/${path}\n+++ b/${path}\n@@ -1,${n} +1,${m} @@\n- (file changed, ${n} lines replaced by ${m} lines)\n+ (file changed, ${n} lines replaced by ${m} lines)`
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (oldLines[i] === newLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  // Backtrack to find diff edits
  let i = n
  let j = m
  const diff: Array<{ type: 'same' | 'add' | 'del'; line: string }> = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diff.unshift({ type: 'same', line: oldLines[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({ type: 'add', line: newLines[j - 1] })
      j--
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diff.unshift({ type: 'del', line: oldLines[i - 1] })
      i--
    }
  }

  // Group into hunks with 3 lines of context
  const context = 3
  const hunks: string[] = []
  let k = 0

  while (k < diff.length) {
    // Find next edit
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

    // Calculate line numbers for hunk
    let oldLineNum = 1
    for (let p = 0; p < start; p++) {
      if (diff[p].type !== 'add') oldLineNum++
    }
    let newLineNum = 1
    for (let p = 0; p < start; p++) {
      if (diff[p].type !== 'del') newLineNum++
    }

    const hunkLines: string[] = []
    let oldHunkCount = 0
    let newHunkCount = 0

    for (let p = start; p < end; p++) {
      const item = diff[p]
      if (item.type === 'same') {
        hunkLines.push(` ${item.line}`)
        oldHunkCount++
        newHunkCount++
      } else if (item.type === 'del') {
        hunkLines.push(`-${item.line}`)
        oldHunkCount++
      } else if (item.type === 'add') {
        hunkLines.push(`+${item.line}`)
        newHunkCount++
      }
    }

    hunks.push(`@@ -${oldLineNum},${oldHunkCount} +${newLineNum},${newHunkCount} @@\n${hunkLines.join('\n')}`)
    k = end
  }

  if (hunks.length === 0) return ''
  return `--- a/${path}\n+++ b/${path}\n${hunks.join('\n')}`
}
