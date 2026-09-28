import { execFile, execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = resolve('skills/taco/scripts/check-update.mjs')

interface Component {
  installed: string | null
  latest: string | null
  updateAvailable: boolean | null
}

interface Payload {
  schema: string
  checkedAt: string
  ok: boolean
  reason: string | null
  source: string | null
  skill: Component
  cli: Component | null
  extension: Component | null
  cached: boolean
}

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const write = (path: string, content: string, mode?: number) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  if (mode !== undefined) chmodSync(path, mode)
}

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })

const localRepo = (tags: string[]) => {
  const dir = tempDir('taco-update-repo-')
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'test'])
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'init'])
  for (const tag of tags) git(dir, ['tag', tag])
  return dir
}

const skillDir = (version: string | null) => {
  const root = tempDir('taco-update-skill-')
  mkdirSync(join(root, 'scripts'), { recursive: true })
  copyFileSync(script, join(root, 'scripts/check-update.mjs'))
  if (version !== null) write(join(root, 'VERSION'), version)
  return join(root, 'scripts/check-update.mjs')
}

const cliStub = (stdout: string) => {
  const dir = tempDir('taco-update-cli-')
  const bin = join(dir, 'taco-cli')
  write(
    bin,
    `#!/bin/sh\nexec ${process.execPath} -e 'process.stdout.write(process.argv[1])' ${JSON.stringify(stdout)}\n`,
    0o755,
  )
  return bin
}

const cliSleep = (seconds: number) => {
  const dir = tempDir('taco-update-cli-sleep-')
  const bin = join(dir, 'taco-cli')
  write(bin, `#!/bin/sh\nexec /bin/sleep ${seconds}\n`, 0o755)
  return bin
}

const cliFlood = () => {
  const dir = tempDir('taco-update-cli-flood-')
  const bin = join(dir, 'taco-cli')
  write(bin, `#!/bin/sh\nexec ${process.execPath} -e "process.stdout.write('x'.repeat(200 * 1024))"\n`, 0o755)
  return bin
}

/** A PATH shim that records how `git` was invoked and answers with fixed output. */
const gitShim = ({ stdout = '', code = 0, sleep = 0 }: { stdout?: string; code?: number; sleep?: number } = {}) => {
  const dir = tempDir('taco-update-shim-')
  const record = join(dir, 'record.json')
  const script = join(dir, 'git')
  write(
    script,
    `#!/bin/sh
if [ ${sleep} -gt 0 ]; then
  echo "$(pwd)" > ${record}
  exec sleep ${sleep}
fi
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({argv:process.argv.slice(2),env:process.env,cwd:process.cwd()}))' ${record} "$@"
cat <<'OUT'
${stdout}
OUT
exit ${code}
`,
    0o755,
  )
  const read = () => (code === 0 && sleep === 0 ? JSON.parse(readFileSync(record, 'utf8')) : { record })
  return { dir, record, read }
}

interface FixtureOptions {
  tags?: string[][]
  releases?: unknown[]
  roundTrip?: (
    url: string,
    body: string,
  ) => { status: number; body?: string; headers?: Record<string, string>; hang?: boolean } | null
}

/** Loopback API fixture: one page of tags plus optional releases and overrides. */
const apiFixture = async (options: FixtureOptions = {}) => {
  const requests: Array<{ url: string; headers: Record<string, string | string[] | undefined> }> = []
  const pages = options.tags ?? [[]]
  const server = createServer((request, response) => {
    const url = request.url ?? ''
    requests.push({ url, headers: request.headers })
    const override = options.roundTrip?.(url, '')
    if (override) {
      response.writeHead(override.status, override.headers ?? {})
      if (override.hang) {
        // Headers only: the client must abort on its own timeout.
        response.write(override.body ?? '')
        return
      }
      response.end(override.body ?? '')
      return
    }
    if (url.startsWith('/repos/Arcadia822/taco/tags')) {
      const page = Number(new URL(url, 'http://localhost').searchParams.get('page') ?? '1')
      const names = pages[page - 1] ?? []
      const body = JSON.stringify(names.map((name) => ({ name })))
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (page < pages.length) headers.link = `<http://localhost/repos/Arcadia822/taco/tags?per_page=100&page=${page + 1}>; rel="next"`
      response.writeHead(200, headers)
      response.end(body)
      return
    }
    if (url.startsWith('/repos/Arcadia822/taco/releases')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(options.releases ?? []))
      return
    }
    response.writeHead(404)
    response.end('{}')
  })
  await new Promise<void>((settle) => server.listen(0, '127.0.0.1', settle))
  cleanups.push(() => server.close())
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture did not bind')
  return { apiBase: `http://127.0.0.1:${address.port}`, requests }
}

interface RunResult {
  status: number
  stdout: string
  stderr: string
}

// Async on purpose: the loopback API fixture runs in this process, so a blocking
// spawnSync would starve the server and make every HTTP case time out.
const run = (args: string[], env: Record<string, string> = {}, cwd?: string) =>
  new Promise<RunResult>((settle) => {
    execFile(
      process.execPath,
      [script, ...args],
      { encoding: 'utf8', cwd, env: { ...process.env, TACO_UPDATE_CACHE_DIR: tempDir('taco-update-cache-'), ...env } },
      (error, stdout, stderr) => {
        const status = error && typeof error.code === 'number' ? error.code : error ? 1 : 0
        settle({ status, stdout, stderr })
      },
    )
  })

const runJson = async (args: string[], env: Record<string, string> = {}, cwd?: string) => {
  const result = await run(args, env, cwd)
  if (result.status !== 0) throw new Error(`exit ${result.status}: ${result.stderr}`)
  return JSON.parse(result.stdout) as Payload
}

/** A PATH that cannot see git, so the probe has to fall back to HTTP. */
const pathWithoutGit = () => tempDir('taco-update-nogit-')

describe('taco update check', () => {
  it('reports an available skill update and a newer taco-cli from the git channel', async () => {
    const repo = localRepo(['v0.10.0', 'v0.11.0', 'taco-cli-v0.2.0', 'tacobin-v0.3.0'])
    const payload = await runJson(['--json', '--repo', repo, '--cli-bin', cliStub('{"binaryVersion":"0.1.4"}')], {}, tempDir('taco-update-cwd-'))

    expect(payload).toMatchObject({
      schema: 'taco-update-check/1',
      ok: true,
      reason: null,
      source: 'git-ls-remote',
      cached: false,
      skill: { installed: '0.11.0', latest: '0.11.0', updateAvailable: false },
      cli: { installed: '0.1.4', latest: '0.2.0', updateAvailable: true },
      extension: null,
    })
  })

  it('reads the installed version from the skill directory that holds the script', async () => {
    const repo = localRepo(['v0.11.0'])
    const payload = await runJson(['--json', '--repo', repo, '--no-cli'], {}, tempDir('taco-update-cwd-'))
    expect(payload.skill).toEqual({ installed: '0.11.0', latest: '0.11.0', updateAvailable: false })

    const older = skillDir('0.10.0\n')
    const result = spawnSync(process.execPath, [older, '--json', '--repo', repo, '--no-cli'], {
      encoding: 'utf8',
      env: { ...process.env, TACO_UPDATE_CACHE_DIR: tempDir('taco-update-cache-') },
    })
    expect((JSON.parse(result.stdout) as Payload).skill).toEqual({
      installed: '0.10.0',
      latest: '0.11.0',
      updateAvailable: true,
    })
  })

  it('hides the skill component and stays silent when the version marker is missing or unreadable', async () => {
    const repo = localRepo(['v0.11.0'])
    const missing = spawnSync(process.execPath, [skillDir(null), '--json', '--repo', repo, '--no-cli'], { encoding: 'utf8' })
    expect(JSON.parse(missing.stdout)).toMatchObject({ ok: false, reason: 'installed-version-marker-missing', cli: null })

    const broken = spawnSync(process.execPath, [skillDir('abc\n'), '--json', '--repo', repo, '--no-cli'], { encoding: 'utf8' })
    expect(JSON.parse(broken.stdout)).toMatchObject({ ok: false, reason: 'installed-version-unreadable' })
  })

  it('never treats an older remote version as an update', async () => {
    const repo = localRepo(['v0.9.0'])
    const payload = await runJson(['--json', '--repo', repo, '--no-cli'], {}, tempDir('taco-update-cwd-'))
    expect(payload.skill).toEqual({ installed: '0.11.0', latest: '0.9.0', updateAvailable: false })
  })

  it('runs git with an isolated environment, no inherited config and a neutral cwd', async () => {
    const shim = gitShim({ stdout: 'abc123def\trefs/tags/v0.11.0' })
    const repo = localRepo(['v0.11.0'])
    const cwd = tempDir('taco-update-cwd-')
    await runJson(['--json', '--repo', repo, '--no-cli'], { PATH: `${shim.dir}:${process.env.PATH ?? ''}` }, cwd)

    const recorded = shim.read()
    expect(recorded.argv).toEqual(['-c', 'credential.helper=', '-c', 'core.askpass=', 'ls-remote', '--tags', '--refs', '--', repo])
    expect(recorded.env.GIT_CONFIG_GLOBAL).toBe('/dev/null')
    expect(recorded.env.GIT_CONFIG_SYSTEM).toBe('/dev/null')
    expect(recorded.env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(recorded.env.GIT_ASKPASS).toBe('false')
    expect(Object.keys(recorded.env)).not.toContain('GIT_DIR')
    expect(recorded.cwd).not.toBe(cwd)
  })

  it('does not read a hostile .git/config from the working directory', async () => {
    const repo = localRepo(['v0.11.0'])
    const cwd = tempDir('taco-update-hostile-')
    git(cwd, ['init', '-q'])
    git(cwd, ['config', 'http.extraheader', 'authorization: Bearer secret'])
    git(cwd, ['config', `url.${join(cwd, 'evil')}.insteadOf`, 'https://github.com/'])

    const payload = await runJson(['--json', '--repo', repo, '--no-cli'], {}, cwd)
    expect(payload.source).toBe('git-ls-remote')
    expect(payload.skill.latest).toBe('0.11.0')
  })

  it('falls back to the tags API when git is unavailable, and only then', async () => {
    const fixture = await apiFixture({ tags: [['v0.11.0', 'v0.10.0', 'taco-cli-v0.2.1']] })
    const payload = await runJson(['--json', '--api-base', fixture.apiBase, '--cli-bin', cliStub('{"binaryVersion":"0.1.4"}')], {
      PATH: pathWithoutGit(),
    })
    expect(payload).toMatchObject({ ok: true, source: 'github-tags-api', cached: false })
    expect(payload.skill).toEqual({ installed: '0.11.0', latest: '0.11.0', updateAvailable: false })
    expect(payload.cli).toEqual({ installed: '0.1.4', latest: '0.2.1', updateAvailable: true })

    const tagRequests = fixture.requests.filter((entry) => entry.url.includes('/tags'))
    expect(tagRequests).toHaveLength(1)
    expect(tagRequests[0].url).toBe('/repos/Arcadia822/taco/tags?per_page=100')
    expect(tagRequests[0].headers['user-agent']).toBe('taco-update-check/1')
    expect(tagRequests[0].headers.authorization).toBeUndefined()
    expect(tagRequests[0].headers.cookie).toBeUndefined()
    expect(tagRequests[0].headers.referer).toBeUndefined()
  })

  it('never falls back when the repository was overridden', async () => {
    const fixture = await apiFixture({ tags: [['v9.9.9']] })
    const payload = await runJson(['--json', '--repo', '/nonexistent-taco-repo', '--api-base', fixture.apiBase, '--no-cli'])
    expect(payload).toMatchObject({ ok: false, source: null })
    expect(fixture.requests).toHaveLength(0)
    expect(payload.skill.installed).toBe('0.11.0')
    expect(payload.skill.latest).toBeNull()
  })

  it('degrades the taco-cli component alone when it is absent or unreadable', async () => {
    const repo = localRepo(['v0.11.0', 'taco-cli-v0.2.1'])

    const disabled = await runJson(['--json', '--repo', repo, '--no-cli'], {}, tempDir('taco-update-cwd-'))
    expect(disabled.cli).toBeNull()
    expect(disabled.ok).toBe(true)

    const absent = await runJson(['--json', '--repo', repo, '--cli-bin', join(tempDir('taco-update-none-'), 'taco-cli')], {}, tempDir('taco-update-cwd-'))
    expect(absent.cli).toBeNull()
    expect(absent.skill.updateAvailable).toBe(false)
    expect(absent.ok).toBe(true)

    const notJson = await runJson(['--json', '--repo', repo, '--cli-bin', cliStub('not json')], {}, tempDir('taco-update-cwd-'))
    expect(notJson.cli).toEqual({ installed: null, latest: '0.2.1', updateAvailable: null })
    expect(notJson.ok).toBe(true)
  })

  it('kills a hanging taco-cli and keeps the skill answer usable', async () => {
    const repo = localRepo(['v0.11.0', 'v0.10.0'])
    const started = Date.now()
    const payload = await runJson(['--json', '--repo', repo, '--cli-bin', cliSleep(5), '--timeout', '300'], {}, tempDir('taco-update-cwd-'))
    expect(Date.now() - started).toBeLessThan(3000)
    expect(payload.cli).toEqual({ installed: null, latest: null, updateAvailable: null })
    expect(payload.skill).toEqual({ installed: '0.11.0', latest: '0.11.0', updateAvailable: false })
    expect(payload.ok).toBe(true)
  })

  it('drops a taco-cli that floods stdout', async () => {
    const repo = localRepo(['v0.11.0', 'taco-cli-v0.2.1'])
    const payload = await runJson(['--json', '--repo', repo, '--cli-bin', cliFlood()], {}, tempDir('taco-update-cwd-'))
    expect(payload.cli?.installed).toBeNull()
    expect(payload.ok).toBe(true)
  })

  it('abandons a git probe that hangs or floods, without leaving the check hung', async () => {
    const hanging = gitShim({ sleep: 5 })
    const started = Date.now()
    const timedOut = await runJson(['--json', '--repo', '/nonexistent', '--api-base', 'http://127.0.0.1:9', '--timeout', '300', '--no-cli'], {
      PATH: `${hanging.dir}:${process.env.PATH ?? ''}`,
    })
    expect(Date.now() - started).toBeLessThan(4000)
    expect(timedOut).toMatchObject({ ok: false, reason: 'timeout' })

    // An overridden repository keeps the answer on the git channel, so the
    // overflow reason is observable instead of being replaced by the fallback.
    const flooding = gitShim({ stdout: 'x'.repeat(200 * 1024) })
    const flooded = await runJson(['--json', '--repo', '/nonexistent', '--no-cli', '--no-cache'], {
      PATH: `${flooding.dir}:${process.env.PATH ?? ''}`,
    })
    expect(flooded).toMatchObject({ ok: false, reason: 'output-limit-exceeded' })
  })

  it('maps HTTP failures to reasons and keeps exit code 0', async () => {
    const cases: Array<[number, string, Record<string, string>]> = [
      [403, 'rate-limited', {}],
      [403, 'rate-limited', { 'x-ratelimit-remaining': '0' }],
      [429, 'rate-limited', {}],
      [500, 'http-error', {}],
    ]
    for (const [status, reason, headers] of cases) {
      const fixture = await apiFixture({ roundTrip: () => ({ status, headers, body: '{}' }) })
      const result = await run(['--json', '--api-base', fixture.apiBase, '--no-cli'], { PATH: pathWithoutGit() })
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, reason })
    }

    const malformed = await apiFixture({ roundTrip: () => ({ status: 200, body: 'not json' }) })
    expect(await runJson(['--json', '--api-base', malformed.apiBase, '--no-cli'], { PATH: pathWithoutGit() })).toMatchObject({
      ok: false,
      reason: 'http-error',
    })

    const refused = await runJson(['--json', '--api-base', 'http://127.0.0.1:9', '--no-cli', '--no-cache'], { PATH: pathWithoutGit() })
    expect(refused).toMatchObject({ ok: false, reason: 'network-unavailable' })
  })

  it('refuses a redirect instead of following it to another host', async () => {
    const target = await apiFixture({ tags: [['v9.9.9']] })
    const fixture = await apiFixture({
      roundTrip: () => ({ status: 302, headers: { location: `${target.apiBase}/repos/Arcadia822/taco/tags?per_page=100` } }),
    })
    const payload = await runJson(['--json', '--api-base', fixture.apiBase, '--no-cli', '--no-cache'], { PATH: pathWithoutGit() })
    expect(payload).toMatchObject({ ok: false, reason: 'http-error', source: null })
    expect(target.requests).toHaveLength(0)
  })

  it('builds the second page from the validated base and stops after two requests', async () => {
    const filler = Array.from({ length: 100 }, (_, index) => `taco-cli-v0.9.${index}`)
    const fixture = await apiFixture({ tags: [filler, ['v0.11.0']] })
    const payload = await runJson(['--json', '--api-base', fixture.apiBase, '--no-cli', '--no-cache'], { PATH: pathWithoutGit() })
    expect(payload.skill.latest).toBe('0.11.0')
    expect(fixture.requests.filter((entry) => entry.url.includes('/tags'))).toHaveLength(2)
    expect(fixture.requests.every((entry) => entry.url.startsWith('/repos/Arcadia822/taco/'))).toBe(true)
  })

  it('ignores prerelease and non-semver tags on both channels', async () => {
    const repo = localRepo(['v1.2.0-rc.1', 'release-1', 'v1.2'])
    const gitPayload = await runJson(['--json', '--repo', repo, '--no-cli'], {}, tempDir('taco-update-cwd-'))
    expect(gitPayload).toMatchObject({ ok: true, source: 'git-ls-remote' })
    expect(gitPayload.skill).toEqual({ installed: '0.11.0', latest: null, updateAvailable: null })

    const fixture = await apiFixture({ tags: [['v1.2.0-rc.1', 'v1.2']] })
    const apiPayload = await runJson(['--json', '--api-base', fixture.apiBase, '--no-cli', '--no-cache'], { PATH: pathWithoutGit() })
    expect(apiPayload).toMatchObject({ ok: true, source: 'github-tags-api' })
    expect(apiPayload.skill.latest).toBeNull()
    expect(apiPayload.cli).toBeNull()
  })

  it('reports the extension only when a newer installable archive exists', async () => {
    const cwd = tempDir('taco-update-project-')
    write(join(cwd, '.specify/extensions/taco/extension.yml'), "extension:\n  id: 'taco'\n  version: '0.6.0'\n")
    const releases = [
      { tag_name: 'v0.11.0', assets: [] },
      { tag_name: 'v0.6.0', assets: [{ name: 'taco-extension-v0.6.0.zip' }] },
    ]
    const fixture = await apiFixture({ tags: [['v0.11.0']], releases })
    const payload = await runJson(['--json', '--api-base', fixture.apiBase, '--no-cli', '--no-cache'], { PATH: pathWithoutGit() }, cwd)
    expect(payload.extension).toEqual({ installed: '0.6.0', latest: '0.6.0', updateAvailable: false })
    expect(fixture.requests.some((entry) => entry.url.includes('/releases'))).toBe(true)

    const newer = await apiFixture({
      tags: [['v0.12.0']],
      releases: [{ tag_name: 'v0.12.0', assets: [{ name: 'taco-extension-v0.12.0.zip' }] }],
    })
    const updated = await runJson(['--json', '--api-base', newer.apiBase, '--no-cli', '--no-cache'], { PATH: pathWithoutGit() }, cwd)
    expect(updated.extension).toEqual({ installed: '0.6.0', latest: '0.12.0', updateAvailable: true })

    const plain = await apiFixture({ tags: [['v0.12.0']] })
    const withoutExtension = await runJson(['--json', '--api-base', plain.apiBase, '--no-cli', '--no-cache'], { PATH: pathWithoutGit() }, tempDir('taco-update-plain-'))
    expect(withoutExtension.extension).toBeNull()
    expect(plain.requests.some((entry) => entry.url.includes('/releases'))).toBe(false)
  })

  it('reads a releases payload larger than the tags cap and drops one beyond its own', async () => {
    const cwd = tempDir('taco-update-project-')
    write(join(cwd, '.specify/extensions/taco/extension.yml'), "extension:\n  id: 'taco'\n  version: '0.6.0'\n")
    const padding = Array.from({ length: 1500 }, (_, index) => ({ name: `padding-${index}-${'p'.repeat(100)}` }))

    const roomy = await apiFixture({
      tags: [['v0.11.0']],
      roundTrip: (url) =>
        url.includes('/releases')
          ? { status: 200, body: JSON.stringify([{ tag_name: 'v0.12.0', assets: [...padding, { name: 'taco-extension-v0.12.0.zip' }] }]) }
          : null,
    })
    const payload = await runJson(['--json', '--api-base', roomy.apiBase, '--no-cli', '--no-cache'], { PATH: pathWithoutGit() }, cwd)
    expect(payload.extension).toEqual({ installed: '0.6.0', latest: '0.12.0', updateAvailable: true })
    expect(payload.ok).toBe(true)

    const oversized = await apiFixture({
      tags: [['v0.11.0']],
      roundTrip: (url) => (url.includes('/releases') ? { status: 200, body: 'x'.repeat(2 * 1024 * 1024) } : null),
    })
    const dropped = await runJson(['--json', '--api-base', oversized.apiBase, '--no-cli', '--no-cache'], { PATH: pathWithoutGit() }, cwd)
    expect(dropped.extension).toEqual({ installed: '0.6.0', latest: null, updateAvailable: null })
    expect(dropped.ok).toBe(true)
  })

  it('reuses a fresh cache without any request and refreshes an expired one', async () => {
    const repo = localRepo(['v0.11.0', 'v0.10.0'])
    const cacheDir = tempDir('taco-update-cache-')
    const first = await runJson(['--json', '--repo', repo, '--no-cli'], { TACO_UPDATE_CACHE_DIR: cacheDir }, tempDir('taco-update-cwd-'))
    expect(first.cached).toBe(false)

    const second = await runJson(['--json', '--repo', repo, '--no-cli'], { TACO_UPDATE_CACHE_DIR: cacheDir }, tempDir('taco-update-cwd-'))
    expect(second.cached).toBe(true)
    expect(second.skill).toEqual(first.skill)

    const cachePath = join(cacheDir, 'update-check.json')
    const raw = readFileSync(cachePath, 'utf8')
    expect(raw).not.toContain(repo)
    expect((JSON.parse(raw) as { target: string }).target).toMatch(/^[0-9a-f]{64}$/)
    const poisoned = JSON.parse(raw) as { checkedAt: string; latest: { skill: string } }
    poisoned.checkedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    poisoned.latest.skill = '0.99.0'
    writeFileSync(cachePath, JSON.stringify(poisoned))
    const refreshed = await runJson(['--json', '--repo', repo, '--no-cli'], { TACO_UPDATE_CACHE_DIR: cacheDir }, tempDir('taco-update-cwd-'))
    expect(refreshed.cached).toBe(false)
    expect(refreshed.skill.latest).toBe('0.11.0')

    writeFileSync(cachePath, '{ not json')
    expect((await runJson(['--json', '--repo', repo, '--no-cli'], { TACO_UPDATE_CACHE_DIR: cacheDir }, tempDir('taco-update-cwd-'))).skill.latest).toBe('0.11.0')
  })

  it('never reuses a cached comparison for a different probe target', async () => {
    const first = localRepo(['v0.11.0'])
    const second = localRepo(['v0.10.0', 'taco-cli-v0.9.9'])
    const cacheDir = tempDir('taco-update-cache-')
    const warm = await runJson(['--json', '--repo', first, '--no-cli'], { TACO_UPDATE_CACHE_DIR: cacheDir }, tempDir('taco-update-cwd-'))
    expect(warm.cached).toBe(false)

    const reuse = await runJson(['--json', '--repo', first, '--no-cli'], { TACO_UPDATE_CACHE_DIR: cacheDir }, tempDir('taco-update-cwd-'))
    expect(reuse.cached).toBe(true)

    const other = await runJson(['--json', '--repo', second, '--no-cli'], { TACO_UPDATE_CACHE_DIR: cacheDir }, tempDir('taco-update-cwd-'))
    expect(other.cached).toBe(false)
    expect(other.skill.latest).toBe('0.10.0')
  })

  it('ignores an extension manifest reached through a symlinked directory', async () => {
    const outside = tempDir('taco-update-outside-')
    write(join(outside, 'extensions/taco/extension.yml'), "extension:\n  id: 'taco'\n  version: '0.5.0'\n")
    const project = tempDir('taco-update-linked-')
    mkdirSync(join(project, '.specify'), { recursive: true })
    symlinkSync(join(outside, 'extensions'), join(project, '.specify', 'extensions'))

    // No --repo override: the extension walk must run, and the linked directory
    // must not count as an installed extension (so no releases request follows).
    const fixture = await apiFixture({ tags: [['v0.11.0']], releases: [{ tag_name: 'v0.12.0', assets: [{ name: 'taco-extension-v0.12.0.zip' }] }] })
    const payload = await runJson(['--json', '--api-base', fixture.apiBase, '--no-cli', '--no-cache'], { PATH: pathWithoutGit() }, project)
    expect(payload.extension).toBeNull()
    expect(fixture.requests.some((entry) => entry.url.includes('/releases'))).toBe(false)
  })

  it('reports a stalled response body as a timeout instead of an unreachable network', async () => {
    const stalled = await apiFixture({
      roundTrip: () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"half":', hang: true }),
    })
    const started = Date.now()
    const payload = await runJson(['--json', '--api-base', stalled.apiBase, '--no-cli', '--no-cache', '--timeout', '300'], {
      PATH: pathWithoutGit(),
    })
    expect(Date.now() - started).toBeLessThan(3000)
    expect(payload).toMatchObject({ ok: false, reason: 'timeout' })
    expect(stalled.requests).toHaveLength(1)
  })

  it('discards a cache whose payload is not version-shaped', async () => {
    const repo = localRepo(['v0.11.0'])
    const cacheDir = tempDir('taco-update-cache-')
    await runJson(['--json', '--repo', repo, '--no-cli'], { TACO_UPDATE_CACHE_DIR: cacheDir }, tempDir('taco-update-cwd-'))

    const cachePath = join(cacheDir, 'update-check.json')
    const tampered = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, unknown> & { latest: { skill: unknown } }
    tampered.latest.skill = 'bad'
    writeFileSync(cachePath, JSON.stringify(tampered))
    const afterBadVersion = await runJson(['--json', '--repo', repo, '--no-cli'], { TACO_UPDATE_CACHE_DIR: cacheDir }, tempDir('taco-update-cwd-'))
    expect(afterBadVersion.cached).toBe(false)
    expect(afterBadVersion.skill.latest).toBe('0.11.0')

    await runJson(['--json', '--repo', repo, '--no-cli'], { TACO_UPDATE_CACHE_DIR: cacheDir }, tempDir('taco-update-cwd-'))
    const badSource = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, unknown>
    badSource.source = 'evil-origin'
    writeFileSync(cachePath, JSON.stringify(badSource))
    expect((await runJson(['--json', '--repo', repo, '--no-cli'], { TACO_UPDATE_CACHE_DIR: cacheDir }, tempDir('taco-update-cwd-'))).cached).toBe(false)
  })

  it('treats an exhausted rate-limit budget on a 200 as rate-limited', async () => {
    const fixture = await apiFixture({
      roundTrip: () => ({ status: 200, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '0' }, body: '[]' }),
    })
    const payload = await runJson(['--json', '--api-base', fixture.apiBase, '--no-cli', '--no-cache'], { PATH: pathWithoutGit() })
    expect(payload).toMatchObject({ ok: false, reason: 'rate-limited', source: null })
  })

  it('rejects a timeout above the timer range', async () => {
    const result = await run(['--json', '--timeout', '2147483648'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage: check-update.mjs')
  })

  it('honours --no-cache and TACO_UPDATE_CACHE_TTL=0, and survives an unwritable cache', async () => {
    const repo = localRepo(['v0.11.0'])
    const cacheDir = tempDir('taco-update-cache-')
    await runJson(['--json', '--repo', repo, '--no-cli'], { TACO_UPDATE_CACHE_DIR: cacheDir }, tempDir('taco-update-cwd-'))
    expect((await runJson(['--json', '--repo', repo, '--no-cli', '--no-cache'], { TACO_UPDATE_CACHE_DIR: cacheDir }, tempDir('taco-update-cwd-'))).cached).toBe(false)
    expect(
      (await runJson(['--json', '--repo', repo, '--no-cli'], { TACO_UPDATE_CACHE_DIR: cacheDir, TACO_UPDATE_CACHE_TTL: '0' }, tempDir('taco-update-cwd-'))).cached,
    ).toBe(false)

    const blocked = tempDir('taco-update-cache-file-')
    write(join(blocked, 'file'), 'not a directory')
    const payload = await runJson(['--json', '--repo', repo, '--no-cli'], { TACO_UPDATE_CACHE_DIR: join(blocked, 'file', 'nested') }, tempDir('taco-update-cwd-'))
    expect(payload.ok).toBe(true)
    expect(payload.skill.latest).toBe('0.11.0')
  })

  it('short-circuits when disabled: no subprocess, no request, no write', async () => {
    const shim = gitShim({ stdout: '' })
    const fixture = await apiFixture({ tags: [['v9.9.9']] })
    const cacheDir = tempDir('taco-update-cache-')
    const payload = await runJson(['--json'], {
      TACO_UPDATE_CHECK: 'off',
      PATH: `${shim.dir}:${process.env.PATH ?? ''}`,
      TACO_UPDATE_CACHE_DIR: cacheDir,
    })
    expect(payload).toMatchObject({ ok: false, reason: 'disabled', source: null, cli: null, extension: null })
    expect(fixture.requests).toHaveLength(0)
    expect(existsSync(shim.record)).toBe(false)
    expect(existsSync(join(cacheDir, 'update-check.json'))).toBe(false)
  })

  it('rejects unsupported arguments and addresses with exit code 2', async () => {
    for (const args of [
      ['--repo', '-x'],
      ['--repo', 'ftp://host/x'],
      ['--repo', 'relative/path'],
      ['--api-base', 'http://example.com'],
      ['--api-base', 'ftp://host'],
      ['--cli-bin', 'taco-cli'],
      ['--timeout', '0'],
      ['--timeout', '-1'],
      ['--nope'],
    ]) {
      const result = await run([...args, '--json'])
      expect(result.status, args.join(' ')).toBe(2)
      expect(result.stderr).toContain('usage: check-update.mjs')
    }
  })

  it('emits exactly the documented JSON contract', async () => {
    const repo = localRepo(['v0.11.0', 'taco-cli-v0.2.1'])
    const payload = await runJson(['--json', '--repo', repo, '--cli-bin', cliStub('{"binaryVersion":"0.1.4"}')], {}, tempDir('taco-update-cwd-'))
    expect(Object.keys(payload).sort()).toEqual(['cached', 'checkedAt', 'cli', 'extension', 'ok', 'reason', 'schema', 'skill', 'source'])
    expect(Object.keys(payload.skill).sort()).toEqual(['installed', 'latest', 'updateAvailable'])
    expect(Object.keys(payload.cli ?? {}).sort()).toEqual(['installed', 'latest', 'updateAvailable'])
    expect(payload.schema).toBe('taco-update-check/1')
    expect(Number.isNaN(Date.parse(payload.checkedAt))).toBe(false)
    for (const part of [payload.skill, payload.cli, payload.extension]) {
      if (!part) continue
      for (const value of [part.installed, part.latest]) {
        if (value !== null) expect(value).toMatch(/^\d+\.\d+\.\d+$/)
      }
    }
  })
})
