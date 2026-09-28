import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Script-level regression for `skills/taco/scripts/lint-mermaid.mjs`.
 *
 * Every run goes through a plain `node` child process: no DOM, no jsdom, no
 * browser. That is the point of the DOMPurify bypass — without it 12 of the 18
 * legal diagram families below would be reported as invalid, so the 18/18 half
 * of the matrix is the gate on the bypass itself.
 */

const script = resolve('skills/taco/scripts/lint-mermaid.mjs')
const shell = resolve('skills/taco/taco-shell.html')
const payloadTag = /<script\b(?=[^>]*\bid=["']taco-asset-mermaid["'])[^>]*>([\s\S]*?)<\/script>/i
const sanitizeAnchor =
  'r.dompurifyConfig?e=My.sanitize(Qdr(e,r),r.dompurifyConfig).toString():e=My.sanitize(Qdr(e,r),{FORBID_TAGS:["style"]}).toString()'

/** The Complete shell's embedded parser, inflated once for the bypass tests. */
const shellPayload = inflateRawSync(
  Buffer.from(payloadTag.exec(readFileSync(shell, 'utf8'))?.[1]?.trim() ?? '', 'base64'),
).toString('utf8')

interface Diagnostic {
  file: string
  line: number | null
  column: number | null
  endLine: number | null
  endColumn: number | null
  kind: string
  detail: string | null
  token: string | null
  expected: string[] | null
  message: string
}

interface Report {
  units: number
  complete: boolean
  diagnostics: Diagnostic[]
  runtimeFailures: Array<{
    file: string | null
    kind: string
    message: string
    detail: string | null
  }>
}

const spawnLint = (args: string[], env: Record<string, string> = {}) => {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  if (result.error) throw result.error
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const runJson = (args: string[], env: Record<string, string> = {}) => {
  const result = spawnLint([...args, '--json'], env)
  return { ...result, report: JSON.parse(result.stdout) as Report }
}

/** The 6 families that go into the matrix as Markdown fences instead of `.mmd` files. */
const FENCED: Record<string, true> = {
  sequenceDiagram: true,
  mindmap: true,
  timeline: true,
  'sankey-beta': true,
  C4Context: true,
  'architecture-beta': true,
}

/** 18 legal families, then 3 syntax-invalid inputs + 1 unknown type. */
const legal: Record<string, string> = {
  flowchart: 'flowchart TD\n  A[Start] --> B[End]\n',
  'flowchart-subgraph':
    'flowchart LR\n  subgraph One\n    A[Start] --> B[End]\n  end\n  B --> C[Finish]\n',
  sequenceDiagram: 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi\n',
  classDiagram:
    'classDiagram\n  class Animal {\n    +String name\n    +makeSound()\n  }\n  Animal <|-- Dog\n',
  'stateDiagram-v2': 'stateDiagram-v2\n  [*] --> A\n  A --> B: go\n  B --> [*]\n',
  gantt:
    'gantt\n  title A chart\n  dateFormat YYYY-MM-DD\n  section S\n  Task :a1, 2024-01-01, 30d\n',
  journey: 'journey\n  title My day\n  section Morning\n    Wake up: 5: Me\n',
  mindmap: 'mindmap\n  root((mindmap))\n    Origins\n      Long history\n',
  timeline: 'timeline\n  title Timeline\n  2024 : one : two\n',
  quadrantChart:
    'quadrantChart\n  title Reach\n  x-axis Low --> High\n  quadrant-1 We should expand\n  Campaign A: [0.3, 0.6]\n',
  'sankey-beta': 'sankey-beta\n\nA,B,10\nB,C,5\n',
  kanban: 'kanban\n  todo[Todo]\n    id1[Task one]\n  done[Done]\n    id2[Task two]\n',
  C4Context:
    'C4Context\n  title System\n  Person(user, "User")\n  System(sys, "System")\n  Rel(user, sys, "Uses")\n',
  erDiagram: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER {\n    string name\n  }\n',
  gitGraph: 'gitGraph\n  commit\n  branch develop\n  checkout develop\n  commit\n',
  'architecture-beta':
    'architecture-beta\n  group api(cloud)[API]\n  service db(database)[Database] in api\n  service server(server)[Server] in api\n  db:L -- R:server\n',
  pie: 'pie\n  "Dogs" : 386\n  "Cats" : 85\n',
  'pie-title': 'pie title Pets\n  "Dogs" : 386\n  "Cats" : 85\n',
}
const legalUnits = Object.entries(legal).map(([name, body]) => ({
  name,
  file: `${name}.${FENCED[name] === true ? 'md' : 'mmd'}`,
  body,
}))

const invalid = {
  'dangling-arrow': { body: 'flowchart TD\n  A[Start] -->\n', kind: 'syntax', line: 2, column: 10 },
  'unclosed-bracket': {
    body: 'flowchart TD\n  A[Start --> B[End]\n',
    kind: 'syntax',
    line: 2,
    column: 4,
  },
  'sequence-missing-colon': {
    body: 'sequenceDiagram\n  Alice->>Bob hello\n',
    kind: 'syntax',
    line: 2,
    column: 10,
  },
  'unknown-type': {
    body: 'notADiagram\n  A --> B\n',
    kind: 'unknown-type',
    line: null,
    column: null,
  },
}
const invalidUnits = Object.entries(invalid).map(([name, test]) => ({
  name,
  file: `invalid-${name}.mmd`,
  body: test.body,
  kind: test.kind,
  line: test.line,
  column: test.column,
}))

describe('lint-mermaid.mjs', () => {
  it('passes all 18 legal diagrams and reports the 3 invalid ones plus the unknown type', () => {
    const directory = mkdtempSync(join(tmpdir(), 'taco-lint-matrix-'))
    for (const [index, unit] of legalUnits.entries()) {
      // Each fence sits behind a different lead-in, so a wrong offset cannot cancel out.
      const lead = Array.from({ length: index + 1 }, (_, step) => `paragraph ${step + 1}`).join(
        '\n\n',
      )
      writeFileSync(
        join(directory, unit.file),
        unit.file.endsWith('.md')
          ? `${lead}\n\n\`\`\`mermaid\n${unit.body}\`\`\`\n\ntail\n`
          : unit.body,
      )
    }
    for (const unit of invalidUnits) writeFileSync(join(directory, unit.file), unit.body)

    const result = runJson(['--dir', directory])
    expect(result.status).toBe(1)
    expect(result.report.units).toBe(22)
    expect(result.report.complete).toBe(true)
    expect(result.report.runtimeFailures).toEqual([])

    const byFile = new Map(
      result.report.diagnostics.map((diagnostic) => [diagnostic.file, diagnostic]),
    )
    expect(result.report.diagnostics).toHaveLength(4)
    for (const unit of legalUnits) {
      const path = relative(process.cwd(), join(directory, unit.file))
      expect(byFile.has(path), `${unit.name} must not be reported`).toBe(false)
    }
    for (const unit of invalidUnits) {
      const diagnostic = byFile.get(relative(process.cwd(), join(directory, unit.file)))
      expect(diagnostic, `${unit.name} must be reported`).toBeDefined()
      expect(diagnostic).toMatchObject({ kind: unit.kind, line: unit.line, column: unit.column })
    }
    // The unknown type must never be filed as a syntax error.
    const unknown = byFile.get(relative(process.cwd(), join(directory, 'invalid-unknown-type.mmd')))
    expect(unknown?.kind).toBe('unknown-type')
  })

  it('is DOM-free: the linter process has no document and the script never reaches for one', () => {
    const directory = mkdtempSync(join(tmpdir(), 'taco-lint-nodom-'))
    const guard = join(directory, 'dom-guard.mjs')
    writeFileSync(
      guard,
      'if (typeof globalThis.document !== "undefined" || typeof globalThis.window !== "undefined") {\n' +
        '  process.stderr.write("dom-present\\n")\n  process.exit(97)\n}\n' +
        'process.stderr.write("dom-free\\n")\n',
    )
    writeFileSync(join(directory, 'ok.mmd'), legal.flowchart)

    const source = readFileSync(script, 'utf8')
    // Comments may mention jsdom or DOM documents; what matters is that no code
    // reaches for either one.
    expect(source).not.toMatch(/from ['"]jsdom|require\(['"]jsdom|import\(['"]jsdom/)
    expect(source).not.toMatch(/\b(?:document|window)\s*(?:\.|\[)|getElementById/)

    // The guard runs inside the linter's own process: a DOM there would exit 97.
    const result = runJson(['--dir', directory], {
      NODE_OPTIONS: `--import ${pathToFileURL(guard).href}`,
    })
    expect(result.stderr).toContain('dom-free')
    expect(result.stderr).not.toContain('dom-present')
    expect(result.status).toBe(0)
    expect(result.report.units).toBe(1)
    expect(result.report.diagnostics).toEqual([])
  })

  it('reports the exact kernel positions for jison and langium failures', () => {
    const directory = mkdtempSync(join(tmpdir(), 'taco-lint-positions-'))
    const cases = {
      'dangling.mmd': invalid['dangling-arrow'].body,
      'unclosed.mmd': invalid['unclosed-bracket'].body,
      'sequence.mmd': invalid['sequence-missing-colon'].body,
      'git.mmd': 'gitGraph\n  commit\n  banana\n',
    }
    for (const [name, body] of Object.entries(cases)) writeFileSync(join(directory, name), body)

    const result = runJson(['--dir', directory])
    expect(result.status).toBe(1)
    const byFile = new Map(
      result.report.diagnostics.map((diagnostic) => [diagnostic.file, diagnostic]),
    )
    const assertAt = (name: string, expected: Partial<Diagnostic>) => {
      const diagnostic = byFile.get(relative(process.cwd(), join(directory, name)))
      expect(diagnostic, `${name} must be reported`).toBeDefined()
      expect(diagnostic).toMatchObject(expected)
    }
    assertAt('dangling.mmd', { line: 2, column: 10, kind: 'syntax' })
    // `hash.loc.first_line` wins over `hash.line`, which says 1 here.
    assertAt('unclosed.mmd', { line: 2, column: 4, kind: 'syntax' })
    assertAt('sequence.mmd', { line: 2, column: 10, kind: 'syntax' })
    // langium reports exact 1-based start/end through `result.parserErrors[0].token`.
    assertAt('git.mmd', { line: 3, column: 3, endLine: 3, endColumn: 8, kind: 'syntax' })

    const dangling = byFile.get(relative(process.cwd(), join(directory, 'dangling.mmd')))
    // The thrown parser message is preserved verbatim for the reader.
    expect(dangling?.detail).toContain('Parse error on line')
    expect(dangling?.token).toBe('EOF')
  })

  it('maps a fence body onto the host document line numbers', () => {
    const directory = mkdtempSync(join(tmpdir(), 'taco-lint-fences-'))
    const document = [
      '# Doc',
      '',
      'Intro.',
      '',
      '```mermaid',
      'flowchart TD',
      '  A[Start] -->',
      '```',
      '',
      'more text',
      '',
      '  ```mermaid',
      'flowchart TD',
      '  A[Start --> B[End]',
      '  ```',
      '',
    ].join('\n')
    writeFileSync(join(directory, 'doc.md'), document)
    const result = runJson([join(directory, 'doc.md')])

    expect(result.status).toBe(1)
    expect(result.report.units).toBe(2)
    expect(result.report.diagnostics).toHaveLength(2)
    const [first, second] = result.report.diagnostics
    // The fence marker is on line 5, so the body starts on line 6: 6 + 2 - 1.
    expect(first).toMatchObject({ line: 7, column: 10, kind: 'syntax' })
    // Indented fence: the body still starts on line 13, and columns are untouched.
    expect(second).toMatchObject({ line: 14, column: 4, kind: 'syntax' })
    // Never the closing fence, never past the body.
    expect(first.line).toBeGreaterThanOrEqual(6)
    expect(first.line).toBeLessThan(8)
    expect(second.line).toBeGreaterThanOrEqual(13)
    expect(second.line).toBeLessThan(15)
  })

  it('treats an empty unit as unknown-type without parsing it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'taco-lint-empty-'))
    writeFileSync(join(directory, 'empty.mmd'), '\n  \n')
    writeFileSync(join(directory, 'empty-fence.md'), '# Doc\n\n```mermaid\n\n```\n')
    const result = runJson(['--dir', directory])

    expect(result.status).toBe(1)
    expect(result.report.units).toBe(2)
    expect(result.report.complete).toBe(true)
    const kinds = result.report.diagnostics.map((diagnostic) => diagnostic.kind)
    expect(kinds).toEqual(['unknown-type', 'unknown-type'])
    // No parser exception exists on this path, so no detail may be invented.
    expect(result.report.diagnostics[0].detail).toBeNull()
  })

  it('refuses to validate when the bypass anchor is missing or duplicated', () => {
    const directory = mkdtempSync(join(tmpdir(), 'taco-lint-bypass-'))
    const asShell = (text: string) =>
      `<!doctype html><html><body><script id="taco-asset-mermaid" type="taco/deflate-b64">${deflateRawSync(Buffer.from(text)).toString('base64')}</script></body></html>`
    const removed = join(directory, 'removed.html')
    const doubled = join(directory, 'doubled.html')
    writeFileSync(removed, asShell(shellPayload.replace(sanitizeAnchor, 'e=String(Qdr(e,r))')))
    writeFileSync(
      doubled,
      asShell(shellPayload.replace(sanitizeAnchor, `${sanitizeAnchor}${sanitizeAnchor}`)),
    )
    const valid = join(directory, 'ok.mmd')
    writeFileSync(valid, legal.flowchart)

    for (const [name, path] of [
      ['removed', removed],
      ['doubled', doubled],
    ] as const) {
      const human = spawnLint(['--shell', path, valid])
      expect(human.status, `${name} must fail`).toBe(2)
      expect(`${human.stdout}${human.stderr}`).not.toContain('通过')
      expect(human.stdout).not.toContain('nothing to validate')
      expect(human.stdout).not.toContain('Mermaid unit(s)')

      const result = runJson(['--shell', path, valid])
      expect(result.status).toBe(2)
      expect(result.report.complete).toBe(false)
      expect(result.report.units).toBe(0)
      expect(result.report.diagnostics).toEqual([])
      expect(result.report.runtimeFailures[0].message).toMatch(
        /bypass anchor appears (0|2) time\(s\)/,
      )
    }
  })

  it('accepts a single-file mermaid build through --mermaid', () => {
    const directory = mkdtempSync(join(tmpdir(), 'taco-lint-mermaid-'))
    const module = join(directory, 'mermaid-single.mjs')
    writeFileSync(module, shellPayload)
    const valid = join(directory, 'ok.mmd')
    writeFileSync(valid, legal.flowchart)
    // The sharded npm entry has no such anchor and is refused; this single-file
    // build carries it, so it is patched and used like the shell payload.
    const result = runJson(['--mermaid', module, valid])
    expect(result.status).toBe(0)
    expect(result.report.units).toBe(1)
    expect(result.report.diagnostics).toEqual([])
  })

  it('lets a runtime failure win over syntax diagnostics in the same run', () => {
    const directory = mkdtempSync(join(tmpdir(), 'taco-lint-mixed-'))
    writeFileSync(join(directory, 'good.mmd'), legal.flowchart)
    writeFileSync(join(directory, 'syntax.mmd'), invalid['dangling-arrow'].body)
    // A kanban body whose parse throws a bare TypeError (no `hash`, no langium
    // token): the kernel must file it as `runtime`, never as a syntax verdict.
    writeFileSync(join(directory, 'runtime.mmd'), 'kanban\n  ::::\n')
    const runtimeUnit = relative(process.cwd(), join(directory, 'runtime.mmd'))

    const result = runJson(['--dir', directory])
    expect(result.status).toBe(2)
    expect(result.report.complete).toBe(false)
    expect(result.report.units).toBe(3)
    const kinds = result.report.diagnostics.map((diagnostic) => diagnostic.kind)
    expect(kinds).toContain('syntax')
    expect(kinds).toContain('runtime')
    expect(result.report.runtimeFailures).toHaveLength(1)
    expect(result.report.runtimeFailures[0].file).toBe(runtimeUnit)

    const human = spawnLint(['--dir', directory])
    expect(human.status).toBe(2)
    expect(human.stdout).toContain('[syntax]')
    expect(human.stdout).toContain('[runtime]')
    expect(human.stdout).not.toContain('通过')
  })

  it('exits 0 with an explicit "nothing to validate" for a directory without units', () => {
    const directory = mkdtempSync(join(tmpdir(), 'taco-lint-nounits-'))
    writeFileSync(join(directory, 'readme.md'), '# Readme\n\n```js\nconst a = 1\n```\n')
    writeFileSync(join(directory, 'notes.txt'), 'flowchart TD\n  A --> B\n')

    const human = spawnLint(['--dir', directory])
    expect(human.status).toBe(0)
    expect(human.stdout).toContain('0 Mermaid unit(s) (nothing to validate)')

    const result = runJson(['--dir', directory])
    expect(result.status).toBe(0)
    expect(result.report).toMatchObject({
      units: 0,
      complete: true,
      diagnostics: [],
      runtimeFailures: [],
    })
  })

  it('reports paths that stay usable from a symlinked working directory', () => {
    // On macOS `tmpdir()` is `/var/...` while the cwd resolves to `/private/var/...`,
    // so a naive relative() turns `docs/diagram.mmd` into `../../../../var/...`.
    const directory = mkdtempSync(join(tmpdir(), 'taco-lint-path-'))
    mkdirSync(join(directory, 'docs'), { recursive: true })
    writeFileSync(join(directory, 'docs', 'broken.mmd'), 'flowchart TD\n  A[Start] -->\n')

    const result = spawnSync(process.execPath, [script, '--dir', join(directory, 'docs'), '--json'], {
      encoding: 'utf8',
      cwd: directory,
    })
    expect(result.status).toBe(1)
    const report = JSON.parse(result.stdout) as { diagnostics: Array<{ file: string }> }
    expect(report.diagnostics).toHaveLength(1)
    const reported = report.diagnostics[0].file
    expect(reported.startsWith('..'), `reported path must not escape the cwd: ${reported}`).toBe(false)
    // The reported path must resolve to the file that actually failed.
    expect(existsSync(resolve(directory, reported))).toBe(true)
  })

  it('reads only top-level fences and both fence markers', () => {
    const directory = mkdtempSync(join(tmpdir(), 'taco-lint-fences-'))
    mkdirSync(directory, { recursive: true })

    // A mermaid fence nested inside a longer fence is an example, not a unit.
    writeFileSync(join(directory, 'nested.md'), [
      '````markdown', '```mermaid', 'notADiagram', '```', '````',
    ].join('\n'))
    const nested = spawnLint(['--dir', directory, '--json'])
    expect(nested.status, 'a nested example must not be validated').toBe(0)
    expect(JSON.parse(nested.stdout).units).toBe(0)

    // A tilde fence is legal Markdown and must be validated like a backtick one.
    writeFileSync(join(directory, 'tilde.md'), '~~~mermaid\nnotADiagram\n~~~\n')
    const tilde = spawnLint([join(directory, 'tilde.md'), '--json'])
    expect(tilde.status, 'a tilde mermaid fence must be checked').toBe(1)
    const tildeReport = JSON.parse(tilde.stdout)
    expect(tildeReport.diagnostics[0]).toMatchObject({ kind: 'unknown-type' })

    // An indented block is code content, not a fence.
    writeFileSync(join(directory, 'indented.md'), '    ```mermaid\n    notADiagram\n    ```\n')
    const indented = spawnLint([join(directory, 'indented.md'), '--json'])
    expect(indented.status).toBe(0)
    expect(JSON.parse(indented.stdout).units).toBe(0)
  })

  it('keeps --json machine-readable when the arguments themselves are rejected', () => {
    const directory = mkdtempSync(join(tmpdir(), 'taco-lint-json-args-'))
    const file = join(directory, 'ok.mmd')
    writeFileSync(file, legal.flowchart)

    const unknown = spawnLint(['--json', '--nope', file])
    expect(unknown.status).toBe(2)
    const unknownReport = JSON.parse(unknown.stdout)
    expect(unknownReport).toMatchObject({ units: 0, complete: false, diagnostics: [] })
    expect(unknownReport.runtimeFailures[0].message).toContain('Unknown option')

    const exclusive = spawnLint(['--json', '--shell', shell, '--mermaid', 'x.mjs', file])
    expect(exclusive.status).toBe(2)
    expect(JSON.parse(exclusive.stdout).complete).toBe(false)
  })

  it('rejects a file handed to --dir, and unknown options', () => {
    const directory = mkdtempSync(join(tmpdir(), 'taco-lint-args-'))
    const file = join(directory, 'ok.mmd')
    writeFileSync(file, legal.flowchart)

    const asDir = spawnLint(['--dir', file])
    expect(asDir.status).toBe(2)
    expect(asDir.stderr).toContain('positional')

    const unknown = spawnLint(['--nope', file])
    expect(unknown.status).toBe(2)
    expect(unknown.stderr).toContain('Unknown option')
  })
})
