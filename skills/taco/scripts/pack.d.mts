export interface TacoFile {
  id?: string
  path: string
  mediaType: string
  content: string
  title?: string
  sourceHash?: string
  blocks?: unknown[]
}

export interface TacoCommentThread {
  id: string
  anchor: {
    path: string
    position?: { start: number; end: number }
    quote?: { exact: string; prefix?: string; suffix?: string }
  }
  status: 'open' | 'resolved'
  messages: Array<{
    id: string
    author: string
    body: string
    createdAt: string
  }>
}

export interface TacoCheckpoints {
  version: number
  nodes: Array<{
    id: string
    title: string
    after?: string[]
    documents?: Array<{ path: string }>
  }>
  documents?: unknown[]
}

export interface TacoNavigationManifest {
  version: 1
  entry?: string
  groups: Array<{
    id: string
    title: string
    paths: string[]
  }>
}

export interface TacoBundle {
  format: 'taco/files'
  version: number
  docId: string
  title: string
  root: string
  files: TacoFile[]
  comments?: TacoCommentThread[]
  checkpoints?: TacoCheckpoints
  navigation?: TacoNavigationManifest
  packOptions?: {
    ignore?: string[]
  }
  [key: string]: unknown
}

export interface PackDirectoryOptions {
  dir: string
  out?: string
  shell?: string
  title?: string
  root?: string
  entry?: string
  group?: string[]
  ignore?: string[]
  dryRun?: boolean
  lite?: boolean
  customShellHtml?: string
}

export interface PackResult {
  outputPath: string
  bundle: TacoBundle
  structure: {
    warnings: string[]
    [key: string]: unknown
  }
  shell: string
  lines: string[]
  skipped: Array<{ path: string; reason: string }>
  warnings: string[]
}

export interface VerifyResult {
  path: string
  html: string
  bundle: TacoBundle
  structure: {
    warnings: string[]
    [key: string]: unknown
  }
  lines: string[]
}

export const FORMAT: 'taco/files'
export const FORMAT_VERSION: number
export const KNOWN_BUNDLE_FIELDS: Set<string>

export function packDirectory(options: PackDirectoryOptions): Promise<PackResult>
export function verifyTaco(pathOrHtml: string): Promise<VerifyResult>
export function verify(path: string): Promise<VerifyResult>
export function pack(parsed: unknown): Promise<PackResult>
export function readBundleFromHtml(path: string): Promise<{ html: string; bundle: TacoBundle }>
export function readBundleFrom(html: string, label: string): Promise<{ html: string; bundle: TacoBundle }>
export function embedBundle(shell: string, bundle: TacoBundle): string
export function atomicWrite(path: string, text: string): Promise<void>
export function validateBundle(raw: unknown): TacoBundle
export function structureOf(bundle: TacoBundle): { warnings: string[]; [key: string]: unknown }
export function shellVariantOf(html: string): string
export function securityVersionOf(html: string): string | null
export function isSafePath(value: unknown): boolean
export function isSafeRootPath(value: unknown): boolean
export function mediaTypeOf(path: string): string
export function portableTitleBase(value: string): string
export function tacoFileBase(path: string): string
export function directoryGroups(files: TacoFile[], root: string): Array<{ id: string; title: string; paths: string[] }>
export function collectFiles(featureDir: string, rootPath: string, existingByPath: Map<string, TacoFile>, ignorePatterns: string[]): Promise<{ files: TacoFile[]; skipped: Array<{ path: string; reason: string }> }>
export function sha256Hex(bytes: Uint8Array | string): Promise<string>
export function isCommentThread(value: unknown): boolean
export function isCommentMessage(value: unknown): boolean
