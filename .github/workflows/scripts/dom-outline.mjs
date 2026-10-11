/**
 * dom-outline.mjs
 *
 * Extracts a compact DOM Outline from a live page inside the network-disabled container.
 * Specifically inspects SVG Mermaid diagrams to expose flowchart nodes and sequenceDiagram
 * actors/notes with explicit data attributes, labels, and classes so the planner can reliably target them.
 */

export function extractDomOutline() {
  const lines = []
  const interactiveElements = []
  const MAX_LINES = 500

  const ownText = (el) =>
    [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent?.trim() || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 80)
  const safeEscape = (str) => {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(str)
    }
    return String(str).replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&')
  }

  const isVisible = (el) => {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return false
    const s = window.getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) !== 0
  }
  // 1. Process SVG Mermaid diagrams specially
  const mermaidContainers = document.querySelectorAll(
    '.mermaid, .mermaid-preview-svg, svg[id^="mermaid-"], svg[id^="taco-mermaid-"], svg.flowchart',
  )
  for (const svg of mermaidContainers) {
    if (!isVisible(svg)) continue

    // Find flowchart nodes with accurate selectors
    const fcNodes = svg.querySelectorAll('g.node, g[class*="node"]')
    for (const node of fcNodes) {
      const text = node.textContent?.trim().replace(/\s+/g, ' ') || ''
      const dataId = node.getAttribute('data-id')
      let selector = 'svg g.node'
      if (node.id) {
        selector = `#${safeEscape(node.id)}`
      } else if (dataId) {
        selector = `g.node[data-id="${safeEscape(dataId)}"]`
      }
      interactiveElements.push({
        selector,
        description: `Mermaid flowchart node: "${text}"`,
        kind: 'flowchart-node',
        nodeId: node.id || dataId || '',
      })
    }

    // Find sequence diagram actors with accurate, real element selectors
    const actors = svg.querySelectorAll('g.actor, rect.actor, [data-actor], text.actor, .actor')
    for (const actor of actors) {
      const text = actor.textContent?.trim().replace(/\s+/g, ' ') || ''
      const aTag = actor.tagName.toLowerCase()
      let selector = ''
      if (actor.id) {
        selector = `#${safeEscape(actor.id)}`
      } else if (actor.hasAttribute('data-actor')) {
        selector = `${aTag}[data-actor="${safeEscape(actor.getAttribute('data-actor') || '')}"]`
      } else if (actor.classList.contains('actor')) {
        selector = `${aTag}.actor`
      } else {
        selector = aTag
      }
      interactiveElements.push({
        selector,
        description: `Mermaid sequence actor: "${text}"`,
        kind: 'sequence-actor',
      })
    }
  }

  // 2. Walk general HTML DOM
  const walk = (el, depth, fold) => {
    if (lines.length >= MAX_LINES) return
    const tag = el.tagName.toLowerCase()
    if (['script', 'style', 'link', 'meta', 'noscript', 'template'].includes(tag)) return
    if (!isVisible(el)) return

    // Special handling for SVG root
    if (tag === 'svg') {
      const isMermaid =
        el.closest('.mermaid') ||
        el.closest('.taco-mermaid-render') ||
        el.classList.contains('mermaid') ||
        el.classList.contains('flowchart') ||
        el.id.startsWith('mermaid-') ||
        el.id.startsWith('taco-mermaid-')
      const rect = el.getBoundingClientRect()
      const idAttr = el.id ? `#${el.id}` : ''
      const realClasses = [...el.classList].map((c) => `.${c}`).join('')
      const annotation = isMermaid ? ' (Mermaid diagram)' : ''
      lines.push(
        `${'  '.repeat(Math.min(depth, 12))}svg${idAttr}${realClasses}[width="${Math.round(rect.width)}"][height="${Math.round(rect.height)}"]${annotation}`,
      )

      // Expand nodes inside mermaid with real tag name and classes
      if (isMermaid) {
        const nodes = el.querySelectorAll('g.node, .actor')
        for (const n of nodes) {
          const text = n.textContent?.trim().replace(/\s+/g, ' ') || ''
          const nTag = n.tagName.toLowerCase()
          const nId = n.id ? `#${n.id}` : ''
          const cls = [...n.classList].map((c) => `.${c}`).join('')
          lines.push(`${'  '.repeat(Math.min(depth + 1, 12))}${nTag}${nId}${cls} "${text}"`)
        }
      }
      return
    }

    const cls = [...el.classList]
      .slice(0, 4)
      .map((c) => `.${c}`)
      .join('')
    const data = [...el.attributes]
      .filter((a) => a.name.startsWith('data-') && a.value.length < 40)
      .slice(0, 3)
      .map((a) => `[${a.name}="${a.value}"]`)
      .join('')
    const aria = ['role', 'aria-label', 'title', 'placeholder', 'type']
      .map((k) => (el.getAttribute(k) ? `${k}="${el.getAttribute(k).slice(0, 40)}"` : ''))
      .filter(Boolean)
      .join(' ')
    const text = ownText(el)
    const rect = el.getBoundingClientRect()
    const away = rect.top >= fold ? ' (below the fold)' : ''
    const interesting =
      cls ||
      data ||
      el.id ||
      text ||
      aria ||
      /^(button|a|input|select|textarea|label|h\d|nav|aside|main)$/.test(tag)

    if (interesting) {
      lines.push(
        `${'  '.repeat(Math.min(depth, 12))}${tag}${el.id ? '#' + el.id : ''}${cls}${data}${
          aria ? ' ' + aria : ''
        }${text ? ` "${text}"` : ''}${away}`,
      )
    }

    const s = window.getComputedStyle(el)
    const scrolls = /auto|scroll|overlay/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1
    for (const child of el.children) {
      walk(child, interesting ? depth + 1 : depth, scrolls ? Math.min(fold, rect.bottom) : fold)
    }
  }

  walk(document.body, 0, window.innerHeight)
  if (lines.length >= MAX_LINES) lines.push('… (truncated)')

  return {
    outline: lines.join('\n'),
    interactiveElements,
  }
}
