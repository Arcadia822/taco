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

  async getEvents(tacoId: string, options?: { after?: string }): Promise<unknown> {
    const url = `${this.hostUrl}/v1/tacos/${tacoId}/events${options?.after ? `?after=${options.after}` : ''}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Fetch events failed: ${res.status}`)
    return res.json()
  }
}
