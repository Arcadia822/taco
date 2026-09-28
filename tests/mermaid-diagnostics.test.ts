import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_DIAGNOSTIC_MESSAGES,
  clampDiagnosticLine,
  classifyMermaidFailure,
  mergeDiagnosticOffset,
} from '../extensions/taco/bin/mermaid-diagnostics.mjs'

const source = 'flowchart TD\n  A --> B\n'

describe('mermaid diagnostics kernel', () => {
  it('reports the loader stage as runtime with no position', () => {
    const result = classifyMermaidFailure({ stage: 'load', error: new Error('cdn offline'), source })
    expect(result).toMatchObject({ kind: 'runtime', detail: 'cdn offline' })
    expect(result.line).toBeUndefined()
    expect(result.message).toBe(DEFAULT_DIAGNOSTIC_MESSAGES.runtime)
  })

  it('reports a render-stage failure without position and without claiming syntax', () => {
    const result = classifyMermaidFailure({ stage: 'render', error: new TypeError('boom'), source })
    expect(result.kind).toBe('render')
    expect(result.line).toBeUndefined()
    expect(result.message).not.toContain('syntax')
  })

  it('reads langium positions structurally instead of by error name', () => {
    // The langium family reports `name === 'Error'`; only the parser token is reliable.
    const error = Object.assign(new Error('Parsing failed:  Parse error on line 3, column 3'), {
      result: { parserErrors: [{ token: { startLine: 3, startColumn: 3, endLine: 3, endColumn: 9 } }] },
    })
    const result = classifyMermaidFailure({ stage: 'parse', error, source: 'gitGraph\n  commit\n  banana\n' })
    expect(result).toMatchObject({ kind: 'syntax', line: 3, column: 3, endLine: 3, endColumn: 9 })
  })

  it('prefers hash.loc.first_line over the message line when jison disagrees', () => {
    // Recorded sample: `hash.line=1` wrong, `loc.first_line=2` right, message says 2.
    const error = Object.assign(new Error('Parse error on line 2:\n...t TD  A[Start --> B[End]'), {
      hash: { line: 1, loc: { first_line: 2, first_column: 4 }, token: 'SQS', expected: ["'SQE'", "'PE'", "'PIPE'", "'TXT'", "'A'", "'B'", "'C'"] },
    })
    const result = classifyMermaidFailure({ stage: 'parse', error, source: 'flowchart TD\n  A[Start --> B[End]' })
    expect(result).toMatchObject({ kind: 'syntax', line: 2, column: 4, token: 'SQS' })
    expect(result.expected).toHaveLength(6)
    expect(result.detail).toContain('Parse error on line 2')
  })

  it('falls back to the message line and clamps it into the source', () => {
    // Recorded sample: the message says line 3 while the body has only 2 lines,
    // and the offending line is line 2 — hence the clamp, not blind trust.
    const error = Object.assign(new Error('Parse error on line 3:\n...t TD  A[Start] -->'), {
      hash: { line: 3, token: 'EOF', expected: [] },
    })
    const result = classifyMermaidFailure({ stage: 'parse', error, source: 'flowchart TD\n  A[Start] -->' })
    expect(result.line).toBe(2)
    const clamped = classifyMermaidFailure({
      stage: 'parse',
      error: Object.assign(new Error('Parse error on line 99'), { hash: {} }),
      source,
    })
    expect(clamped.line).toBe(3)
  })

  it('classifies an unknown diagram type separately from a syntax error', () => {
    const error = Object.assign(new Error('No diagram type detected'), { name: 'UnknownDiagramError' })
    const result = classifyMermaidFailure({ stage: 'parse', error, source: 'notadiagram TD\n  A --> B\n' })
    expect(result).toMatchObject({ kind: 'unknown-type', detail: 'No diagram type detected' })
  })

  it('separates an empty source from a syntax error on the boolean parse path', () => {
    expect(classifyMermaidFailure({ stage: 'parse', returnedFalse: true, source: '' }).kind).toBe('unknown-type')
    expect(classifyMermaidFailure({ stage: 'parse', returnedFalse: true, source: '   \n\n' }).kind).toBe('unknown-type')
    expect(classifyMermaidFailure({ stage: 'parse', returnedFalse: true, source: '%% only a comment\n' }).kind).toBe('unknown-type')
    // A boolean `false` keeps no error object, so it must not invent one.
    const broken = classifyMermaidFailure({ stage: 'parse', returnedFalse: true, source: 'flowchart TD\n  A -->\n' })
    expect(broken).toMatchObject({ kind: 'syntax' })
    expect(broken.detail).toBeUndefined()
  })

  it('treats an unexpected parse-stage failure as an untrustworthy runtime', () => {
    const result = classifyMermaidFailure({ stage: 'parse', error: new TypeError('My.addHook is not a function'), source })
    expect(result.kind).toBe('runtime')
  })

  it('never serializes the langium result payload', () => {
    const circular = { parserErrors: [{ token: { startLine: 1, startColumn: 1 } }] }
    Object.assign(circular, { self: circular })
    const error = Object.assign(new Error('Parsing failed'), { result: circular })
    const result = classifyMermaidFailure({ stage: 'parse', error, source: 'gitGraph\n' })
    expect(JSON.parse(JSON.stringify(result))).toMatchObject({ kind: 'syntax', line: 1, column: 1 })
  })

  it('accepts caller messages so one kernel serves both runtimes', () => {
    const result = classifyMermaidFailure({ stage: 'parse', returnedFalse: true, source, messages: { syntax: '语法无效' } })
    expect(result.message).toBe('语法无效')
    expect(DEFAULT_DIAGNOSTIC_MESSAGES['unknown-type']).toBe('No diagram type detected')
  })

  it('clamps and offsets positions for a Markdown fence', () => {
    expect(clampDiagnosticLine(0, 3)).toBe(1)
    expect(clampDiagnosticLine(9, 3)).toBe(3)
    expect(clampDiagnosticLine(undefined, 3)).toBeUndefined()
    const merged = mergeDiagnosticOffset({ kind: 'syntax', message: 'x', line: 2, endLine: 2 }, 8)
    expect(merged).toMatchObject({ line: 10, endLine: 10 })
    expect(mergeDiagnosticOffset({ kind: 'syntax', message: 'x' }, 8).line).toBeUndefined()
  })

  it('keeps the skill mirror byte-identical to the canonical kernel', () => {
    const canonical = readFileSync(resolve('extensions/taco/bin/mermaid-diagnostics.mjs'))
    const mirrored = readFileSync(resolve('skills/taco/scripts/mermaid-diagnostics.mjs'))
    expect(mirrored.equals(canonical), 'skills/taco/scripts/mermaid-diagnostics.mjs must stay byte-identical').toBe(true)
    expect(canonical.includes('import '), 'the kernel must stay dependency-free for the Node linter').toBe(false)
  })
})
