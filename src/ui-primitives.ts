import { fileKind, fileName, type TacoFile } from './model.ts'

export type IconName =
  | 'braces'
  | 'chevron-down'
  | 'chevron-right'
  | 'file'
  | 'file-code'
  | 'file-text'
  | 'folder'
  | 'folder-open'
  | 'globe'
  | 'external-link'
  | 'eye'
  | 'message-square'
  | 'panel-left-close'
  | 'panel-left-open'
  | 'presentation'
  | 'radio'
  | 'save'
  | 'share'
  | 'square'
  | 'template'
  | 'key'
  | 'x'

const iconPaths: Record<IconName, string> = {
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><polyline points="14 2 14 8 20 8"/>',
  'file-code': '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><polyline points="14 2 14 8 20 8"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>',
  'file-text': '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'external-link': '<path d="M15 3h6v6"/><path d="m10 14 11-11"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  eye: '<path d="M2.1 12a10.6 10.6 0 0 1 19.8 0 10.6 10.6 0 0 1-19.8 0"/><circle cx="12" cy="12" r="3"/>',
  folder: '<path d="M20 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z"/>',
  'folder-open': '<path d="m6 14 1.5-3h12.2a2 2 0 0 1 1.8 2.9l-2 4A2 2 0 0 1 17.7 19H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/>',
  'message-square': '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
  'panel-left-close': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>',
  'panel-left-open': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>',
  presentation: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
  radio: '<path d="M4.9 19.1a10 10 0 0 1 0-14.2"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  save: '<path d="M15.2 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.8z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/>',
  square: '<rect width="14" height="14" x="5" y="5" rx="1"/>',
  template: '<rect width="18" height="14" x="3" y="5" rx="2"/><path d="M7 9h4"/><path d="M7 13h8"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L21 8"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
}

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

export const svgIcon = (name: IconName): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('ui-icon')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.75')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.dataset.icon = name
  svg.innerHTML = iconPaths[name]
  return svg
}

export const setButtonIcon = (button: HTMLButtonElement, name: IconName): void => {
  const current = button.querySelector('.ui-icon')
  if (current) current.replaceWith(svgIcon(name))
  else button.prepend(svgIcon(name))
}

export interface SidebarRowOptions {
  className: string
  leading?: Element
  label: string
  labelClass?: string
  trailing?: HTMLElement
}

export const sidebarRow = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: SidebarRowOptions,
): HTMLElementTagNameMap[K] => {
  const row = el(tag, [
    'sidebar-row',
    options.leading ? '' : 'sidebar-row-no-leading',
    !options.leading && !options.trailing ? 'sidebar-row-no-trailing' : '',
    options.className,
  ].filter(Boolean).join(' '))
  if (options.leading) {
    const iconSlot = el('span', 'sidebar-row-icon')
    iconSlot.setAttribute('aria-hidden', 'true')
    iconSlot.append(options.leading)
    row.append(iconSlot)
  }
  row.append(el('span', `sidebar-row-label ${options.labelClass ?? ''}`.trim(), options.label))
  if (options.trailing) row.append(options.trailing)
  return row
}

export const createControlButton = (
  icon: IconName,
  label: string,
  action: () => void,
  className = '',
  labelVisible = false,
  primary = false,
): HTMLButtonElement => {
  const button = el('button', [
    'control-button',
    labelVisible ? 'control-button-with-label' : 'control-button-icon',
    primary ? 'control-button-primary' : '',
    className,
  ].filter(Boolean).join(' '))
  button.type = 'button'
  button.title = label
  button.setAttribute('aria-label', label)
  button.append(svgIcon(icon))
  if (labelVisible) button.append(el('span', 'button-label', label))
  button.addEventListener('click', action)
  return button
}

export interface ConfirmDialogOptions {
  title: string
  messages: readonly string[]
  confirmLabel: string
  cancelLabel: string
}

export const showConfirmDialog = (options: ConfirmDialogOptions): Promise<boolean> =>
  new Promise((resolve) => {
    const dialog = el('dialog', 'confirmation-dialog') as HTMLDialogElement
    dialog.setAttribute('aria-labelledby', 'taco-confirmation-title')

    const title = el('h2', 'confirmation-dialog-title', options.title)
    title.id = 'taco-confirmation-title'
    const body = el('div', 'confirmation-dialog-body')
    for (const message of options.messages) body.append(el('p', '', message))

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
        resolve(accepted)
      }
    }

    cancel.addEventListener('click', () => finish(false))
    confirm.addEventListener('click', () => finish(true))
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
    cancel.focus()
  })

const extensionLabel = (file: TacoFile): string => {
  const name = fileName(file.path)
  const extension = name.includes('.') ? name.split('.').at(-1)! : 'txt'
  return extension.toUpperCase().slice(0, 4)
}

export const createFileTypeIcon = (file: TacoFile): SVGSVGElement => {
  const kind = fileKind(file)
  const icon: Record<typeof kind, IconName> = {
    markdown: 'file-text',
    html: 'file-code',
    yaml: 'file-code',
    json: 'braces',
    text: 'file',
  }
  const type = svgIcon(icon[kind])
  type.classList.add('file-type', `type-${kind}`)
  type.setAttribute('title', extensionLabel(file))
  return type
}

export const fallbackFileTitle = (file: TacoFile): string => {
  const name = fileName(file.path)
  const stem = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name
  const words = stem.split(/[-_]+/).filter(Boolean)
  if (!words.length) return name
  return words.map((word) => word.length <= 4 && word === word.toUpperCase()
    ? word
    : `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ')
}
