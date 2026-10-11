export interface CollectedOutline {
  view: string
  title: string
  url: string
  filePath?: string
  outline: string
  interactiveElements: any[]
}

export declare function collectOutlines(options?: {
  tacoFile?: string
  hostUrl?: string
  outPath?: string
  playwrightModule?: string
  timeout?: number
}): Promise<CollectedOutline[]>
