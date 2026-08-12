import { describe, expect, it } from 'vitest'
import { resolveEmbeddedMarkdownAssets } from '../src/markdown-assets.ts'
import type { TacoBundle } from '../src/model.ts'

const bundle = (): TacoBundle => ({
  format: 'taco/files',
  version: 1,
  docId: 'taco-product-spec',
  title: 'Taco',
  root: 'specs/001-taco-bento-product',
  files: [{
    path: 'specs/001-taco-bento-product/README.md',
    mediaType: 'text/markdown',
    content: '# Taco',
  }],
})

describe('embedded Markdown assets', () => {
  it('resolves marketing README images without changing their canonical source', () => {
    const documentBundle = bundle()
    const root = document.createElement('div')
    root.innerHTML = [
      '<img src="src/assets/taco-logo.svg">',
      '<img src="docs/assets/taco-overview.png">',
      '<img src="https://example.com/badge.svg">',
    ].join('')

    resolveEmbeddedMarkdownAssets(root, documentBundle, documentBundle.files[0])

    const images = root.querySelectorAll('img')
    expect(images[0].getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(images[0].dataset.tacoSource).toBe('src/assets/taco-logo.svg')
    expect(images[1].getAttribute('src')).toMatch(/^data:image\/jpeg;base64,/)
    expect(images[1].dataset.tacoSource).toBe('docs/assets/taco-overview.png')
    expect(images[2].getAttribute('src')).toBe('https://example.com/badge.svg')
    expect(documentBundle.files[0].content).toBe('# Taco')
  })

  it('does not substitute assets in unrelated Taco documents', () => {
    const documentBundle = bundle()
    documentBundle.docId = 'another-spec'
    const root = document.createElement('div')
    root.innerHTML = '<img src="src/assets/taco-logo.svg">'

    resolveEmbeddedMarkdownAssets(root, documentBundle, documentBundle.files[0])

    expect(root.querySelector('img')?.getAttribute('src')).toBe('src/assets/taco-logo.svg')
  })
})
