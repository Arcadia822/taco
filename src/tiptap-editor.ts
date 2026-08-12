import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Editor, Extension, generateHTML } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { createTacoCodeBlock } from './tiptap-code-block.ts'
import type { TacoCodeBlockCommentTarget } from './tiptap-code-block.ts'
import { DocumentProperties, DocumentProperty } from './tiptap-document-properties.ts'
import { CenteredBlock } from './tiptap-centered-block.ts'
import type { MermaidPluginLabels, MermaidRuntime } from './mermaid.ts'
import { fileKind, type TacoBlock, type TacoBundle } from './model.ts'

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
}

export const createTacoEditorExtensions = (labels: MermaidPluginLabels, options: TacoEditorExtensionOptions = {}) => [
  StarterKit.configure({ codeBlock: false }),
  TacoBlockIdentity,
  DocumentProperties,
  DocumentProperty,
  CenteredBlock,
  createTacoCodeBlock(labels, {
    renderMermaid: options.renderMermaid,
    mermaidRuntime: options.mermaidRuntime,
    onComment: options.onCodeBlockComment,
  }),
  Image,
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
  (blocks ?? []).map((block) => block.html).join('')

/**
 * Upgrade legacy Markdown before a collaboration session adopts the bundle.
 * Doing this lazily after peers connect makes identical deterministic blocks
 * look like concurrent insert operations, which can duplicate their IDs.
 */
export const migrateTacoBundleBlocks = (bundle: TacoBundle, labels: MermaidPluginLabels): void => {
  for (const file of bundle.files) {
    if (fileKind(file) !== 'markdown' || file.blocks?.length) continue
    const extensions = createTacoEditorExtensions(labels, { renderMermaid: false })
    const editor = new Editor({
      extensions,
      content: file.content,
      contentType: 'markdown',
    })
    ensureTacoBlockIds(editor, file.id ?? file.path, true)
    file.blocks = blocksFromEditor(editor, extensions)
    editor.destroy()
  }
}
