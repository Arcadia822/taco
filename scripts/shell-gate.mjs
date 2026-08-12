#!/usr/bin/env node
// Taco single-file conformance gate: readable document, compressed runtime,
// balanced raw-text blocks, and no bundled web fonts.

import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

const path = process.argv[2]
if (!path) {
  console.error('usage: node scripts/shell-gate.mjs <taco.html>')
  process.exit(1)
}

const fail = (message) => { throw new Error(`Taco shell gate: ${message}`) }
const html = readFileSync(path, 'utf8')
const close = '</scr' + 'ipt>'
const securityMeta = html.match(/<meta\b(?=[^>]*\bname=["']taco-security-version["'])[^>]*>/i)?.[0]
if (securityMeta?.match(/\bcontent=["']([^"']+)["']/i)?.[1] !== '1') fail('runtime security marker is missing or outdated')

const opens = (html.match(/<script[\s>]/g) ?? []).length
const closes = html.split(close).length - 1
if (opens !== closes) fail(`script tag imbalance: ${opens}/${closes}`)
if (/<script type="module"/.test(html)) fail('runtime module remains uncompressed')

const documentBlocks = [...html.matchAll(/<script type="application\/taco\+json" id="taco-document">([\s\S]*?)<\/script>/g)]
if (documentBlocks.length !== 1) fail(`expected one taco document block, found ${documentBlocks.length}`)
try { JSON.parse(documentBlocks[0][1]) }
catch (error) { fail(`document block is not valid JSON: ${error.message}`) }

const inflate = (id) => {
  const pattern = new RegExp(`<script id="${id}" type="taco/deflate-b64">([A-Za-z0-9+/=]+)<\\/script>`)
  const match = html.match(pattern)
  if (!match) fail(`${id} payload is missing`)
  return inflateRawSync(Buffer.from(match[1], 'base64')).toString('utf8')
}

const css = inflate('taco-rt-css')
const javascript = inflate('taco-rt')
if (!css.trim()) fail('inflated CSS is empty')
if (!javascript.trim()) fail('inflated JavaScript is empty')
if (css.includes('@font-face') || /data:font\//.test(css)) fail('runtime contains a bundled font')
if (javascript.includes('mermaidAPI') || javascript.includes('mermaid.parseError')) fail('runtime contains bundled Mermaid code')
if (!javascript.includes('mermaid@11.16.1/dist/mermaid.esm.min.mjs')) fail('runtime is missing the pinned Mermaid CDN loader')
if (!javascript.includes('collab-secrets-present')) fail('runtime is missing collaboration-secret detection')
for (const member of ['securityVersion', 'validate', 'listFiles', 'readFile', 'search']) {
  if (!javascript.includes(member)) fail(`runtime is missing bounded Agent API member: ${member}`)
}
if (!html.includes("style.setAttribute('data-taco-transient', '')")) fail('runtime style is not marked transient')

const replacement = JSON.stringify({ format: 'taco/files', version: 1, docId: 'gate', title: 'Gate', root: 'specs/gate', files: [] })
const spliced = html.replace(documentBlocks[0][0], `<script type="application/taco+json" id="taco-document">${replacement}${close}`)
if (!spliced.includes(replacement)) fail('document block cannot be replaced safely')

console.log(`shell gate passed: ${Math.round(Buffer.byteLength(html) / 1024)}KB, runtime ${Math.round((Buffer.byteLength(css) + Buffer.byteLength(javascript)) / 1024)}KB inflated`)
