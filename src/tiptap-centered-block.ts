import { mergeAttributes, Node } from '@tiptap/core'

export const CenteredBlock = Node.create({
  name: 'centeredBlock',
  group: 'block',
  content: 'block+',
  defining: true,

  parseHTML() {
    return [
      { tag: 'div[align="center"]' },
      { tag: 'div[data-taco-align="center"]' },
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
    return `<div align="center">\n${helpers.renderChildren(node.content ?? [], '\n')}\n</div>`
  },
})
