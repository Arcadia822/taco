import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  atomicWrite,
  embedBundle,
  portableTitleBase,
  tacoFileBase,
  validateBundle,
  type TacoBundle,
} from '../../../skills/taco/scripts/pack.mjs'
import { EXIT_CODES, makeCliError } from './errors.ts'
import { COMPLETE_SHELL_HTML, LITE_SHELL_HTML } from './generated/assets.ts'
import { verifyNoSymlinksInAncestry, verifyNotForbidden } from './local-paths.ts'
export interface NewOptions {
  path: string
  title?: string
  lite?: boolean
}

export const executeNew = async (
  options: NewOptions,
): Promise<{ exitCode: number; stdout?: string; stderr?: string }> => {
  if (!options.path) {
    const error = makeCliError('VALIDATION_ERROR', 'Missing required target path argument')
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  const targetPath = resolve(options.path)
  if (!targetPath.toLowerCase().endsWith('.taco.html')) {
    const error = makeCliError('VALIDATION_ERROR', 'Target path must end with .taco.html')
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  // Refuse overwrite if target already exists
  if (existsSync(targetPath)) {
    const error = makeCliError(
      'CONFLICT_ERROR',
      `Target file already exists: ${targetPath}. Refusing to overwrite.`,
    )
    return { exitCode: EXIT_CODES.CONFLICT_ERROR, stderr: JSON.stringify(error) }
  }

  try {
    await verifyNoSymlinksInAncestry(targetPath)
    await verifyNotForbidden(targetPath)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(makeCliError('VALIDATION_ERROR', msg)) }
  }

  const rawTitle = options.title ?? tacoFileBase(targetPath)
  const title = portableTitleBase(rawTitle)
  const targetStem = tacoFileBase(targetPath)
  if (targetStem !== title) {
    const error = makeCliError(
      'VALIDATION_ERROR',
      `Taco title requires filename ${title}.taco.html, not ${basename(targetPath)}`,
    )
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }
  const docId = randomUUID()
  const safeRoot = portableTitleBase(title) || 'workspace'
  // New creates an empty files: [] bundle for the agent to populate
  const bundle: TacoBundle = {
    format: 'taco/files',
    version: 1,
    docId,
    title,
    root: safeRoot,
    files: [],
  }

  try {
    validateBundle(bundle)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(makeCliError('VALIDATION_ERROR', msg)) }
  }

  const shell = options.lite ? LITE_SHELL_HTML : COMPLETE_SHELL_HTML
  if (!shell) {
    const error = makeCliError('LOCAL_IO_ERROR', 'Embedded shell template is missing')
    return { exitCode: EXIT_CODES.LOCAL_IO_ERROR, stderr: JSON.stringify(error) }
  }

  try {
    const html = embedBundle(shell, bundle)
    await atomicWrite(targetPath, html)
  } catch (err) {
    const error = makeCliError('LOCAL_IO_ERROR', `Failed to write taco file: ${(err as Error).message}`)
    return { exitCode: EXIT_CODES.LOCAL_IO_ERROR, stderr: JSON.stringify(error) }
  }

  const result = {
    schema: 'taco-cli-new/1',
    path: targetPath,
    docId,
    title,
    shellVariant: options.lite ? 'lite' : 'complete',
    filesCount: 0,
  }

  return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(result, null, 2) }
}
