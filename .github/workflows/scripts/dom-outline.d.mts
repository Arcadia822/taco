export interface DomOutlineResult {
  outline: string
  interactiveElements: Array<{
    selector: string
    description: string
    kind: string
    nodeId?: string
  }>
}

export declare function extractDomOutline(): DomOutlineResult
