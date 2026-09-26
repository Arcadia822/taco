import type { TacoBundle, TacoFile } from './model.ts'
import type { MermaidRuntime } from './mermaid.ts'
import type { TacoCodeBlockCommentTarget } from './mermaid-split-view.ts'

export interface RichEditorMountOptions {
  element: HTMLElement
  file: TacoFile
  bundle: TacoBundle
  readOnly: boolean
  labels: {
    markdownEditor: string
    source?: string
    hidePreview?: string
    [key: string]: string | undefined
  }
  mermaidRuntime?: MermaidRuntime
  onUpdate: (content: string, blocks?: TacoFile['blocks']) => void
  onCodeBlockComment?: (target: TacoCodeBlockCommentTarget) => void
  onLinkClick?: (event: MouseEvent) => void
  onSelectionChange?: () => void
  onRefreshHighlights?: (host: HTMLElement) => void
  onOutlinePaint?: () => void
  scrollToHeading?: (headingHash: string) => void
}

export interface RichEditorHandle {
  readonly element: HTMLElement
  readonly rawEditor?: unknown
  destroy(): void
  setTitle(title: string): boolean
}

export interface RichEditorAdapter {
  migrateBundleBlocks(bundle: TacoBundle, labels?: Record<string, string | undefined>): Array<{ path: string; message: string }>
  mount(options: RichEditorMountOptions): RichEditorHandle
}

let defaultRichEditorAdapter: RichEditorAdapter | undefined

export const setDefaultRichEditorAdapter = (adapter: RichEditorAdapter | undefined): void => {
  defaultRichEditorAdapter = adapter
}

export const getDefaultRichEditorAdapter = (): RichEditorAdapter | undefined => defaultRichEditorAdapter
