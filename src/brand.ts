const SVG_NS = 'http://www.w3.org/2000/svg'

export const createBrandMark = (): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.classList.add('brand-mark-icon')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')

  const bubbles = [
    { cx: '15.2', cy: '8.8', r: '4.8', className: 'brand-bubble brand-bubble-primary' },
    { cx: '7.2', cy: '14.4', r: '3.2', className: 'brand-bubble brand-bubble-secondary' },
    { cx: '14.8', cy: '18', r: '2', className: 'brand-bubble brand-bubble-tertiary' },
  ]

  for (const bubble of bubbles) {
    const circle = document.createElementNS(SVG_NS, 'circle')
    circle.setAttribute('cx', bubble.cx)
    circle.setAttribute('cy', bubble.cy)
    circle.setAttribute('r', bubble.r)
    circle.setAttribute('class', bubble.className)
    svg.append(circle)
  }

  return svg
}

export const createBrandMarkContainer = (className = 'brand-mark'): HTMLSpanElement => {
  const mark = document.createElement('span')
  mark.className = className
  mark.append(createBrandMark())
  return mark
}
