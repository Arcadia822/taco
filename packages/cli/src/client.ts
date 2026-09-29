import {
  canonicalizeJson,
  computeSnapshotContentHash,
  projectLocalBundleToUploadContent,
  validateStagedUploadContent,
} from '@taco/protocol'
import { extractTacoBundleFromHtml } from './dry-run.ts'

export interface PublishResult {
  command: 'publish'
  host: string
  id: string
  tacoId: string
  title: string
  contentHash: string
  url: string
  createdAt: string
}

export class TacoClient {
  constructor(private readonly hostUrl: string) {}

  /**
   * Pure Pastebin publish:
   * 1. Extracts pure bundle data from local .taco.html
   * 2. Projects it into clean StagedUploadContent (stripping secrets, ensuring pure data)
   * 3. Sends directly to POST /v1/tacos without any User/ApiKey/Login requirements
   * 4. Returns public Taco URL
   */
  async publish(options: { rawHtml: string }): Promise<PublishResult> {
    const rawBundle = extractTacoBundleFromHtml(options.rawHtml)
    const projected = projectLocalBundleToUploadContent(rawBundle)
    if (!projected.ok) {
      throw new Error(`Local projection failed: ${projected.err}`)
    }

    const validated = validateStagedUploadContent(projected.content)
    if (!validated.ok) {
      throw new Error(`Protocol validation failed: ${validated.err}`)
    }

    const payload = validated.payload
    const res = await fetch(`${this.hostUrl}/v1/tacos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      throw new Error(`Publish failed (HTTP ${res.status}): ${await res.text()}`)
    }

    return (await res.json()) as PublishResult
  }

  async getEvents(tacoId: string, options?: { after?: string; through?: string; limit?: number }): Promise<unknown> {
    const params = new URLSearchParams()
    if (options?.after !== undefined) params.set('after', options.after)
    if (options?.through !== undefined) params.set('through', options.through)
    if (options?.limit !== undefined) params.set('limit', String(options.limit))
    const query = params.size ? `?${params}` : ''
    const res = await fetch(`${this.hostUrl}/v1/tacos/${tacoId}/events${query}`)
    if (!res.ok) {
      let errorBody:
        | { error?: { code?: string; message?: string; details?: Record<string, unknown> } }
        | undefined
      try {
        errorBody = (await res.json()) as {
          error?: { code?: string; message?: string; details?: Record<string, unknown> }
        }
      } catch {}
      const msg = errorBody?.error?.message || `Fetch events failed: ${res.status}`
      const code =
        errorBody?.error?.code || (res.status === 410 ? 'CURSOR_EXPIRED' : 'LOCAL_IO_ERROR')
      const err = new Error(msg) as Error & {
        statusCode?: number
        code?: string
        errorDetails?: unknown
      }
      err.statusCode = res.status
      err.code = code
      err.errorDetails = errorBody
      throw err
    }
    return res.json()
  }

  async getHandoff(tacoId: string, handoffId: string): Promise<unknown> {
    const url = `${this.hostUrl}/v1/tacos/${tacoId}/handoffs/${handoffId}`
    const res = await fetch(url)
    if (!res.ok) {
      let errorBody:
        | { error?: { code?: string; message?: string; details?: Record<string, unknown> } }
        | undefined
      try {
        errorBody = (await res.json()) as {
          error?: { code?: string; message?: string; details?: Record<string, unknown> }
        }
      } catch {}
      const msg = errorBody?.error?.message || `Fetch handoff failed: ${res.status}`
      const code =
        errorBody?.error?.code ||
        (res.status === 410 ? 'CURSOR_EXPIRED' : res.status === 404 ? 'NOT_FOUND' : 'LOCAL_IO_ERROR')
      const err = new Error(msg) as Error & {
        statusCode?: number
        code?: string
        errorDetails?: unknown
      }
      err.statusCode = res.status
      err.code = code
      err.errorDetails = errorBody
      throw err
    }
    return res.json()
  }
}
