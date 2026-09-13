import { mergeAttributes, Node } from '@tiptap/core'

export const CenteredBlock = Node.create({
  name: 'centeredBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      rawHtml: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-taco-raw-html'),
        renderHTML: (attributes) => (attributes.rawHtml ? { 'data-taco-raw-html': attributes.rawHtml } : {}),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[align="center"]',
        getAttrs: (node) => {
          const element = node as HTMLElement
          const rawAttr = element.getAttribute('data-taco-raw-html') || element.dataset.tacoRawHtml
          let raw = rawAttr
          if (raw && raw.startsWith('%')) {
            try { raw = decodeURIComponent(raw) } catch {}
          }
          return {
            rawHtml: raw || null,
          }
        },
      },
      {
        tag: 'div[data-taco-align="center"]',
        getAttrs: (node) => {
          const element = node as HTMLElement
          const rawAttr = element.getAttribute('data-taco-raw-html') || element.dataset.tacoRawHtml
          let raw = rawAttr
          if (raw && raw.startsWith('%')) {
            try { raw = decodeURIComponent(raw) } catch {}
          }
          return {
            rawHtml: raw || null,
          }
        },
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      align: 'center',
      'data-taco-align': 'center',
      class: 'taco-centered-block',
    }), 0]
  },
  renderMarkdown(node, helpers) {
    if (node.attrs?.rawHtml) {
      return String(node.attrs.rawHtml)
    }
    return `<div align="center">\n${helpers.renderChildren(node.content ?? [], '\n')}\n</div>`
  },
})
