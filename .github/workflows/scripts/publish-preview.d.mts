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
}

export interface UpdatePrDescriptionInput {
  repo: string
  prNumber: string | number
  headSha: string
  assetCommitSha: string
  currentBody: string
  runId?: string | null
}

export interface PublisherResult {
  success?: true
  skipped?: boolean
  reason?: string
  assetCommitSha?: string
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
export declare const uploadAssetsAndCommit: (input: UploadAssetsInput) => Promise<string>
export declare const updatePrDescription: (input: UpdatePrDescriptionInput) => Promise<void>
export declare const runPublisher: () => Promise<PublisherResult>
