import { mergeAttributes, Node } from '@tiptap/core'
import { marked } from 'marked'

export const CenteredBlock = Node.create({
  name: 'centeredBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[align="center"]' }, { tag: 'div[data-taco-align="center"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      align: 'center',
      'data-taco-align': 'center',
      class: 'taco-centered-block',
    }), 0]
  },
  renderMarkdown(node, helpers) {
    // Markdown inside a raw HTML block is not parsed as Markdown on reopening.
    // Unedited source is retained by the block reconstructor; edits serialize current children.
    const children = helpers.renderChildren(node.content ?? [], '\n\n')
    return `<div align="center">\n${marked.parse(children, { async: false })}</div>`
  },
})
