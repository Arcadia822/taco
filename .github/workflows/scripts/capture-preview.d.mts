export interface CapturedView {
  id: string
  filename: string
  viewport: {
    width: number
    height: number
    isMobile: boolean
    hasTouch: boolean
  }
}

export interface CaptureOptions {
  /** Directory that receives exactly the registered PNG filenames. */
  outDir?: string
  /** Complete `.taco.html` bundle to snapshot; required by the `taco` views. */
  tacoFile?: string | null
  /** Loopback URL of the running host server; required by the `host` views. */
  hostUrl?: string | null
  /** Trusted Playwright package directory or entry file. */
  playwrightModule?: string | null
  /** Per-view ready timeout in milliseconds. */
  timeout?: number
}

export declare const captureViews: (options?: CaptureOptions) => Promise<CapturedView[]>
