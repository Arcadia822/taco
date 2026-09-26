import { Editor } from '@tiptap/core'
import {
  blockHtml,
  blocksFromEditor,
  createTacoEditorExtensions,
  ensureTacoBlockIds,
  migrateTacoBundleBlocks,
} from './tiptap-editor.ts'
import { MarkdownBlockReconstructor } from './markdown-block-reconstructor.ts'
import { setEditorFrontmatterProperty } from './tiptap-document-properties.ts'
import { resolveEmbeddedMarkdownAssets } from './markdown-assets.ts'
import type { RichEditorAdapter, RichEditorHandle, RichEditorMountOptions } from './rich-editor.ts'
import type { MermaidPluginLabels } from './mermaid.ts'

export class TiptapRichEditorAdapter implements RichEditorAdapter {
  migrateBundleBlocks(
    bundle: Parameters<typeof migrateTacoBundleBlocks>[0],
    labels?: Record<string, string | undefined>,
  ): Array<{ path: string; message: string }> {
    const mermaidLabels = (labels ?? {}) as unknown as Parameters<typeof migrateTacoBundleBlocks>[1]
    return migrateTacoBundleBlocks(bundle, mermaidLabels)
  }

  mount(options: RichEditorMountOptions): RichEditorHandle {
    const {
      element,
      file,
      bundle,
      readOnly,
      labels,
      mermaidRuntime,
      onUpdate,
      onCodeBlockComment,
      onLinkClick,
      onSelectionChange,
      onRefreshHighlights,
      onOutlinePaint,
      scrollToHeading,
    } = options
    const reconstructor = new MarkdownBlockReconstructor()
    const mermaidLabels: MermaidPluginLabels = {
      source: labels.source ?? 'Source',
      hidePreview: labels.hidePreview ?? 'Hide preview',
      zoom: labels.zoom ?? 'Zoom',
      zoomIn: labels.zoomIn ?? 'Zoom in',
      zoomOut: labels.zoomOut ?? 'Zoom out',
      resetZoom: labels.resetZoom ?? 'Reset zoom',
      zoomLevel: labels.zoomLevel ?? 'Zoom level',
      close: labels.close ?? 'Close',
      previewTitle: labels.previewTitle ?? 'Diagram',
      copy: labels.copy ?? 'Copy',
      copied: labels.copied ?? 'Copied',
      copyFailed: labels.copyFailed ?? 'Copy failed',
      comment: labels.comment ?? 'Comment',
      auto: labels.auto ?? 'Auto',
      plainText: labels.plainText ?? 'Plain text',
      loading: labels.loading ?? 'Loading…',
      error: labels.error ?? 'Error',
      theme: labels.theme,
      codePanel: labels.codePanel,
      lineComment: labels.lineComment,
      nodeComment: labels.nodeComment,
      direction: labels.direction,
      liveUpdate: labels.liveUpdate,
      updateDiagram: labels.updateDiagram,
    }

    const extensions = createTacoEditorExtensions(mermaidLabels, {
      mermaidRuntime,
      onCodeBlockComment,
    })

    const hasBlocks = Boolean(file.blocks?.length)
    let mounting = true
    let destroyed = false

    const editor = new Editor({
      element,
      extensions,
      editable: !readOnly,
      content: hasBlocks ? blockHtml(file.blocks) : file.content,
      ...(hasBlocks ? { parseOptions: { preserveWhitespace: 'full' as const } } : { contentType: 'markdown' as const }),
      editorProps: {
        attributes: {
          class: 'tiptap',
          'aria-label': labels.markdownEditor,
        },
      },
      onUpdate: ({ editor: activeEditor, transaction }) => {
        if (mounting || destroyed) return
        if (!transaction.docChanged) return
        if (ensureTacoBlockIds(activeEditor, file.id ?? file.path, false)) return
        const nextMarkdown = reconstructor.reconstruct(activeEditor)
        if (nextMarkdown === file.content || nextMarkdown.trim() === file.content.trim()) return
        onUpdate(nextMarkdown, blocksFromEditor(activeEditor, extensions))
        requestAnimationFrame(() => {
          if (destroyed) return
          resolveEmbeddedMarkdownAssets(element, bundle, file)
          onRefreshHighlights?.(element)
          onOutlinePaint?.()
        })
      },
    })

    ensureTacoBlockIds(editor, file.id ?? file.path, !hasBlocks)
    reconstructor.init(file.content, editor)
    if (!file.blocks?.length) {
      file.blocks = blocksFromEditor(editor, extensions)
    }
    mounting = false

    requestAnimationFrame(() => {
      if (destroyed) return
      resolveEmbeddedMarkdownAssets(element, bundle, file)
      onRefreshHighlights?.(element)
      const headingHash = decodeURIComponent(location.hash.split('::')[1] ?? '')
      if (headingHash && scrollToHeading) scrollToHeading(headingHash)
      onOutlinePaint?.()
    })

    const handleClick = (event: MouseEvent): void => onLinkClick?.(event)
    const handleMouseUp = (): void => onSelectionChange?.()
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Shift' || event.key === 'Escape') return
      onSelectionChange?.()
    }

    element.addEventListener('click', handleClick)
    element.addEventListener('mouseup', handleMouseUp)
    element.addEventListener('keyup', handleKeyUp)

    return {
      element,
      rawEditor: editor,
      destroy: () => {
        destroyed = true
        element.removeEventListener('click', handleClick)
        element.removeEventListener('mouseup', handleMouseUp)
        element.removeEventListener('keyup', handleKeyUp)
        editor.destroy()
      },
      setTitle: (title: string): boolean => {
        if (destroyed) return false
        return setEditorFrontmatterProperty(editor, 'title', title || undefined)
      },
    }
  }
}

export const completeRichEditorAdapter: RichEditorAdapter = new TiptapRichEditorAdapter()
