import { renderCanonicalTacoHtml } from './src/lib/taco-shell-template.ts'

// Ensure webpack/next traces the static shell asset into the deployment bundle
export function ensureShellTraced() {
  return renderCanonicalTacoHtml
}
