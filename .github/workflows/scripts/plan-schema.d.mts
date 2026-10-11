export type DesktopViewport = {
  readonly width: 1280
  readonly height: 800
}

export type MermaidInteractiveKind =
  'flowchart-node' | 'sequence-actor' | 'sequence-note' | 'diagram-root'

export interface DomOutlineElement {
  tag: string
  id?: string
  classes?: string[]
  attributes?: Record<string, string>
  text?: string
  aria?: string
  interactive?: boolean
  mermaidKind?: MermaidInteractiveKind
  mermaidNodeId?: string
  mermaidNodeLabel?: string
  belowFold?: boolean
}

export interface DomOutlinePayload {
  readonly view: 'taco' | 'host'
  readonly title: string
  readonly url: string
  readonly outline: string
  readonly interactiveElements: Array<{
    selector: string
    description: string
    kind: string
    nodeId?: string
  }>
}

export type PreviewStepAction = 'click' | 'hover' | 'shot' | 'wait' | 'scroll' | 'open-file'

export interface PreviewStep {
  do: PreviewStepAction
  target?: string
  text?: string
  to?: string
  path?: string
  ms?: number
  name?: string
  caption?: string
}

export interface PreviewScene {
  id: string
  title: string
  target: 'taco' | 'host'
  steps: PreviewStep[]
}

export interface PreviewPlan {
  version: 1
  source: 'deepseek-planner' | 'human-fixture'
  model?: string
  ui_change: boolean
  summary: string
  mismatch?: string
  unseen?: string
  scenes: PreviewScene[]
}

export interface StepExecutionResult {
  stepIndex: number
  action: PreviewStepAction
  status: 'passed' | 'failed'
  error?: string
  target?: string
  durationMs: number
}

export interface SceneExecutionResult {
  id: string
  title: string
  status: 'passed' | 'failed'
  error?: string
  steps: StepExecutionResult[]
  screenshots: Array<{
    filename: string
    name: string
    caption: string
    status: 'passed' | 'failed'
  }>
}

export interface PreviewManifest {
  version: 1
  planSource: 'deepseek-planner' | 'human-fixture'
  plannerModel?: string
  status: 'passed' | 'failed' | 'unavailable'
  summary: string
  mismatch?: string
  unseen?: string
  trustLevel?: 'verified' | 'untrusted-recorded'
  scenes: SceneExecutionResult[]
  errors: string[]
  executedAt: string
}

export declare const DESKTOP_VIEWPORT: DesktopViewport
export declare const MAX_SCENES: number
export declare const MAX_STEPS_PER_SCENE: number
export declare const MAX_SHOT_NAME_LENGTH: number
export declare const VALID_SHOT_NAME: RegExp
export declare const FORBIDDEN_TEXT_OR_TARGET: RegExp

export declare class PlanValidationError extends Error {
  constructor(message: string)
}

export declare function validatePreviewPlan(plan: unknown): PreviewPlan
