import type { PreviewManifest } from './plan-schema.d.mts'

export interface ExecutePlanOptions {
  planFile?: string
  tacoFile?: string
  hostUrl?: string
  outDir?: string
  playwrightModule?: string
  timeout?: number
}

export declare function executePlan(options?: ExecutePlanOptions): Promise<PreviewManifest>
