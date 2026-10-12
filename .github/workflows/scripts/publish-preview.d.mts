export interface HeadCheck {
  canPublish: boolean
  /** Present only when publication may proceed. */
  body?: string
  /** Present only when publication is skipped. */
  reason?: string
}

export interface UploadAssetsInput {
  repo: string
  prNumber: string | number
  headSha: string
  artifactsDir: string
  maxAttempts?: number
  /** Sanitized manifest the record job uploaded; drives which blobs are written. */
  manifest?: unknown
}

export interface UpdatePrDescriptionInput {
  repo: string
  prNumber: string | number
  headSha: string
  assetCommitSha: string | null
  currentBody: string
  runId?: string | null
  manifest?: unknown
  plan?: unknown
}

export interface PublisherResult {
  success?: true
  skipped?: boolean
  reason?: string
  /** Null when the revision has no screenshots to publish. */
  assetCommitSha?: string | null
  /** Assets commit, reported when the head moved after the upload succeeded. */
  assets?: string
}

export declare class GitHubApiError extends Error {
  readonly status: number
  constructor(message: string, status: number)
}

export declare const checkLivePrHeadSha: (
  repo: string,
  prNumber: string | number,
  expectedHeadSha: string,
) => Promise<HeadCheck>
export declare const ensureAssetsBranch: (repo: string) => Promise<string>
export declare const uploadAssetsAndCommit: (input: UploadAssetsInput) => Promise<string | null>
export declare const updatePrDescription: (input: UpdatePrDescriptionInput) => Promise<void>
export declare const runPublisher: () => Promise<PublisherResult>
