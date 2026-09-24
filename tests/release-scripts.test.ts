import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const checkChangesScript = resolve('skills/taco-release/scripts/check-changes.mjs')
const releaseNotesScript = resolve('skills/taco-release/scripts/generate-release-notes.mjs')

const fixtures: string[] = []

afterEach(() => {
  while (fixtures.length > 0) rmSync(fixtures.pop() as string, { recursive: true, force: true })
})

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function node(cwd: string, args: string[]): string {
  return execFileSync(process.execPath, args, { cwd, encoding: 'utf8' }).trim()
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'taco-release-scripts-'))
  fixtures.push(dir)
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'test'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src/feature.js'), 'export const initial = true\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-qm', 'feat: initial'])
  git(dir, ['tag', 'v1.0.0'])
  return dir
}

function commitOn(dir: string, subject: string, body?: string) {
  writeFileSync(join(dir, 'src/feature.js'), `export const change = '${subject}'\n`)
  git(dir, ['add', '.'])
  const args = ['commit', '-qm', subject]
  if (body) args.push('-m', body)
  git(dir, args)
}

function tacoReport(dir: string) {
  const raw = node(dir, [checkChangesScript, '--ref', 'HEAD', '--json'])
  const components = JSON.parse(raw).components
  return components.find((c: { name: string }) => c.name === 'taco')
}

describe('check-changes.mjs version bump classification', () => {
  it('treats BREAKING CHANGE in the commit body as a major bump', () => {
    const dir = makeRepo()
    commitOn(dir, 'feat(api): add a new route', 'BREAKING CHANGE: removes the old /legacy endpoint')
    expect(tacoReport(dir)).toMatchObject({
      hasChanges: true,
      recommendedBump: 'major',
      recommendedVersion: '2.0.0'
    })
  })

  it('treats a bang marker in the subject as a major bump', () => {
    const dir = makeRepo()
    commitOn(dir, 'feat(api)!: redesign the document format')
    expect(tacoReport(dir)).toMatchObject({
      recommendedBump: 'major',
      recommendedVersion: '2.0.0'
    })
  })

  it('bumps minor when features land without breaking changes', () => {
    const dir = makeRepo()
    commitOn(dir, 'feat(core): add export')
    commitOn(dir, 'fix(core): correct the export path')
    expect(tacoReport(dir)).toMatchObject({
      recommendedBump: 'minor',
      recommendedVersion: '1.1.0'
    })
  })

  it('bumps patch for maintenance commits and reports none when idle', () => {
    const dir = makeRepo()
    commitOn(dir, 'chore(core): tidy the build script')
    expect(tacoReport(dir)).toMatchObject({
      recommendedBump: 'patch',
      recommendedVersion: '1.0.1'
    })

    const idle = makeRepo()
    expect(tacoReport(idle)).toMatchObject({
      hasChanges: false,
      recommendedBump: 'none',
      recommendedVersion: null
    })
  })
})

describe('generate-release-notes.mjs changelog update', () => {
  it('prepends the new entry under the Changelog header and syncs the extension manifest', () => {
    const dir = makeRepo()
    mkdirSync(join(dir, 'extensions/taco'), { recursive: true })
    writeFileSync(
      join(dir, 'extensions/taco/CHANGELOG.md'),
      '# Changelog\n\n## 0.8.0 - 2026-01-01\n\n- Old entry.\n'
    )
    writeFileSync(
      join(dir, 'extensions/taco/extension.yml'),
      "schema_version: '1.0'\n\nextension:\n  id: 'taco'\n  version: '0.8.0'\n"
    )
    git(dir, ['add', '.'])
    git(dir, ['commit', '-qm', 'chore: seed the release manifests'])
    commitOn(dir, 'feat(core): ship the pipeline', 'BREAKING CHANGE: drops the legacy bundle format')

    node(dir, [
      releaseNotesScript,
      '--from', 'v1.0.0',
      '--to', 'HEAD',
      '--version', '1.1.0',
      '--update-changelog',
      '--outfile', 'notes.md'
    ])

    const changelog = readFileSync(join(dir, 'extensions/taco/CHANGELOG.md'), 'utf8')
    expect(changelog.startsWith('# Changelog\n\n## [1.1.0]')).toBe(true)
    expect(changelog).toContain('### ⚠ BREAKING CHANGES')
    expect(changelog).toContain('drops the legacy bundle format')
    expect(changelog).toContain('## 0.8.0 - 2026-01-01')

    const manifest = readFileSync(join(dir, 'extensions/taco/extension.yml'), 'utf8')
    expect(manifest).toContain("version: '1.1.0'")
    expect(manifest).not.toContain("version: '0.8.0'")

    expect(readFileSync(join(dir, 'notes.md'), 'utf8')).toContain('## [1.1.0]')
  })
})
