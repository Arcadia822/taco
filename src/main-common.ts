import { resolveCheckpoints, type DocumentStatus, type ResolvedCheckpoints } from '@taco/protocol'
import './styles.css'
import { capturePristine, canWriteInPlace, openedFileName, saveFile, titleForFileName, type SaveResult } from './kernel/save.ts'
import { configureApp } from './kernel/app.ts'
import { FileBrowser, type FileBrowserOptions } from './file-browser.ts'
import type { HostedHandoffOutcome } from './hosted-session.ts'
import { fileByPath, fileKind, isInternalFile, isMediaFileKind, parseBundle, relativePath, type TacoBundle, type TacoFile } from './model.ts'
import { credentialFreeFile, TACO_SECURITY_VERSION } from './security.ts'
import { validateDocument, type DocumentValidation } from './validation.ts'

export interface LoadBundleResult {
  ok: boolean
  error?: string
  files?: number
  undoable?: boolean
}

export interface TacoFileApi {
  readonly format: 'taco/files'
  readonly version: string
  readonly securityVersion: string
  validate(): DocumentValidation
  loadBundle(source: string | Record<string, unknown>): LoadBundleResult
  undoLoad(): boolean
  canSave(): boolean
  save(): Promise<SaveResult>
  listFiles(): Array<{ path: string; mediaType: string; bytes: number }>
  readFile(path: string): TacoFile | null
  search(query: string): TacoFile[]
  getCheckpoints(): ResolvedCheckpoints
  getReviewHandoff(): {
    title: string
    root: string
    originPath: string | null
    changedFiles: Array<{ path: string; mediaType: string; content: string; diff?: string }>
    checkpointChanges: Array<{ path: string; from: DocumentStatus; to: DocumentStatus }>
    checkpointTemplateChange: { from: string | null; to: string | null } | null
    checkpointDocumentAdditions: Array<{ checkpointId: string; path: string }>
    comments: NonNullable<TacoBundle['comments']>
  }
  fileHash?: (content: string, mediaType?: string) => string
  /**
   * Same-origin Host review capability, present only when the serving page declared one. Bundles can
   * never set it, and it never addresses another origin.
   */
  hosted?: () => { tacoId: string; apiBase: string } | null
  /** Handoff through the Host. Only a Host page gets this; offline copies keep the copy action. */
  handoff?: () => Promise<HostedHandoffOutcome>
}


export const dismissSplash = (): void => {
  const splash = document.getElementById('taco-splash')
  if (!splash) return
  const remove = (): void => splash.remove()
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    remove()
    return
  }
  splash.classList.add('is-leaving')
  splash.addEventListener('transitionend', remove, { once: true })
  window.setTimeout(remove, 260)
}

export const dismissSplashAfterPaint = (): void => {
  requestAnimationFrame(() => requestAnimationFrame(dismissSplash))
}

export function bootCommon(bundle: TacoBundle, options: FileBrowserOptions = {}, initialReady?: Promise<unknown>): FileBrowser {
  configureApp({ appId: 'taco', appName: 'Taco' })
  capturePristine()
  const openedName = openedFileName()
  if (openedName) bundle.title = titleForFileName(bundle.title, openedName)
  const root = document.getElementById('app')
  if (!root) throw new Error('Taco root element is missing')

  let current: { bundle: TacoBundle; browser: FileBrowser } | null = null
  let replaced: string | null = null

  function expose(): void {
    const live = current
    if (!live) return
    const { bundle: doc, browser } = live
    window.taco = {
      format: 'taco/files',
      version: __APP_VERSION__,
      securityVersion: TACO_SECURITY_VERSION,
      validate: () => validateDocument(doc, browser.getRenderErrors()),
      loadBundle: (source) => {
        let json: string
        try {
          json = typeof source === 'string' ? source : JSON.stringify(source)
        } catch (error) {
          return { ok: false, error: `not serializable: ${(error as Error).message}` }
        }
        let raw: Record<string, unknown> | null = null
        try {
          const value = JSON.parse(json) as unknown
          if (value && typeof value === 'object' && !Array.isArray(value)) raw = value as Record<string, unknown>
        } catch {
          // parseBundle reports the JSON error below.
        }
        const parsed = parseBundle(json)
        if (!parsed.ok) return { ok: false, error: parsed.err === 'empty' ? 'empty' : `${parsed.err}: ${parsed.detail}` }
        // parseBundle silently drops a malformed `navigation`. Loading is a write-back, so a
        // document that loses its grouping must be rejected rather than replacing the open review.
        if (raw?.navigation !== undefined && parsed.bundle.navigation === undefined) {
          return { ok: false, error: 'navigation is not a v1 manifest with groups[].{id,title,paths}' }
        }
        replaced = JSON.stringify(current!.bundle)
        mount(parsed.bundle)
        return { ok: true, files: parsed.bundle.files.length, undoable: true }
      },
      undoLoad: () => {
        if (replaced === null) return false
        const restored = parseBundle(replaced)
        if (!restored.ok) return false
        replaced = null
        mount(restored.bundle)
        return true
      },
      canSave: () => canWriteInPlace(),
      save: () => saveFile(current!.bundle),
      listFiles: () => doc.files
        .filter((file) => !isInternalFile(file.path))
        .map((file) => ({
          path: relativePath(doc, file),
          mediaType: file.mediaType,
          bytes: new TextEncoder().encode(file.content).length,
        })),
      readFile: (path) => {
        const fullPath = path.startsWith(`${doc.root}/`) ? path : `${doc.root}/${path}`
        const file = fileByPath(doc, fullPath)
        return file ? credentialFreeFile(file) : null
      },
      search: (query) => {
        const needle = query.trim().toLocaleLowerCase()
        if (!needle) return []
        return doc.files
          .filter((file) => !isInternalFile(file.path)
            && (file.path.toLocaleLowerCase().includes(needle)
            || (!isMediaFileKind(fileKind(file)) && file.content.toLocaleLowerCase().includes(needle))))
          .map(credentialFreeFile)
      },
      getCheckpoints: () => resolveCheckpoints(doc),
      getReviewHandoff: () => {
        const changedFiles = browser.getModifiedReviewFiles()
        return {
          title: doc.title,
          root: doc.root,
          originPath: new URLSearchParams(location.search).get('origin_path') || null,
          changedFiles,
          checkpointChanges: browser.getCheckpointChanges(),
          checkpointTemplateChange: browser.getCheckpointTemplateChange(),
          checkpointDocumentAdditions: browser.getCheckpointDocumentAdditions(),
          comments: doc.comments ?? [],
        }
      },
      hosted: () => browser.hostedInfo(),
      handoff: () => browser.handoffViaHost(),
    }
  }

  function mount(next: TacoBundle): FileBrowser {
    current?.browser.destroy()
    document.title = `${next.title} — Taco`
    const browser = new FileBrowser(root!, next, options)
    current = { bundle: next, browser }
    expose()
    return browser
  }

  const browser = mount(bundle)
  const ready = initialReady
    ? Promise.allSettled([initialReady, browser.initialPreviewReady])
    : browser.initialPreviewReady
  void ready.then(dismissSplashAfterPaint)
  return browser
}

export function recoveryGate(raw: string | null, reason: string): void {
  const root = document.getElementById('app')
  if (!root) return
  root.innerHTML = ''
  const gate = document.createElement('main')
  gate.id = 'taco-main'
  gate.className = 'recovery-gate'
  const eyebrow = document.createElement('div')
  eyebrow.className = 'eyebrow'
  eyebrow.textContent = 'Recovery mode'
  const title = document.createElement('h1')
  title.textContent = 'Taco could not open this file bundle.'
  const detail = document.createElement('p')
  detail.textContent = reason
  const policy = document.createElement('p')
  policy.textContent = 'The embedded files were not interpreted or modified.'
  const pre = document.createElement('pre')
  pre.textContent = raw ?? '(bundle block is empty)'
  gate.append(eyebrow, title, detail, policy, pre)
  root.append(gate)
  dismissSplashAfterPaint()
}
