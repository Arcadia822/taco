export interface MarkerRange {
  hasBlock: boolean
  /** Byte offsets into the body, or -1 when no block is present. */
  startIndex: number
  endIndex: number
}

export interface PreviewBlockInput {
  /** Full 40-character head commit recorded during capture. */
  headSha: string
  prNumber: string | number
  repo: string
  /** Assets-branch commit that holds the published PNGs. */
  assetCommitSha: string
  runId?: string | null
  /** ISO timestamp; injected so tests can pin the rendered output. */
  timestamp?: string | null
}

export declare const MARKER_START: string
export declare const MARKER_END: string

export declare class PrBodyMarkerError extends Error {}

export declare const validateMarkers: (body: string | null | undefined) => MarkerRange
export declare const updatePrBodyWithBlock: (
  currentBody: string | null | undefined,
  blockContent: string,
) => string
export declare const generatePreviewBlockMarkdown: (input: PreviewBlockInput) => string
