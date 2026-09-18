import { readFileSync } from 'node:fs'
import {
  computeDryRunProjectionSummary,
  projectLocalBundleToUploadContent,
  validateStagedUploadContent,
  type DryRunProjectionSummary,
} from '@taco/protocol'

/**
 * Extracts and parses the embedded JSON bundle from a standalone .taco.html file.
 */
export const extractTacoBundleFromHtml = (htmlContent: string): Record<string, unknown> => {
  const match = htmlContent.match(
    /<script\b[^>]*\bid=["']taco-document["'][^>]*>([\s\S]*?)<\/script>/i,
  )
  if (!match) {
    throw new Error('Invalid Taco file: missing <script id="taco-document"> container')
  }

  const jsonText = match[1].trim()
  try {
    return JSON.parse(jsonText) as Record<string, unknown>
  } catch (err) {
    throw new Error(`Invalid Taco file: JSON parse error: ${(err as Error).message}`)
  }
}

/**
 * Executes a local dry-run projection for publish or update.
 */
export const executeLocalDryRun = async (options: {
  command: 'publish' | 'update'
  filePath: string
  host: string
  baseRevisionId?: string
}): Promise<DryRunProjectionSummary> => {
  let rawHtml: string
  try {
    rawHtml = readFileSync(options.filePath, 'utf8')
  } catch (err) {
    throw new Error(`Failed to read input file '${options.filePath}': ${(err as Error).message}`)
  }

  const rawBundle = extractTacoBundleFromHtml(rawHtml)
  const projection = projectLocalBundleToUploadContent(rawBundle)
  if (!projection.ok) {
    throw new Error(`Validation failed during projection: ${projection.err}`)
  }

  const validated = validateStagedUploadContent(projection.content)
  if (!validated.ok) {
    throw new Error(`Protocol validation failed: ${validated.err}`)
  }

  const summary = await computeDryRunProjectionSummary(projection.content, {
    command: options.command,
    host: options.host,
    baseRevisionId: options.baseRevisionId,
  })

  summary.strippedFieldCategories = projection.strippedCategories
  return summary
}
