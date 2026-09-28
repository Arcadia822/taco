/**
 * Mermaid failure classification shared by two consumers:
 *
 * - the browser bundle (`src/mermaid.ts` imports it through
 *   `../extensions/taco/bin/mermaid-diagnostics.mjs`), and
 * - the dependency-free Node linter (`skills/taco/scripts/lint-mermaid.mjs`
 *   imports the byte-identical mirror next to it).
 *
 * This file must stay dependency-free plain JavaScript with no `import`, so the
 * Node side can load it without a build step on every supported Node version.
 * `mermaid-diagnostics.d.mts` declares its types for TypeScript consumers.
 */

/** @typedef {'syntax' | 'unknown-type' | 'render' | 'runtime'} MermaidDiagnosticKind */

const KINDS = ['syntax', 'unknown-type', 'render', 'runtime']

/** Localizable fallbacks: callers with their own copy pass `messages`. */
export const DEFAULT_DIAGNOSTIC_MESSAGES = {
  syntax: 'Invalid Mermaid syntax',
  'unknown-type': 'No diagram type detected',
  render: 'The diagram could not be rendered (no position information)',
  runtime: 'Mermaid validation is unavailable',
}

export const MERMAID_DIAGNOSTIC_KINDS = KINDS

const DEFAULT_MAX_EXPECTED = 6
/** `/Parse error on line (\d+)/` — the jison family's human-readable position. */
const MESSAGE_LINE = /Parse error on line (\d+)/
/** A jison parse error always carries a `hash`; langium carries parser tokens. */
const asRecord = (value) => (typeof value === 'object' && value !== null ? value : undefined)
const finiteNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const stringValue = (value) => (typeof value === 'string' ? value : undefined)

/**
 * Clamp a 1-based line to the unit's own line range. Applied before any fence
 * offset, so a wrong-but-plausible line can never point past the diagram body.
 */
export const clampDiagnosticLine = (line, lineCount) => {
  const value = finiteNumber(line)
  if (value === undefined) return undefined
  return Math.min(Math.max(1, Math.round(value)), Math.max(1, lineCount))
}

/** langium diagrams expose exact 1-based positions through the parser token. */
const langiumToken = (error) => {
  const parserErrors = asRecord(asRecord(error)?.result)?.parserErrors
  if (!Array.isArray(parserErrors) || parserErrors.length === 0) return undefined
  return asRecord(asRecord(parserErrors[0])?.token)
}

/**
 * A lexer error is a source error, not an untrustworthy environment: a typo in a
 * `pie` / `packet-beta` / `gitGraph` diagram throws before any parser token exists,
 * carrying `{ line, column, message }` on `result.lexerErrors[0]` instead.
 */
const langiumLexerError = (error) => {
  const lexerErrors = asRecord(asRecord(error)?.result)?.lexerErrors
  if (!Array.isArray(lexerErrors) || lexerErrors.length === 0) return undefined
  return asRecord(lexerErrors[0])
}

/** True for a source with no diagram at all: empty, whitespace, or comments only. */
const hasNoDiagram = (source) => source.replace(/%%[^\n]*/g, '').trim().length === 0

const diagnostic = (kind, messages, fields) => ({
  kind,
  message: stringValue(messages?.[kind]) ?? DEFAULT_DIAGNOSTIC_MESSAGES[kind],
  ...fields,
})

/**
 * Turn a stage-specific failure into a presentable diagnostic.
 *
 * The stage is an explicit input because the same error shape means different
 * things while loading, parsing and rendering. Only whitelisted fields are read:
 * a langium error's `result` is huge and self-referential, so it must never be
 * serialized or logged wholesale.
 *
 * @param {{ stage: 'load' | 'parse' | 'render', error?: unknown, returnedFalse?: boolean, source: string, messages?: Record<string, string>, maxExpected?: number }} input
 */
export const classifyMermaidFailure = (input) => {
  const messages = input.messages
  const detail = stringValue(asRecord(input.error)?.message)
  const lineCount = input.source.split('\n').length

  if (input.stage === 'load') {
    return diagnostic('runtime', messages, { detail: detail ?? (input.error === undefined ? undefined : String(input.error)) })
  }
  if (input.stage === 'render') {
    return diagnostic('render', messages, { detail })
  }

  const error = asRecord(input.error)
  // `parse(..., { suppressErrors: true })` returns a boolean and keeps nothing else.
  if (input.returnedFalse === true || error === undefined) {
    return hasNoDiagram(input.source)
      ? diagnostic('unknown-type', messages, {})
      : diagnostic('syntax', messages, {})
  }

  const token = langiumToken(input.error)
  if (token !== undefined) {
    return diagnostic('syntax', messages, {
      detail,
      line: clampDiagnosticLine(token.startLine, lineCount),
      column: finiteNumber(token.startColumn),
      endLine: clampDiagnosticLine(token.endLine, lineCount),
      endColumn: finiteNumber(token.endColumn),
    })
  }

  const lexer = langiumLexerError(input.error)
  if (lexer !== undefined) {
    return diagnostic('syntax', messages, {
      detail,
      line: clampDiagnosticLine(lexer.line, lineCount),
      column: finiteNumber(lexer.column),
    })
  }

  const hash = asRecord(error.hash)
  if (hash !== undefined) {
    // `hash.loc.first_line` is the only reliable jison position (it beat both
    // `hash.line` and the message in the recorded samples); the raw message is
    // always preserved so a wrong guess stays diagnosable by the reader.
    const fromLocation = finiteNumber(asRecord(hash.loc)?.first_line)
    const fromMessage = Number(MESSAGE_LINE.exec(detail ?? '')?.[1])
    const expected = Array.isArray(hash.expected)
      ? hash.expected.filter((item) => typeof item === 'string').slice(0, input.maxExpected ?? DEFAULT_MAX_EXPECTED)
      : undefined
    return diagnostic('syntax', messages, {
      detail,
      line: clampDiagnosticLine(fromLocation ?? (Number.isFinite(fromMessage) ? fromMessage : undefined), lineCount),
      column: finiteNumber(asRecord(hash.loc)?.first_column),
      token: stringValue(hash.token),
      expected,
    })
  }

  if (error.name === 'UnknownDiagramError') {
    return diagnostic('unknown-type', messages, { detail })
  }

  // An unexpected parse-stage failure means the validation environment itself is
  // untrustworthy; it must never be reported as a syntax verdict or a render one.
  return diagnostic('runtime', messages, { detail })
}

/**
 * Map a body-relative diagnostic onto its host file. Markdown fences need the
 * fence's start offset; `.mmd` units pass 0.
 */
export const mergeDiagnosticOffset = (value, lineOffset) =>
  value.line === undefined
    ? value
    : {
        ...value,
        line: value.line + lineOffset,
        endLine: value.endLine === undefined ? undefined : value.endLine + lineOffset,
      }
