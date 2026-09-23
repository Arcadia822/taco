import { createControlButton, el, type IconName } from './ui-primitives.ts'

export type AllowedNewFileType = 'markdown' | 'mermaid' | 'json' | 'yaml' | 'openapi'

export interface NewFileTypeOption {
  type: AllowedNewFileType
  label: string
  extension: string
  iconName: IconName
  colorClass: string
  defaultContent: (baseName: string) => string
}

export const NEW_FILE_TYPES: readonly NewFileTypeOption[] = [
  {
    type: 'markdown',
    label: 'Markdown (.md)',
    extension: '.md',
    iconName: 'file-text',
    colorClass: 'type-markdown',
    defaultContent: (name) => `# ${name}\n\n`,
  },
  {
    type: 'mermaid',
    label: 'Mermaid (.mmd)',
    extension: '.mmd',
    iconName: 'presentation',
    colorClass: 'type-mermaid',
    defaultContent: () => `flowchart TD\n  A[Start] --> B[End]\n`,
  },
  {
    type: 'json',
    label: 'JSON (.json)',
    extension: '.json',
    iconName: 'braces',
    colorClass: 'type-json',
    defaultContent: () => `{\n  \n}\n`,
  },
  {
    type: 'yaml',
    label: 'YAML (.yaml)',
    extension: '.yaml',
    iconName: 'file-code',
    colorClass: 'type-yaml',
    defaultContent: () => `# Configuration\n`,
  },
  {
    type: 'openapi',
    label: 'OpenAPI (.yaml)',
    extension: '.yaml',
    iconName: 'file-code',
    colorClass: 'type-yaml',
    defaultContent: (name) => `openapi: 3.1.0\ninfo:\n  title: "${name}"\n  version: "1.0.0"\npaths: {}\n`,
  },
] as const

export interface NewFileDialogOptions {
  title: string
  confirmLabel: string
  cancelLabel: string
  typeLabel: string
  nameLabel: string
  categoryLabel: string
  ungroupedLabel: string
  groups: ReadonlyArray<{ id: string; title: string }>
  initialGroupId: string | null
  namePlaceholder?: string
}

export interface NewFileResult {
  fileName: string
  mediaType: string
  content: string
  groupId: string | null
}

export const showNewFileDialog = (options: NewFileDialogOptions): Promise<NewFileResult | null> =>
  new Promise((resolve) => {
    const dialog = el('dialog', 'confirmation-dialog new-file-dialog') as HTMLDialogElement
    dialog.setAttribute('aria-labelledby', 'taco-new-file-title')

    const title = el('h2', 'confirmation-dialog-title', options.title)
    title.id = 'taco-new-file-title'
    const body = el('div', 'confirmation-dialog-body new-file-body')

    // 1. 类型选择卡片容器（每个卡片都配上和 sidebar 里面一模一样的彩色图标）
    const typeRow = el('div', 'new-file-type-row')
    const typeLabel = el('span', 'new-file-field-label', options.typeLabel)
    const typeList = el('div', 'new-file-type-list')

    let selectedType: AllowedNewFileType = 'markdown'
    const extSuffix = el('span', 'new-file-ext-suffix', '.md')

    const typeButtons: HTMLButtonElement[] = []
    for (const opt of NEW_FILE_TYPES) {
      const btn = createControlButton(opt.iconName, opt.label, () => {
        selectedType = opt.type
        extSuffix.textContent = opt.extension
        for (const button of typeButtons) {
          button.classList.toggle('is-active', button === btn)
          button.setAttribute('aria-pressed', String(button === btn))
        }
      }, `new-file-type-card${opt.type === selectedType ? ' is-active' : ''}`, true)
      btn.setAttribute('aria-pressed', String(opt.type === selectedType))
      btn.querySelector('.ui-icon')?.classList.add('file-type', opt.colorClass)
      typeButtons.push(btn)
      typeList.append(btn)
    }
    typeRow.append(typeLabel, typeList)

    // 2. 纯文件名输入
    const nameRow = el('div', 'new-file-name-row')
    const nameLabel = el('label', 'new-file-field-label', options.nameLabel)
    nameLabel.htmlFor = 'taco-new-file-name'
    const inputWrapper = el('div', 'new-file-input-wrapper')
    const input = el('input', 'prompt-dialog-input new-file-input') as HTMLInputElement
    input.id = 'taco-new-file-name'
    input.name = 'file-name'
    input.autocomplete = 'off'
    input.placeholder = options.namePlaceholder ?? 'overview'
    inputWrapper.append(input, extSuffix)
    nameRow.append(nameLabel, inputWrapper)

    const categoryRow = el('div', 'new-file-category-row')
    const categoryLabel = el('label', 'new-file-field-label', options.categoryLabel)
    categoryLabel.htmlFor = 'taco-new-file-category'
    const category = el('select', 'prompt-dialog-input new-file-category') as HTMLSelectElement
    category.id = 'taco-new-file-category'
    category.name = 'category'
    category.append(new Option(options.ungroupedLabel, ''))
    for (const group of options.groups) category.append(new Option(group.title, group.id))
    category.value = options.groups.some((group) => group.id === options.initialGroupId) ? options.initialGroupId! : ''
    categoryRow.append(categoryLabel, category)
    body.append(typeRow, nameRow, categoryRow)

    const actions = el('div', 'confirmation-dialog-actions')
    const cancel = createControlButton('x', options.cancelLabel, () => finish(false), 'new-file-cancel', true)
    const confirm = createControlButton('plus', options.confirmLabel, () => finish(true), 'new-file-confirm', true, true)
    actions.append(cancel, confirm)
    dialog.append(title, body, actions)

    let settled = false
    const finish = (accepted: boolean): void => {
      if (settled) return
      const rawName = input.value.trim()
      if (accepted && !rawName) { input.focus(); return }
      settled = true
      try {
        if (dialog.open && typeof dialog.close === 'function') dialog.close()
      } finally {
        dialog.remove()
        if (!accepted) {
          resolve(null)
          return
        }

        const chosen = NEW_FILE_TYPES.find((t) => t.type === selectedType) ?? NEW_FILE_TYPES[0]
        const cleanBase = rawName.replace(new RegExp(`\\${chosen.extension}$`, 'i'), '').trim()
        const finalName = `${cleanBase}${chosen.extension}`

        let mediaType = 'text/markdown'
        if (chosen.type === 'json') mediaType = 'application/json'
        else if (chosen.type === 'yaml' || chosen.type === 'openapi') mediaType = 'application/yaml'
        else if (chosen.type === 'mermaid') mediaType = 'text/plain'

        resolve({
          fileName: finalName,
          mediaType,
          content: chosen.defaultContent(cleanBase),
          groupId: category.value || null,
        })
      }
    }

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        finish(true)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        finish(false)
      }
    })
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      finish(false)
    })
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(false)
    })

    document.body.append(dialog)
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    input.focus()
  })
