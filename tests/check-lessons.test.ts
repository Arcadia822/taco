import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const checkLessonsScript = resolve('scripts/check-lessons.mjs')
const repoLessons = resolve('LESSONS.md')

const fixtures: string[] = []

afterEach(() => {
  while (fixtures.length > 0) {
    rmSync(fixtures.pop() as string, { recursive: true, force: true })
  }
})

function createFixtureDir(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'taco-check-lessons-test-'))
  fixtures.push(dir)
  const lessonsContent = content !== undefined ? content : readFileSync(repoLessons, 'utf8')
  writeFileSync(join(dir, 'LESSONS.md'), lessonsContent, 'utf8')
  return dir
}

function runCheck(lessonsPath: string): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [checkLessonsScript, lessonsPath], {
    cwd: resolve('.'),
    encoding: 'utf8',
  })
  return {
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  }
}

describe('check-lessons.mjs behavior regressions', () => {
  it('passes on clean repo LESSONS.md without mutations', () => {
    const dir = createFixtureDir()
    const res = runCheck(join(dir, 'LESSONS.md'))
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('LESSONS.md validation passed: 4 lessons verified.')
  })

  it('rejects missing or empty Evidence section', () => {
    const base = readFileSync(repoLessons, 'utf8')
    const mutated = base.replace(
      '#### Evidence\n\n- 2026-09-26 — PR #54: local dependency drift after ad-hoc package install caused image-sanitization and editor test failures resolved by `npm ci` (recorded in memory `fdc8fe3e`).',
      '#### Evidence\n',
    )
    const dir = createFixtureDir(mutated)
    const res = runCheck(join(dir, 'LESSONS.md'))
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('Error in LESSON-001: Missing or empty "#### Evidence" section')
  })

  it('rejects Occurrences count mismatch against evidence list items', () => {
    const base = readFileSync(repoLessons, 'utf8')
    const mutated = base.replace('- **Occurrences**: 1', '- **Occurrences**: 2')
    const dir = createFixtureDir(mutated)
    const res = runCheck(join(dir, 'LESSONS.md'))
    expect(res.status).toBe(1)
    expect(res.stderr).toContain(
      'Error in LESSON-001: Occurrences count (2) does not match evidence list item count (1)',
    )
  })

  it('rejects un-escalated status when Occurrences >= 3', () => {
    const base = readFileSync(repoLessons, 'utf8')
    const mutated = base
      .replace(
        /\| \[LESSON-001\]\(#[^)]+\)\s*\|\s*[^|]+\|\s*\d+\s*\|\s*`?\*?open\*?`?\s*\|/,
        '| [LESSON-001](#lesson-001-local-dependency-drift-pollutes-test-runs)         | Local Dependency Drift Pollutes Test Runs         |      3      |   **open**    |',
      )
      .replace(
        '- **Occurrences**: 1\n- **Status**: `open`',
        '- **Occurrences**: 3\n- **Status**: `open`',
      )
      .replace(
        '#### Evidence\n\n- 2026-09-26 — PR #54: local dependency drift after ad-hoc package install caused image-sanitization and editor test failures resolved by `npm ci` (recorded in memory `fdc8fe3e`).',
        '#### Evidence\n\n- Evidence 1\n- Evidence 2\n- Evidence 3',
      )
    expect(mutated).not.toBe(base)
    const dir = createFixtureDir(mutated)
    const res = runCheck(join(dir, 'LESSONS.md'))
    expect(res.status).toBe(1)
    expect(res.stderr).toContain(
      'Occurrences is 3 >= 3, but status is "open". Must be escalated to a structural mechanism',
    )
  })

  it('rejects nonexistent file path in Guard', () => {
    const base = readFileSync(repoLessons, 'utf8')
    const mutated = base.replace(
      '- **Guard**: `package-lock.json`, `.github/workflows/ci.yml`',
      '- **Guard**: `nonexistent-guard-file.ts`',
    )
    expect(mutated).not.toBe(base)
    const dir = createFixtureDir(mutated)
    const res = runCheck(join(dir, 'LESSONS.md'))
    expect(res.status).toBe(1)
    expect(res.stderr).toContain(
      'Error in LESSON-001: Guard references non-existent path "nonexistent-guard-file.ts"',
    )
  })

  it('rejects nonexistent file path in Escalation Index Guard', () => {
    const base = readFileSync(repoLessons, 'utf8')
    const mutated = base.replace(
      '| `package-lock.json`, `.github/workflows/ci.yml`                      |',
      '| `nonexistent-index-guard.ts`                                         |',
    )
    expect(mutated).not.toBe(base)
    const dir = createFixtureDir(mutated)
    const res = runCheck(join(dir, 'LESSONS.md'))
    expect(res.status).toBe(1)
    expect(res.stderr).toContain(
      'Error in Escalation Index for LESSON-001: Guard references non-existent path "nonexistent-index-guard.ts"',
    )
  })

  it('correctly ignores headings inside code fences of varying lengths (3 backticks vs 4 backticks)', () => {
    const base = readFileSync(repoLessons, 'utf8')
    const withFences = base.replace(
      '#### Symptom',
      '````markdown\n### LESSON-999: Faked Lesson In Code\n```\nstill code\n````\n\n#### Symptom',
    )
    expect(withFences).not.toBe(base)
    const dir = createFixtureDir(withFences)
    const res = runCheck(join(dir, 'LESSONS.md'))
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('LESSONS.md validation passed: 4 lessons verified.')
  })

  it('does not close fence if closing delimiter has trailing non-whitespace', () => {
    const base = readFileSync(repoLessons, 'utf8')
    // ```` still code should not close 4-backtick fence
    const withFences = base.replace(
      '#### Symptom',
      '````markdown\n```\n```` still code\n### LESSON-999: Still In Code\n````\n\n#### Symptom',
    )
    expect(withFences).not.toBe(base)
    const dir = createFixtureDir(withFences)
    const res = runCheck(join(dir, 'LESSONS.md'))
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('LESSONS.md validation passed: 4 lessons verified.')
  })

  it('counts only top-level evidence items and ignores indented sublists or code fences', () => {
    const base = readFileSync(repoLessons, 'utf8')
    // Add sublist and fenced code with fake items inside LESSON-001 evidence
    const mutated = base.replace(
      '#### Evidence\n\n- 2026-09-26 — PR #54: local dependency drift after ad-hoc package install caused image-sanitization and editor test failures resolved by `npm ci` (recorded in memory `fdc8fe3e`).',
      '#### Evidence\n\n- 2026-09-26 — PR #54: main incident\n  - sublist detail item (should not count)\n  ```\n  - code item (should not count)\n  ```',
    )
    expect(mutated).not.toBe(base)
    const dir = createFixtureDir(mutated)
    const res = runCheck(join(dir, 'LESSONS.md'))
    // 1 occurrence with 1 top-level bullet should pass
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('LESSONS.md validation passed: 4 lessons verified.')
  })

  it('rejects index / detail occurrences mismatch', () => {
    const base = readFileSync(repoLessons, 'utf8')
    const mutated = base.replace(
      /\| (\[LESSON-001\]\(#[^)]+\)[^|]*\|[^|]*\|)\s*1\s*\|/,
      '| $1      2      |',
    )
    expect(mutated).not.toBe(base)
    const dir = createFixtureDir(mutated)
    const res = runCheck(join(dir, 'LESSONS.md'))
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('Error in Escalation Index for LESSON-001: Occurrences mismatch')
  })

  it('rejects duplicate ID in Lessons Register', () => {
    const base = readFileSync(repoLessons, 'utf8')
    const mutated = base.replace('### LESSON-002:', '### LESSON-001:')
    expect(mutated).not.toBe(base)
    const dir = createFixtureDir(mutated)
    const res = runCheck(join(dir, 'LESSONS.md'))
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('Duplicate lesson heading ID "LESSON-001"')
  })
})
