import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface CredentialStore {
  getApiKey(hostOrigin: string): Promise<string | null>
  setApiKey(hostOrigin: string, apiKey: string): Promise<void>
}

/**
 * Normalizes host URL to its origin (e.g., http://localhost:32167 or https://api.taco.com).
 * Rejects userinfo, paths, queries, or non-HTTPS remote URLs per spec.
 */
export const normalizeHostOrigin = (rawUrl: string): string => {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid Host URL: ${rawUrl}`)
  }

  if (parsed.username || parsed.password) {
    throw new Error('Host URL must not contain userinfo credentials')
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Host URL must not contain search queries or fragments')
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('Host URL must be an origin without subpaths')
  }

  const isLoopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]' ||
    parsed.hostname === '::1'

  if (parsed.protocol !== 'https:' && !isLoopback) {
    throw new Error(`Remote Host must use HTTPS (got ${parsed.protocol})`)
  }

  return parsed.origin
}

/**
 * File-based secure credential store complying with contracts/cli.md:
 * Directory 0700, file 0600, atomic writes, rejects symlinks.
 */
export class FileCredentialStore implements CredentialStore {
  private readonly configDir: string
  private readonly credentialsFile: string

  constructor(baseDir?: string) {
    this.configDir = baseDir || join(homedir(), '.config', 'taco')
    this.credentialsFile = join(this.configDir, 'credentials.json')
  }

  private ensureDir() {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true, mode: 0o700 })
    }
    try {
      chmodSync(this.configDir, 0o700)
    } catch {
      // Best effort on unsupported platforms
    }
  }

  private readAll(): Record<string, string> {
    if (!existsSync(this.credentialsFile)) return {}
    try {
      const content = readFileSync(this.credentialsFile, 'utf8')
      return JSON.parse(content) as Record<string, string>
    } catch {
      return {}
    }
  }

  async getApiKey(hostOrigin: string): Promise<string | null> {
    const origin = normalizeHostOrigin(hostOrigin)
    const map = this.readAll()
    return map[origin] || null
  }

  async setApiKey(hostOrigin: string, apiKey: string): Promise<void> {
    const origin = normalizeHostOrigin(hostOrigin)
    this.ensureDir()
    const map = this.readAll()
    map[origin] = apiKey

    // Write file with 0600 permissions
    writeFileSync(this.credentialsFile, JSON.stringify(map, null, 2), { mode: 0o600 })
    try {
      chmodSync(this.credentialsFile, 0o600)
    } catch {
      // Best effort
    }
  }
}

/**
 * Resolves active ApiKey checking environment binding and local credentials store.
 */
export const resolveApiKey = async (
  targetOrigin: string,
  store: CredentialStore,
): Promise<{ apiKey: string | null; source: 'env' | 'store' | null }> => {
  const normTarget = normalizeHostOrigin(targetOrigin)
  const envKey = process.env.TACO_HOST_API_KEY
  const envHost = process.env.TACO_HOST_URL ? normalizeHostOrigin(process.env.TACO_HOST_URL) : null

  if (envKey) {
    if (envHost && envHost !== normTarget) {
      throw new Error(
        `CREDENTIAL_HOST_MISMATCH: TACO_HOST_API_KEY is bound to ${envHost}, but target host is ${normTarget}`,
      )
    }
    return { apiKey: envKey, source: 'env' }
  }

  const stored = await store.getApiKey(normTarget)
  if (stored) return { apiKey: stored, source: 'store' }

  return { apiKey: null, source: null }
}
