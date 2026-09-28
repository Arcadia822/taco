import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Spec §7.1: the linter bypasses one DOMPurify call inside the shipped Mermaid
 * payload so it can run without a DOM. This differential pins the claim that the
 * bypass does not change a syntax verdict, by comparing the linter against the
 * same payload left untouched and given a real DOM.
 *
 * Inputs cover the sanitization semantics the bypass removes: HTML tags, `<br>`,
 * `#br#` row separators, entities, comments, and markup that contains Mermaid syntax.
 */
const INPUTS: Array<[string, string]> = [
  ['html bold label', 'flowchart TD\n  A["<b>x</b>"] --> B\n'],
  ['script label', 'flowchart TD\n  A["<script>alert(1)</script>"] --> B\n'],
  ['ampersand label', 'flowchart TD\n  A["a & b"] --> B\n'],
  ['br label', 'flowchart TD\n  A["<br>"] --> B\n'],
  ['comment label', 'flowchart TD\n  A["<!-- x -->"] --> B\n'],
  ['unescaped lt label', 'flowchart TD\n  A["a < b"] --> B\n'],
  ['state label lt', 'stateDiagram-v2\n  A: "a<b"\n'],
  ['class member amp', 'classDiagram\n  class A {\n    +x : "a&b"\n  }\n'],
  ['gantt title lt', 'gantt\n  title a<b\n  section S\n    t: 2024-01-01, 1d\n'],
  ['pie title amp', 'pie title a&b\n  "x" : 1\n'],
  ['mindmap markup label', 'mindmap\n  root["<i>r</i>"]\n'],
  ['markup plus broken bracket', 'flowchart TD\n  A["<b>x</b>" --> B\n'],
  ['percent label', 'flowchart TD\n  A["%%"] --> B\n'],
  ['dashes label', 'flowchart TD\n  A["---"] --> B\n'],
  ['entity label', 'flowchart TD\n  A["&#35;x"] --> B\n'],
  ['sequence html message', 'sequenceDiagram\n  Alice->>Bob: "<b>hi</b>"\n'],
  ['br placeholder and entity', 'flowchart TD\n  A["#br#<br>&lt;"] --> B\n'],
  ['style tag label', 'flowchart TD\n  A["<style>x</style>"] --> B\n'],
  ['br placeholder alone', 'flowchart TD\n  A["#br#"] --> B\n'],
  ['mermaid syntax inside markup', 'flowchart TD\n  A["<style>--> B</style>"] --> B\n'],
  ['arrow inside markup', 'flowchart TD\n  A["<b>--></b>"] --> B\n'],
]

interface Verdict {
  kind: string
  line?: number
  column?: number
}

const reference = (directory: string): Record<string, Verdict> => {
  const script = join(directory, 'reference.mjs')
  writeFileSync(script, `
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from ${JSON.stringify(resolve('node_modules/jsdom/lib/api.js'))}
import { classifyMermaidFailure } from ${JSON.stringify(resolve('extensions/taco/bin/mermaid-diagnostics.mjs'))}

const html = readFileSync(${JSON.stringify(resolve('skills/taco/taco-shell.html'))}, 'utf8')
const payload = inflateRawSync(Buffer.from(html.match(/<script id="taco-asset-mermaid" type="taco\\/deflate-b64">([^<]*)<\\/script>/)[1], 'base64'))
const modulePath = join(mkdtempSync(join(tmpdir(), 'taco-ref-')), 'mermaid.mjs')
writeFileSync(modulePath, payload)

const window = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'https://taco.local/' }).window
for (const key of Object.getOwnPropertyNames(window)) {
  if (['location','globalThis','top','parent','frames','self','window'].includes(key) || key in globalThis) continue
  try { Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key] }) } catch {}
}
globalThis.window = window
globalThis.self = window
globalThis.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 20 })
globalThis.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent ?? '').length * 8 }

const mermaid = (await import(pathToFileURL(modulePath).href)).default
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', layout: 'elk', look: 'neo', theme: 'redux', htmlLabels: false, flowchart: { curve: 'basis' } })

const inputs = JSON.parse(readFileSync(join(${JSON.stringify(directory)}, 'inputs.json'), 'utf8'))
const out = {}
for (const [name, source] of inputs) {
  let error = null
  try { await mermaid.parse(source) } catch (caught) { error = caught }
  if (!error) { out[name] = { kind: 'ok' }; continue }
  const classified = classifyMermaidFailure({ stage: 'parse', error, source })
  out[name] = { kind: classified.kind, line: classified.line, column: classified.column }
}
process.stdout.write(JSON.stringify(out))
`)
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  expect(run.status, `reference runner failed: ${run.stderr}`).toBe(0)
  return JSON.parse(run.stdout) as Record<string, Verdict>
}

describe('linter differential against the untouched payload with a DOM', () => {
  it('reports the same verdict, line and column for 21 markup-heavy inputs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'taco-diff-'))
    const docs = join(directory, 'docs')
    mkdirSync(docs)
    const names: string[] = []
    INPUTS.forEach(([, source], index) => {
      const name = `i${String(index + 1).padStart(2, '0')}`
      names.push(name)
      writeFileSync(join(docs, `${name}.mmd`), source)
    })
    writeFileSync(join(directory, 'inputs.json'), JSON.stringify(INPUTS))

    const expected = reference(directory)
    // One corpus entry is genuinely invalid, so exit code 1 is expected here; the
    // report is still complete and that is what the differential reads.
    const run = spawnSync(process.execPath, [
      resolve('skills/taco/scripts/lint-mermaid.mjs'), '--dir', docs, '--json',
    ], { encoding: 'utf8', cwd: directory })
    expect(run.status, `linter crashed: ${run.stderr}`).toBe(1)
    const report = JSON.parse(run.stdout) as { complete: boolean, diagnostics: Array<{ file: string, kind: string, line: number | null, column: number | null }> }

    expect(report.complete, 'the differential run must be a complete validation').toBe(true)
    const actual = new Map(report.diagnostics.map((item) => [item.file.replace(/^docs\//, '').replace(/\.mmd$/, ''), item]))

    const mismatches: string[] = []
    INPUTS.forEach(([label], index) => {
      const name = names[index]
      const want = expected[label]
      const got = actual.get(name)
      const gotKind = got?.kind ?? 'ok'
      // `line`/`column` are null in JSON when the kernel has no position.
      const gotLine = got?.line ?? undefined
      const gotColumn = got?.column ?? undefined
      if (want.kind !== gotKind || want.line !== gotLine || want.column !== gotColumn) {
        mismatches.push(`${label}: reference ${JSON.stringify(want)} vs linter ${JSON.stringify({ kind: gotKind, line: gotLine, column: gotColumn })}`)
      }
    })

    expect(mismatches, 'the DOMPurify bypass must not change any verdict').toEqual([])
    // Sanity: the corpus must actually exercise both outcomes.
    const kinds = new Set(Object.values(expected).map((item) => item.kind))
    expect(kinds.has('ok'), 'some inputs must parse').toBe(true)
  }, 120_000)
})
