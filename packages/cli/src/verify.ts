import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import {
  verifyTaco,
  type VerifyResult,
} from '../../../skills/taco/scripts/pack.mjs'
import {
  bypassSanitize,
  fencedUnits,
  importPayload,
  validateUnit,
} from '../../../skills/taco/scripts/lint-mermaid.mjs'
import { EXIT_CODES, makeCliError } from './errors.ts'
import { COMPLETE_SHELL_HTML } from './generated/assets.ts'

const MERMAID_TAG = /<script\b(?=[^>]*\bid=["']taco-asset-mermaid["'])[^>]*>([\s\S]*?)<\/script>/i

let cachedMermaidApi: { parse: (text: string) => Promise<unknown>; initialize: (options: unknown) => void } | null = null

async function getMermaidParser(): Promise<{ parse: (text: string) => Promise<unknown> } | null> {
  if (cachedMermaidApi) return cachedMermaidApi
  const match = MERMAID_TAG.exec(COMPLETE_SHELL_HTML)
  if (!match) return null
  try {
    const rawJs = inflateRawSync(Buffer.from(match[1].trim(), 'base64')).toString('utf8')
    const patched = bypassSanitize(rawJs, 'embedded complete shell')
    const api = await importPayload(patched, 'embedded complete shell')
    if (typeof api?.initialize === 'function') {
      api.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: 'default',
        flowchart: { htmlLabels: false },
      })
    }
    cachedMermaidApi = api
    return api
  } catch {
    return null
  }
}

export const executeVerify = async (
  filePath: string,
): Promise<{ exitCode: number; stdout?: string; stderr?: string }> => {
  if (!filePath) {
    const error = makeCliError('VALIDATION_ERROR', 'Missing required file path argument')
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  const resolvedPath = resolve(filePath)
  if (!existsSync(resolvedPath)) {
    const error = makeCliError('LOCAL_IO_ERROR', `File not found: ${resolvedPath}`)
    return { exitCode: EXIT_CODES.LOCAL_IO_ERROR, stderr: JSON.stringify(error) }
  }

  try {
    const result: VerifyResult = await verifyTaco(resolvedPath)
    const warnings: string[] = [...(result.structure.warnings ?? [])]

    // Validate diagrams using bundled Mermaid parser (fail closed if unavailable)
    const api = await getMermaidParser()
    if (!api) {
      const error = makeCliError(
        'VALIDATION_ERROR',
        'Bundled Mermaid parser failed to load from embedded shell',
      )
      return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
    }

    for (const file of result.bundle.files) {
      if (file.path.toLowerCase().endsWith('.mmd')) {
        const diag = await validateUnit(api, { file: file.path, body: file.content, lineOffset: 0 })
        if (diag !== undefined) {
          const d = diag as { message?: string }
          warnings.push(`Mermaid syntax error in ${file.path}: ${d.message ?? 'failed to parse'}`)
        }
      } else if (file.path.toLowerCase().endsWith('.md')) {
        const units = fencedUnits(file.path, file.content)
        for (const unit of units) {
          const diag = await validateUnit(api, unit)
          if (diag !== undefined) {
            const d = diag as { message?: string }
            warnings.push(`Mermaid syntax error in ${file.path}: ${d.message ?? 'failed to parse'}`)
          }
        }
      }
    }

    const payload = {
      schema: 'taco-cli-verify/1',
      path: result.path,
      docId: result.bundle.docId,
      title: result.bundle.title,
      root: result.bundle.root,
      level: 'V2',
      fileCount: result.bundle.files.length,
      commentCount: result.bundle.comments?.length ?? 0,
      checkpoints: Boolean(result.bundle.checkpoints),
      warnings,
      lines: result.lines,
    }

    if (warnings.length > 0) {
      return {
        exitCode: EXIT_CODES.VALIDATION_ERROR,
        stdout: JSON.stringify(payload, null, 2),
      }
    }

    return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(payload, null, 2) }
  } catch (err) {
    const error = makeCliError('VALIDATION_ERROR', (err as Error).message)
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }
}
