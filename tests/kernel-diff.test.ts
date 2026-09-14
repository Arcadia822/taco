import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createUnifiedDiff } from '../src/kernel/diff.ts'

/**
 * Applies unified diff using system patch utility.
 * Creates a unique temp directory and cleans it up after execution.
 */
function applySystemPatch(original: string, diffText: string): string {
  if (!diffText) return original

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taco-diff-test-'))
  const origFilePath = path.join(tempDir, 'file.txt')
  const patchFilePath = path.join(tempDir, 'diff.patch')

  try {
    fs.writeFileSync(origFilePath, original, 'utf8')
    fs.writeFileSync(patchFilePath, diffText, 'utf8')

    // Invoke patch command. -p1 strips a/ or b/ prefixes.
    // -s: silent. --posix / standard POSIX behavior.
    const proc = spawnSync('patch', ['-u', '-p1', '-i', patchFilePath, origFilePath], {
      cwd: tempDir,
      encoding: 'utf8',
    })

    if (proc.status !== 0) {
      throw new Error(`patch failed (status ${proc.status}):\nSTDOUT: ${proc.stdout}\nSTDERR: ${proc.stderr}\nDIFF:\n${diffText}`)
    }

    return fs.readFileSync(origFilePath, 'utf8')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

describe('createUnifiedDiff with system patch', () => {
  it('returns empty string when content is identical', () => {
    expect(createUnifiedDiff('hello\nworld\n', 'hello\nworld\n', 'file.txt')).toBe('')
    expect(createUnifiedDiff('', '', 'file.txt')).toBe('')
    expect(createUnifiedDiff('single line', 'single line', 'file.txt')).toBe('')
  })

  it('handles empty old file (creation) with system patch', () => {
    const oldText = ''
    const newText = 'line 1\nline 2\n'
    const diff = createUnifiedDiff(oldText, newText, 'file.txt')
    expect(diff).toContain('--- a/file.txt')
    expect(diff).toContain('+++ b/file.txt')
    expect(diff).toContain('@@ -0,0 +1,2 @@')
    expect(diff).toContain('+line 1\n+line 2')
    expect(applySystemPatch(oldText, diff)).toBe(newText)
  })

  it('handles empty new file (deletion) with system patch', () => {
    const oldText = 'line 1\nline 2\n'
    const newText = ''
    const diff = createUnifiedDiff(oldText, newText, 'file.txt')
    expect(diff).toContain('@@ -1,2 +0,0 @@')
    expect(diff).toContain('-line 1\n-line 2')
    expect(applySystemPatch(oldText, diff)).toBe(newText)
  })

  it('handles newline vs no-newline at EOF with system patch', () => {
    const oldWithout = 'line 1\nline 2'
    const newWith = 'line 1\nline 2\n'
    const diffAddNewline = createUnifiedDiff(oldWithout, newWith, 'file.txt')
    expect(diffAddNewline).toContain('\\ No newline at end of file')
    expect(applySystemPatch(oldWithout, diffAddNewline)).toBe(newWith)

    const diffRemoveNewline = createUnifiedDiff(newWith, oldWithout, 'file.txt')
    expect(diffRemoveNewline).toContain('\\ No newline at end of file')
    expect(applySystemPatch(newWith, diffRemoveNewline)).toBe(oldWithout)
  })

  it('handles files with no trailing newline on either side with changes', () => {
    const oldText = 'alpha\nbeta\ngamma'
    const newText = 'alpha\nbeta 2\ngamma'
    const diff = createUnifiedDiff(oldText, newText, 'file.txt')
    expect(diff).toContain('\\ No newline at end of file')
    expect(applySystemPatch(oldText, diff)).toBe(newText)
  })

  it('generates multiple separated hunks and applies cleanly', () => {
    const oldLines: string[] = []
    const newLines: string[] = []
    for (let i = 1; i <= 50; i++) {
      oldLines.push(`line ${i}`)
      newLines.push(`line ${i}`)
    }
    // Edit line 5 and line 45
    oldLines[4] = 'old line 5'
    newLines[4] = 'new line 5'
    oldLines[44] = 'old line 45'
    newLines[44] = 'new line 45'

    const oldText = oldLines.join('\n') + '\n'
    const newText = newLines.join('\n') + '\n'
    const diff = createUnifiedDiff(oldText, newText, 'file.txt')

    const hunkHeaders = diff.match(/@@ -\d+,\d+ \+\d+,\d+ @@/g)
    expect(hunkHeaders).not.toBeNull()
    expect(hunkHeaders!.length).toBe(2)
    expect(applySystemPatch(oldText, diff)).toBe(newText)
  })

  it('correctly handles >4000 lines without returning fake summary and applies patch', () => {
    const totalLines = 4500
    const oldArr: string[] = []
    const newArr: string[] = []
    for (let i = 1; i <= totalLines; i++) {
      oldArr.push(`entry-${i}`)
      newArr.push(`entry-${i}`)
    }
    // Change near beginning and near end
    oldArr[10] = 'entry-11-old'
    newArr[10] = 'entry-11-new'
    oldArr[4200] = 'entry-4201-old'
    newArr[4200] = 'entry-4201-new'

    const oldText = oldArr.join('\n') + '\n'
    const newText = newArr.join('\n') + '\n'

    const diff = createUnifiedDiff(oldText, newText, 'file.txt')

    // Must NOT contain the old fake summary:
    expect(diff).not.toContain('(file changed,')
    expect(diff).toContain('-entry-11-old')
    expect(diff).toContain('+entry-11-new')
    expect(diff).toContain('-entry-4201-old')
    expect(diff).toContain('+entry-4201-new')

    expect(applySystemPatch(oldText, diff)).toBe(newText)
  })

  it('formats single-line hunk headers correctly without comma when count is 1', () => {
    const oldText = 'hello\n'
    const newText = 'world\n'
    const diff = createUnifiedDiff(oldText, newText, 'file.txt')
    expect(diff).toContain('@@ -1 +1 @@')
    expect(applySystemPatch(oldText, diff)).toBe(newText)
  })

  it('handles line moved to/from EOF with differing newline', () => {
    // Moved to EOF without newline
    const orig1 = 'hello\nworld\nfoo\n'
    const mod1 = 'world\nfoo\nhello'
    const diff1 = createUnifiedDiff(orig1, mod1, 'file.txt')
    expect(diff1).toContain('\\ No newline at end of file')
    expect(applySystemPatch(orig1, diff1)).toBe(mod1)

    // Moved from EOF without newline to start
    const orig2 = 'world\nfoo\nhello'
    const mod2 = 'hello\nworld\nfoo\n'
    const diff2 = createUnifiedDiff(orig2, mod2, 'file.txt')
    expect(diff2).toContain('\\ No newline at end of file')
    expect(applySystemPatch(orig2, diff2)).toBe(mod2)

    // Same text line at EOF changing newline status with duplicates elsewhere
    const orig3 = 'alpha\nbeta\nalpha'
    const mod3 = 'alpha\nbeta\nalpha\n'
    const diff3 = createUnifiedDiff(orig3, mod3, 'file.txt')
    expect(applySystemPatch(orig3, diff3)).toBe(mod3)
  })
})
