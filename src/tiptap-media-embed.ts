import { Node } from '@tiptap/core'
import { sanitizeEditorHtml } from './security.ts'

/**
 * Keeps sanitized `<video>`, `<audio>`, and `<iframe>` embeds alive inside the
 * ProseMirror schema. Without nodes for them, the editor drops the elements
 * when it parses block HTML, and the Markdown reconstructor serializes them
 * back out as empty strings — losing author content on every edit.
 *
 * Two shapes are needed because marked emits different tokens for the same
 * markup: a lone embed on its own line becomes a block html token, while an
 * embed that shares a paragraph context becomes inline html tokens merged into
 * paragraph content. Block-level nodes are illegal inside a paragraph, so the
 * inline shape gets its own node; both hold the sanitized markup verbatim and
 * round-trip without modeling each tag in the schema.
 */
const createMediaEmbedNode = (name: string, inline: boolean) =>
  Node.create({
    name,
    group: inline ? 'inline' : 'block',
    inline,
    atom: true,
    defining: true,

    addAttributes() {
      return {
        html: {
          default: '',
          // Only the inline variant parses from DOM: marked merges a single-line
          // embed into paragraph content, which must stay inline-legal. Block
          // embeds arrive through the html token handler, never parseHTML.
          parseHTML: inline ? (element) => element.outerHTML : undefined,
        },
      }
    },

    parseHTML() {
      return inline ? [{ tag: 'video' }, { tag: 'audio' }, { tag: 'iframe' }] : []
    },

    renderHTML({ node }) {
      const container = document.createElement(inline ? 'span' : 'div')
      container.setAttribute('data-taco-media-embed', '')
      container.innerHTML = sanitizeEditorHtml(String(node.attrs.html ?? ''))
      return { dom: container }
    },

    markdownTokenName: 'html',

    parseMarkdown(token, helpers) {
      const raw = String((token as { raw?: string; text?: string }).raw ?? '')
      // Claim only pure media embeds; anything else (a centered `<div>`, ad-hoc
      // `<p>` runs) keeps flowing through the schema's regular HTML parsing so
      // CenteredBlock and paragraphs survive.
      if (!/^<(?:video|audio|iframe)\b/i.test(raw.trim())) return []
      return helpers.createNode(name, { html: raw }, [])
    },

    renderMarkdown(node) {
      return String(node.attrs?.html ?? '').trim()
    },
  })

export const MediaEmbed = createMediaEmbedNode('mediaEmbed', false)
export const InlineMediaEmbed = createMediaEmbedNode('inlineMediaEmbed', true)
