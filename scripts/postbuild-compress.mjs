#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Adapted for Taco from Bento's self-extracting single-file shell.

import { readFileSync, writeFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { basename, resolve } from 'node:path'
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

const COMPRESSION_CONFIGS = [
  { level: 9, memLevel: 8 }, // zlib default
  { level: 9, memLevel: 6 }, // optimal for JS Lite, Adapter, Mermaid
  { level: 8, memLevel: 7 }, // optimal for JS Complete
  { level: 7, memLevel: 8 }, // optimal for CSS
]

const encode = (value, fixedOptions = null) => {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')
  if (fixedOptions) {
    return deflateRawSync(buf, fixedOptions).toString('base64')
  }
  let best = deflateRawSync(buf, COMPRESSION_CONFIGS[0])
  for (let i = 1; i < COMPRESSION_CONFIGS.length; i++) {
    const candidate = deflateRawSync(buf, COMPRESSION_CONFIGS[i])
    if (candidate.length < best.length) {
      best = candidate
    }
  }
  return best.toString('base64')
}
let jsPayload = ''
const cssPayload = encode(styleMatch[1])

let mermaidPayload = ''
let richAdapterPayload = ''
let sharedPayload = ''
const isLite = /<meta\b[^>]*name=["']taco-shell-variant["'][^>]*content=["']lite["']/i.test(html)

if (!isLite) {
  jsPayload = encode(moduleMatch[1])
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
    treeShaking: true,
    write: false,
  })
  const mermaidCode = mermaidResult.outputFiles[0].text
  mermaidPayload = `<script id="taco-asset-mermaid" type="taco/deflate-b64">${encode(mermaidCode, { level: 9, memLevel: 6 })}</script>`
} else {
  // Build both Lite entries together so esbuild emits one offline-safe shared
  // module instead of bundling Taco's source/editor helpers twice.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const result = buildSync({
    entryPoints: {
      'taco-rt': resolve(process.cwd(), 'src/main-lite.ts'),
      'taco-asset-rich-adapter': resolve(process.cwd(), 'src/rich-editor-tiptap.ts'),
    },
    outdir: resolve(process.cwd(), 'dist-single/.lite-chunks'),
    entryNames: '[name]',
    chunkNames: 'taco-shared',
    splitting: true,
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    external: ['@tiptap/*', 'lowlight', 'highlight.js/*', 'marked'],
    loader: { '.css': 'empty' }, // Vite's existing inline stylesheet remains authoritative.
    treeShaking: true,
    write: false,
    metafile: true,
    alias: {
      '@taco/protocol': resolve(process.cwd(), 'packages/protocol/src/index.ts'),
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEFAULT_LOCALE__: JSON.stringify(process.env.TACO_DEFAULT_LOCALE ?? ''),
      __EMBEDDED_ASSETS__: JSON.stringify({}), // Also empty in the prior Lite adapter; unused by main.
    },
  })
  const chunks = new Map(result.outputFiles.map((file) => [basename(file.path), file.text]))
  const main = chunks.get('taco-rt.js')
  const shared = chunks.get('taco-shared.js')
  const adapter = chunks.get('taco-asset-rich-adapter.js')
  if (chunks.size !== 3 || !main || !shared || !adapter) {
    throw new Error(`Unexpected Lite chunks: ${[...chunks.keys()].join(', ')}`)
  }
  const sharedImport = '"./taco-shared.js"'
  if (!main.includes(sharedImport) || !adapter.includes(sharedImport)) {
    throw new Error('Lite runtime and adapter must both import the shared module')
  }
  for (const [outputPath, output] of Object.entries(result.metafile.outputs)) {
    if (outputPath.endsWith('/taco-rt.js') || outputPath.endsWith('/taco-shared.js')) {
      if (output.imports.some((entry) => entry.external)) {
        throw new Error(`Offline Lite core has external imports: ${outputPath}`)
      }
    }
  }
  jsPayload = encode(main)
  sharedPayload = `<script id="taco-rt-shared" type="taco/deflate-b64">${encode(shared)}</script>`
  richAdapterPayload = `<script type="application/taco+base64" id="taco-asset-rich-adapter">${encode(adapter)}</script>`
}

const loader = `
(async () => {
  const fail = (message) => {
    const node = document.createElement('div')
    node.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#f4f1ea;color:#20211f;font:15px/1.6 system-ui,sans-serif;text-align:center;padding:40px;z-index:99999'
    node.textContent = message
    document.body.appendChild(node)
    document.getElementById('taco-splash')?.remove()
  }
  if (typeof DecompressionStream === 'undefined') {
    fail('Taco requires a browser with DecompressionStream support.')
    return
  }
  const inflate = async (id) => {
    const el = document.getElementById(id)
    if (!el) return ''
    const bytes = Uint8Array.from(atob(el.textContent.trim()), (c) => c.charCodeAt(0))
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return await new Response(stream).text()
  }
  let moduleUrl = ''
  ${isLite ? "let sharedUrl = ''" : ''}
  try {
    const css = await inflate('taco-rt-css')
    document.querySelectorAll('style[data-taco-transient]').forEach((s) => s.remove())
    const style = document.createElement('style')
    style.id = 'taco-rt-style'
    style.setAttribute('data-taco-transient', '')
    style.textContent = css
    document.head.appendChild(style)
    ${isLite ? `const shared = document.getElementById('taco-rt-shared')
    sharedUrl = URL.createObjectURL(new Blob([await inflate('taco-rt-shared')], { type: 'text/javascript' }))
    Object.defineProperty(shared, 'tacoSharedModuleUrl', { value: sharedUrl })` : ''}
    ${isLite ? 'let' : 'const'} javascript = await inflate('taco-rt')
    ${isLite ? `const specifier = '"./taco-shared.js"'
    if (!javascript.includes(specifier)) throw new Error('Shared Lite runtime import is missing')
    javascript = javascript.replace(specifier, JSON.stringify(sharedUrl))` : ''}
    moduleUrl = URL.createObjectURL(new Blob([javascript], { type: 'text/javascript' }))
    await import(moduleUrl)
  } catch (error) {
    ${isLite ? 'if (sharedUrl) URL.revokeObjectURL(sharedUrl)' : ''}
    fail('Taco could not start: ' + (error?.message || error))
  } finally {
    if (moduleUrl) URL.revokeObjectURL(moduleUrl)
  }
})()
`

const minLoader = transformSync(loader, { minify: true, target: 'es2022' }).code
if (minLoader.includes('</scr' + 'ipt>')) throw new Error('loader contains a script close sequence')

const payloads = [
  `<script id="taco-rt-css" type="taco/deflate-b64">${cssPayload}</script>`,
  `<script id="taco-rt" type="taco/deflate-b64">${jsPayload}</script>`,
  sharedPayload,
  mermaidPayload,
  richAdapterPayload,
  `<script>${minLoader}</script>`,
].filter(Boolean).join('\n')

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
const collapseBlankLinesOutsideDataBlock = (source) => {
  const docStart = source.search(/<script\b[^>]*\bid=["']taco-document["'][^>]*>/i)
  if (docStart === -1) return source.replace(/\n{2,}/g, '\n')
  const docEndTag = '</script>'
  const docEnd = source.indexOf(docEndTag, docStart)
  if (docEnd === -1) return source.replace(/\n{2,}/g, '\n')
  const afterDoc = docEnd + docEndTag.length
  const before = source.slice(0, docStart).replace(/\n{2,}/g, '\n')
  const docBlock = source.slice(docStart, afterDoc)
  const after = source.slice(afterDoc).replace(/\n{2,}/g, '\n')
  return before + docBlock + after
}


let withoutRuntime = stripCommentsOutsideDataBlock(html)
  .replace(moduleMatch[0], '')
  .replace(styleMatch[0], '')
withoutRuntime = withoutRuntime.replace(/<style\b(?![^>]*\brel="stylesheet")>([\s\S]*?)<\/style>/i, (_, css) => {
  const minCss = transformSync(css, { loader: 'css', minify: true }).code.trim()
  return `<style>${minCss}</style>`
})


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
  const importMap = `<script type="importmap">${JSON.stringify({ imports })}</script>`
  withoutRuntime = withoutRuntime.replace(/\s*<\/head>/i, () => `\n${importMap}\n</head>`)
}

withoutRuntime = collapseBlankLinesOutsideDataBlock(withoutRuntime)

const output = withoutRuntime
  .replace(/\s*<\/body>/i, () => `\n${payloads}\n</body>`)
  .replace(/[\t ]+$/gm, '')
if (output === withoutRuntime) throw new Error('closing body tag not found')

const scriptOpens = (output.match(/<script[\s>]/g) ?? []).length
const scriptCloses = output.split('</scr' + 'ipt>').length - 1
if (scriptOpens !== scriptCloses) throw new Error(`script tag imbalance: ${scriptOpens}/${scriptCloses}`)

writeFileSync(path, output)
const kb = (bytes) => `${Math.round(bytes / 1024)}KB`
console.log(`compressed shell: ${kb(Buffer.byteLength(html))} → ${kb(Buffer.byteLength(output))}`)
