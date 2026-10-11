// SPDX-License-Identifier: MIT
// Sandboxed HTML document assembly for inline Taco viewer previews.
// All external network is blocked via CSP while allowing inline script/style
// so self-contained interactive single-page documents work safely.

export const EMBEDDED_HTML_CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'">`

export const EMBEDDED_HTML_SANDBOX =
  'allow-scripts allow-popups allow-popups-to-escape-sandbox'

const DOCTYPE_REGEX = /^(\s*<!doctype\b[^>]*>)/i

export function embeddedHtmlDocument(content: string): string {
  let bom = ''
  let remainder = content
  if (remainder.charCodeAt(0) === 0xfeff) {
    bom = remainder.slice(0, 1)
    remainder = remainder.slice(1)
  }

  const match = DOCTYPE_REGEX.exec(remainder)
  if (match) {
    const doctypeToken = match[1]
    const afterDoctype = remainder.slice(doctypeToken.length)
    return `${bom}${doctypeToken}\n${EMBEDDED_HTML_CSP}\n${afterDoctype}`
  }

  return `${bom}<!doctype html>\n${EMBEDDED_HTML_CSP}\n${remainder}`
}
