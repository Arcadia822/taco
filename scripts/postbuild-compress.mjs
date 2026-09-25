#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Adapted for Taco from Bento's self-extracting single-file shell.

import { readFileSync, writeFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { resolve } from 'node:path'
import { buildSync, transformSync } from 'esbuild'

const path = process.argv[2]
if (!path) {
  console.error('usage: node scripts/postbuild-compress.mjs <taco.html>')
  process.exit(1)
}

const html = readFileSync(path, 'utf8')
if (html.includes('id="taco-rt"')) {
  console.log('compressed shell already present — skipping')
  process.exit(0)
}

const moduleMatch = html.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/)
if (!moduleMatch) throw new Error('inline module script not found')

const styleMatch = html.match(/<style[^>]*\brel="stylesheet"[^>]*>([\s\S]*?)<\/style>/)
if (!styleMatch) throw new Error('inline application stylesheet not found')

const encode = (value) => deflateRawSync(Buffer.from(value, 'utf8'), { level: 9 }).toString('base64')
const jsPayload = encode(moduleMatch[1])
const cssPayload = encode(styleMatch[1])

let mermaidPayload = ''
let richAdapterPayload = ''
const isLite = /<meta\b[^>]*name=["']taco-shell-variant["'][^>]*content=["']lite["']/i.test(html)

if (!isLite) {
  // Complete shell gets standalone embedded compressed Mermaid module for 100% offline diagram rendering
  const mermaidResult = buildSync({
    stdin: {
      contents: 'import mermaid from "mermaid"; export default mermaid;\n',
      resolveDir: process.cwd(),
      loader: 'js',
    },
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    write: false,
  })
  const mermaidCode = mermaidResult.outputFiles[0].text
  mermaidPayload = `    <script id="taco-asset-mermaid" type="taco/deflate-b64">${encode(mermaidCode)}</script>\n`
} else {
  // Lite shell gets standalone embedded compressed rich editor adapter module
  // with npm dependencies externalized and local Taco sources bundled.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const adapterResult = buildSync({
    entryPoints: [resolve(process.cwd(), 'src/rich-editor-tiptap.ts')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    packages: 'external',
    write: false,
    alias: {
      '@taco/protocol': resolve(process.cwd(), 'packages/protocol/src/index.ts'),
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEFAULT_LOCALE__: JSON.stringify(process.env.TACO_DEFAULT_LOCALE ?? ''),
      __EMBEDDED_ASSETS__: JSON.stringify({}),
    },
  })
  const adapterCode = adapterResult.outputFiles[0].text
  richAdapterPayload = `    <script type="application/taco+base64" id="taco-asset-rich-adapter">${encode(adapterCode)}</script>\n`
}

const loader = `
(async () => {
  var fail = function (message) {
    var node = document.createElement('div')
    node.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#f4f1ea;color:#20211f;font:15px/1.6 system-ui,sans-serif;text-align:center;padding:40px;z-index:99999'
    node.textContent = message
    document.body.appendChild(node)
    var splash = document.getElementById('taco-splash')
    if (splash) splash.remove()
  }
  if (typeof DecompressionStream === 'undefined') {
    fail('Taco requires a browser with DecompressionStream support.')
    return
  }
  var inflate = async function (id) {
    var el = document.getElementById(id)
    if (!el) return ''
    var text = el.textContent.trim()
    var bytes = Uint8Array.from(atob(text), function (character) { return character.charCodeAt(0) })
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return await new Response(stream).text()
  }
  var moduleUrl = ''
  try {
    var css = await inflate('taco-rt-css')
    var stale = document.querySelectorAll('style[data-taco-transient]')
    for (var index = 0; index < stale.length; index++) stale[index].remove()
    var style = document.createElement('style')
    style.id = 'taco-rt-style'
    style.setAttribute('data-taco-transient', '')
    style.textContent = css
    document.head.appendChild(style)
    var javascript = await inflate('taco-rt')
    moduleUrl = URL.createObjectURL(new Blob([javascript], { type: 'text/javascript' }))
    await import(moduleUrl)
  } catch (error) {
    fail('Taco could not start: ' + (error && error.message ? error.message : error))
  } finally {
    if (moduleUrl) URL.revokeObjectURL(moduleUrl)
  }
})()
`

const minLoader = transformSync(loader, { minify: true }).code
if (minLoader.includes('</scr' + 'ipt>')) throw new Error('loader contains a script close sequence')

const payloads = `
    <script id="taco-rt-css" type="taco/deflate-b64">${cssPayload}</script>
    <script id="taco-rt" type="taco/deflate-b64">${jsPayload}</script>
${mermaidPayload}${richAdapterPayload}    <script>${minLoader}</script>
`

const stripCommentsOutsideDataBlock = (source) => {
  const docStart = source.search(/<script\b[^>]*\bid=["']taco-document["'][^>]*>/i)
  if (docStart === -1) return source.replace(/<!--[\s\S]*?-->/g, '')
  const docEndTag = '</script>'
  const docEnd = source.indexOf(docEndTag, docStart)
  if (docEnd === -1) return source.replace(/<!--[\s\S]*?-->/g, '')
  const afterDoc = docEnd + docEndTag.length
  const before = source.slice(0, docStart).replace(/<!--[\s\S]*?-->/g, '')
  const docBlock = source.slice(docStart, afterDoc)
  const after = source.slice(afterDoc).replace(/<!--[\s\S]*?-->/g, '')
  return before + docBlock + after
}

let withoutRuntime = stripCommentsOutsideDataBlock(html)
  .replace(moduleMatch[0], '')
  .replace(styleMatch[0], '')

if (isLite) {
  // jsDelivr's +esm resolver can select different ProseMirror patch versions for
  // distinct Tiptap extensions. ProseMirror plugins share keyed global state, so
  // every extension must import one canonical copy of each package.
  const imports = { '/npm/': 'https://cdn.jsdelivr.net/npm/', '/': 'https://esm.sh/' }
  const prosemirrorVersions = {
    'prosemirror-state': ['1.4.4', ['1.4.3']],
    'prosemirror-view': ['1.42.2', ['1.41.4', '1.41.6']],
    'prosemirror-transform': ['1.12.0', ['1.10.3', '1.10.4', '1.10.5', '1.7.2', '1.11.0']],
    'prosemirror-model': ['1.25.11', ['1.19.1', '1.24.1', '1.25.0', '1.25.1', '1.25.4']],
  }
  for (const [name, [canonical, older]] of Object.entries(prosemirrorVersions)) {
    for (const version of older) {
      const canonicalUrl = `https://cdn.jsdelivr.net/npm/${name}@${canonical}/`
      imports[`/npm/${name}@${version}/`] = canonicalUrl
      imports[`https://cdn.jsdelivr.net/npm/${name}@${version}/`] = canonicalUrl
    }
  }
  const importMap = `    <script type="importmap">${JSON.stringify({ imports })}</script>\n`
  withoutRuntime = withoutRuntime.replace('</head>', `${importMap}  </head>`)
}

const output = withoutRuntime
  .replace('</body>', `${payloads}  </body>`)
  .replace(/[\t ]+$/gm, '')
if (output === withoutRuntime) throw new Error('closing body tag not found')

const scriptOpens = (output.match(/<script[\s>]/g) ?? []).length
const scriptCloses = output.split('</scr' + 'ipt>').length - 1
if (scriptOpens !== scriptCloses) throw new Error(`script tag imbalance: ${scriptOpens}/${scriptCloses}`)

writeFileSync(path, output)
const kb = (bytes) => `${Math.round(bytes / 1024)}KB`
console.log(`compressed shell: ${kb(Buffer.byteLength(html))} → ${kb(Buffer.byteLength(output))}`)
