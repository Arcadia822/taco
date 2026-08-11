import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const cli = resolve('extensions/taco/bin/taco.mjs')
const shell = resolve('extensions/taco/assets/taco-shell.html')
const dataBlock = /(<script\b(?=[^>]*\bid=["']taco-document["'])[^>]*>)([\s\S]*?)(<\/script>)/i

interface CliBundle {
  format: string
  version: number
  docId: string
  title: string
  root: string
  files: Array<{ path: string; content: string; sourceHash?: string }>
  packOptions?: { ignore: string[] }
  comments?: Array<Record<string, unknown>>
}

const readBundle = (path: string): CliBundle => {
  const html = readFileSync(path, 'utf8')
  const match = html.match(dataBlock)
  if (!match) throw new Error('missing Taco data block')
  return JSON.parse(match[2]) as CliBundle
}

const writeBundle = (path: string, bundle: CliBundle): void => {
  const html = readFileSync(path, 'utf8')
  const json = JSON.stringify(bundle, null, 2).replace(/</g, '\\u003c')
  writeFileSync(path, html.replace(dataBlock, `$1\n${json}\n$3`), 'utf8')
}

const runJson = <T>(args: string[], cwd: string): T =>
  JSON.parse(
    execFileSync(process.execPath, [cli, ...args, '--json'], { cwd, encoding: 'utf8' }),
  ) as T

describe('Taco extension CLI', () => {
  it('packs UTF-8 feature files with source baselines', () => {
    const project = mkdtempSync(join(tmpdir(), 'taco-pack-'))
    const feature = join(project, 'specs/001-demo')
    const output = join(feature, '001-demo.taco.html')
    mkdirSync(join(feature, 'contracts'), { recursive: true })
    writeFileSync(join(feature, 'spec.md'), '# Demo\n\nOriginal text.\n')
    writeFileSync(join(feature, 'contracts/api.json'), '{"ok":true}\n')

    const result = runJson<{ files: number; root: string; output: string }>(
      ['pack', feature, '--project-root', project, '--output', output, '--shell', shell],
      project,
    )
    const bundle = readBundle(output)

    expect(result).toMatchObject({ files: 2, root: 'specs/001-demo', output })
    expect(bundle.title).toBe('001-demo')
    expect(bundle.files.map((file) => file.path)).toEqual([
      'specs/001-demo/contracts/api.json',
      'specs/001-demo/spec.md',
    ])
    expect(bundle.files.every((file) => /^[a-f0-9]{64}$/.test(file.sourceHash ?? ''))).toBe(true)
  })

  it('refreshes an existing Taco with the latest shell while preserving its bundle state', () => {
    const project = mkdtempSync(join(tmpdir(), 'taco-refresh-'))
    const feature = join(project, 'specs/002-refresh')
    const oldShell = join(project, 'old-shell.html')
    const newShell = join(project, 'new-shell.html')
    const existing = join(feature, 'Human_title.taco.html')
    mkdirSync(feature, { recursive: true })
    writeFileSync(join(feature, 'spec.md'), '# Refresh\n\nCanonical text.\n')
    writeFileSync(
      oldShell,
      '<!doctype html><html data-runtime="old"><head><script id="taco-document" type="application/taco+json">{}</script></head></html>',
    )
    writeFileSync(
      newShell,
      '<!doctype html><html data-runtime="new"><head><script id="taco-document" type="application/taco+json">{}</script></head></html>',
    )

    runJson(
      ['pack', feature, '--project-root', project, '--output', existing, '--shell', oldShell],
      project,
    )
    const prior = readBundle(existing)
    prior.title = 'Wrong title'
    prior.comments = [{ id: 'preserved-comment' }]
    writeBundle(existing, prior)

    runJson(
      [
        'pack',
        feature,
        '--project-root',
        project,
        '--output',
        existing,
        '--from',
        existing,
        '--shell',
        newShell,
      ],
      project,
    )

    const html = readFileSync(existing, 'utf8')
    const bundle = readBundle(existing)
    expect(html).toContain('data-runtime="new"')
    expect(html).not.toContain('data-runtime="old"')
    expect(html).toContain('<title>Human_title — Taco</title>')
    expect(bundle).toMatchObject({
      docId: prior.docId,
      title: 'Human_title',
      comments: [{ id: 'preserved-comment' }],
    })
  })

  it('previews and imports direct edits while exposing anchored comments', () => {
    const project = mkdtempSync(join(tmpdir(), 'taco-sync-'))
    const feature = join(project, 'specs/002-review')
    const source = join(feature, 'spec.md')
    const output = join(feature, '002-review.taco.html')
    mkdirSync(feature, { recursive: true })
    writeFileSync(source, '# Review\n\nOriginal text.\n')
    runJson(
      ['pack', feature, '--project-root', project, '--output', output, '--shell', shell],
      project,
    )

    const bundle = readBundle(output)
    const edited = '# Review\n\nHuman direct edit.\n'
    bundle.files[0].content = edited
    const start = edited.indexOf('direct edit')
    bundle.comments = [
      {
        id: 'thread-1',
        anchor: {
          path: 'specs/002-review/spec.md',
          position: { start, end: start + 'direct edit'.length },
          quote: { exact: 'direct edit', prefix: 'Human ', suffix: '.\n' },
        },
        status: 'open',
        messages: [
          {
            id: 'message-1',
            author: 'Reviewer',
            body: 'Make this measurable.',
            createdAt: '2026-08-10T00:00:00.000Z',
          },
        ],
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-10T00:00:00.000Z',
      },
    ]
    writeBundle(output, bundle)

    const preview = runJson<{
      applied: boolean
      summary: { updated: number; conflicts: number }
      comments: Array<{ id: string; stale: boolean; location: { line: number; column: number } }>
    }>(['sync', output, '--project-root', project, '--dry-run'], project)
    expect(preview.summary).toEqual(expect.objectContaining({ updated: 1, conflicts: 0 }))
    expect(preview.applied).toBe(false)
    expect(readFileSync(source, 'utf8')).toContain('Original text')
    expect(preview.comments[0]).toMatchObject({
      id: 'thread-1',
      stale: false,
      location: { line: 3, column: 7 },
    })

    const applied = runJson<{ applied: boolean; summary: { updated: number } }>(
      ['sync', output, '--project-root', project],
      project,
    )
    expect(applied).toMatchObject({ applied: true, summary: { updated: 1 } })
    expect(readFileSync(source, 'utf8')).toBe(edited)
  })

  it('refuses the whole sync when canonical and Taco copies diverge', () => {
    const project = mkdtempSync(join(tmpdir(), 'taco-conflict-'))
    const feature = join(project, 'specs/003-conflict')
    const source = join(feature, 'spec.md')
    const plan = join(feature, 'plan.md')
    const output = join(feature, '003-conflict.taco.html')
    mkdirSync(dirname(source), { recursive: true })
    writeFileSync(source, '# Conflict\n\nBaseline.\n')
    writeFileSync(plan, '# Plan\n\nBaseline plan.\n')
    runJson(
      ['pack', feature, '--project-root', project, '--output', output, '--shell', shell],
      project,
    )

    const bundle = readBundle(output)
    bundle.files.find((file) => file.path.endsWith('/spec.md'))!.content =
      '# Conflict\n\nTaco edit.\n'
    bundle.files.find((file) => file.path.endsWith('/plan.md'))!.content =
      '# Plan\n\nTaco plan edit.\n'
    writeBundle(output, bundle)
    writeFileSync(source, '# Conflict\n\nIndependent source edit.\n')

    const result = spawnSync(
      process.execPath,
      [cli, 'sync', output, '--project-root', project, '--json'],
      { cwd: project, encoding: 'utf8' },
    )
    const parsed = JSON.parse(result.stdout) as {
      applied: boolean
      summary: { conflicts: number; updated: number }
      files: Array<{ path: string; state: string }>
    }

    expect(result.status).toBe(2)
    expect(parsed).toMatchObject({ applied: false, summary: { conflicts: 1, updated: 1 } })
    expect(parsed.files).toContainEqual({
      path: 'specs/003-conflict/spec.md',
      state: 'conflict',
      baselineKnown: true,
    })
    expect(readFileSync(source, 'utf8')).toContain('Independent source edit')
    expect(readFileSync(plan, 'utf8')).toContain('Baseline plan')
  })

  it('includes all visible text while separating default and explicit exclusions', () => {
    const project = mkdtempSync(join(tmpdir(), 'taco-exclusions-'))
    const feature = join(project, 'specs/004-exclusions')
    const output = join(feature, '004-exclusions.taco.html')
    mkdirSync(join(feature, 'nested/.drafts'), { recursive: true })
    mkdirSync(join(feature, 'private/nested'), { recursive: true })
    writeFileSync(join(feature, 'spec.md'), '# Exclusions\n')
    writeFileSync(join(feature, 'plan.md'), '# Plan\n')
    writeFileSync(join(feature, 'nested/visible.txt'), 'visible\n')
    writeFileSync(join(feature, '.env'), 'SECRET=no\n')
    writeFileSync(join(feature, 'nested/.drafts/note.md'), 'hidden\n')
    writeFileSync(join(feature, 'old.taco.html'), '<html></html>')
    writeFileSync(join(feature, 'private/nested/note.md'), 'private\n')

    const result = runJson<{
      files: number
      defaultIgnored: string[]
      explicitIgnored: Array<{ path: string; pattern: string }>
      ignorePatterns: string[]
    }>(
      [
        'pack',
        feature,
        '--project-root',
        project,
        '--shell',
        shell,
        '--ignore',
        'private/**',
        '--ignore',
        'unused?.md',
      ],
      project,
    )
    const bundle = readBundle(output)

    expect(result.files).toBe(3)
    expect(result.defaultIgnored).toEqual(['.env', 'nested/.drafts', 'old.taco.html'])
    expect(result.explicitIgnored).toEqual([{ path: 'private', pattern: 'private/**' }])
    expect(result.ignorePatterns).toEqual(['private/**', 'unused?.md'])
    expect(bundle.packOptions?.ignore).toEqual(['private/**', 'unused?.md'])
    expect(bundle.files.map((file) => file.path)).toEqual([
      'specs/004-exclusions/nested/visible.txt',
      'specs/004-exclusions/plan.md',
      'specs/004-exclusions/spec.md',
    ])

    writeFileSync(join(feature, 'private/later.md'), 'later\n')
    const refreshed = runJson<{ explicitIgnored: Array<{ path: string; pattern: string }> }>(
      ['pack', feature, '--project-root', project, '--shell', shell],
      project,
    )
    expect(refreshed.explicitIgnored).toEqual([{ path: 'private', pattern: 'private/**' }])
    expect(readBundle(output).packOptions?.ignore).toEqual(['private/**', 'unused?.md'])

    const replaced = runJson<{
      explicitIgnored: Array<{ path: string; pattern: string }>
      ignorePatterns: string[]
    }>(
      ['pack', feature, '--project-root', project, '--shell', shell, '--ignore', 'nested/**'],
      project,
    )
    expect(replaced.explicitIgnored).toEqual([{ path: 'nested', pattern: 'nested/**' }])
    expect(replaced.ignorePatterns).toEqual(['nested/**'])
    expect(readBundle(output).packOptions?.ignore).toEqual(['nested/**'])
  })

  it('fails on visible non-UTF-8 files and symlinks unless explicitly excluded', () => {
    const project = mkdtempSync(join(tmpdir(), 'taco-unsafe-files-'))
    const feature = join(project, 'specs/005-unsafe-files')
    mkdirSync(feature, { recursive: true })
    writeFileSync(join(feature, 'spec.md'), '# Unsafe files\n')
    writeFileSync(join(feature, 'binary.dat'), Buffer.from([0xff, 0xfe, 0xfd]))
    symlinkSync(join(feature, 'spec.md'), join(feature, 'linked.md'))

    const binaryFailure = spawnSync(
      process.execPath,
      [cli, 'pack', feature, '--project-root', project, '--shell', shell, '--json'],
      { cwd: project, encoding: 'utf8' },
    )
    expect(binaryFailure.status).toBe(1)
    expect(JSON.parse(binaryFailure.stderr)).toEqual({
      error: 'File is not valid UTF-8: binary.dat; exclude it with --ignore',
    })

    const symlinkFailure = spawnSync(
      process.execPath,
      [
        cli,
        'pack',
        feature,
        '--project-root',
        project,
        '--shell',
        shell,
        '--ignore',
        'binary.dat',
        '--json',
      ],
      { cwd: project, encoding: 'utf8' },
    )
    expect(symlinkFailure.status).toBe(1)
    expect(JSON.parse(symlinkFailure.stderr)).toEqual({
      error: 'Unsupported symbolic link in feature directory: linked.md; exclude it with --ignore',
    })

    const result = runJson<{
      files: number
      explicitIgnored: Array<{ path: string; pattern: string }>
    }>(
      [
        'pack',
        feature,
        '--project-root',
        project,
        '--shell',
        shell,
        '--ignore',
        'binary.dat',
        '--ignore',
        'linked.md',
      ],
      project,
    )
    expect(result.files).toBe(1)
    expect(result.explicitIgnored).toEqual([
      { path: 'binary.dat', pattern: 'binary.dat' },
      { path: 'linked.md', pattern: 'linked.md' },
    ])
  })

  it('rejects unsafe ignore patterns and excluding spec.md', () => {
    const project = mkdtempSync(join(tmpdir(), 'taco-ignore-safety-'))
    const feature = join(project, 'specs/006-ignore-safety')
    mkdirSync(feature, { recursive: true })
    writeFileSync(join(feature, 'spec.md'), '# Ignore safety\n')

    for (const pattern of ['../outside', '/absolute', 'spec.md']) {
      const result = spawnSync(
        process.execPath,
        [
          cli,
          'pack',
          feature,
          '--project-root',
          project,
          '--shell',
          shell,
          '--ignore',
          pattern,
          '--json',
        ],
        { cwd: project, encoding: 'utf8' },
      )
      expect(result.status).toBe(1)
    }
  })

  it('refuses Taco input and output paths outside the canonical feature boundary', () => {
    const project = mkdtempSync(join(tmpdir(), 'taco-boundary-'))
    const feature = join(project, 'specs/007-boundary')
    const output = join(feature, '007-boundary.taco.html')
    const outside = join(project, 'outside.taco.html')
    mkdirSync(feature, { recursive: true })
    writeFileSync(join(feature, 'spec.md'), '# Boundary\n')

    const outsidePack = spawnSync(
      process.execPath,
      [
        cli,
        'pack',
        feature,
        '--project-root',
        project,
        '--output',
        outside,
        '--shell',
        shell,
        '--json',
      ],
      { cwd: project, encoding: 'utf8' },
    )
    expect(outsidePack.status).toBe(1)

    runJson(['pack', feature, '--project-root', project, '--shell', shell], project)
    writeFileSync(outside, readFileSync(output))
    const outsideSync = spawnSync(
      process.execPath,
      [cli, 'sync', outside, '--project-root', project, '--dry-run', '--json'],
      { cwd: project, encoding: 'utf8' },
    )
    expect(outsideSync.status).toBe(1)
    expect(JSON.parse(outsideSync.stderr)).toEqual({
      error: 'Reviewed Taco must be inside its canonical feature directory',
    })

    const linkedOutput = join(feature, 'linked.taco.html')
    symlinkSync(outside, linkedOutput)
    const linkedPack = spawnSync(
      process.execPath,
      [
        cli,
        'pack',
        feature,
        '--project-root',
        project,
        '--output',
        linkedOutput,
        '--shell',
        shell,
        '--json',
      ],
      { cwd: project, encoding: 'utf8' },
    )
    expect(linkedPack.status).toBe(1)
    expect(JSON.parse(linkedPack.stderr).error).toContain(
      'Refusing to write Taco through a symbolic link',
    )
  })
})
