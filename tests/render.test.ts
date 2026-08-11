import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/render.ts'
import { slugifyHeading } from '../src/slugify.ts'

describe('Markdown rendering', () => {
  it('renders GFM while removing executable HTML', () => {
    const html = renderMarkdown(`# Title\n\n- [x] done\n\n<script>window.pwned = true</script>\n<img src=x onerror="window.pwned=true">`)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('h1')?.textContent).toBe('Title')
    expect(doc.querySelector('input[type="checkbox"]')).not.toBeNull()
    expect(doc.querySelector('script')).toBeNull()
    expect(doc.querySelector('img')?.hasAttribute('onerror')).toBe(false)
  })

  it('creates deterministic unique heading anchors', () => {
    const used = new Set<string>()
    expect(slugifyHeading('Success Criteria', used)).toBe('success-criteria')
    expect(slugifyHeading('Success Criteria', used)).toBe('success-criteria-2')
    expect(slugifyHeading('用户故事', used)).toBe('用户故事')
  })
})
