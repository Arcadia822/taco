export interface PreviewDecision {
  run_preview: boolean
  label_triggered: boolean
  paths_triggered: boolean
  matched_count: number
  matched_paths: string[]
}

export declare const shouldTriggerFromPaths: (
  paths: readonly string[] | null | undefined,
) => boolean
export declare const shouldTriggerFromLabels: (
  labels: readonly string[] | string | null | undefined,
) => boolean
export declare const evaluatePreviewDecision: (input: {
  paths?: readonly string[]
  labels?: readonly string[]
}) => PreviewDecision
