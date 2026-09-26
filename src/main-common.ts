import { resolveCheckpoints, type DocumentStatus, type ResolvedCheckpoints } from '@taco/protocol'
import './styles.css'
import { capturePristine, openedFileName, titleForFileName } from './kernel/save.ts'
import { configureApp } from './kernel/app.ts'
import { FileBrowser, type FileBrowserOptions } from './file-browser.ts'
import { fileByPath, isInternalFile, relativePath, type TacoBundle, type TacoFile } from './model.ts'
import { credentialFreeFile, TACO_SECURITY_VERSION, validateTacoSecurity, type SecurityValidation } from './security.ts'

export interface TacoFileApi {
  readonly format: 'taco/files'
  readonly version: string
  readonly securityVersion: string
  validate(): SecurityValidation
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
  document.title = `${bundle.title} — Taco`
  const root = document.getElementById('app')
  if (!root) throw new Error('Taco root element is missing')
  const browser = new FileBrowser(root, bundle, options)
  const ready = initialReady
    ? Promise.allSettled([initialReady, browser.initialPreviewReady])
    : browser.initialPreviewReady
  void ready.then(dismissSplashAfterPaint)

  window.taco = {
    format: 'taco/files',
    version: __APP_VERSION__,
    securityVersion: TACO_SECURITY_VERSION,
    validate: () => validateTacoSecurity(bundle),
    listFiles: () => bundle.files
      .filter((file) => !isInternalFile(file.path))
      .map((file) => ({
        path: relativePath(bundle, file),
        mediaType: file.mediaType,
        bytes: new TextEncoder().encode(file.content).length,
      })),
    readFile: (path) => {
      const fullPath = path.startsWith(`${bundle.root}/`) ? path : `${bundle.root}/${path}`
      const file = fileByPath(bundle, fullPath)
      return file ? credentialFreeFile(file) : null
    },
    search: (query) => {
      const needle = query.trim().toLocaleLowerCase()
      if (!needle) return []
      return bundle.files
        .filter((file) => !isInternalFile(file.path)
          && (file.path.toLocaleLowerCase().includes(needle)
          || (file.mediaType !== 'image/png' && file.content.toLocaleLowerCase().includes(needle))))
        .map(credentialFreeFile)
    },
    getCheckpoints: () => resolveCheckpoints(bundle),
    getReviewHandoff: () => {
      const changedFiles = browser.getModifiedReviewFiles()
      return {
        title: bundle.title,
        root: bundle.root,
        originPath: new URLSearchParams(location.search).get('origin_path') || null,
        changedFiles,
        checkpointChanges: browser.getCheckpointChanges(),
        checkpointTemplateChange: browser.getCheckpointTemplateChange(),
        checkpointDocumentAdditions: browser.getCheckpointDocumentAdditions(),
        comments: bundle.comments ?? [],
      }
    },
  }
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
