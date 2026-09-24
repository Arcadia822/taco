import { beforeEach, describe, expect, it, vi } from 'vitest'
import { showCategoryManagerDialog } from '../src/category-manager-dialog.ts'
import { FORMAT, type TacoBundle } from '../src/model.ts'

const createBundle = (files: Array<{ path: string; content?: string }>): TacoBundle => ({
  format: FORMAT,
  version: 1,
  docId: 'dialog-test',
  title: 'Dialog Test',
  root: 'specs/sample',
  files: files.map((f) => ({
    id: f.path,
    path: f.path,
    mediaType: f.path.endsWith('.yaml') ? 'application/yaml' : 'text/markdown',
    content: f.content ?? '# test',
  })),
})

describe('CategoryManagerDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders category list, files, sources, and empty state properly', async () => {
    const bundle = createBundle([
      { path: 'specs/sample/docs/intro.md', content: '# Intro' },
    ])

    const onRenameCategory = vi.fn()
    const onDeleteCategory = vi.fn()

    const promise = showCategoryManagerDialog({
      bundle,
      title: 'Manage categories',
      closeLabel: 'Close',
      renameLabel: 'Rename category',
      deleteLabel: 'Delete category',
      deleteConfirm: 'Delete this category?',
      renamePrompt: 'New category name:',
      affectedFiles: (count) => `${count} files`,
      noCustomCategories: 'No custom categories found.',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      onRenameCategory,
      onDeleteCategory,
    })

    const dialog = document.querySelector<HTMLDialogElement>('.category-manager-dialog')
    expect(dialog).not.toBeNull()
    expect(dialog?.querySelector('h2')?.textContent).toBe('Manage categories')

    const items = dialog?.querySelectorAll('.category-manager-item')
    expect(items).toHaveLength(1)

    const name = dialog?.querySelector('.category-manager-name')
    expect(name?.textContent).toBe('docs')

    // 验证去掉了展开详情和影响文件数量徽章
    expect(dialog?.querySelector('.category-manager-count')).toBeNull()
    expect(dialog?.querySelector('.category-manager-caret')).toBeNull()
    expect(dialog?.querySelector('.category-manager-sources')).toBeNull()
    expect(dialog?.querySelector('.category-manager-files')).toBeNull()

    // 验证有分类时右上角添加按钮可见
    const topAddBtn = dialog?.querySelector<HTMLButtonElement>('.category-manager-add-btn')
    expect(topAddBtn?.style.display).not.toBe('none')
    // 点击关闭按钮关闭弹窗
    // 点击外部或触发 cancel 事件关闭弹窗
    dialog?.dispatchEvent(new Event('cancel'))
    await promise

    expect(document.querySelector('.category-manager-dialog')).toBeNull()
  })

  it('renders empty message when no custom categories exist', async () => {
    const bundle = createBundle([
      { path: 'specs/sample/other.md', content: '# No Category' },
    ])

    const promise = showCategoryManagerDialog({
      bundle,
      title: 'Manage categories',
      closeLabel: 'Close',
      renameLabel: 'Rename category',
      deleteLabel: 'Delete category',
      deleteConfirm: 'Delete this category?',
      renamePrompt: 'New category name:',
      noCustomCategories: 'No custom categories found.',
      addCategoryLabel: 'Add category',
      addCategoryPrompt: 'Category name:',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      onAddCategory: vi.fn(),
      onRenameCategory: vi.fn(),
      onDeleteCategory: vi.fn(),
    })

    const dialog = document.querySelector<HTMLDialogElement>('.category-manager-dialog')
    const empty = dialog?.querySelector('.category-manager-empty')
    expect(empty?.textContent).toBe('No custom categories found.')

    // 验证 nodata 时右上角添加分类按钮隐藏，空状态中添加按钮可见
    const topAddBtn = dialog?.querySelector<HTMLButtonElement>('.category-manager-add-btn')
    expect(topAddBtn?.style.display).toBe('none')
    const emptyAddBtn = dialog?.querySelector<HTMLButtonElement>('.category-manager-empty-add-btn')
    expect(emptyAddBtn).not.toBeNull()
    dialog?.dispatchEvent(new Event('cancel'))
    await promise
  })

  it('disables actions for checkpoint locked categories', async () => {
    const bundle = createBundle([
      { path: 'specs/sample/locked/item.md', content: '# Locked' },
    ])
    bundle.checkpoints = {
      version: 1,
      nodes: [{
        id: 'review',
        title: 'Review',
        after: [],
        documents: [{ path: 'specs/sample/locked/item.md' }],
      }],
      documents: [],
    }

    const promise = showCategoryManagerDialog({
      bundle,
      title: 'Manage categories',
      closeLabel: 'Close',
      renameLabel: 'Rename category',
      deleteLabel: 'Delete category',
      deleteConfirm: 'Delete this category?',
      renamePrompt: 'New category name:',
      affectedFiles: (count) => `${count} files`,
      noCustomCategories: 'No custom categories found.',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      onRenameCategory: vi.fn(),
      onDeleteCategory: vi.fn(),
    })

    const dialog = document.querySelector<HTMLDialogElement>('.category-manager-dialog')
    const lockedBadge = dialog?.querySelector('.category-manager-locked-badge')
    expect(lockedBadge?.textContent).toBe('Checkpoint locked')

    const actionButtons = dialog?.querySelectorAll<HTMLButtonElement>('.category-manager-action-btn')
    expect(actionButtons?.length).toBeGreaterThanOrEqual(2)
    actionButtons?.forEach((btn) => {
      expect(btn.disabled).toBe(true)
    })

    dialog?.dispatchEvent(new Event('cancel'))
    await promise
  })

  it('renders add category button and triggers onAddCategory', async () => {
    const bundle = createBundle([
      { path: 'specs/sample/README.md', content: '# No Category' },
    ])

    const onAddCategory = vi.fn()

    const promise = showCategoryManagerDialog({
      bundle,
      title: 'Manage categories',
      closeLabel: 'Close',
      renameLabel: 'Rename category',
      deleteLabel: 'Delete category',
      deleteConfirm: 'Delete this category?',
      renamePrompt: 'New category name:',
      affectedFiles: (count) => `${count} files`,
      noCustomCategories: 'No custom categories found.',
      addCategoryLabel: 'Add category',
      addCategoryPrompt: 'Category name:',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      onAddCategory,
      onRenameCategory: vi.fn(),
      onDeleteCategory: vi.fn(),
    })

    const dialog = document.querySelector<HTMLDialogElement>('.category-manager-dialog')
    const addBtn = dialog?.querySelector<HTMLButtonElement>('.category-manager-add-btn')
    expect(addBtn).not.toBeNull()
    expect(addBtn?.textContent).toContain('Add category')

    dialog?.dispatchEvent(new Event('cancel'))
    await promise
  })
})
