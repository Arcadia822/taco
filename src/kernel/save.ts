// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Adapted for Taco from Bento kernel/src/save.ts.

import type { KernelDoc } from './doc.ts'
import { appConfig } from './app.ts'
import { isSafePath, type TacoBundle } from '../model.ts'

const DATA_BLOCK_ID = 'taco-document'
const TRANSIENT_SELECTOR = '[data-taco-transient]'

let pristine: Document | null = null

export function capturePristine(): void {
  pristine = document.cloneNode(true) as Document
}

export function readEmbeddedDoc(): string | null {
  const block = document.getElementById(DATA_BLOCK_ID)
  const text = block?.textContent?.trim()
  return text || null
}

function serializeWith(shell: Document, doc: KernelDoc): string {
  const clone = shell.cloneNode(true) as Document
  for (const el of Array.from(clone.querySelectorAll(TRANSIENT_SELECTOR))) el.remove()

  const blocks = clone.querySelectorAll(`[id="${DATA_BLOCK_ID}"]`)
  if (blocks.length > 1) throw new Error('The Taco shell contains more than one canonical document block')
  let block = blocks.item(0)
  if (!block) {
    block = clone.createElement('script')
    block.setAttribute('type', 'application/taco+json')
    block.id = DATA_BLOCK_ID
    clone.head.appendChild(block)
  }
  const json = JSON.stringify(doc, null, 2)
  JSON.parse(json)
  block.textContent = `\n${json.replace(/</g, '\\u003c')}\n`

  const title = clone.querySelector('title')
  if (title) title.textContent = `${doc.title} — ${appConfig().appName}`

  return `<!doctype html>\n${clone.documentElement.outerHTML}`
}

export function serializeFile(doc: KernelDoc): string {
  if (!pristine) throw new Error('capturePristine() was not called at boot')
  return serializeWith(pristine, doc)
}

export function portableTitleBase(title: string): string {
  return title
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '') || 'Untitled'
}

export function suggestedFileName(doc: KernelDoc, suffix = ''): string {
  const base = portableTitleBase(doc.title)
  return `${base}${suffix ? `-${suffix}` : ''}.taco.html`
}

interface WritableLike {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}

export interface FileHandleLike {
  createWritable(): Promise<WritableLike>
  getFile?(): Promise<{ text(): Promise<string> }>
  name: string
}

export interface DirectoryHandleLike {
  getDirectoryHandle(name: string, options: { create: true }): Promise<DirectoryHandleLike>
  getFileHandle(name: string, options: { create: true }): Promise<FileHandleLike>
  name: string
}

export type SaveResult = 'saved' | 'saved-as' | 'saved-and-unpacked' | 'downloaded' | 'cancelled' | 'directory-unavailable'
export type SavePurpose = 'in-place' | 'copy'

let fileHandle: FileHandleLike | null = null

const hasFsAccess = (): boolean => typeof (window as Window & {
  showSaveFilePicker?: unknown
}).showSaveFilePicker === 'function'

const hasDirectoryAccess = (): boolean => typeof (window as Window & {
  showDirectoryPicker?: unknown
}).showDirectoryPicker === 'function'

export const canWriteInPlace = (): boolean => hasFsAccess()
export const canSaveAndUnpack = (): boolean => hasDirectoryAccess()
export const hasFileHandle = (): boolean => fileHandle !== null
export const currentFileName = (): string | null => fileHandle?.name ?? null

export function openedFileName(): string | null {
  if (fileHandle?.name) return fileHandle.name
  try {
    const base = decodeURIComponent(new URL(location.href).pathname.split('/').pop() ?? '')
    return /\.taco\.html$/i.test(base) ? base : null
  } catch {
    return null
  }
}

export const fileBase = (name: string): string =>
  name.replace(/\.taco\.html$/i, '').replace(/\.html$/i, '')

export const titleForFileName = (title: string, name: string): string => {
  const base = fileBase(name)
  return portableTitleBase(title) === base ? title : base
}

async function pickHandle(
  doc: KernelDoc,
  purpose: SavePurpose,
  suffix = '',
): Promise<FileHandleLike | null> {
  try {
    const pickerWindow = window as unknown as Window & {
      showSaveFilePicker: (options: unknown) => Promise<FileHandleLike>
    }
    const canonicalName = suggestedFileName(doc, suffix)
    const openedName = openedFileName()
    const suggestedName = purpose === 'in-place' && openedName && fileBase(openedName) === fileBase(canonicalName)
      ? openedName
      : canonicalName
    return await pickerWindow.showSaveFilePicker({
      suggestedName,
      ...(fileHandle ? { startIn: fileHandle } : {}),
      id: purpose === 'in-place' ? 'taco-document' : 'taco-copy',
      types: [{ description: appConfig().appName, accept: { 'text/html': ['.html'] } }],
    })
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') return null
    throw error
  }
}

async function writeHandle(handle: FileHandleLike, content: string, mediaType = 'text/html'): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(new Blob([content], { type: mediaType }))
  await writable.close()
  if (handle.getFile) {
    const written = await (await handle.getFile()).text()
    if (written !== content) throw new Error('The saved file did not pass write verification')
  }
}

async function directoryForPath(root: DirectoryHandleLike, parts: string[]): Promise<DirectoryHandleLike> {
  let directory = root
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true })
  return directory
}

export async function unpackBundle(directory: DirectoryHandleLike, bundle: TacoBundle): Promise<void> {
  const rootPrefix = `${bundle.root}/`
  for (const file of bundle.files) {
    if (!isSafePath(file.path) || !file.path.startsWith(rootPrefix)) {
      throw new Error(`Refusing to unpack an unsafe Taco path: ${file.path}`)
    }
    const unpackPath = file.path.slice(rootPrefix.length)
    if (!isSafePath(unpackPath)) throw new Error(`Refusing to unpack an unsafe Taco path: ${file.path}`)
    const parts = unpackPath.split('/')
    const name = parts.pop()
    if (!name) throw new Error(`Refusing to unpack an empty Taco filename: ${file.path}`)
    const parent = await directoryForPath(directory, parts)
    await writeHandle(await parent.getFileHandle(name, { create: true }), file.content, file.mediaType)
  }
}

async function pickUnpackDirectory(): Promise<DirectoryHandleLike | null> {
  try {
    const pickerWindow = window as unknown as Window & {
      showDirectoryPicker: (options: unknown) => Promise<DirectoryHandleLike>
    }
    return await pickerWindow.showDirectoryPicker({
      id: 'taco-unpack',
      mode: 'readwrite',
      ...(fileHandle ? { startIn: fileHandle } : {}),
    })
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') return null
    throw error
  }
}

export function downloadFile(html: string, name: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export async function saveFile(doc: KernelDoc): Promise<SaveResult> {
  const html = serializeFile(doc)
  if (!hasFsAccess()) {
    downloadFile(html, suggestedFileName(doc))
    return 'downloaded'
  }
  if (!fileHandle || fileBase(fileHandle.name) !== fileBase(suggestedFileName(doc))) {
    const picked = await pickHandle(doc, 'in-place')
    if (!picked) return 'cancelled'
    fileHandle = picked
    await writeHandle(picked, html)
    return 'saved-as'
  }
  await writeHandle(fileHandle, html)
  return 'saved'
}

export async function saveCopy(doc: KernelDoc): Promise<SaveResult> {
  const copyDoc = { ...doc, title: `${doc.title}-copy` }
  const html = serializeFile(copyDoc)
  if (!hasFsAccess()) {
    downloadFile(html, suggestedFileName(copyDoc))
    return 'downloaded'
  }
  const picked = await pickHandle(copyDoc, 'copy')
  if (!picked) return 'cancelled'
  await writeHandle(picked, html)
  return 'saved-as'
}

export async function saveVariant(doc: KernelDoc, suffix: string): Promise<SaveResult> {
  const variantDoc = { ...doc, title: `${doc.title}-${suffix}` }
  const html = serializeFile(variantDoc)
  if (!hasFsAccess()) {
    downloadFile(html, suggestedFileName(variantDoc))
    return 'downloaded'
  }
  const picked = await pickHandle(variantDoc, 'copy')
  if (!picked) return 'cancelled'
  await writeHandle(picked, html)
  return 'saved-as'
}

export async function saveAndUnpack(bundle: TacoBundle): Promise<SaveResult> {
  if (!hasDirectoryAccess()) throw new Error('This browser cannot write a Taco directory')
  const directory = await pickUnpackDirectory()
  if (!directory) return 'directory-unavailable'

  const html = serializeFile(bundle)
  const name = suggestedFileName(bundle)
  const tacoHandle = await directory.getFileHandle(name, { create: true })
  await writeHandle(tacoHandle, html)
  await unpackBundle(directory, bundle)
  fileHandle = tacoHandle
  return 'saved-and-unpacked'
}

export function downloadJson(doc: KernelDoc): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${fileBase(suggestedFileName(doc))}.json`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function adoptFileHandle(handle: FileHandleLike | null): void {
  fileHandle = handle
}
