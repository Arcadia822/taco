// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeExtract, rollbackExtraction } from '../src/extract.ts'
import { resolvePackDestination } from '../src/local-paths.ts'
import { runCli } from '../src/runner.ts'
import { readBundleFrom, readBundleFromHtml } from '../../../skills/taco/scripts/pack.mjs'

describe('write safety and creation robustness', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'taco-write-safety-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('handles concurrent creates: exactly one succeeds with docId matching disk, others CONFLICT', async () => {
    const targetPath = join(tempDir, 'ConcurrentDoc.taco.html')
    const CONCURRENCY = 8

    const promises = Array.from({ length: CONCURRENCY }, () => runCli(['new', targetPath]))
    const results = await Promise.all(promises)

    const successes = results.filter((r) => r.exitCode === 0)
    const conflicts = results.filter((r) => r.exitCode === 4)

    expect(successes.length).toBe(1)
    expect(conflicts.length).toBe(CONCURRENCY - 1)

    const successOutput = JSON.parse(successes[0].stdout!)
    expect(successOutput.schema).toBe('taco-cli-new/1')
    expect(typeof successOutput.docId).toBe('string')

    // The surviving file on disk must have the exact docId reported by the winning run
    const fileContent = readFileSync(targetPath, 'utf8')
    const { bundle } = await readBundleFrom(fileContent, targetPath)
    expect(bundle.docId).toBe(successOutput.docId)

    // All conflicting invocations must report CONFLICT_ERROR with "Refusing to overwrite"
    for (const conflict of conflicts) {
      const err = JSON.parse(conflict.stderr!)
      expect(err.error.code).toBe('CONFLICT_ERROR')
      expect(err.error.message).toContain('Refusing to overwrite')
    }
  })

  it('new succeeds when target parent directory is missing', async () => {
    const targetPath = join(tempDir, 'drafts', 'Review.taco.html')
    expect(existsSync(join(tempDir, 'drafts'))).toBe(false)

    const res = await runCli(['new', targetPath])
    expect(res.exitCode).toBe(0)
    expect(existsSync(targetPath)).toBe(true)

    const output = JSON.parse(res.stdout!)
    expect(output.title).toBe('Review')
    expect(output.path).toBe(resolve(targetPath))

    const { bundle } = await readBundleFromHtml(targetPath)
    expect(bundle.title).toBe('Review')
  })

  it('pack --out Explicit.taco.html defaults title to file stem when --title is omitted', async () => {
    const sourceDir = join(tempDir, 'feature-src')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'spec.md'), '# Feature Spec\n\nDetails here.')

    const explicitOut = join(tempDir, 'Explicit.taco.html')

    const res = await runCli(['pack', sourceDir, '--out', explicitOut])
    expect(res.exitCode).toBe(0)
    expect(existsSync(explicitOut)).toBe(true)

    const { bundle } = await readBundleFromHtml(explicitOut)
    expect(bundle.title).toBe('Explicit')
  })

  it('falls back to specs/ directory when docs is a plain file in repository cascade', async () => {
    const repoRoot = join(tempDir, 'repo')
    mkdirSync(join(repoRoot, '.git'), { recursive: true })

    const featureDir = join(repoRoot, 'myfeature')
    mkdirSync(featureDir, { recursive: true })
    writeFileSync(join(featureDir, 'index.md'), '# Index')

    // Create docs as a regular file, not a directory
    writeFileSync(join(repoRoot, 'docs'), 'not a directory')
    // Create specs as an actual directory
    mkdirSync(join(repoRoot, 'specs'), { recursive: true })

    const destination = resolvePackDestination(featureDir, undefined, undefined, undefined)
    expect(destination.level).toBe('L3')
    expect(destination.basis).toBe('repository contains specs/')
    expect(destination.outputPath).toBe(join(repoRoot, 'specs', 'tacos', 'myfeature.taco.html'))

    const packRes = await runCli(['pack', featureDir])
    expect(packRes.exitCode).toBe(0)
    expect(existsSync(destination.outputPath)).toBe(true)
  })

  it('rejects prototype template names like constructor, toString, and __proto__ with VALIDATION_ERROR', async () => {
    const forbidden = ['constructor', 'toString', '__proto__']

    for (const name of forbidden) {
      const target = join(tempDir, `${name}.taco.html`)
      const res = await runCli(['init', target, '--template', name])
      expect(res.exitCode).toBe(2)
      const err = JSON.parse(res.stderr!)
      expect(err.error.code).toBe('VALIDATION_ERROR')
      expect(err.error.message).toContain(`Unknown template: '${name}'`)
    }
  })

  it('extraction rollback never deletes a pre-existing foreign file', async () => {
    const foreignFilePath = join(tempDir, 'foreign-file.txt')
    writeFileSync(foreignFilePath, 'important existing foreign user data')
    const actualStat = statSync(foreignFilePath)

    // Call rollbackExtraction with mismatched dev/ino (e.g. simulated foreign file)
    await rollbackExtraction(
      [{ path: foreignFilePath, dev: actualStat.dev, ino: actualStat.ino + 999999 }],
      [],
    )
    expect(existsSync(foreignFilePath)).toBe(true)
    expect(readFileSync(foreignFilePath, 'utf8')).toBe('important existing foreign user data')

    // Call rollbackExtraction with mismatched directory
    const foreignDirPath = join(tempDir, 'foreign-dir')
    mkdirSync(foreignDirPath)
    writeFileSync(join(foreignDirPath, 'kept.txt'), 'kept')
    await rollbackExtraction([], [{ path: foreignDirPath, dev: 1, ino: 2 }])
    expect(existsSync(join(foreignDirPath, 'kept.txt'))).toBe(true)

    // Test through executeExtract fault injection seam with a pre-existing foreign file in outDir
    const tacoPath = join(tempDir, 'Sample.taco.html')
    const initRes = await runCli(['init', tacoPath, '--template', 'spec', '--title', 'Sample'])
    expect(initRes.exitCode).toBe(0)

    const extractOutDir = join(tempDir, 'extracted-target')
    mkdirSync(extractOutDir, { recursive: true })
    const foreignTarget = join(extractOutDir, 'user-preexisting.txt')
    writeFileSync(foreignTarget, 'do not delete me')

    await expect(
      executeExtract({
        filePath: tacoPath,
        outDir: extractOutDir,
        _faultSeam: 'during-write',
      }),
    ).rejects.toThrow()

    // Pre-existing file must remain untouched
    expect(existsSync(foreignTarget)).toBe(true)
    expect(readFileSync(foreignTarget, 'utf8')).toBe('do not delete me')
  })

  it('cleans up partial writes and owned directories on extraction write failure', async () => {
    const tacoPath = join(tempDir, 'PartialTest.taco.html')
    const initRes = await runCli([
      'init',
      tacoPath,
      '--template',
      'architecture',
      '--title',
      'PartialTest',
    ])
    expect(initRes.exitCode).toBe(0)

    const outDir = join(tempDir, 'partial-extracted')
    expect(existsSync(outDir)).toBe(false)

    await expect(
      executeExtract({
        filePath: tacoPath,
        outDir,
        _faultSeam: 'during-write',
      }),
    ).rejects.toThrow()

    // Any partially written file must have been unlinked
    const partialFile = join(outDir, 'architecture.md')
    expect(existsSync(partialFile)).toBe(false)

    // The newly created empty directory must have been cleaned up
    expect(existsSync(outDir)).toBe(false)
  })
})
