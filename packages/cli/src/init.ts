import { existsSync } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  atomicWrite,
  embedBundle,
  portableTitleBase,
  tacoFileBase,
  validateBundle,
  type TacoBundle,
  type TacoFile,
} from '../../../skills/taco/scripts/pack.mjs'
import { EXIT_CODES, makeCliError } from './errors.ts'
import { COMPLETE_SHELL_HTML, LITE_SHELL_HTML, TEMPLATES } from './generated/assets.ts'
import { verifyNoSymlinksInAncestry, verifyNotForbidden } from './local-paths.ts'

export interface InitOptions {
  target?: string
  template?: string
  title?: string
  lite?: boolean
  listTemplates?: boolean
}

const TEMPLATE_NAMES = ['spec', 'architecture', 'api-reference', 'adr', 'prd', 'interaction'] as const

export const executeInit = async (
  options: InitOptions,
): Promise<{ exitCode: number; stdout?: string; stderr?: string }> => {
  if (options.listTemplates || (!options.target && !options.template)) {
    const list = TEMPLATE_NAMES.map((name) => ({
      name,
      description: `Built-in ${name} template from extensions/taco/templates/${name}`,
    }))
    return {
      exitCode: EXIT_CODES.OK,
      stdout: JSON.stringify({ schema: 'taco-cli-init-templates/1', templates: list }, null, 2),
    }
  }

  const templateName = options.template ?? 'spec'
  const templateAsset = TEMPLATES[templateName]
  if (!templateAsset) {
    const error = makeCliError(
      'VALIDATION_ERROR',
      `Unknown template: '${templateName}'. Available templates: ${TEMPLATE_NAMES.join(', ')}`,
    )
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  const targetArg = options.target ?? `.${templateName}`
  const targetPath = resolve(targetArg)
  const isHtmlTarget = targetPath.toLowerCase().endsWith('.taco.html')

  const titleRaw = options.title ?? (isHtmlTarget ? tacoFileBase(targetPath) : basename(targetPath))
  const title = portableTitleBase(titleRaw)
  if (isHtmlTarget) {
    const targetStem = tacoFileBase(targetPath)
    if (targetStem !== title) {
      const error = makeCliError(
        'VALIDATION_ERROR',
        `Taco title requires filename ${title}.taco.html, not ${basename(targetPath)}`,
      )
      return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
    }
  }
  const docId = randomUUID()

  const shell = options.lite ? LITE_SHELL_HTML : COMPLETE_SHELL_HTML
  if (!shell) {
    const error = makeCliError('LOCAL_IO_ERROR', 'Embedded shell template is missing')
    return { exitCode: EXIT_CODES.LOCAL_IO_ERROR, stderr: JSON.stringify(error) }
  }

  // Preflight symlink and forbidden checks
  try {
    await verifyNoSymlinksInAncestry(targetPath)
    await verifyNotForbidden(targetPath)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(makeCliError('VALIDATION_ERROR', msg)) }
  }
  // Prepare template markdown content with JSON-safe YAML frontmatter
  let templateContent = templateAsset.templateMd
  if (templateContent) {
    // Replace frontmatter title if present, otherwise prepend
    if (templateContent.startsWith('---')) {
      templateContent = templateContent.replace(
        /^---\s*\ntitle:[^\n]*\n/m,
        `---\ntitle: ${JSON.stringify(title)}\n`,
      )
    } else {
      templateContent = `---\ntitle: ${JSON.stringify(title)}\n---\n\n${templateContent}`
    }
  } else {
    templateContent = `---\ntitle: ${JSON.stringify(title)}\n---\n\n## ${title}\n\n`
  }

  const writtenFiles: string[] = []

  if (isHtmlTarget) {
    // Preflight target existence check
    if (existsSync(targetPath)) {
      const error = makeCliError(
        'CONFLICT_ERROR',
        `Target file already exists: ${targetPath}. Refusing to overwrite.`,
      )
      return { exitCode: EXIT_CODES.CONFLICT_ERROR, stderr: JSON.stringify(error) }
    }

    const safeRoot = portableTitleBase(title) || 'workspace'
    const files: TacoFile[] = [
      {
        path: `${safeRoot}/${templateName}.md`,
        mediaType: 'text/markdown',
        content: templateContent,
      },
    ]

    const bundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId,
      title,
      root: safeRoot,
      files,
    }

    let html: string
    try {
      validateBundle(bundle)
      html = embedBundle(shell, bundle)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(makeCliError('VALIDATION_ERROR', msg)) }
    }

    await mkdir(dirname(targetPath), { recursive: true })
    await atomicWrite(targetPath, html)
    writtenFiles.push(targetPath)
  } else {
    // Target is a directory: preflight BOTH md and taco targets before writing either
    const mdFileName = `${templateName}.md`
    const mdFilePath = join(targetPath, mdFileName)
    const tacoFilePath = join(targetPath, `${title}.taco.html`)
    try {
      await verifyNoSymlinksInAncestry(mdFilePath)
      await verifyNoSymlinksInAncestry(tacoFilePath)
      await verifyNotForbidden(mdFilePath)
      await verifyNotForbidden(tacoFilePath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(makeCliError('VALIDATION_ERROR', msg)) }
    }

    if (existsSync(mdFilePath)) {
      const error = makeCliError(
        'CONFLICT_ERROR',
        `Target template markdown already exists: ${mdFilePath}. Refusing to overwrite.`,
      )
      return { exitCode: EXIT_CODES.CONFLICT_ERROR, stderr: JSON.stringify(error) }
    }

    if (existsSync(tacoFilePath)) {
      const error = makeCliError(
        'CONFLICT_ERROR',
        `Target taco artifact already exists: ${tacoFilePath}. Refusing to overwrite.`,
      )
      return { exitCode: EXIT_CODES.CONFLICT_ERROR, stderr: JSON.stringify(error) }
    }

    const safeRoot = basename(targetPath)
    const files: TacoFile[] = [
      {
        path: `${safeRoot}/${mdFileName}`,
        mediaType: 'text/markdown',
        content: templateContent,
      },
    ]

    const bundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId,
      title,
      root: safeRoot,
      files,
    }

    let html: string
    try {
      validateBundle(bundle)
      html = embedBundle(shell, bundle)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(makeCliError('VALIDATION_ERROR', msg)) }
    }

    const createdDir = !existsSync(targetPath)
    if (createdDir) {
      await mkdir(targetPath, { recursive: true })
    }

    let mdWritten = false
    let tacoWritten = false
    try {
      await writeFile(mdFilePath, templateContent, { encoding: 'utf8', flag: 'wx' })
      mdWritten = true
      writtenFiles.push(mdFilePath)

      await atomicWrite(tacoFilePath, html)
      tacoWritten = true
      writtenFiles.push(tacoFilePath)
    } catch (err) {
      // Roll back owned creations
      if (mdWritten) {
        await unlink(mdFilePath).catch(() => {})
      }
      if (tacoWritten) {
        await unlink(tacoFilePath).catch(() => {})
      }
      const msg = err instanceof Error ? err.message : String(err)
      return { exitCode: EXIT_CODES.LOCAL_IO_ERROR, stderr: JSON.stringify(makeCliError('LOCAL_IO_ERROR', msg)) }
    }
  }
  const result = {
    schema: 'taco-cli-init/1',
    template: templateName,
    target: targetPath,
    title,
    docId,
    shellVariant: options.lite ? 'lite' : 'complete',
    files: writtenFiles,
  }

  return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(result, null, 2) }
}
