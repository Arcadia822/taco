import { currentAuthorName, normalizeAuthorName, setAuthorName } from './identity.ts'
import { el } from './ui-primitives.ts'

export interface AuthorNameDialogLabels {
  title: string
  hint: string
  cancel: string
  confirm: string
}

const closeDialog = (dialog: HTMLDialogElement): void => {
  if (typeof dialog.close === 'function') dialog.close()
  else {
    dialog.removeAttribute('open')
    dialog.remove()
  }
}

export const requireAuthorName = (labels: AuthorNameDialogLabels, onConfirm: (name: string) => void): void => {
  const existing = currentAuthorName()
  if (existing) { onConfirm(existing); return }

  document.querySelector('.author-name-dialog')?.remove()
  const dialog = el('dialog', 'author-name-dialog') as HTMLDialogElement
  const form = el('form', 'author-name-form')
  const title = el('h2', 'author-name-title', labels.title)
  title.id = 'taco-author-name-title'
  const hint = el('p', 'author-name-hint', labels.hint)
  hint.id = 'taco-author-name-hint'
  const input = el('input', 'author-name-input') as HTMLInputElement
  input.type = 'text'
  input.name = 'displayName'
  input.maxLength = 64
  input.autocomplete = 'off'
  input.required = true
  input.setAttribute('aria-label', labels.title)
  input.setAttribute('aria-describedby', hint.id)
  const actions = el('div', 'author-name-actions')
  const cancel = el('button', 'comment-action', labels.cancel) as HTMLButtonElement
  cancel.type = 'button'
  const confirm = el('button', 'comment-submit', labels.confirm) as HTMLButtonElement
  confirm.type = 'submit'
  confirm.disabled = true

  input.addEventListener('input', () => { confirm.disabled = !normalizeAuthorName(input.value) })
  cancel.addEventListener('click', () => closeDialog(dialog))
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const name = normalizeAuthorName(input.value)
    if (!name) { input.focus(); return }
    const author = setAuthorName(name)
    closeDialog(dialog)
    onConfirm(author)
  })
  actions.append(cancel, confirm)
  form.append(title, hint, input, actions)
  dialog.setAttribute('aria-labelledby', title.id)
  dialog.setAttribute('aria-describedby', hint.id)
  dialog.append(form)
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  document.body.append(dialog)
  if (typeof dialog.showModal === 'function') dialog.showModal()
  else dialog.setAttribute('open', '')
  input.focus()
}
