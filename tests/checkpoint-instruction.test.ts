import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileBrowser } from '../src/file-browser.ts'
import type { TacoBundle } from '../src/model.ts'

const testBundle: TacoBundle = {
  format: 'taco/files',
  version: 1,
  docId: 'instruction-test',
  title: 'Instruction Test',
  root: 'specs/test',
  files: [
    {
      id: 'f1',
      path: 'specs/test/spec.md',
      mediaType: 'text/markdown',
      content: '# Spec Document\n\nSome content.',
    },
    {
      id: 'f2',
      path: 'specs/test/tasks.md',
      mediaType: 'text/markdown',
      content: '# Tasks Document\n\nTask list.',
    },
  ],
  checkpoints: {
    version: 1,
    nodes: [
      {
        id: 'phase1',
        title: 'Phase 1',
        after: [],
        documents: [
          {
            path: 'specs/test/spec.md',
            instruction: 'Must include architecture diagram and error handling.',
          },
          {
            path: 'specs/test/tasks.md',
          },
        ],
      },
    ],
    documents: [],
  },
}
describe('FileBrowser Checkpoint Instruction Tab', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  })

  it('shows instruction tab when selecting document with instruction and hides it for document without', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const browser = new FileBrowser(root, structuredClone(testBundle))

    // specs/test/spec.md is selected by default (first file)
    const instructionTab = root.querySelector<HTMLButtonElement>('.right-panel-tabs [data-segmented-value="instruction"]')
    expect(instructionTab).not.toBeNull()
    expect(instructionTab?.hidden).toBe(false)

    // Click instruction tab
    instructionTab?.click()
    const instructionPanel = root.querySelector<HTMLElement>('#taco-instruction-panel')
    expect(instructionPanel?.hidden).toBe(false)
    expect(instructionPanel?.textContent).toContain('Must include architecture diagram and error handling.')

    // Switch to tasks.md which has no instruction
    const tasksFileBtn = root.querySelector<HTMLButtonElement>('[data-path="specs/test/tasks.md"]')
    expect(tasksFileBtn).not.toBeNull()
    tasksFileBtn?.click()

    // Instruction tab should be hidden and removed from active tablist
    const updatedInstructionTab = root.querySelector<HTMLButtonElement>('.right-panel-tabs [data-segmented-value="instruction"]')
    expect(updatedInstructionTab).toBeNull()

    // Auxiliary tab should fallback to outline (since tasks.md is markdown)
    const outlinePanel = root.querySelector<HTMLElement>('#taco-outline')
    expect(outlinePanel?.hidden).toBe(false)

    browser.destroy()
    root.remove()
  })

  it('smoothly falls back to comments when switching from instruction tab to document without outline or instruction', () => {
    const bundleWithYaml = structuredClone(testBundle)
    bundleWithYaml.files.push({
      id: 'f3',
      path: 'specs/test/config.yaml',
      mediaType: 'application/yaml',
      content: 'key: value',
    })
    const root = document.createElement('div')
    document.body.append(root)
    const browser = new FileBrowser(root, bundleWithYaml)

    // Explicitly click spec.md to select it
    const specFileBtn = root.querySelector<HTMLButtonElement>('[data-path="specs/test/spec.md"]')
    specFileBtn?.click()

    // Select instruction tab on spec.md
    const instructionTab = root.querySelector<HTMLButtonElement>('.right-panel-tabs [data-segmented-value="instruction"]')
    expect(instructionTab).not.toBeNull()
    instructionTab?.click()
    const panel = root.querySelector<HTMLElement>('#taco-instruction-panel')
    expect(panel?.hidden).toBe(false)
    // Switch to config.yaml (no instruction, not markdown -> no outline)
    const yamlFileBtn = root.querySelector<HTMLButtonElement>('[data-path="specs/test/config.yaml"]')
    yamlFileBtn?.click()

    // Should fallback to comments
    const commentList = root.querySelector<HTMLElement>('#taco-comment-list')
    expect(commentList?.hidden).toBe(false)
    expect(root.querySelector<HTMLElement>('#taco-instruction-panel')?.hidden).toBe(true)
    expect(root.querySelector<HTMLElement>('#taco-outline')?.hidden).toBe(true)

    browser.destroy()
    root.remove()
  })

  it('handles malformed checkpoint nodes gracefully without crashing', () => {
    const malformedBundle = structuredClone(testBundle)
    // @ts-expect-error testing malformed array element
    malformedBundle.checkpoints.nodes.push(null)
    const root = document.createElement('div')
    document.body.append(root)
    expect(() => {
      const browser = new FileBrowser(root, malformedBundle)
      browser.destroy()
    }).not.toThrow()
    root.remove()
  })

  it('falls back to outline when switching from instruction tab to a markdown document without instruction', () => {
    const bundleWithNotes = structuredClone(testBundle)
    bundleWithNotes.files.push({
      id: 'f4',
      path: 'specs/test/notes.md',
      mediaType: 'text/markdown',
      content: '# Notes\n\nSome notes.',
    })
    const root = document.createElement('div')
    document.body.append(root)
    const browser = new FileBrowser(root, bundleWithNotes)

    const specFileBtn = root.querySelector<HTMLButtonElement>('[data-path="specs/test/spec.md"]')
    specFileBtn?.click()
    const instructionTab = root.querySelector<HTMLButtonElement>('.right-panel-tabs [data-segmented-value="instruction"]')
    instructionTab?.click()

    const notesFileBtn = root.querySelector<HTMLButtonElement>('[data-path="specs/test/notes.md"]')
    notesFileBtn?.click()

    // Auxiliary tab should fallback to outline
    const outlinePanel = root.querySelector<HTMLElement>('#taco-outline')
    expect(outlinePanel?.hidden).toBe(false)

    browser.destroy()
    root.remove()
  })

})
