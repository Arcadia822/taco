/**
 * Types for `view-registry.mjs`. The pipeline scripts stay plain JavaScript so the
 * workflow can run them with no build step, and this hand-written declaration keeps
 * TypeScript consumers typed (the same pattern as `extensions/taco/bin/png.d.mts`).
 */

export interface FixedView {
  id: string
  filename: string
  title: string
  /** Which surface the view renders: the standalone bundle or the host app. */
  target: 'taco' | 'host'
  viewport: {
    width: number
    height: number
    /** Present only for the narrow, touch-emulated views. */
    isMobile?: boolean
    hasTouch?: boolean
  }
}

export declare const FIXED_VIEWS: readonly FixedView[]
export declare const getViewByFilename: (filename: string) => FixedView | null
/** The path a captured view takes on the assets branch; the publisher writes it. */
export declare const previewAssetPath: (
  view: FixedView,
  prNumber: string | number,
  headSha: string,
) => string
