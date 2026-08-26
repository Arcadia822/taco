import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSegmentedControl } from '../src/segmented-control.ts'

describe('createSegmentedControl', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders reusable labelled options and keeps selection state in sync', () => {
    const onChange = vi.fn()
    const control = createSegmentedControl({
      label: 'Appearance',
      value: 'system',
      options: [
        { value: 'system', label: '跟随系统' },
        { value: 'light', label: '明亮' },
        { value: 'dark', label: '暗色' },
      ],
      onChange,
    })
    document.body.append(control.element)

    const system = control.element.querySelector<HTMLButtonElement>('[data-segmented-value="system"]')!
    const dark = control.element.querySelector<HTMLButtonElement>('[data-segmented-value="dark"]')!
    expect(control.element.getAttribute('aria-label')).toBe('Appearance')
    expect(system.getAttribute('aria-pressed')).toBe('true')
    expect(dark.getAttribute('aria-pressed')).toBe('false')

    dark.click()
    expect(onChange).toHaveBeenCalledWith('dark')
    expect(system.getAttribute('aria-pressed')).toBe('false')
    expect(dark.getAttribute('aria-pressed')).toBe('true')

    control.setValue('light')
    expect(control.element.querySelector('[data-segmented-value="light"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(dark.getAttribute('aria-pressed')).toBe('false')
  })

  it('provides the shared tab semantics used by document and file views', () => {
    const control = createSegmentedControl({
      label: 'Document panels',
      value: 'outline',
      variant: 'tabs',
      className: 'right-panel-tabs',
      options: [
        { value: 'outline', label: 'Outline', controls: 'outline-panel' },
        { value: 'comments', label: 'Comments', controls: 'comments-panel' },
      ],
      onChange: vi.fn(),
    })
    document.body.append(control.element)

    const outline = control.buttonFor('outline')!
    const comments = control.buttonFor('comments')!
    expect(control.element.getAttribute('role')).toBe('tablist')
    expect(control.element.classList.contains('right-panel-tabs')).toBe(true)
    expect(outline.getAttribute('role')).toBe('tab')
    expect(outline.getAttribute('aria-selected')).toBe('true')
    expect(outline.getAttribute('aria-controls')).toBe('outline-panel')
    comments.click()
    expect(comments.getAttribute('aria-selected')).toBe('true')
    expect(comments.tabIndex).toBe(0)
    expect(outline.tabIndex).toBe(-1)
  })
})
