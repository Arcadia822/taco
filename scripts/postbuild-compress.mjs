#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Adapted for Taco from Bento's self-extracting single-file shell.

import { readFileSync, writeFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'

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
    var text = document.getElementById(id).textContent.trim()
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

if (loader.includes('</scr' + 'ipt>')) throw new Error('loader contains a script close sequence')

const payloads = `
    <script id="taco-rt-css" type="taco/deflate-b64">${cssPayload}</script>
    <script id="taco-rt" type="taco/deflate-b64">${jsPayload}</script>
    <script>${loader}</script>
`

const withoutRuntime = html
  .replace(moduleMatch[0], '')
  .replace(styleMatch[0], '')
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
