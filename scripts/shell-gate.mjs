#!/usr/bin/env node
// Taco single-file conformance gate: readable document, compressed runtime,
// balanced raw-text blocks, variant checks, and size gates.

import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { basename } from 'node:path'

const path = process.argv[2]
if (!path) {
  console.error('usage: node scripts/shell-gate.mjs <taco.html> [complete|lite]')
  process.exit(1)
}

const expectedVariant = process.argv[3]
if (expectedVariant && expectedVariant !== 'complete' && expectedVariant !== 'lite') {
  throw new Error(`Taco shell gate: invalid expected variant "${expectedVariant}"; must be "complete" or "lite"`)
}

const fail = (message) => { throw new Error(`Taco shell gate: ${message}`) }
const html = readFileSync(path, 'utf8')
const close = '</scr' + 'ipt>'
const securityMeta = html.match(/<meta\b(?=[^>]*\bname=["']taco-security-version["'])[^>]*>/i)?.[0]
if (securityMeta?.match(/\bcontent=["']([^"']+)["']/i)?.[1] !== '1') fail('runtime security marker is missing or outdated')

const variantMeta = html.match(/<meta\b(?=[^>]*\bname=["']taco-shell-variant["'])[^>]*>/i)?.[0]
const variant = variantMeta?.match(/\bcontent=["'](complete|lite)["']/i)?.[1]
if (!variant) fail('variant marker <meta name="taco-shell-variant" content="complete|lite"> is missing or invalid')

if (expectedVariant && variant !== expectedVariant) {
  fail(`variant mismatch: expected ${expectedVariant}, found ${variant}`)
}

const base = basename(path)
if (/_Lite\./i.test(base) && variant !== 'lite') {
  fail(`shell filename ${base} indicates Lite, but variant marker is ${variant}`)
}
if (/Taco_Spec\.taco\.html$/i.test(base) && variant !== 'complete') {
  fail(`shell filename ${base} indicates Complete, but variant marker is ${variant}`)
}
const opens = (html.match(/<script[\s>]/g) ?? []).length
const closes = html.split(close).length - 1
if (opens !== closes) fail(`script tag imbalance: ${opens}/${closes}`)
if (/<script type="module"/.test(html)) fail('runtime module remains uncompressed')

const documentBlocks = [...html.matchAll(/<script type="application\/taco\+json" id="taco-document">([\s\S]*?)<\/script>/g)]
if (documentBlocks.length !== 1) fail(`expected one taco document block, found ${documentBlocks.length}`)
try { JSON.parse(documentBlocks[0][1]) }
catch (error) { fail(`document block is not valid JSON: ${error.message}`) }

const inflate = (id, type = 'taco/deflate-b64') => {
  const pattern = new RegExp(`<script\\b[^>]*\\bid=["']${id}["'][^>]*>([A-Za-z0-9+/=]+)<\\/script>|<script\\b[^>]*\\btype=["']${type}["'][^>]*\\bid=["']${id}["'][^>]*>([A-Za-z0-9+/=]+)<\\/script>`)
  const match = html.match(pattern)
  if (!match) fail(`${id} payload is missing`)
  const b64 = match[1] || match[2]
  return inflateRawSync(Buffer.from(b64, 'base64')).toString('utf8')
}

const css = inflate('taco-rt-css')
const javascript = inflate('taco-rt')
const shared = variant === 'lite' ? inflate('taco-rt-shared') : ''
const runtime = javascript + shared
if (!css.trim()) fail('inflated CSS is empty')
if (!javascript.trim() || (variant === 'lite' && !shared.trim())) fail('inflated JavaScript is empty')
if (css.includes('@font-face') || /data:font\//.test(css)) fail('runtime contains a bundled font')
if (!runtime.includes('collab-secrets-present')) fail('runtime is missing collaboration-secret detection')
for (const member of ['securityVersion', 'validate', 'listFiles', 'readFile', 'search']) {
  if (!runtime.includes(member)) fail(`runtime is missing bounded Agent API member: ${member}`)
}
if (!/\.setAttribute\(["']data-taco-transient["'],\s*["']["']\)/.test(html)) fail('runtime style is not marked transient')

if (variant === 'complete') {
  if (!html.includes('id="taco-asset-mermaid"')) fail('Complete shell is missing embedded offline Mermaid asset')
} else if (variant === 'lite') {
  if (!html.includes('id="taco-asset-rich-adapter"')) fail('Lite shell is missing embedded #taco-asset-rich-adapter')
  if (!html.includes('type="importmap"')) fail('Lite shell is missing importmap')
  if (!javascript.includes('./taco-shared.js')) fail('Lite runtime is missing its shared import')
  const adapterCode = inflate('taco-asset-rich-adapter', 'application/taco\\+base64')
  if (!adapterCode.includes('./taco-shared.js')) fail('Lite adapter is missing its shared import')
  if (!adapterCode.trim()) fail('Lite rich-adapter asset is empty')
  if (!adapterCode.includes('TiptapRichEditorAdapter')) {
    fail('Lite rich-adapter asset is missing TiptapRichEditorAdapter export')
  }
  if (runtime.includes('TiptapBlockIdentity') || runtime.includes('createTacoEditorExtensions')) {
    fail('Lite shell must not bundle the npm rich editor graph')
  }
  const emptyReplacement = JSON.stringify({ format: 'taco/files', version: 1, docId: 'gate', title: 'Gate', root: 'specs/gate', files: [] })
  const emptyHtml = html.replace(documentBlocks[0][0], `<script type="application/taco+json" id="taco-document">${emptyReplacement}${close}`)
  const emptyBytes = Buffer.byteLength(emptyHtml, 'utf8')
  if (emptyBytes >= 225 * 1024) {
    fail(`empty Lite shell must be < 225 KiB (230,400 bytes), got ${emptyBytes} bytes (${(emptyBytes / 1024).toFixed(1)} KiB)`)
  }
}

const replacement = JSON.stringify({ format: 'taco/files', version: 1, docId: 'gate', title: 'Gate', root: 'specs/gate', files: [] })
const spliced = html.replace(documentBlocks[0][0], `<script type="application/taco+json" id="taco-document">${replacement}${close}`)
if (!spliced.includes(replacement)) fail('document block cannot be replaced safely')

console.log(`shell gate passed: [${variant}] ${Math.round(Buffer.byteLength(html) / 1024)}KB, runtime ${Math.round((Buffer.byteLength(css) + Buffer.byteLength(runtime)) / 1024)}KB inflated`)
