import { listCategories } from './category.ts'
import type { TacoBundle } from './model.ts'
import {
  createControlButton,
  el,
  showConfirmDialog,
  showPromptDialog,
} from './ui-primitives.ts'

export interface CategoryManagerDialogOptions {
  bundle: TacoBundle
  title: string
  closeLabel?: string
  renameLabel: string
  deleteLabel: string
  deleteConfirm: string
  renamePrompt: string
  affectedFiles?: (count: number) => string
  noCustomCategories: string
  addCategoryLabel?: string
  addCategoryPrompt?: string
  confirmLabel: string
  cancelLabel: string
  onAddCategory?: (categoryName: string) => Promise<void> | void
  onRenameCategory: (oldName: string, newName: string) => Promise<void> | void
  onDeleteCategory: (categoryName: string) => Promise<void> | void
}

export function showCategoryManagerDialog(options: CategoryManagerDialogOptions): Promise<void> {
  return new Promise((resolve) => {
    const dialog = el('dialog', 'confirmation-dialog category-manager-dialog') as HTMLDialogElement
    dialog.setAttribute('aria-labelledby', 'category-manager-title')

    const headerRow = el('div', 'category-manager-header-row')
    const title = el('h2', 'confirmation-dialog-title category-manager-title', options.title)
    title.id = 'category-manager-title'
    headerRow.append(title)

    let addBtn: HTMLButtonElement | null = null
    if (options.onAddCategory && options.addCategoryLabel) {
      addBtn = createControlButton(
        'plus',
        options.addCategoryLabel,
        () => {
          void (async () => {
            const catName = await showPromptDialog({
              title: options.addCategoryLabel!,
              placeholder: options.addCategoryPrompt ?? 'Category name:',
              confirmLabel: options.confirmLabel,
              cancelLabel: options.cancelLabel,
            })
            if (catName && catName.trim()) {
              await options.onAddCategory?.(catName.trim())
              renderList()
            }
          })()
        },
        'category-manager-add-btn',
        true,
      )
      headerRow.append(addBtn)
    }

    const body = el('div', 'confirmation-dialog-body category-manager-body')

    const renderList = (): void => {
      body.innerHTML = ''
      const categories = listCategories(options.bundle)

      // nodata 时隐藏右上角的添加分类按钮，只保留空状态里的添加按钮
      if (addBtn) {
        addBtn.style.display = categories.length === 0 ? 'none' : 'inline-flex'
      }

      if (categories.length === 0) {
        const emptyBox = el('div', 'category-manager-empty-box')
        const empty = el('p', 'category-manager-empty', options.noCustomCategories)
        emptyBox.append(empty)
        if (options.onAddCategory && options.addCategoryLabel) {
          const addFirstBtn = createControlButton(
            'plus',
            options.addCategoryLabel,
            () => {
              void (async () => {
                const catName = await showPromptDialog({
                  title: options.addCategoryLabel!,
                  placeholder: options.addCategoryPrompt ?? 'Category name:',
                  confirmLabel: options.confirmLabel,
                  cancelLabel: options.cancelLabel,
                })
                if (catName && catName.trim()) {
                  await options.onAddCategory?.(catName.trim())
                  renderList()
                }
              })()
            },
            'category-manager-empty-add-btn',
            true,
          )
          emptyBox.append(addFirstBtn)
        }
        body.append(emptyBox)
        return
      }

      const list = el('div', 'category-manager-list')
      for (const cat of categories) {
        const item = el('div', 'category-manager-item')

        const info = el('div', 'category-manager-item-info')
        const name = el('span', 'category-manager-name', cat.name)
        info.append(name)

        if (cat.isCheckpointOverridden) {
          const locked = el('span', 'category-manager-locked-badge', 'Checkpoint locked')
          info.append(locked)
        }

        const actions = el('div', 'category-manager-item-actions')
        const renameBtn = createControlButton(
          'edit',
          options.renameLabel,
          () => {
            void (async () => {
              const newName = await showPromptDialog({
                title: options.renameLabel,
                placeholder: options.renamePrompt,
                initialValue: cat.name,
                confirmLabel: options.confirmLabel,
                cancelLabel: options.cancelLabel,
              })
              if (newName && newName.trim() && newName.trim() !== cat.name) {
                await options.onRenameCategory(cat.name, newName.trim())
                renderList()
              }
            })()
          },
          'category-manager-action-btn',
        )
        if (cat.isCheckpointOverridden) {
          renameBtn.disabled = true
        }

        const deleteBtn = createControlButton(
          'trash',
          options.deleteLabel,
          () => {
            void (async () => {
              const confirmed = await showConfirmDialog({
                title: options.deleteLabel,
                messages: [options.deleteConfirm],
                destructive: true,
                confirmLabel: options.deleteLabel,
                cancelLabel: options.cancelLabel,
              })
              if (confirmed) {
                await options.onDeleteCategory(cat.name)
                renderList()
              }
            })()
          },
          'category-manager-action-btn is-destructive',
        )
        if (cat.isCheckpointOverridden) {
          deleteBtn.disabled = true
        }

        actions.append(renameBtn, deleteBtn)
        item.append(info, actions)
        list.append(item)
      }
      body.append(list)
    }

    renderList()

    dialog.append(headerRow, body)

    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      try {
        if (dialog.open && typeof dialog.close === 'function') dialog.close()
      } finally {
        dialog.remove()
        resolve()
      }
    }

    dialog.addEventListener('cancel', (e) => {
      e.preventDefault()
      finish()
    })
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) {
        const rect = dialog.getBoundingClientRect()
        const isInDialog = (
          rect.top <= event.clientY &&
          event.clientY <= rect.bottom &&
          rect.left <= event.clientX &&
          event.clientX <= rect.right
        )
        if (!isInDialog) finish()
      }
    })

    document.body.append(dialog)
    if (typeof dialog.showModal === 'function') dialog.showModal()
  })
}
