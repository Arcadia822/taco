import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const cli = resolve('extensions/taco/bin/taco.mjs')
const stock = readFileSync('extensions/taco/policies/taco-agent-policy.md', 'utf8')
const project = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'taco-policy-')))
  mkdirSync(join(root, '.specify'))
  return root
}
const write = (root: string, path: string, content: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}
const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8')
const run = (root: string, dry = false) => {
  const result = spawnSync(process.execPath, [cli, 'prepare-policy', '--project-root', root, '--json', ...(dry ? ['--dry-run'] : [])], { encoding: 'utf8' })
  expect(result.stderr).toBe('')
  return { status: result.status, ...JSON.parse(result.stdout) }
}

describe('Taco process policy preparation', () => {
  it.each(['PROCESS.md', 'context/PROCESS.md'])('uses declared 5xP %s, preserving unrelated instructions and rerunning unchanged', (path) => {
    const root = project()
    const agents = `# Project instructions\n\nUse 5xP context. Read [Process](${path}).\n\nKeep the team rules.\n`
    const process = '# Team process\n\nRun the team quality gate.\n'
    write(root, 'AGENTS.md', agents)
    write(root, path, process)
    expect(run(root)).toMatchObject({ status: 0, processPath: join(root, path), model: '5xp', process: { status: 'updated' }, agents: { status: 'updated' }, applied: true })
    expect(read(root, path)).toContain(process)
    expect(read(root, path)).toContain(stock.trim())
    expect(read(root, 'AGENTS.md')).toContain(agents)
    expect(read(root, 'AGENTS.md')).not.toContain('## Taco Spec Kit authoring and review')
    expect(read(root, 'AGENTS.md').match(/Before any Spec Kit or Taco work/g)).toHaveLength(1)
    const once = [read(root, path), read(root, 'AGENTS.md')]
    expect(run(root)).toMatchObject({ process: { status: 'unchanged' }, agents: { status: 'unchanged' } })
    expect([read(root, path), read(root, 'AGENTS.md')]).toEqual(once)
    if (path !== 'PROCESS.md') expect(existsSync(join(root, 'PROCESS.md'))).toBe(false)
  })

  it('follows a context router with reference links and resolves Process relative to that router', () => {
    const root = project()
    write(root, 'AGENTS.md', '# Team\n\nRead [Context][context].\n\n[context]: context/index.md\n')
    write(root, 'context/index.md', '# 5xP\n\n[Process][]\n\n[Process]: ../workflow/development.md\n')
    write(root, 'workflow/development.md', '## Team process\n')
    expect(run(root)).toMatchObject({ status: 0, processPath: join(root, 'workflow/development.md'), model: '5xp' })
    expect(read(root, 'context/index.md')).toBe('# 5xP\n\n[Process][]\n\n[Process]: ../workflow/development.md\n')
  })

  it('creates YAML documents without adopting 5xP and reruns unchanged', () => {
    const root = project()
    expect(run(root)).toMatchObject({ status: 0, model: 'dedicated', processPath: join(root, 'docs/taco-process.md'), process: { status: 'created' }, agents: { status: 'created' } })
    expect(read(root, 'AGENTS.md')).toMatch(/^---\ntitle:/)
    expect(read(root, 'docs/taco-process.md')).toMatch(/^---\ntitle: "Taco workflow"\ntaco_scope: plan\n---/)
    expect(existsSync(join(root, 'PROCESS.md'))).toBe(false)
    expect(run(root)).toMatchObject({ process: { status: 'unchanged' }, agents: { status: 'unchanged' } })
  })

  it('does not infer 5xP from a Process filename, ordinary links, or fenced examples', () => {
    const root = project()
    const agents = '# Team\n\nThis repository does not use 5xP.\n[Process](https://example.com/process)\n[Context](missing.md)\n\n```md\nUse 5xP. [Process](PROCESS.md)\n```\n'
    write(root, 'AGENTS.md', agents)
    write(root, 'PROCESS.md', 'Do not alter this ordinary file.\n')
    expect(run(root)).toMatchObject({ status: 0, model: 'dedicated' })
    expect(read(root, 'PROCESS.md')).toBe('Do not alter this ordinary file.\n')
    expect(read(root, 'AGENTS.md')).toContain(agents)
  })

  it.each(['fence', 'longer-closing-fence', 'comment'])('preserves %s examples while installing a real mandatory route', (kind) => {
    const root = project()
    const route = 'Before any Spec Kit or Taco work, read and follow the Taco workflow in [docs/taco-process.md](<docs/taco-process.md>).'
    const example = kind === 'comment' ? `<!--\n${route}\n-->` : `  \`\`\`md\n${route}\n${kind === 'longer-closing-fence' ? '````' : '```'}`
    const agents = `## Team instructions\n\nExample only:\n${example}\n\nKeep our team rules.\n`
    write(root, 'AGENTS.md', agents)
    expect(run(root)).toMatchObject({ status: 0, applied: true, agents: { status: 'updated' } })
    const installed = read(root, 'AGENTS.md')
    expect(installed).toBe(`${agents}\n${route}\n`)
    expect(run(root)).toMatchObject({ status: 0, process: { status: 'unchanged' }, agents: { status: 'unchanged' } })
    expect(read(root, 'AGENTS.md')).toBe(installed)
  })

  it.each(['```md', '<!--'])('refuses an unclosed %s example without appending an inactive route', (opening) => {
    const root = project()
    const agents = `## Team instructions\n\n${opening}\nBefore any Spec Kit or Taco work, read and follow the Taco workflow in [docs/taco-process.md](<docs/taco-process.md>).\n`
    write(root, 'AGENTS.md', agents)
    expect(run(root)).toMatchObject({ status: 2, applied: false, agents: { status: 'manual-merge' } })
    expect(read(root, 'AGENTS.md')).toBe(agents)
    expect(existsSync(join(root, 'docs/taco-process.md'))).toBe(false)
  })

  it('previews creation and migration without writing', () => {
    const root = project()
    write(root, 'AGENTS.md', stock)
    expect(run(root, true)).toMatchObject({ status: 0, dryRun: true, applied: false, migrated: true, process: { status: 'created' }, agents: { status: 'updated' } })
    expect(read(root, 'AGENTS.md')).toBe(stock)
    expect(existsSync(join(root, 'docs'))).toBe(false)
  })

  it.each(['shipped', 'guide'])('migrates exact legacy %s policy while retaining adjacent Agent sections', (variant) => {
    const root = project()
    const legacy = readFileSync(`tests/fixtures/taco-policy-${variant === 'shipped' ? '' : 'guide-'}v04.txt`, 'utf8')
    const before = '## Project rules\n\nKeep before.\n\n'
    const after = '\n\n## Other rules\n\nKeep after.\n'
    write(root, 'AGENTS.md', before + legacy + after)
    expect(run(root)).toMatchObject({ status: 0, migrated: true })
    expect(read(root, 'AGENTS.md')).toContain(before)
    expect(read(root, 'AGENTS.md')).toContain('## Other rules\n\nKeep after.')
    expect(read(root, 'AGENTS.md')).not.toContain('## Taco Spec Kit authoring and review')
    expect(read(root, 'docs/taco-process.md')).toContain(stock.trim())
  })

  it.each([
    'Use 5xP. [Process](PROCESS.md) and [Process](context/PROCESS.md).\n',
    'Use 5xP without a declared Process route.\n',
    'Use 5xP. [Process](missing.md).\n',
    'Use 5xP. [Process](../outside.md).\n',
    'Use 5xP. [Process](https://example.com/process.md).\n',
    'Use 5xP. [Process](AGENTS.md).\n',
  ])('refuses ambiguous, missing, and unsafe declared routes without changing content: %s', (agents) => {
    const root = project()
    write(root, 'AGENTS.md', agents)
    write(root, 'PROCESS.md', 'Root process.\n')
    write(root, 'context/PROCESS.md', 'Context process.\n')
    expect(run(root)).toMatchObject({ status: 2, applied: false, process: { status: 'manual-merge' }, agents: { status: 'manual-merge' } })
    expect(read(root, 'AGENTS.md')).toBe(agents)
    expect(read(root, 'PROCESS.md')).toBe('Root process.\n')
    expect(read(root, 'context/PROCESS.md')).toBe('Context process.\n')
    expect(existsSync(join(root, 'docs/taco-process.md'))).toBe(false)
  })

  it('preserves customized legacy policies and refuses an unmanaged Process section', () => {
    const root = project()
    const customized = stock + '\n- Keep our local Taco requirement.\n'
    write(root, 'AGENTS.md', customized)
    expect(run(root)).toMatchObject({ status: 2 })
    expect(read(root, 'AGENTS.md')).toBe(customized)
    expect(existsSync(join(root, 'docs/taco-process.md'))).toBe(false)
    write(root, 'AGENTS.md', 'Keep Agent rules.\n')
    write(root, 'docs/taco-process.md', customized)
    expect(run(root)).toMatchObject({ status: 2 })
    expect(read(root, 'AGENTS.md')).toBe('Keep Agent rules.\n')
    expect(read(root, 'docs/taco-process.md')).toBe(customized)
  })

  it.each(['body', 'marker', 'duplicate'])('refuses %s changes to the managed process block without modifying AGENTS', (change) => {
    const root = project()
    run(root)
    const agents = read(root, 'AGENTS.md')
    const original = read(root, 'docs/taco-process.md')
    const changed = change === 'body' ? original.replace('YAML frontmatter', 'Custom frontmatter') : change === 'marker' ? original.replace('taco:process-policy:end', 'taco:process-policy:custom') : original + original
    write(root, 'docs/taco-process.md', changed)
    expect(run(root)).toMatchObject({ status: 2 })
    expect(read(root, 'AGENTS.md')).toBe(agents)
    expect(read(root, 'docs/taco-process.md')).toBe(changed)
  })

  it.each(['AGENTS.md', 'docs', 'docs/taco-process.md', '.specify'])('refuses symbolic links at %s including dangling links', (path) => {
    const root = project()
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'taco-outside-')))
    if (path === '.specify') {
      const inner = join(root, 'inner')
      mkdirSync(inner)
      symlinkSync(outside, join(inner, '.specify'))
      expect(run(inner)).toMatchObject({ status: 2 })
      return
    }
    mkdirSync(dirname(join(root, path)), { recursive: true })
    symlinkSync(path === 'docs' ? outside : join(outside, 'missing'), join(root, path))
    expect(run(root)).toMatchObject({ status: 2 })
    expect(existsSync(join(outside, 'taco-process.md'))).toBe(false)
    expect(existsSync(join(outside, 'missing'))).toBe(false)
  })

  it('rejects duplicate or customized routing references and preserves unrelated Process content', () => {
    const root = project()
    write(root, 'docs/taco-process.md', '## Team policy\n\nKeep it.\n')
    run(root)
    expect(read(root, 'docs/taco-process.md')).toContain('## Team policy\n\nKeep it.')
    const process = read(root, 'docs/taco-process.md')
    const agents = read(root, 'AGENTS.md') + read(root, 'AGENTS.md')
    write(root, 'AGENTS.md', agents)
    expect(run(root)).toMatchObject({ status: 2 })
    expect(read(root, 'AGENTS.md')).toBe(agents)
    expect(read(root, 'docs/taco-process.md')).toBe(process)
  })
  it('rolls back the Process write if the AGENTS replacement fails', () => {
    const root = project()
    const agents = '## Team instructions\n\nKeep these.\n'
    const processContent = '## Team workflow\n\nKeep this too.\n'
    write(root, 'AGENTS.md', agents)
    write(root, 'docs/taco-process.md', processContent)
    const hook = join(root, 'fail-second-rename.mjs')
    writeFileSync(hook, `
      import fs from 'node:fs/promises'
      import { syncBuiltinESMExports } from 'node:module'
      const rename = fs.rename
      let calls = 0
      fs.rename = (...args) => {
        if (++calls === 2) throw new Error('Injected AGENTS replacement failure')
        return rename(...args)
      }
      syncBuiltinESMExports()
    `)
    const result = spawnSync(process.execPath, ['--import', hook, cli, 'prepare-policy', '--project-root', root, '--json'], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({ applied: false, reason: 'Injected AGENTS replacement failure' })
    expect(read(root, 'AGENTS.md')).toBe(agents)
    expect(read(root, 'docs/taco-process.md')).toBe(processContent)
  })

})
