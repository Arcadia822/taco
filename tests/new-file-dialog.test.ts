import { beforeEach, describe, expect, it } from 'vitest'
import { NEW_FILE_TYPES, showNewFileDialog, type NewFileDialogOptions } from '../src/new-file-dialog.ts'

describe('new-file-dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  const defaultOptions: NewFileDialogOptions = {
    title: 'New File',
    confirmLabel: 'Create',
    cancelLabel: 'Cancel',
    typeLabel: 'File Type',
    nameLabel: 'File Name',
    categoryLabel: 'Category',
    ungroupedLabel: 'Ungrouped',
    groups: [
      { id: 'group-spec', title: 'Specifications' },
      { id: 'group-api', title: 'API Contracts' },
    ],
    initialGroupId: null,
  }

  describe('NEW_FILE_TYPES definition', () => {
    it('exposes exactly 4 canonical file types and excludes openapi', () => {
      const types = NEW_FILE_TYPES.map((t) => t.type)
      expect(types).toEqual(['markdown', 'mermaid', 'json', 'yaml'])
      expect(types).not.toContain('openapi')
      expect(NEW_FILE_TYPES).toHaveLength(4)
    })

    it('defines distinct and valid file extensions for each canonical type', () => {
      const extensions = NEW_FILE_TYPES.map((t) => t.extension)
      expect(extensions).toEqual(['.md', '.mmd', '.json', '.yaml'])
      const uniqueExtensions = new Set(extensions)
      expect(uniqueExtensions.size).toBe(4)
    })

    it('generates expected default content for all 4 types', () => {
      const md = NEW_FILE_TYPES.find((t) => t.type === 'markdown')!
      expect(md.defaultContent('feature')).toBe('# feature\n\n')

      const mmd = NEW_FILE_TYPES.find((t) => t.type === 'mermaid')!
      expect(mmd.defaultContent('diagram')).toBe('flowchart TD\n  A[Start] --> B[End]\n')

      const json = NEW_FILE_TYPES.find((t) => t.type === 'json')!
      expect(json.defaultContent('payload')).toBe('{\n  \n}\n')

      const yaml = NEW_FILE_TYPES.find((t) => t.type === 'yaml')!
      expect(yaml.defaultContent('config')).toBe('# Configuration\n')
    })
  })

  describe('showNewFileDialog DOM and interactions', () => {
    it('renders selection buttons for only the 4 canonical types and none for openapi', () => {
      showNewFileDialog(defaultOptions)

      const dialog = document.querySelector<HTMLDialogElement>('.new-file-dialog')!
      expect(dialog).not.toBeNull()

      const typeButtons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.new-file-type-card'))
      expect(typeButtons).toHaveLength(4)

      const labels = typeButtons.map((btn) => btn.textContent?.trim())
      expect(labels).toEqual(['Markdown (.md)', 'Mermaid (.mmd)', 'JSON (.json)', 'YAML (.yaml)'])

      for (const btn of typeButtons) {
        expect(btn.textContent).not.toContain('OpenAPI')
      }
    })

    it('defaults to markdown selection with .md suffix indicator', () => {
      showNewFileDialog(defaultOptions)

      const typeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.new-file-type-card'))
      expect(typeButtons[0].classList.contains('is-active')).toBe(true)
      expect(typeButtons[0].getAttribute('aria-pressed')).toBe('true')

      const suffix = document.querySelector('.new-file-ext-suffix')
      expect(suffix?.textContent).toBe('.md')
    })

    it('updates active state and extension suffix when switching file types', () => {
      showNewFileDialog(defaultOptions)

      const typeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.new-file-type-card'))
      const suffix = document.querySelector('.new-file-ext-suffix')!

      // Switch to Mermaid
      typeButtons[1].click()
      expect(typeButtons[1].classList.contains('is-active')).toBe(true)
      expect(typeButtons[0].classList.contains('is-active')).toBe(false)
      expect(suffix.textContent).toBe('.mmd')

      // Switch to JSON
      typeButtons[2].click()
      expect(typeButtons[2].classList.contains('is-active')).toBe(true)
      expect(typeButtons[1].classList.contains('is-active')).toBe(false)
      expect(suffix.textContent).toBe('.json')

      // Switch to YAML
      typeButtons[3].click()
      expect(typeButtons[3].classList.contains('is-active')).toBe(true)
      expect(typeButtons[2].classList.contains('is-active')).toBe(false)
      expect(suffix.textContent).toBe('.yaml')
    })

    it('creates a Markdown file with text/markdown mediaType', async () => {
      const promise = showNewFileDialog(defaultOptions)

      const input = document.querySelector<HTMLInputElement>('.new-file-input')!
      input.value = 'spec'

      const confirmBtn = document.querySelector<HTMLButtonElement>('.new-file-confirm')!
      confirmBtn.click()

      const result = await promise
      expect(result).toEqual({
        fileName: 'spec.md',
        mediaType: 'text/markdown',
        content: '# spec\n\n',
        groupId: null,
      })
      expect(document.querySelector('.new-file-dialog')).toBeNull()
    })

    it('creates a Mermaid file with text/plain mediaType', async () => {
      const promise = showNewFileDialog(defaultOptions)

      const typeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.new-file-type-card'))
      typeButtons[1].click() // mermaid

      const input = document.querySelector<HTMLInputElement>('.new-file-input')!
      input.value = 'flowchart'

      const confirmBtn = document.querySelector<HTMLButtonElement>('.new-file-confirm')!
      confirmBtn.click()

      const result = await promise
      expect(result).toEqual({
        fileName: 'flowchart.mmd',
        mediaType: 'text/plain',
        content: 'flowchart TD\n  A[Start] --> B[End]\n',
        groupId: null,
      })
    })

    it('creates a JSON file with application/json mediaType', async () => {
      const promise = showNewFileDialog(defaultOptions)

      const typeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.new-file-type-card'))
      typeButtons[2].click() // json

      const input = document.querySelector<HTMLInputElement>('.new-file-input')!
      input.value = 'schema'

      const confirmBtn = document.querySelector<HTMLButtonElement>('.new-file-confirm')!
      confirmBtn.click()

      const result = await promise
      expect(result).toEqual({
        fileName: 'schema.json',
        mediaType: 'application/json',
        content: '{\n  \n}\n',
        groupId: null,
      })
    })

    it('creates a YAML file with application/yaml mediaType', async () => {
      const promise = showNewFileDialog(defaultOptions)

      const typeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.new-file-type-card'))
      typeButtons[3].click() // yaml

      const input = document.querySelector<HTMLInputElement>('.new-file-input')!
      input.value = 'openapi'

      const confirmBtn = document.querySelector<HTMLButtonElement>('.new-file-confirm')!
      confirmBtn.click()

      const result = await promise
      expect(result).toEqual({
        fileName: 'openapi.yaml',
        mediaType: 'application/yaml',
        content: '# Configuration\n',
        groupId: null,
      })
    })

    it('avoids double-extending when user types file name with extension', async () => {
      const promise = showNewFileDialog(defaultOptions)

      const input = document.querySelector<HTMLInputElement>('.new-file-input')!
      input.value = 'guide.md'

      const confirmBtn = document.querySelector<HTMLButtonElement>('.new-file-confirm')!
      confirmBtn.click()

      const result = await promise
      expect(result?.fileName).toBe('guide.md')
    })

    it('retains selected category groupId in result', async () => {
      const promise = showNewFileDialog({
        ...defaultOptions,
        initialGroupId: 'group-api',
      })

      const input = document.querySelector<HTMLInputElement>('.new-file-input')!
      input.value = 'api-spec'

      const category = document.querySelector<HTMLSelectElement>('.new-file-category')!
      expect(category.value).toBe('group-api')

      const confirmBtn = document.querySelector<HTMLButtonElement>('.new-file-confirm')!
      confirmBtn.click()

      const result = await promise
      expect(result?.groupId).toBe('group-api')
    })

    it('does not submit when input is empty and focuses input', async () => {
      const promise = showNewFileDialog(defaultOptions)

      const input = document.querySelector<HTMLInputElement>('.new-file-input')!
      const confirmBtn = document.querySelector<HTMLButtonElement>('.new-file-confirm')!
      confirmBtn.click()

      expect(document.activeElement).toBe(input)
      expect(document.querySelector('.new-file-dialog')).not.toBeNull()

      // Cancel to clean up
      const cancelBtn = document.querySelector<HTMLButtonElement>('.new-file-cancel')!
      cancelBtn.click()

      const result = await promise
      expect(result).toBeNull()
      expect(document.querySelector('.new-file-dialog')).toBeNull()
    })
    it('cancels and resolves null when cancel button is clicked', async () => {
      const promise = showNewFileDialog(defaultOptions)

      const cancelBtn = document.querySelector<HTMLButtonElement>('.new-file-cancel')!
      cancelBtn.click()

      const result = await promise
      expect(result).toBeNull()
      expect(document.querySelector('.new-file-dialog')).toBeNull()
    })

    it('cancels and resolves null on Escape key', async () => {
      const promise = showNewFileDialog(defaultOptions)

      const input = document.querySelector<HTMLInputElement>('.new-file-input')!
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

      const result = await promise
      expect(result).toBeNull()
      expect(document.querySelector('.new-file-dialog')).toBeNull()
    })

    it('confirms on Enter key when input is not empty', async () => {
      const promise = showNewFileDialog(defaultOptions)

      const input = document.querySelector<HTMLInputElement>('.new-file-input')!
      input.value = 'tasks'
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

      const result = await promise
      expect(result?.fileName).toBe('tasks.md')
      expect(document.querySelector('.new-file-dialog')).toBeNull()
    })
  })
})
