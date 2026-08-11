import { mergeAttributes, Node, type MarkdownToken } from '@tiptap/core'

interface PropertyRowToken {
  key: string
  tokens: MarkdownToken[]
}

type DocumentPropertiesToken = MarkdownToken & {
  type: 'documentProperties'
  raw: string
  rows: PropertyRowToken[]
}

const propertyRowPattern = /^\*\*([^*\r\n]+)\*\*:[ \t]*([^\r\n]*)(?:(?:\r?\n){2}|(?:\r?\n)?$)/
const standalonePropertyKeys = new Set(['Taco scope', 'Input'])

export const DocumentProperty = Node.create({
  name: 'documentProperty',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      key: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-key') ?? '',
        renderHTML: (attributes) => ({ 'data-key': String(attributes.key ?? '') }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="document-property"]', contentElement: '.document-property-value' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const internal = node.attrs.key === 'Taco scope'
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'document-property',
        'data-type': 'document-property',
        ...(internal ? { 'data-internal': 'true', hidden: '' } : {}),
      }),
      ['div', { class: 'document-property-key', contenteditable: 'false' }, String(node.attrs.key)],
      ['div', { class: 'document-property-value' }, 0],
    ]
  },
})

export const DocumentProperties = Node.create({
  name: 'documentProperties',
  group: 'block',
  content: 'documentProperty+',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="document-properties"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      class: 'document-properties',
      'data-type': 'document-properties',
    }), 0]
  },

  markdownTokenName: 'documentProperties',

  parseMarkdown(token, helpers) {
    const properties = token as DocumentPropertiesToken
    return helpers.createNode('documentProperties', undefined, properties.rows.map((row) =>
      helpers.createNode('documentProperty', { key: row.key }, helpers.parseInline(row.tokens))))
  },

  renderMarkdown(node, helpers) {
    return (node.content ?? []).map((row) => {
      const key = String(row.attrs?.key ?? '')
      return `**${key}**: ${helpers.renderChildren(row.content ?? [])}`
    }).join('\n\n')
  },

  markdownTokenizer: {
    name: 'documentProperties',
    level: 'block',
    start: (source) => propertyRowPattern.test(source) ? 0 : -1,
    tokenize(source, tokens, lexer) {
      if (tokens.length > 0) return undefined
      const rows: PropertyRowToken[] = []
      let raw = ''
      let remaining = source

      while (remaining) {
        const match = remaining.match(propertyRowPattern)
        if (!match) break
        rows.push({ key: match[1].trim(), tokens: lexer.inlineTokens(match[2]) })
        raw += match[0]
        remaining = remaining.slice(match[0].length)
      }

      if (!rows.length || (rows.length === 1 && !standalonePropertyKeys.has(rows[0].key))) return undefined
      return { type: 'documentProperties', raw, rows } as DocumentPropertiesToken
    },
  },
})
