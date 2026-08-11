import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApp } from '../src/kernel/app.ts'
import {
  capturePristine,
  adoptFileHandle,
  saveAndUnpack,
  saveFile,
  serializeFile,
  suggestedFileName,
  titleForFileName,
  type DirectoryHandleLike,
  type FileHandleLike,
} from '../src/kernel/save.ts'
import type { TacoBundle } from '../src/model.ts'

const bundle: TacoBundle = {
  format: 'taco/files',
  version: 1,
  docId: 'save-test',
  title: 'Save test',
  root: 'specs/001-save',
  files: [
    { path: 'specs/001-save/spec.md', mediaType: 'text/markdown', content: '# Exact\n\nDo not rewrite.  ' },
    { path: 'specs/001-save/contracts/api.md', mediaType: 'text/markdown', content: '# API\n' },
  ],
}

describe('single-file save serializer', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head><title>Taco</title><script id="taco-document" type="application/taco+json">{}</script></head><body><div id="app"></div></body>'
    configureApp({ appId: 'taco-test', appName: 'Taco' })
    capturePristine()
    adoptFileHandle(null)
  })

  it('writes the canonical file bundle without changing file text', () => {
    const html = serializeFile(bundle)
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    const saved = JSON.parse(parsed.getElementById('taco-document')!.textContent!) as TacoBundle
    expect(saved).toEqual(bundle)
    expect(saved.files[0].content).toBe('# Exact\n\nDo not rewrite.  ')
  })

  it('suggests a portable Taco filename', () => {
    expect(suggestedFileName(bundle)).toBe('Save_test.taco.html')
    expect(suggestedFileName(bundle, 'copy')).toBe('Save_test-copy.taco.html')
    expect(suggestedFileName({ ...bundle, title: '季度 计划 / Q3' })).toBe('季度_计划_Q3.taco.html')
    expect(titleForFileName('Quarterly Plan', 'Quarterly_Plan.taco.html')).toBe('Quarterly Plan')
    expect(titleForFileName('Wrong title', 'final.taco.html')).toBe('final')
  })

  it('uses a new matching filename after the document title changes', async () => {
    const pickedNames: string[] = []
    const showSaveFilePicker = vi.fn(async function (this: Window, options: unknown) {
      expect(this).toBe(window)
      const name = (options as { suggestedName: string }).suggestedName
      pickedNames.push(name)
      return {
        name,
        createWritable: async () => ({ write: async () => undefined, close: async () => undefined }),
      } satisfies FileHandleLike
    })
    vi.stubGlobal('showSaveFilePicker', showSaveFilePicker)

    const editable = structuredClone(bundle)
    await expect(saveFile(editable)).resolves.toBe('saved-as')
    editable.title = 'Renamed Taco'
    await expect(saveFile(editable)).resolves.toBe('saved-as')

    expect(pickedNames).toEqual(['Save_test.taco.html', 'Renamed_Taco.taco.html'])
    expect(showSaveFilePicker).toHaveBeenCalledTimes(2)
  })

  it('does not reuse an opened filename that disagrees with the Taco title', async () => {
    history.replaceState(null, '', '/Existing_name.taco.html')
    const showSaveFilePicker = vi.fn(async (options: unknown) => ({
      name: (options as { suggestedName: string }).suggestedName,
      createWritable: async () => ({ write: async () => undefined, close: async () => undefined }),
    }) satisfies FileHandleLike)
    vi.stubGlobal('showSaveFilePicker', showSaveFilePicker)

    await expect(saveFile({ ...bundle, title: 'A different title' })).resolves.toBe('saved-as')

    expect(showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName: 'A_different_title.taco.html',
    }))
  })

  it('uses the chosen directory as the visible Taco tree root and adopts the Taco file for later saves', async () => {
    const writes = new Map<string, { content: string; mediaType: string }>()
    const readBlob = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.addEventListener('load', () => resolve(String(reader.result)))
      reader.addEventListener('error', () => reject(reader.error))
      reader.readAsText(blob)
    })

    const directory = (path = ''): DirectoryHandleLike => ({
      name: path.split('/').at(-1) ?? 'workspace',
      getDirectoryHandle: async (name) => directory(path ? `${path}/${name}` : name),
      getFileHandle: async (name) => {
        const filePath = path ? `${path}/${name}` : name
        let content = ''
        return {
          name,
          createWritable: async () => ({
            write: async (blob) => {
              content = await readBlob(blob)
              writes.set(filePath, { content, mediaType: blob.type })
            },
            close: async () => undefined,
          }),
          getFile: async () => ({ text: async () => content }),
        } satisfies FileHandleLike
      },
    })
    const showDirectoryPicker = vi.fn(async function (this: Window) {
      expect(this).toBe(window)
      return directory()
    })
    vi.stubGlobal('showDirectoryPicker', showDirectoryPicker)
    const showSaveFilePicker = vi.fn()
    vi.stubGlobal('showSaveFilePicker', showSaveFilePicker)

    await expect(saveAndUnpack(bundle)).resolves.toBe('saved-and-unpacked')
    expect(showDirectoryPicker).toHaveBeenCalledWith(expect.objectContaining({ mode: 'readwrite' }))
    expect(writes.get('Save_test.taco.html')?.content).toContain('"format": "taco/files"')
    expect(writes.get('spec.md')).toEqual({
      content: '# Exact\n\nDo not rewrite.  ',
      mediaType: 'text/markdown',
    })
    expect(writes.get('contracts/api.md')).toEqual({
      content: '# API\n',
      mediaType: 'text/markdown',
    })
    expect([...writes.keys()]).not.toContain('specs/001-save/spec.md')

    await expect(saveFile(bundle)).resolves.toBe('saved')
    expect(showSaveFilePicker).not.toHaveBeenCalled()
  })

  it('does not misreport a denied directory grant as a completed cancellation', async () => {
    vi.stubGlobal('showDirectoryPicker', vi.fn(async function (this: Window) {
      expect(this).toBe(window)
      throw new DOMException('Write permission was not granted', 'AbortError')
    }))

    await expect(saveAndUnpack(bundle)).resolves.toBe('directory-unavailable')
  })
})
