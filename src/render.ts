import { marked } from 'marked'
import { sanitizeRenderedHtml } from './security.ts'

export function renderMarkdown(markdown: string): string {
  const rendered = marked.parse(markdown, {
    async: false,
    gfm: true,
    breaks: false,
  }) as string
  return sanitizeRenderedHtml(rendered)
}
