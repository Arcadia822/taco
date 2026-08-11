export interface SegmentedControlOption<Value extends string> {
  value: Value
  label: string
  title?: string
}

export interface SegmentedControlOptions<Value extends string> {
  label: string
  value: Value
  options: readonly SegmentedControlOption<Value>[]
  className?: string
  onChange: (value: Value) => void
}

export interface SegmentedControl<Value extends string> {
  element: HTMLDivElement
  setValue: (value: Value) => void
}

export const createSegmentedControl = <Value extends string>(
  config: SegmentedControlOptions<Value>,
): SegmentedControl<Value> => {
  const element = document.createElement('div')
  element.className = ['segmented-control', config.className].filter(Boolean).join(' ')
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', config.label)

  const buttons = new Map<Value, HTMLButtonElement>()

  const setValue = (value: Value): void => {
    for (const [optionValue, button] of buttons) {
      const active = optionValue === value
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-pressed', String(active))
    }
  }

  for (const option of config.options) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'segmented-control-option'
    button.textContent = option.label
    button.title = option.title ?? option.label
    button.dataset.segmentedValue = option.value
    button.addEventListener('click', () => {
      setValue(option.value)
      config.onChange(option.value)
    })
    buttons.set(option.value, button)
    element.append(button)
  }

  setValue(config.value)
  return { element, setValue }
}
