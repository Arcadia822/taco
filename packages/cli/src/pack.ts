import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  packDirectory,
  type PackResult,
} from '../../../skills/taco/scripts/pack.mjs'
import { EXIT_CODES, makeCliError } from './errors.ts'
import { COMPLETE_SHELL_HTML, LITE_SHELL_HTML } from './generated/assets.ts'
import {
  resolvePackDestination,
  verifyNoSymlinksInAncestry,
  verifyNotForbidden,
} from './local-paths.ts'
export interface CliPackOptions {
  dir: string
  out?: string
  title?: string
  entry?: string
  root?: string
  group?: string[]
  ignore?: string[]
  lite?: boolean
  dryRun?: boolean
}

export const executePack = async (
  options: CliPackOptions,
): Promise<{ exitCode: number; stdout?: string; stderr?: string }> => {
  if (!options.dir) {
    const error = makeCliError('VALIDATION_ERROR', 'Missing required directory argument')
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  try {
    const resolvedDestination = resolvePackDestination(
      options.dir,
      options.out,
      options.title,
      options.root,
    )
    const destinationPath = resolvedDestination.outputPath

    await verifyNoSymlinksInAncestry(destinationPath)
    await verifyNotForbidden(destinationPath)

    // CLI pack refuses ALL existing targets (explicit refresh only updates)
    if (existsSync(destinationPath)) {
      const error = makeCliError(
        'CONFLICT_ERROR',
        `Target artifact already exists: ${destinationPath}. Use explicit refresh to update an existing review.`,
      )
      return { exitCode: EXIT_CODES.CONFLICT_ERROR, stderr: JSON.stringify(error) }
    }

    if (!options.dryRun) {
      await mkdir(dirname(destinationPath), { recursive: true })
    }

    const result: PackResult = await packDirectory({
      dir: resolve(options.dir),
      out: destinationPath,
      title: options.title,
      entry: options.entry,
      root: options.root,
      group: options.group,
      ignore: options.ignore,
      lite: options.lite,
      dryRun: options.dryRun,
      customShellHtml: options.lite ? LITE_SHELL_HTML : COMPLETE_SHELL_HTML,
    })

    const payload = {
      schema: 'taco-cli-pack/1',
      outputPath: result.outputPath,
      lines: result.lines,
    }

    return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(payload, null, 2) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isValidation =
      msg.includes('not supported') ||
      msg.includes('not a safe') ||
      msg.includes('does not match') ||
      msg.includes('duplicate') ||
      msg.includes('escapes bundle root') ||
      msg.includes('limit') ||
      msg.includes('invalid') ||
      msg.includes('Refusing') ||
      msg.includes('symbolic link') ||
      msg.includes('Non-canonical') ||
      msg.includes('required directory')

    const isConflict = msg.includes('already exists')
    if (isConflict) {
      const error = makeCliError('CONFLICT_ERROR', msg)
      return { exitCode: EXIT_CODES.CONFLICT_ERROR, stderr: JSON.stringify(error) }
    }

    const code = isValidation ? 'VALIDATION_ERROR' : 'LOCAL_IO_ERROR'
    const exitCode = isValidation ? EXIT_CODES.VALIDATION_ERROR : EXIT_CODES.LOCAL_IO_ERROR
    const error = makeCliError(code, msg)
    return { exitCode, stderr: JSON.stringify(error) }
  }
}
