import StarterKit from '@tiptap/starter-kit'
import Paragraph from '@tiptap/extension-paragraph'
import Link from '@tiptap/extension-link'
import { Markdown } from '@tiptap/markdown'
import { Editor, Extension, generateHTML } from '@tiptap/core'
import Image, { type ImageOptions } from '@tiptap/extension-image'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { createTacoCodeBlock } from './tiptap-code-block.ts'
import type { TacoCodeBlockCommentTarget } from './tiptap-code-block.ts'
import { createDocumentProperties, type DocumentPropertiesLabels } from './tiptap-document-properties.ts'
import { CenteredBlock } from './tiptap-centered-block.ts'
import type { MermaidPluginLabels, MermaidRuntime } from './mermaid.ts'
import { fileKind, type TacoBlock, type TacoBundle } from './model.ts'
import { inertImageAttributes, sanitizeEditorHtml } from './security.ts'
import { splitFrontmatter } from './frontmatter.ts'

const BLOCK_TYPES = [
  'paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList',
  'taskList', 'horizontalRule', 'image', 'table', 'documentProperties',
  'centeredBlock',
]

const hashId = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

const randomBlockId = (): string => {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `block-${value}`
}

export const TacoBlockIdentity = Extension.create({
  name: 'tacoBlockIdentity',
  addGlobalAttributes() {
    return [{
      types: BLOCK_TYPES,
      attributes: {
        tacoBlockId: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-taco-block-id'),
          renderHTML: (attributes) => attributes.tacoBlockId
            ? { 'data-taco-block-id': String(attributes.tacoBlockId) }
            : {},
        },
      },
    }]
  },
})

export interface TacoEditorExtensionOptions {
  renderMermaid?: boolean
  mermaidRuntime?: MermaidRuntime
  onCodeBlockComment?: (target: TacoCodeBlockCommentTarget) => void
  propertyLabels?: DocumentPropertiesLabels
}

// Tiptap's default paragraph parser unwraps standalone images for its block
// image schema. Inline images must remain inside a paragraph in every context.
const ImageParagraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    if (token.tokens?.length === 1 && token.tokens[0].type === 'image') {
      return helpers.createNode('paragraph', undefined, helpers.parseInline(token.tokens))
    }
    return Paragraph.config.parseMarkdown!.call(this, token, helpers)
  },
})

const markdownLink = (content: string, attrs: Record<string, unknown> | undefined): string => {
  const href = String(attrs?.href ?? '')
  const escapedHref = href.replace(/\\/g, '\\\\').replace(/[<>]/g, '\\$&')
  const destination = /[\s()<>]/.test(href) ? `<${escapedHref}>` : escapedHref
  const title = attrs?.title ? ` "${String(attrs.title).replace(/[\\"]/g, '\\$&')}"` : ''
  return `[${content}](${destination}${title})`
}

// The upstream Markdown mark helper only marks text, dropping links on atoms.
const ImageLink = Link.extend({
  parseMarkdown(token, helpers) {
    return helpers.parseInline(token.tokens ?? []).map((node) => ({
      ...node,
      marks: [...(node.marks ?? []), { type: 'link', attrs: { href: token.href, title: token.title || null } }],
    }))
  },
})

const SafeImage = Image.extend({
  addOptions(): ImageOptions {
    return {
      ...this.parent?.(),
      allowBase64: true,
      inline: true,
    } as ImageOptions
  },
  renderMarkdown(node, helpers, context) {
    let markdown = Image.config.renderMarkdown!.call(this, node, helpers, context)
    const link = node.marks?.find((mark) => mark.type === 'link')
    if (link) {
      markdown = markdownLink(markdown, link.attrs)
    }
    return markdown
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-taco-source') ?? element.getAttribute('src'),
        renderHTML: (attributes) => inertImageAttributes(attributes.src),
      },
    }
  },
})

export const createTacoEditorExtensions = (labels: MermaidPluginLabels, options: TacoEditorExtensionOptions = {}) => [
  StarterKit.configure({ codeBlock: false, paragraph: false, link: false }),
  ImageParagraph,
  ImageLink,
  TacoBlockIdentity,
  createDocumentProperties(options.propertyLabels),
  CenteredBlock,
  createTacoCodeBlock(labels, {
    renderMermaid: options.renderMermaid,
    mermaidRuntime: options.mermaidRuntime,
    onComment: options.onCodeBlockComment,
  }),
  SafeImage,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  Markdown.configure({ markedOptions: { gfm: true } }),
]

export const ensureTacoBlockIds = (editor: Editor, fileId: string, deterministic: boolean): boolean => {
  let transaction = editor.state.tr
  let changed = false
  editor.state.doc.forEach((node, offset, index) => {
    if (node.attrs.tacoBlockId) return
    const id = deterministic
      ? `block-${hashId(`${fileId}\u001f${index}\u001f${node.type.name}\u001f${node.textContent}`)}`
      : randomBlockId()
    transaction = transaction.setNodeMarkup(offset, undefined, { ...node.attrs, tacoBlockId: id })
    changed = true
  })
  if (changed) editor.view.dispatch(transaction)
  return changed
}

export const blocksFromEditor = (editor: Editor, extensions: ReturnType<typeof createTacoEditorExtensions>): TacoBlock[] => {
  const blocks: TacoBlock[] = []
  editor.state.doc.forEach((node) => {
    const id = String(node.attrs.tacoBlockId ?? '')
    if (!id) return
    blocks.push({
      id,
      type: node.type.name,
      html: generateHTML({ type: 'doc', content: [node.toJSON()] }, extensions),
    })
  })
  return blocks
}

export const blockHtml = (blocks: TacoBlock[] | undefined): string =>
  (blocks ?? []).map((block) => {
    const container = document.createElement('div')
    container.innerHTML = sanitizeEditorHtml(block.html)
    // Tiptap strips newline-only HTML text nodes before parsing. A soft break
    // between inline images is still a word separator; retain it as a space.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const text = walker.currentNode
      if (/^\n\s*$/.test(text.textContent ?? '') && text.parentElement?.closest('p, h1, h2, h3, h4, h5, h6') && !text.parentElement.closest('pre, code')) {
        text.textContent = ' '
      }
    }
    const html = container.innerHTML
    // Older Taco files stored standalone images as top-level blocks. Keep their
    // collaboration identity on the paragraph required by the inline schema.
    if (block.type !== 'image') return html
    const paragraph = document.createElement('p')
    paragraph.setAttribute('data-taco-block-id', block.id)
    paragraph.innerHTML = html
    return paragraph.outerHTML
  }).join('')

/**
 * Upgrade legacy Markdown before a collaboration session adopts the bundle.
 * Doing this lazily after peers connect makes identical deterministic blocks
 * look like concurrent insert operations, which can duplicate their IDs.
 */
export interface TacoBlockMigrationFailure {
  path: string
  message: string
}

export const migrateTacoBundleBlocks = (bundle: TacoBundle, labels: MermaidPluginLabels): TacoBlockMigrationFailure[] => {
  const failures: TacoBlockMigrationFailure[] = []
  for (const file of bundle.files) {
    if (fileKind(file) !== 'markdown') continue
    const hasFrontmatter = Boolean(splitFrontmatter(file.content))
    const blockHasFrontmatter = file.blocks?.some((block) => block.type === 'documentProperties' && block.html.includes('data-yaml=')) ?? false
    const legacyPropertiesBlock = file.blocks?.some((block) => block.type === 'documentProperties' && !block.html.includes('data-yaml=')) ?? false
    if (file.blocks?.length && hasFrontmatter === blockHasFrontmatter && !legacyPropertiesBlock) continue
    const extensions = createTacoEditorExtensions(labels, { renderMermaid: false })
    let editor: Editor | undefined
    try {
      editor = new Editor({ extensions, content: file.content, contentType: 'markdown' })
      editor.state.doc.check()
      ensureTacoBlockIds(editor, file.id ?? file.path, true)
      file.blocks = blocksFromEditor(editor, extensions)
    } catch (error) {
      failures.push({ path: file.path, message: error instanceof Error ? error.message : String(error) })
    } finally {
      editor?.destroy()
    }
  }
  return failures
}
