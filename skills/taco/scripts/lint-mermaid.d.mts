export interface MermaidDiagnostic {
  file: string | null
  line: number | null
  column: number | null
  endLine: number | null
  endColumn: number | null
  kind: 'syntax' | 'unknown-type' | 'render' | 'runtime'
  detail: string | null
  token: string | null
  expected: string | null
  message: string
}

export interface LintMermaidReport {
  units: number
  complete: boolean
  diagnostics: MermaidDiagnostic[]
  runtimeFailures: Array<{
    file: string | null
    kind: string
    message: string
    detail: string | null
  }>
}

export interface LintMermaidOptions {
  dir?: string
  shell?: string
  mermaid?: string
  inputs: string[]
  json?: boolean
}

export function run(options: LintMermaidOptions): Promise<LintMermaidReport>
export function loadMermaid(options: unknown): Promise<{ parse: (text: string) => Promise<unknown>; initialize: (options: unknown) => void }>
export function readShellPayload(shellPath: string): string
export function importPayload(source: string, origin: string): Promise<{ parse: (text: string) => Promise<unknown>; initialize: (options: unknown) => void }>
export function bypassSanitize(source: string, origin: string): string
export function validateUnit(api: unknown, unit: { file: string; body: string; lineOffset: number }): Promise<unknown>
export function fencedUnits(path: string, content: string): Array<{ file: string; body: string; lineOffset: number }>
export const DEFAULT_SHELL: string
