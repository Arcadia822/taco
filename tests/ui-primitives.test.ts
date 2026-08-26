import { beforeEach, describe, expect, it } from 'vitest'
import { showConfirmDialog } from '../src/ui-primitives.ts'

describe('confirmation dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('cancels on Escape without accepting the action', async () => {
    const result = showConfirmDialog({
      title: 'Download This Taco?',
      messages: ['The browser controls the destination.'],
      confirmLabel: 'Download',
      cancelLabel: 'Cancel',
    })
    const dialog = document.querySelector<HTMLDialogElement>('.confirmation-dialog')!

    const cancel = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(cancel)

    await expect(result).resolves.toBe(false)
    expect(cancel.defaultPrevented).toBe(true)
    expect(document.querySelector('.confirmation-dialog')).toBeNull()
  })

  it('renders every warning and resolves only after explicit confirmation', async () => {
    const result = showConfirmDialog({
      title: 'Download This Taco?',
      messages: ['The browser controls the destination.', 'This copy contains credentials.'],
      confirmLabel: 'Download',
      cancelLabel: 'Cancel',
    })
    const dialog = document.querySelector<HTMLDialogElement>('.confirmation-dialog')!

    expect(Array.from(dialog.querySelectorAll('.confirmation-dialog-body p')).map((node) => node.textContent))
      .toEqual(['The browser controls the destination.', 'This copy contains credentials.'])
    dialog.querySelector<HTMLButtonElement>('.confirmation-dialog-confirm')!.click()

    await expect(result).resolves.toBe(true)
    expect(document.querySelector('.confirmation-dialog')).toBeNull()
  })
})
