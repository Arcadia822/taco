import DOMPurify from 'dompurify'
import { marked } from 'marked'

export function renderMarkdown(markdown: string): string {
  const rendered = marked.parse(markdown, {
    async: false,
    gfm: true,
    breaks: false,
  }) as string
  return DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'button'],
    FORBID_ATTR: ['style', 'onerror', 'onload'],
  })
}
