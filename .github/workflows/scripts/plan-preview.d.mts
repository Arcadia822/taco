import type { PreviewPlan } from './plan-schema.d.mts'

export interface PlannerConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export declare function resolvePlannerConfig(env?: NodeJS.ProcessEnv): PlannerConfig

export declare function requestPlannerPlan(
  messages: ChatMessage[],
  config: PlannerConfig,
): Promise<Record<string, unknown>>

export declare function generateDynamicPreviewPlan(options?: {
  diffFile?: string
  outlinesFile?: string
  outPlanFile?: string
  apiKey?: string
  baseUrl?: string
  model?: string
  timeout?: number
}): Promise<PreviewPlan>
