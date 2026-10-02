/**
 * Mermaid syntax lint for Taco deliverables.
 *
 * Usage:
 *   node scripts/lint-mermaid.mjs <file.mmd|file.md>...
 *   node scripts/lint-mermaid.mjs --dir <dir> [--json]
 *   node scripts/lint-mermaid.mjs --shell <other-shell.html> <file.md>
 *   node scripts/lint-mermaid.mjs --mermaid <single-file-mermaid.mjs> <file.md>
 *   cat diagram.mmd | node scripts/lint-mermaid.mjs -
 *
 * Run this after writing a `.mmd` file (or a ```mermaid fence) and before
 * delivering it. Bare `.mmd` files and `mermaid` fenced blocks in `.md` files
 * are validated; everything else is ignored.
 *
 * The parser comes from the Complete shell shipped next to this skill
 * (`../taco-shell.html` -> `<script id="taco-asset-mermaid">` -> base64 ->
 * raw deflate). It runs as a plain Node ESM module in a temp file: no CDN, no
 * jsdom, no browser, no dependency beyond Node's own modules.
 *
 * Mermaid's `parse()` only needs a DOM because `sanitizeText` calls DOMPurify
 * unconditionally; without the bypass below, 12 of the 18 diagram families
 * known to be valid would be reported as invalid. So the payload is patched in
 * memory before it is written out and imported, and the anchor is asserted to
 * appear exactly once. The same assertion guards `--mermaid`, whose build must
 * carry that anchor too — a sharded or differently minified build is refused
 * rather than checked unpatched. If the anchor moved, the run stops with exit
 * code 2 instead of producing a wall of false positives.
 *
 * Exit codes: 0 every unit parsed; 1 diagnostics found; 2 validation could not
 * be completed credibly (payload missing, bypass anchor moved, unreadable
 * input, or a unit failed with a `runtime` diagnostic). 2 wins over 1.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import { classifyMermaidFailure, mergeDiagnosticOffset } from './mermaid-diagnostics.mjs'

const USAGE = `Usage: lint-mermaid.mjs [options] <file.mmd|file.md>...
       lint-mermaid.mjs --dir <dir> [options]
       cat diagram.mmd | lint-mermaid.mjs -

Checks Mermaid diagrams (bare .mmd files, and \`\`\`mermaid fences in .md files)
before delivery. The parser is taken from this skill's Complete shell, so the
check is offline and free of added dependencies.

Options:
  --dir <dir>       recursively scan a directory for .mmd and .md files
  --json            machine-readable report on stdout
  --shell <path>    take the parser from another Complete shell
  --mermaid <path>  import a single-file mermaid build instead of the payload
  --help            show this message

Exit codes:
  0  every unit parsed
  1  diagnostics found
  2  validation could not complete (payload missing, bypass anchor moved,
     unreadable input, or a unit hit a runtime failure); 2 wins over 1
`

/** The Complete shell that ships with this skill, next to the scripts folder. */
const DEFAULT_SHELL = fileURLToPath(new URL('../taco-shell.html', import.meta.url))
const PAYLOAD_TAG = /<script\b(?=[^>]*\bid=["']taco-asset-mermaid["'])[^>]*>([\s\S]*?)<\/script>/i
/**
 * Matches the DOMPurify call inside `sanitizeText`:
 * `r.dompurifyConfig ? text = DOMPurify.sanitize(sanitizeMore(text, r), r.dompurifyConfig).toString() : text = DOMPurify.sanitize(sanitizeMore(text, r), {FORBID_TAGS: ["style"]}).toString()`
 *
 * Minifiers rename local identifiers (e.g. `r`, `t`, `Iy`, `Chr`), but preserve the ternary
 * invocation structure. Backreferences ensure structural and identifier consistency across minifier runs.
 */
const SANITIZE_PATTERN =
  /\b([a-zA-Z0-9_$]+)\.dompurifyConfig\s*\?\s*([a-zA-Z0-9_$]+)\s*=\s*([a-zA-Z0-9_$]+)\.sanitize\(\s*([a-zA-Z0-9_$]+)\(\s*\2\s*,\s*\1\s*\)\s*,\s*\1\.dompurifyConfig\s*\)\.toString\(\)\s*:\s*\2\s*=\s*\3\.sanitize\(\s*\4\(\s*\2\s*,\s*\1\s*\)\s*,\s*\{\s*(?:FORBID_TAGS|['"]FORBID_TAGS['"])\s*:\s*\[['"]style['"]\]\s*\}\s*\)\.toString\(\)/g
// CommonMark fence shape: up to three leading spaces, three or more backticks or
// tildes, then an info string. Tracking the marker and its length is what keeps a
// nested example inside another fence from being read as a real diagram.
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/
/** Static literal lookups stay a record; the walk never mutates this. */
const SKIPPED_DIRS = { node_modules: true }
const MERMAID_OPTIONS = {
  startOnLoad: false,
  securityLevel: 'strict',
  layout: 'elk',
  look: 'neo',
  theme: 'redux',
  htmlLabels: false,
  flowchart: { curve: 'basis' },
}

/** Raised for every condition that makes the run untrustworthy (exit code 2). */
class Abort extends Error {
  constructor(message, file = null) {
    super(message)
    this.file = file
  }
}

const abort = (message, file = null) => {
  throw new Abort(message, file)
}

const readText = (path, what) => {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    abort(`${what} could not be read: ${path} (${error.message})`, path)
  }
}

/**
 * Report the path the caller asked for, not a recomputed one. `relative()` against
 * `process.cwd()` breaks whenever the two spellings differ by a symlink — on macOS
 * `TMPDIR` is `/var/...` while the cwd resolves to `/private/var/...`, which turned
 * a plain `docs/diagram.mmd` into `../../../../../../../var/...`.
 */
const realPathOrNull = (value) => {
  try {
    return realpathSync(value)
  } catch {
    return null
  }
}
const realCwd = realPathOrNull(process.cwd())

/**
 * Report the path the caller asked for. `relative(process.cwd(), path)` alone breaks
 * whenever the two spellings differ by a symlink — on macOS `TMPDIR` is `/var/...`
 * while the cwd resolves to `/private/var/...`, which turned a plain
 * `docs/diagram.mmd` into `../../../../../../../var/...` and made the report useless.
 */
const displayPath = (path) => {
  if (!isAbsolute(path)) return path
  const attempts = [[process.cwd(), path]]
  const realTarget = realPathOrNull(path)
  if (realCwd && realTarget) attempts.push([realCwd, realTarget])
  for (const [from, to] of attempts) {
    const value = relative(from, to)
    if (value !== '' && !value.startsWith('..')) return value
  }
  return relative(process.cwd(), path) || '.'
}

const parseArgs = (argv) => {
  const options = {
    json: false,
    help: false,
    dir: undefined,
    shell: undefined,
    mermaid: undefined,
    inputs: [],
  }
  const valued = { '--dir': 'dir', '--shell': 'shell', '--mermaid': 'mermaid' }
  for (let index = 0; index < argv.length; index++) {
    const raw = argv[index]
    const name = raw.startsWith('--') && raw.includes('=') ? raw.slice(0, raw.indexOf('=')) : raw
    if (name === '--json') {
      options.json = true
      continue
    }
    if (name === '--help' || name === '-h') {
      options.help = true
      continue
    }
    if (valued[name] !== undefined) {
      const inline = raw.includes('=') ? raw.slice(raw.indexOf('=') + 1) : argv[++index]
      if (inline === undefined || inline === '') abort(`${name} requires a path`)
      options[valued[name]] = inline
      continue
    }
    // `-` is stdin; anything else starting with `-` is a typo, not a path.
    if (name.startsWith('-') && name !== '-') abort(`Unknown option: ${raw}`)
    options.inputs.push(raw)
  }
  return options
}

/**
 * Patch the payload so mermaid's label text no longer goes through DOMPurify.
 * A moved anchor means the payload was rebuilt: refuse rather than validate.
 */
const bypassSanitize = (source, origin, what = 'payload') => {
  const matches = [...source.matchAll(SANITIZE_PATTERN)]
  if (matches.length !== 1) {
    abort(
      `${what} structure has changed: the DOMPurify bypass anchor appears ${matches.length} time(s) in ${origin}, expected exactly 1` +
        ' - re-derive the anchor before trusting any result (a build without it cannot be checked without a DOM)',
      origin,
    )
  }
  const [fullMatch, config, text, , sanitizeMore] = matches[0]
  const bypass = `${text}=String(${sanitizeMore}(${text},${config}))`
  const index = matches[0].index
  return source.slice(0, index) + bypass + source.slice(index + fullMatch.length)
}

/** Import the patched payload from a temp `.mjs` file and hand back its parser. */
const importPayload = async (source, origin) => {
  const directory = mkdtempSync(join(tmpdir(), 'taco-mermaid-lint-'))
  const modulePath = join(directory, 'mermaid-payload.mjs')
  writeFileSync(modulePath, source)
  try {
    const module = await import(pathToFileURL(modulePath).href)
    const api = typeof module?.parse === 'function' ? module : module?.default
    if (typeof api?.parse !== 'function') {
      abort(`payload does not expose parse(): ${origin}`, origin)
    }
    return api
  } catch (error) {
    if (error instanceof Abort) throw error
    abort(`payload could not be imported: ${origin} (${error.message})`, origin)
  } finally {
    // Best effort: Windows can refuse to unlink a module that was just imported.
    try {
      rmSync(directory, { recursive: true, force: true })
    } catch {
      // The temp directory is in the OS temp area; leaking it is harmless.
    }
  }
}

const readShellPayload = (shellPath) => {
  const html = readText(shellPath, 'Complete shell')
  const match = PAYLOAD_TAG.exec(html)
  if (!match) {
    abort(
      `no #taco-asset-mermaid payload in ${shellPath}` +
        ' (Lite shells do not embed the parser; pass the Complete shell with --shell)',
      shellPath,
    )
  }
  try {
    return inflateRawSync(Buffer.from(match[1].trim(), 'base64')).toString('utf8')
  } catch (error) {
    abort(
      `#taco-asset-mermaid payload could not be decompressed: ${shellPath} (${error.message})`,
      shellPath,
    )
  }
}

/** Resolve the parser: embedded shell payload by default, overridable both ways. */
const loadMermaid = async (options) => {
  if (options.mermaid !== undefined) {
    const path = resolve(options.mermaid)
    if (!existsSync(path)) abort(`mermaid module not found: ${path}`, path)
    return importPayload(
      bypassSanitize(readText(path, 'Mermaid module'), path, 'mermaid module'),
      path,
    )
  }
  const shellPath = options.shell === undefined ? DEFAULT_SHELL : resolve(options.shell)
  if (!existsSync(shellPath)) abort(`Complete shell not found: ${shellPath}`, shellPath)
  const payload = bypassSanitize(readShellPayload(shellPath), shellPath)
  return importPayload(payload, shellPath)
}

const isMarkdown = (path) => path.toLowerCase().endsWith('.md')
const isMermaidFile = (path) => {
  const lower = path.toLowerCase()
  return lower.endsWith('.mmd') || lower.endsWith('.md')
}

/** `mermaid` fenced blocks: the body's first line maps to fence line + 1. */
const fencedUnits = (path, content) => {
  const lines = content.split('\n')
  const units = []
  let index = 0
  while (index < lines.length) {
    // A CRLF document keeps its `\r` in every line; the marker still has to match.
    const line = lines[index].replace(/\r$/, '')
    const open = FENCE_OPEN.exec(line)
    if (open === null) {
      index += 1
      continue
    }
    const marker = open[2][0]
    const info = open[3]
    // CommonMark: a backtick fence's info string may not contain a backtick, so
    // `\`\`\`mermaid`example` is ordinary text rather than a fence.
    if (marker === '`' && info.includes('`')) {
      index += 1
      continue
    }
    const closing = new RegExp(`^ {0,3}${marker}{${open[2].length},}[ \\t]*$`)
    let end = index + 1
    while (end < lines.length && !closing.test(lines[end].replace(/\r$/, ''))) end++
    // Only a top-level fence counts; the info string's first word selects the language.
    if (/^mermaid\b/i.test(info.trim())) {
      units.push({
        file: displayPath(path),
        body: lines.slice(index + 1, end).join('\n'),
        lineOffset: index + 1,
      })
    }
    index = end + 1
  }
  return units
}

const unitsFor = (path, content) =>
  isMarkdown(path)
    ? fencedUnits(path, content)
    : [{ file: displayPath(path), body: content, lineOffset: 0 }]

const walkDirectory = (root) => {
  const found = []
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch (error) {
    abort(`directory could not be read: ${root} (${error.message})`, root)
  }
  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIPPED_DIRS[entry.name] === true) continue
      found.push(...walkDirectory(path))
      continue
    }
    if (!entry.isFile()) continue
    // Taco documents embed their own Mermaid inside a data block; they are not units.
    if (entry.name.endsWith('.taco.html')) continue
    if (isMermaidFile(entry.name)) found.push(path)
  }
  return found
}

const collectFiles = (options) => {
  const files = []
  if (options.dir !== undefined) {
    const root = resolve(options.dir)
    if (!existsSync(root)) abort(`directory not found: ${root}`, root)
    if (!isDirectory(root)) {
      abort(
        `--dir expects a directory, but ${root} is a file: pass it as a positional argument instead`,
        root,
      )
    }
    files.push(...walkDirectory(root))
  }
  for (const input of options.inputs) {
    if (input === '-') continue
    const path = resolve(input)
    if (!existsSync(path)) abort(`input could not be read: ${path}`, path)
    if (isDirectory(path)) {
      abort(`input is a directory: ${path} (use --dir ${input})`, path)
    }
    files.push(path)
  }
  // Same file reached twice (e.g. --dir plus an explicit path) is one unit.
  return [...new Set(files)]
}

const isDirectory = (path) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

const normalize = (value) => (value === undefined || value === null ? null : value)

const diagnosticRecord = (diagnostic, file) => ({
  file,
  line: normalize(diagnostic.line),
  column: normalize(diagnostic.column),
  endLine: normalize(diagnostic.endLine),
  endColumn: normalize(diagnostic.endColumn),
  kind: diagnostic.kind,
  detail: normalize(diagnostic.detail),
  token: normalize(diagnostic.token),
  expected: normalize(diagnostic.expected),
  message: diagnostic.message,
})

/** One unit: empty/whitespace never reaches `parse`; everything else must throw or parse. */
const validateUnit = async (api, unit) => {
  if (unit.body.trim().length === 0) {
    return classifyMermaidFailure({ stage: 'parse', returnedFalse: true, source: unit.body })
  }
  try {
    const result = await api.parse(unit.body)
    // Stub/CDN parsers may answer with a boolean instead of throwing.
    return result === false
      ? classifyMermaidFailure({ stage: 'parse', returnedFalse: true, source: unit.body })
      : undefined
  } catch (error) {
    return classifyMermaidFailure({ stage: 'parse', error, source: unit.body })
  }
}

const run = async (options) => {
  if (options.dir === undefined && options.inputs.length === 0) {
    abort('no input: pass one or more .mmd/.md files, --dir <dir>, or - for stdin')
  }
  const files = collectFiles(options)
  const wantsStdin = options.inputs.includes('-')

  const api = await loadMermaid(options)
  api.initialize(MERMAID_OPTIONS)

  const report = { units: 0, complete: true, diagnostics: [], runtimeFailures: [] }
  const record = (unit) => (diagnostic) => {
    const merged = mergeDiagnosticOffset(diagnostic, unit.lineOffset)
    report.diagnostics.push(diagnosticRecord(merged, unit.file))
    if (merged.kind === 'runtime') {
      report.complete = false
      report.runtimeFailures.push({
        file: unit.file,
        kind: 'runtime',
        message: merged.message,
        detail: normalize(merged.detail),
      })
    }
  }

  const units = []
  for (const file of files) units.push(...unitsFor(file, readText(file, 'input')))
  if (wantsStdin) units.push({ file: '-', body: readFileSync(0, 'utf8'), lineOffset: 0 })

  for (const unit of units) {
    report.units += 1
    const diagnostic = await validateUnit(api, unit)
    if (diagnostic !== undefined) record(unit)(diagnostic)
  }
  return report
}

const printHuman = (report) => {
  const lines = []
  for (const diagnostic of report.diagnostics) {
    const position =
      diagnostic.line === null
        ? ''
        : diagnostic.column === null
          ? ` ${diagnostic.line}`
          : ` ${diagnostic.line}:${diagnostic.column}`
    lines.push(`${diagnostic.file}${position} [${diagnostic.kind}] ${diagnostic.message}`)
    if (diagnostic.detail !== null) {
      for (const detail of String(diagnostic.detail).split('\n')) lines.push(`  ${detail}`)
    }
  }
  if (report.complete && report.units === 0) {
    lines.push('0 Mermaid unit(s) (nothing to validate)')
  } else {
    lines.push(
      `${report.units} Mermaid unit(s), ${report.diagnostics.length} diagnostic(s)${report.complete ? '' : ' - incomplete'}`,
    )
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

const emit = (report, json) => {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }
  printHuman(report)
}

const main = async () => {
  const argv = process.argv.slice(2)
  // Argument errors happen before `options` exists, so the JSON flag is read raw.
  const wantsJson = argv.includes('--json')
  const aborted = (error) => {
    const report = {
      units: 0,
      complete: false,
      diagnostics: [],
      runtimeFailures: [
        {
          file: error.file === null ? null : displayPath(error.file),
          kind: 'runtime',
          message: error.message,
          detail: null,
        },
      ],
    }
    if (wantsJson) emit(report, true)
    process.stderr.write(`error: validation did not complete - ${error.message}\n`)
    return 2
  }

  let options
  try {
    options = parseArgs(argv)
    if (options.help) {
      process.stdout.write(USAGE)
      return 0
    }
    if (options.shell !== undefined && options.mermaid !== undefined) {
      abort('use either --shell or --mermaid, not both')
    }
  } catch (error) {
    if (!(error instanceof Abort)) throw error
    return aborted(error)
  }

  try {
    const report = await run(options)
    emit(report, options.json)
    if (!report.complete) return 2
    return report.diagnostics.length === 0 ? 0 : 1
  } catch (error) {
    if (!(error instanceof Abort)) throw error
    return aborted(error)
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  },
)
