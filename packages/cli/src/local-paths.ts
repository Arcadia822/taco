import { existsSync, readFileSync } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { portableTitleBase, tacoFileBase } from '../../../skills/taco/scripts/pack.mjs'

export const canonicalizeSystemPrefix = (p: string): string => {
  if (process.platform === 'darwin') {
    if (p === '/var' || p.startsWith('/var/')) {
      return '/private' + p
    }
    if (p === '/tmp' || p.startsWith('/tmp/')) {
      return '/private' + p
    }
  }
  return p
}

export const assertSafeDestination = async (targetPath: string): Promise<void> => {
  await verifyNoSymlinksInAncestry(targetPath)
  await verifyNotForbidden(targetPath)
}
export const verifyNoSymlinksInAncestry = async (targetPath: string): Promise<void> => {
  const norm = canonicalizeSystemPrefix(resolve(targetPath))
  let current = norm
  while (true) {
    try {
      const stats = await lstat(current)
      if (stats.isSymbolicLink()) {
        const error = new Error(`Refusing to operate through a symbolic link: '${current}'`)
        Object.assign(error, { code: 'VALIDATION_ERROR' })
        throw error
      }
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'VALIDATION_ERROR') {
        throw err
      }
      if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) throw err
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}

export const verifyNotForbidden = async (targetPath: string): Promise<void> => {
  const resolved = resolve(targetPath)
  let probe = resolved
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  const realPrefix = existsSync(probe) ? await realpath(probe) : resolved
  const parts = [...resolved.split(sep), ...realPrefix.split(sep)]
  const forbiddenNames = ['node_modules', '.git', 'skills', 'extensions', 'templates']
  for (const part of parts) {
    if (forbiddenNames.includes(part)) {
      const error = new Error(`Refusing forbidden target path inside '${part}': ${targetPath}`)
      Object.assign(error, { code: 'VALIDATION_ERROR' })
      throw error
    }
  }
}

export const findRepositoryRoot = (startDir: string): string | null => {
  let current = resolve(startDir)
  while (true) {
    const gitDir = join(current, '.git')
    if (existsSync(gitDir)) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

export interface ResolvedPackDestination {
  outputPath: string
  level: string
  basis: string
}

export const resolvePackDestination = (
  inputDir: string,
  outOption: string | undefined,
  titleOption: string | undefined,
  rootOption: string | undefined,
): ResolvedPackDestination => {
  const resolvedInput = resolve(inputDir)
  const baseTitle = titleOption ?? rootOption ?? basename(resolvedInput)
  const canonicalStem = portableTitleBase(baseTitle)

  if (outOption) {
    const resolvedOut = resolve(outOption)
    if (resolvedOut.toLowerCase().endsWith('.taco.html')) {
      const stem = tacoFileBase(resolvedOut)
      if (stem !== portableTitleBase(stem)) {
        const error = new Error(
          `Non-canonical output filename '${basename(resolvedOut)}'; expected '${portableTitleBase(stem)}.taco.html'`,
        )
        Object.assign(error, { code: 'VALIDATION_ERROR' })
        throw error
      }
      return { outputPath: resolvedOut, level: 'L0', basis: 'user instruction (file)' }
    } else {
      const targetFile = join(resolvedOut, `${canonicalStem}.taco.html`)
      return { outputPath: targetFile, level: 'L0', basis: 'user instruction (dir)' }
    }
  }

  const repoRoot = findRepositoryRoot(resolvedInput)
  if (!repoRoot) {
    const home = process.env['HOME'] || process.env['USERPROFILE'] || homedir()
    if (!home) {
      const error = new Error('L5 target requires HOME or USERPROFILE environment variable')
      Object.assign(error, { code: 'VALIDATION_ERROR' })
      throw error
    }
    const target = join(home, 'Documents', 'tacos', `${canonicalStem}.taco.html`)
    return { outputPath: target, level: 'L5', basis: 'outside repository' }
  }

  if (resolvedInput === repoRoot) {
    const target = join(repoRoot, 'tacos', `${canonicalStem}.taco.html`)
    return { outputPath: target, level: 'L2', basis: 'repository root' }
  }

  const candidateDirs = ['docs', 'doc', 'documents', 'specs']
  for (const dirName of candidateDirs) {
    const probe = join(repoRoot, dirName)
    if (existsSync(probe)) {
      const target = join(probe, 'tacos', `${canonicalStem}.taco.html`)
      return { outputPath: target, level: 'L3', basis: `repository contains ${dirName}/` }
    }
  }

  const target = join(repoRoot, 'tacos', `${canonicalStem}.taco.html`)
  return { outputPath: target, level: 'L4', basis: 'repository without doc directories' }
}
