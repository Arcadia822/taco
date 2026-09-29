import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

let cachedTemplate: { before: string; after: string } | null = null

export function resetTacoShellTemplateCache(): void {
  cachedTemplate = null
}

function resolveHostShellPath(): string {
  const candidates = [
    join(process.cwd(), 'assets', 'taco-shell.html'),
    join(process.cwd(), 'packages', 'host', 'assets', 'taco-shell.html'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    'Host Taco shell asset is missing: dedicated host asset not found at assets/taco-shell.html (fail closed, portable fallback disabled)',
  )
}

export function getTacoShellTemplate(): { before: string; after: string } {
  if (cachedTemplate) return cachedTemplate

  const startTag = '<script type="application/taco+json" id="taco-document">'
  const endTag = '</script>'
  const shellPath = resolveHostShellPath()
  const fullHtml = readFileSync(shellPath, 'utf8')

  const securityMeta = fullHtml.match(/<meta\b(?=[^>]*\bname=["']taco-security-version["'])[^>]*>/i)?.[0]
  if (securityMeta?.match(/\bcontent=["']([^"']+)["']/i)?.[1] !== '1') {
    throw new Error('Host Taco shell asset security marker is missing or outdated')
  }

  const variantMeta = fullHtml.match(/<meta\b(?=[^>]*\bname=["']taco-shell-variant["'])[^>]*>/i)?.[0]
  const variant = variantMeta?.match(/\bcontent=["']([^"']+)["']/i)?.[1]
  if (variant !== 'host') {
    throw new Error(
      `Host Taco shell asset is stale or invalid: expected variant "host", found "${variant ?? 'missing'}" (fail closed, portable fallback disabled)`,
    )
  }

  const startIdx = fullHtml.indexOf(startTag)
  if (startIdx === -1) {
    throw new Error('Failed to find <script id="taco-document"> in host taco-shell.html')
  }

  const endIdx = fullHtml.indexOf(endTag, startIdx)
  if (endIdx === -1) {
    throw new Error('Failed to find closing </script> in host taco-shell.html')
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
