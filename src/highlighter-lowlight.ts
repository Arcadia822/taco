import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import { mermaidLanguage } from './mermaid-language.ts'
import { createLowlight } from 'lowlight'
import type { SourceHighlighter, SourceLanguage } from './source-editor.ts'

interface HighlightNode {
  type: string
  value?: string
  tagName?: string
  properties?: { className?: string | string[] }
  children?: HighlightNode[]
}

const appendHighlightNode = (parent: Node, node: HighlightNode): void => {
  if (node.type === 'text') {
    parent.appendChild(document.createTextNode(node.value ?? ''))
    return
  }
  if (node.type !== 'element' || !node.tagName) return

  const element = document.createElement(node.tagName)
  const className = node.properties?.className
  if (className) element.className = Array.isArray(className) ? className.join(' ') : className
  for (const child of node.children ?? []) appendHighlightNode(element, child)
  parent.appendChild(element)
}

const lowlight = createLowlight({ json, yaml, mermaid: mermaidLanguage })

export const completeHighlighter: SourceHighlighter = (
  target: HTMLElement,
  language: SourceLanguage,
  value: string,
): void => {
  const tree = lowlight.highlight(language, value) as unknown as HighlightNode
  target.replaceChildren()
  for (const child of tree.children ?? []) appendHighlightNode(target, child)
}
