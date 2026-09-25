import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import type { LanguageFn } from 'highlight.js'
import { createLowlight } from 'lowlight'
import type { SourceHighlighter, SourceLanguage } from './source-editor.ts'

const mermaid: LanguageFn = (hljs) => ({
  name: 'Mermaid',
  aliases: ['mmd'],
  keywords: {
    keyword: [
      'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram-v2', 'erDiagram',
      'journey', 'gantt', 'pie', 'quadrantChart', 'requirementDiagram', 'gitGraph', 'mindmap',
      'timeline', 'sankey-beta', 'xychart-beta', 'block-beta', 'packet', 'architecture-beta', 'kanban',
      'subgraph', 'end', 'direction', 'participant', 'actor', 'autonumber', 'activate', 'deactivate',
      'loop', 'alt', 'else', 'opt', 'par', 'and', 'rect', 'critical', 'break', 'note', 'over',
      'left', 'right', 'of', 'as', 'classDef', 'class', 'click', 'style', 'linkStyle',
    ].join(' '),
  },
  contains: [
    { begin: /^---[ \t]*$/, end: /^---[ \t]*$/, subLanguage: 'yaml' },
    hljs.COMMENT('%%', '$'),
    hljs.QUOTE_STRING_MODE,
    { scope: 'symbol', begin: /(?:<-->|<--|-->|---|-\.->|==>|~~~|--x|--o|o--|x--)/ },
    { scope: 'title', begin: /\b[A-Za-z_][\w-]*(?=\s*[[(\{])/ },
    { scope: 'number', begin: hljs.NUMBER_RE },
  ],
})

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

const lowlight = createLowlight({ json, yaml, mermaid })

export const completeHighlighter: SourceHighlighter = (
  target: HTMLElement,
  language: SourceLanguage,
  value: string,
): void => {
  const tree = lowlight.highlight(language, value) as unknown as HighlightNode
  target.replaceChildren()
  for (const child of tree.children ?? []) appendHighlightNode(target, child)
}
