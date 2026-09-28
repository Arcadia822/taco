/**
 * Types for `mermaid-diagnostics.mjs`. The implementation is plain JavaScript so
 * that Node-side consumers load it without a build step; this hand-written
 * declaration keeps the browser bundle type-safe (the same pattern as `png.mjs`).
 */

export type MermaidDiagnosticKind = 'syntax' | 'unknown-type' | 'render' | 'runtime'

export interface MermaidDiagnostic {
  kind: MermaidDiagnosticKind
  /** User-facing message: the caller's localized string, or the English fallback. */
  message: string
  /** Underlying error text, preserved verbatim and never translated. */
  detail?: string
  /** 1-based, already clamped to the unit (and already offset for a Markdown fence). */
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  /** jison error token, when the parser reported one. */
  token?: string
  /** jison expected-token list, truncated. */
  expected?: string[]
}

export interface MermaidFailureInput {
  /** The failing stage. A langium `result` and a jison `hash` are stage-scoped. */
  stage: 'load' | 'parse' | 'render'
  error?: unknown
  /** True when `parse` returned `false` instead of throwing. */
  returnedFalse?: boolean
  /** Diagram source of the failing unit, without any fence markers. */
  source: string
  /** Localized messages keyed by kind; missing kinds fall back to English. */
  messages?: Partial<Record<MermaidDiagnosticKind, string>>
  /** Cap for the truncated `expected` list. */
  maxExpected?: number
}

export declare const DEFAULT_DIAGNOSTIC_MESSAGES: Record<MermaidDiagnosticKind, string>
export declare const MERMAID_DIAGNOSTIC_KINDS: readonly MermaidDiagnosticKind[]
export declare const clampDiagnosticLine: (line: unknown, lineCount: number) => number | undefined
export declare const classifyMermaidFailure: (input: MermaidFailureInput) => MermaidDiagnostic
export declare const mergeDiagnosticOffset: (value: MermaidDiagnostic, lineOffset: number) => MermaidDiagnostic
