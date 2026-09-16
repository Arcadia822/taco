import { el, svgIcon, type IconName } from './ui-primitives.ts'

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
  typeLabel?: string
  nameLabel?: string
  namePlaceholder?: string
}

export interface NewFileResult {
  fileName: string
  mediaType: string
  content: string
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
    const typeLabel = el('label', 'new-file-field-label', options.typeLabel ?? 'File type:')
    const typeList = el('div', 'new-file-type-list')

    let selectedType: AllowedNewFileType = 'markdown'
    const extSuffix = el('span', 'new-file-ext-suffix', '.md')

    const typeButtons: HTMLButtonElement[] = []
    for (const opt of NEW_FILE_TYPES) {
      const btn = el('button', `new-file-type-card${opt.type === selectedType ? ' is-active' : ''}`) as HTMLButtonElement
      btn.type = 'button'

      const icon = svgIcon(opt.iconName)
      icon.classList.add('file-type', opt.colorClass)

      const text = el('span', 'new-file-type-card-label', opt.label)
      btn.append(icon, text)

      btn.addEventListener('click', () => {
        selectedType = opt.type
        extSuffix.textContent = opt.extension
        for (const b of typeButtons) b.classList.toggle('is-active', b === btn)
      })

      typeButtons.push(btn)
      typeList.append(btn)
    }
    typeRow.append(typeLabel, typeList)

    // 2. 纯文件名输入
    const nameRow = el('div', 'new-file-name-row')
    const nameLabel = el('label', 'new-file-field-label', options.nameLabel ?? 'File name:')
    const inputWrapper = el('div', 'new-file-input-wrapper')
    const input = el('input', 'prompt-dialog-input new-file-input') as HTMLInputElement
    input.type = 'text'
    input.placeholder = options.namePlaceholder ?? 'overview'
    inputWrapper.append(input, extSuffix)
    nameRow.append(nameLabel, inputWrapper)

    body.append(typeRow, nameRow)

    const actions = el('div', 'confirmation-dialog-actions')
    const cancel = el('button', 'confirmation-dialog-cancel', options.cancelLabel) as HTMLButtonElement
    cancel.type = 'button'
    const confirm = el('button', 'confirmation-dialog-confirm', options.confirmLabel) as HTMLButtonElement
    confirm.type = 'button'
    actions.append(cancel, confirm)
    dialog.append(title, body, actions)

    let settled = false
    const finish = (accepted: boolean): void => {
      if (settled) return
      settled = true
      try {
        if (dialog.open && typeof dialog.close === 'function') dialog.close()
      } finally {
        dialog.remove()
        if (!accepted) {
          resolve(null)
          return
        }

        const rawName = input.value.trim()
        if (!rawName) {
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
        })
      }
    }

    cancel.addEventListener('click', () => finish(false))
    confirm.addEventListener('click', () => finish(true))
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
