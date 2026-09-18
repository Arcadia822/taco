import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

let cachedTemplate: { before: string; after: string } | null = null

export function getTacoShellTemplate(): { before: string; after: string } {
  if (cachedTemplate) return cachedTemplate

  // Load from extensions/taco/assets/taco-shell.html
  const startTag = '<script type="application/taco+json" id="taco-document">'
  const endTag = '</script>'
  const localAsset = join(process.cwd(), 'assets', 'taco-shell.html')
  const rootAsset = join(process.cwd(), 'extensions', 'taco', 'assets', 'taco-shell.html')
  const shellPath = existsSync(localAsset) ? localAsset : rootAsset
  const fullHtml = readFileSync(shellPath, 'utf8')
  const startIdx = fullHtml.indexOf(startTag)
  if (startIdx === -1) {
    throw new Error('Failed to find <script id="taco-document"> in taco-shell.html')
  }

  const endIdx = fullHtml.indexOf(endTag, startIdx)
  if (endIdx === -1) {
    throw new Error('Failed to find closing </script> in taco-shell.html')
  }

  const before = fullHtml.slice(0, startIdx + startTag.length)
  const after = fullHtml.slice(endIdx)

  cachedTemplate = { before, after }
  return cachedTemplate
}

/**
 * Injects a real Taco bundle into the canonical Taco HTML shell.
 * Produces the exact 1:1 visual appearance, Bento layouts, WYSIWYG editor,
 * outline, comment system, and file browser.
 */
export function renderCanonicalTacoHtml(bundle: unknown): string {
  const { before, after } = getTacoShellTemplate()
  const serialized = JSON.stringify(bundle, null, 2).replace(/</g, '\\u003c')
  return `${before}\n${serialized}\n${after}`
}
