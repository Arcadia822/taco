#!/usr/bin/env node
// Taco update check for the `taco` skill.
//
// Answers one question for an agent: "is there a newer published version of the
// taco skill (and, when installed here, taco-cli or the Taco Spec Kit extension)?"
// It never installs anything, never writes project files, and never sends local
// data anywhere. Implementation of specs/012-skill-update-notice (spec §5).
//
//   node scripts/check-update.mjs [--json] [--repo <url|path>] [--api-base <url>]
//                                 [--timeout <ms>] [--cli-bin <path>] [--no-cli]
//                                 [--no-cache]
//
// Environment:
//   TACO_UPDATE_CHECK=off        skip everything (no subprocess, no request)
//   TACO_CLI_BIN=<path>          explicit taco-cli executable (absolute path)
//   TACO_UPDATE_CACHE_TTL=<sec>  cache TTL, default 900; 0 disables the cache
//   TACO_UPDATE_CACHE_DIR=<dir>  cache directory (default ~/.cache/taco)
//
// Exit codes: 0 for a completed check (even when the answer is "unknown", which
// is reported as ok:false + reason), 2 for a usage error. A check must never
// fail the Taco work that triggered it.

import { spawn } from 'node:child_process'
import { lstat, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const VERSION_FILE = resolve(SCRIPT_DIR, '..', 'VERSION')

const DEFAULT_REPO = 'https://github.com/Arcadia822/taco.git'
const DEFAULT_API_BASE = 'https://api.github.com'
const REPO_PATH = '/repos/Arcadia822/taco'
const USER_AGENT = 'taco-update-check/1'
const RESPONSE_LIMIT = 64 * 1024
// The releases endpoint is inherently larger (assets metadata); it still needs a bound.
const RELEASES_RESPONSE_LIMIT = 1024 * 1024
const DEFAULT_TIMEOUT_MS = 3000
const SEMVER = /^\d+\.\d+\.\d+$/
const SKILL_TAG = /^v(\d+\.\d+\.\d+)$/
const CLI_TAG = /^taco-cli-v(\d+\.\d+\.\d+)$/
const EXTENSION_ASSET = /^taco-extension-v(\d+\.\d+\.\d+)\.zip$/
const CACHE_SCHEMA = 'taco-update-check-cache/1'
const DEFAULT_TTL_SECONDS = 900
const MAX_PROJECT_WALK = 8

const USAGE = `usage: check-update.mjs [--json] [--repo <url|path>] [--api-base <url>]
                          [--timeout <ms>] [--cli-bin <path>] [--no-cli] [--no-cache]`

class UsageError extends Error {}
class HttpFailure extends Error {
  constructor(reason) {
    super(reason)
    this.reason = reason
  }
}

// --- options ----------------------------------------------------------------

const parseOptions = (argv, env) => {
  const cacheHome = env.XDG_CACHE_HOME || join(homedir(), '.cache')
  const options = {
    json: false,
    repo: DEFAULT_REPO,
    repoOverridden: false,
    apiBase: DEFAULT_API_BASE,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    cliBin: env.TACO_CLI_BIN ?? null,
    cli: true,
    cache: true,
    ttlSeconds: DEFAULT_TTL_SECONDS,
    cacheDir: env.TACO_UPDATE_CACHE_DIR || join(cacheHome, 'taco'),
  }

  if (env.TACO_UPDATE_CACHE_TTL !== undefined) {
    const ttl = Number(env.TACO_UPDATE_CACHE_TTL)
    if (!Number.isInteger(ttl) || ttl < 0) throw new UsageError('TACO_UPDATE_CACHE_TTL must be a non-negative integer')
    options.ttlSeconds = ttl
  }

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    switch (flag) {
      case '--json':
        options.json = true
        break
      case '--no-cli':
        options.cli = false
        break
      case '--no-cache':
        options.cache = false
        break
      case '--repo':
        if (!value || value.startsWith('-')) throw new UsageError('--repo requires a url or an absolute path')
        if (!/^https:\/\//.test(value) && !isAbsolute(value)) {
          throw new UsageError('--repo only accepts an https:// url or an absolute local path')
        }
        options.repo = value
        options.repoOverridden = true
        index += 1
        break
      case '--api-base': {
        if (!value || value.startsWith('-')) throw new UsageError('--api-base requires a url')
        const loopback = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(value)
        if (value !== DEFAULT_API_BASE && !loopback) {
          throw new UsageError('--api-base only accepts https://api.github.com or a loopback test fixture')
        }
        options.apiBase = value.replace(/\/$/, '')
        index += 1
        break
      }
      case '--timeout': {
        const timeout = Number(value)
        if (!Number.isInteger(timeout) || timeout <= 0) throw new UsageError('--timeout requires a positive integer')
        options.timeoutMs = timeout
        index += 1
        break
      }
      case '--cli-bin':
        if (!value || value.startsWith('-')) throw new UsageError('--cli-bin requires a path')
        if (!isAbsolute(value)) throw new UsageError('--cli-bin requires an absolute path')
        options.cliBin = value
        index += 1
        break
      default:
        throw new UsageError(`unknown argument: ${flag}`)
    }
  }

  if (options.cliBin !== null && !isAbsolute(options.cliBin)) {
    throw new UsageError('TACO_CLI_BIN requires an absolute path')
  }
  return options
}

// --- version helpers --------------------------------------------------------

const compare = (left, right) => {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1
  }
  return 0
}

const maxVersion = (values) => {
  let best = null
  for (const value of values) if (best === null || compare(best, value) < 0) best = value
  return best
}

const component = (installed, latest) => ({
  installed: installed ?? null,
  latest: latest ?? null,
  updateAvailable: installed && latest ? compare(latest, installed) > 0 : null,
})

const latestFromTags = (names) => ({
  skill: maxVersion(names.map((name) => SKILL_TAG.exec(name)?.[1]).filter(Boolean)),
  cli: maxVersion(names.map((name) => CLI_TAG.exec(name)?.[1]).filter(Boolean)),
})

const latestInstallableExtension = (releases) => {
  if (!Array.isArray(releases)) return null
  const versions = []
  for (const release of releases) {
    for (const asset of Array.isArray(release?.assets) ? release.assets : []) {
      const match = EXTENSION_ASSET.exec(String(asset?.name ?? ''))
      if (match) versions.push(match[1])
    }
  }
  return maxVersion(versions)
}

const readVersionMarker = async (file) => {
  const raw = await readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null
    return ''
  })
  if (raw === null) return { value: null, reason: 'installed-version-marker-missing' }
  const value = raw.trim()
  return SEMVER.test(value) ? { value, reason: null } : { value: null, reason: 'installed-version-unreadable' }
}

// --- subprocesses -----------------------------------------------------------

const runProcess = (command, args, { cwd, env, timeoutMs }) =>
  new Promise((settle) => {
    let child
    try {
      child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      settle({ failed: true, reason: error.code === 'ENOENT' ? 'git-unavailable' : 'network-unavailable' })
      return
    }

    let stdout = ''
    let settled = false
    let overflowed = false
    let timer = null

    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // Process group already gone.
      }
      settle(result)
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (stdout.length > RESPONSE_LIMIT) {
        overflowed = true
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          // Ignore.
        }
      }
    })
    child.on('error', (error) =>
      finish({ failed: true, reason: error.code === 'ENOENT' ? 'git-unavailable' : 'network-unavailable' }),
    )
    child.on('close', (code) => {
      if (overflowed) return finish({ failed: true, reason: 'output-limit-exceeded' })
      if (code === 0) return finish({ failed: false, stdout })
      finish({ failed: true, reason: 'network-unavailable' })
    })

    timer = setTimeout(() => finish({ failed: true, reason: 'timeout' }), timeoutMs)
  })

const gitEnvironment = () => ({
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? '',
  LANG: process.env.LANG ?? 'C',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'false',
  SSH_ASKPASS: 'false',
})

const readTagsWithGit = (repo, timeoutMs) =>
  runProcess('git', ['-c', 'credential.helper=', '-c', 'core.askpass=', 'ls-remote', '--tags', '--refs', '--', repo], {
    cwd: tmpdir(),
    env: gitEnvironment(),
    timeoutMs,
  })

// Resolves the CLI to an absolute, regular, executable file. Returns null when
// nothing matches, so an uninstalled CLI stays `cli: null` in the answer.
const resolveCliBin = async (options) => {
  const name = options.cliBin ?? 'taco-cli'
  const candidates = isAbsolute(name)
    ? [name]
    : (process.env.PATH ?? '')
        .split(':')
        .filter(Boolean)
        .map((dir) => join(dir, name))
  for (const candidate of candidates) {
    const info = await stat(candidate).catch(() => null)
    if (info?.isFile() && (info.mode & 0o111) !== 0) return candidate
  }
  return null
}

// Only an absolute, regular, executable file is executed. A symlink is followed
// (that is how npm installs a bin), but a directory, fifo or non-executable file
// is refused, and a failure here only drops that component.
const readCliVersion = async (bin, timeoutMs) => {
  const result = await runProcess(bin, ['--version'], {
    cwd: tmpdir(),
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LANG: process.env.LANG ?? 'C' },
    timeoutMs,
  })
  if (result.failed) return null
  try {
    const value = String(JSON.parse(result.stdout)?.binaryVersion ?? '').trim()
    return SEMVER.test(value) ? value : null
  } catch {
    return null
  }
}

// --- HTTP -------------------------------------------------------------------

const readCapped = async (response, limit = RESPONSE_LIMIT) => {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      throw new HttpFailure('output-limit-exceeded')
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

const getJson = async (url, timeoutMs, limit = RESPONSE_LIMIT) => {
  let response
  try {
    response = await fetch(url, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new HttpFailure(error?.name === 'TimeoutError' ? 'timeout' : 'network-unavailable')
  }
  if (response.status >= 300 && response.status < 400) throw new HttpFailure('http-error')
  if (!response.ok) {
    throw new HttpFailure(response.status === 403 || response.status === 429 ? 'rate-limited' : 'http-error')
  }
  const text = await readCapped(response, limit)
  try {
    return { body: JSON.parse(text), link: response.headers.get('link') ?? '' }
  } catch {
    throw new HttpFailure('http-error')
  }
}

const namesOf = (body) => (Array.isArray(body) ? body.map((entry) => String(entry?.name ?? '')) : [])

const latestFromApi = async (apiBase, timeoutMs) => {
  const first = await getJson(`${apiBase}${REPO_PATH}/tags?per_page=100`, timeoutMs)
  const names = namesOf(first.body)
  let latest = latestFromTags(names)
  if ((latest.skill === null || latest.cli === null) && /rel="next"/.test(first.link)) {
    const second = await getJson(`${apiBase}${REPO_PATH}/tags?per_page=100&page=2`, timeoutMs)
    latest = latestFromTags([...names, ...namesOf(second.body)])
  }
  return latest
}

const readTagNames = (stdout) =>
  stdout
    .split('\n')
    .map((line) => line.split('\t')[1] ?? '')
    .map((ref) => ref.replace(/^refs\/tags\//, ''))
    .filter(Boolean)

// --- project context --------------------------------------------------------

// Returns the installed extension version, null when a manifest exists but its
// version cannot be read, and undefined when no manifest is found (in which case
// the extension is not part of this check at all).
const findExtensionVersion = async (startDir) => {
  let current = resolve(startDir)
  for (let depth = 0; depth <= MAX_PROJECT_WALK; depth += 1) {
    const manifest = join(current, '.specify', 'extensions', 'taco', 'extension.yml')
    const info = await lstat(manifest).catch(() => null)
    if (info && !info.isSymbolicLink() && info.isFile()) {
      const raw = await readFile(manifest, 'utf8').catch(() => '')
      const value = raw.match(/^\s{2}version:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1] ?? null
      return value && SEMVER.test(value) ? value : null
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

// --- cache ------------------------------------------------------------------

const cacheFile = (options) => join(options.cacheDir, 'update-check.json')

const readCache = async (options, needsExtension) => {
  if (!options.cache || options.ttlSeconds === 0) return null
  const raw = await readFile(cacheFile(options), 'utf8').catch(() => null)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.schema !== CACHE_SCHEMA || typeof parsed.checkedAt !== 'string') return null
    if (!parsed.latest || typeof parsed.latest !== 'object') return null
    const age = (Date.now() - Date.parse(parsed.checkedAt)) / 1000
    if (!Number.isFinite(age) || age < 0 || age > options.ttlSeconds) return null
    if (needsExtension && parsed.extensionProbed !== true) return null
    return { source: parsed.source ?? null, latest: parsed.latest }
  } catch {
    return null
  }
}

const writeCache = async (options, snapshot) => {
  if (!options.cache || options.ttlSeconds === 0) return
  try {
    await mkdir(options.cacheDir, { recursive: true })
    const temporary = `${cacheFile(options)}.tmp-${process.pid}`
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, cacheFile(options))
  } catch {
    // The cache is an optimization; a failure must not change the answer.
  }
}

// --- output -----------------------------------------------------------------

const summary = (payload) => {
  if (!payload.ok) return `Taco update check: skipped (${payload.reason ?? 'unknown'})`
  const parts = []
  for (const [name, part] of [
    ['skill', payload.skill],
    ['cli', payload.cli],
    ['extension', payload.extension],
  ]) {
    if (!part) continue
    if (part.updateAvailable === true) parts.push(`${name} ${part.installed} -> ${part.latest} (update available)`)
    else if (part.updateAvailable === false) parts.push(`${name} ${part.installed} (up to date)`)
    else if (part.installed) parts.push(`${name} ${part.installed} (comparison unavailable)`)
  }
  const suffix = payload.cached ? ' [cached]' : ''
  return parts.length === 0 ? 'Taco update check: up to date' : `Taco update check: ${parts.join('; ')}${suffix}`
}

const emit = (options, payload) => {
  if (options.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  else process.stdout.write(`${summary(payload)}\n`)
}

const blocked = (reason, extra = {}) => ({
  schema: 'taco-update-check/1',
  checkedAt: new Date().toISOString(),
  ok: false,
  reason,
  source: null,
  skill: { installed: null, latest: null, updateAvailable: null },
  cli: null,
  extension: null,
  cached: false,
  ...extra,
})

// --- main -------------------------------------------------------------------

const main = async () => {
  const options = parseOptions(process.argv.slice(2), process.env)

  if (process.env.TACO_UPDATE_CHECK === 'off') {
    emit(options, blocked('disabled'))
    return
  }

  const marker = await readVersionMarker(VERSION_FILE).catch(() => ({ value: null, reason: 'installed-version-unreadable' }))
  if (marker.value === null) {
    emit(options, blocked(marker.reason))
    return
  }
  const skillUnknown = { skill: { installed: marker.value, latest: null, updateAvailable: null } }

  // The extension belongs to the default repository's release assets, so an
  // overridden `--repo` (mirror or test fixture) skips it rather than answering
  // about the wrong repository.
  const extensionInstalled = options.repoOverridden ? undefined : await findExtensionVersion(process.cwd()).catch(() => undefined)
  const needsExtension = extensionInstalled !== undefined

  let snapshot
  let cachedUsed = false
  const cached = await readCache(options, needsExtension)
  if (cached) {
    snapshot = cached
    cachedUsed = true
  } else {
    snapshot = await probeRemote(options, needsExtension, skillUnknown)
    if (snapshot === null) return
  }

  const cliPath = options.cli ? await resolveCliBin(options).catch(() => null) : null
  const cliInstalled = cliPath ? await readCliVersion(cliPath, options.timeoutMs).catch(() => null) : null

  emit(options, {
    schema: 'taco-update-check/1',
    checkedAt: new Date().toISOString(),
    ok: true,
    reason: null,
    source: snapshot.source,
    skill: component(marker.value, snapshot.latest.skill),
    cli: cliPath ? component(cliInstalled, snapshot.latest.cli) : null,
    extension: needsExtension ? component(extensionInstalled, snapshot.latest.extension) : null,
    cached: cachedUsed,
  })
}

const probeRemote = async (options, needsExtension, skillUnknown) => {
  let source = 'git-ls-remote'
  let latest = null

  const git = await readTagsWithGit(options.repo, options.timeoutMs)
  if (!git.failed) {
    latest = latestFromTags(readTagNames(git.stdout))
  } else if (!options.repoOverridden) {
    try {
      latest = await latestFromApi(options.apiBase, options.timeoutMs)
      source = 'github-tags-api'
    } catch (error) {
      emit(options, blocked(error instanceof HttpFailure ? error.reason : 'network-unavailable', skillUnknown))
      return null
    }
  } else {
    emit(options, blocked(git.reason, skillUnknown))
    return null
  }

  let extensionLatest = null
  if (needsExtension) {
    try {
      const releases = await getJson(`${options.apiBase}${REPO_PATH}/releases?per_page=100`, options.timeoutMs, RELEASES_RESPONSE_LIMIT)
      extensionLatest = latestInstallableExtension(releases.body)
    } catch {
      // A failed extension lookup only removes that component from the answer.
      extensionLatest = null
    }
  }

  const snapshot = {
    schema: CACHE_SCHEMA,
    checkedAt: new Date().toISOString(),
    source,
    latest: { skill: latest.skill, cli: latest.cli, extension: extensionLatest },
    extensionProbed: needsExtension,
  }
  await writeCache(options, snapshot)
  return snapshot
}

try {
  await main()
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n${USAGE}\n`)
    process.exitCode = 2
  } else {
    emit({ json: process.argv.includes('--json') }, blocked('internal-error'))
  }
}
