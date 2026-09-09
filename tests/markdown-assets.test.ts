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
      '<img src="https://raw.githubusercontent.com/Arcadia822/taco/main/src/assets/taco-logo.svg">',
      '<img src="https://raw.githubusercontent.com/Arcadia822/taco/main/docs/assets/taco-overview.png">',
      '<img src="https://example.com/badge.svg">',
    ].join('')

    resolveEmbeddedMarkdownAssets(root, documentBundle, documentBundle.files[0], 'file:')

    const images = root.querySelectorAll('img')
    expect(images[0].getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(images[0].dataset.tacoSource).toBe('https://raw.githubusercontent.com/Arcadia822/taco/main/src/assets/taco-logo.svg')
    expect(images[1].getAttribute('src')).toMatch(/^data:image\/jpeg;base64,/)
    expect(images[1].dataset.tacoSource).toBe('https://raw.githubusercontent.com/Arcadia822/taco/main/docs/assets/taco-overview.png')
    expect(images[2].getAttribute('src')).toBe('https://example.com/badge.svg')
    expect(documentBundle.files[0].content).toBe('# Taco')
  })

  it('loads trusted marketing images from GitHub on hosted Taco pages', () => {
    const documentBundle = bundle()
    const root = document.createElement('div')
    const source = 'https://raw.githubusercontent.com/Arcadia822/taco/main/src/assets/taco-logo.svg'
    root.innerHTML = `<img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" data-taco-source="${source}">`

    resolveEmbeddedMarkdownAssets(root, documentBundle, documentBundle.files[0], 'https:')

    expect(root.querySelector('img')?.getAttribute('src')).toBe(source)
    expect(root.querySelector('img')?.dataset.tacoSource).toBe(source)
  })

  it('does not substitute assets in unrelated Taco documents', () => {
    const documentBundle = bundle()
    documentBundle.docId = 'another-spec'
    const root = document.createElement('div')
    root.innerHTML = '<img src="src/assets/taco-logo.svg">'

    resolveEmbeddedMarkdownAssets(root, documentBundle, documentBundle.files[0])

    expect(root.querySelector('img')?.getAttribute('src')).toBe('src/assets/taco-logo.svg')
  })

  it('resolves relative PNG references for top-level and nested Markdown documents', () => {
    const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const testBundle: TacoBundle = {
      format: 'taco/files',
      version: 1,
      docId: 'local-png-spec',
      title: 'Local PNG Feature',
      root: 'specs/007-local-png-assets',
      files: [
        {
          path: 'specs/007-local-png-assets/spec.md',
          mediaType: 'text/markdown',
          content: '## Spec\n\n![UI](design/screen.png)\n![UI](./design/screen.png)',
        },
        {
          path: 'specs/007-local-png-assets/checklists/requirements.md',
          mediaType: 'text/markdown',
          content: '## Checklist\n\n![UI](../design/screen.png)',
        },
        {
          path: 'specs/007-local-png-assets/design/screen.png',
          mediaType: 'image/png',
          content: pngDataUrl,
          sourceHash: 'b'.repeat(64),
        },
        {
          path: 'specs/007-local-png-assets/design/screen shot.png',
          mediaType: 'image/png',
          content: pngDataUrl,
          sourceHash: 'c'.repeat(64),
        },
      ],
    }

    // Test top-level document with both design/screen.png and ./design/screen.png
    const topRoot = document.createElement('div')
    topRoot.innerHTML = [
      '<img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" data-taco-source="design/screen.png">',
      '<img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" data-taco-source="./design/screen.png">',
      '<img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" data-taco-source="design/screen%20shot.png">',
      '<img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" data-taco-source="../../outside.png">',
      '<img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" data-taco-source="design/nonexistent.png">',
    ].join('')

    resolveEmbeddedMarkdownAssets(topRoot, testBundle, testBundle.files[0])

    const topImages = topRoot.querySelectorAll('img')
    expect(topImages[0].getAttribute('src')).toBe(pngDataUrl)
    expect(topImages[0].dataset.tacoSource).toBe('design/screen.png')

    expect(topImages[1].getAttribute('src')).toBe(pngDataUrl)
    expect(topImages[1].dataset.tacoSource).toBe('./design/screen.png')

    expect(topImages[2].getAttribute('src')).toBe(pngDataUrl)
    expect(topImages[2].dataset.tacoSource).toBe('design/screen%20shot.png')

    // Traversal outside bundle.root is ignored
    expect(topImages[3].getAttribute('src')).toBe('data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=')
    expect(topImages[3].dataset.tacoSource).toBe('../../outside.png')

    // Missing file is ignored
    expect(topImages[4].getAttribute('src')).toBe('data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=')
    expect(topImages[4].dataset.tacoSource).toBe('design/nonexistent.png')

    // Test nested document with ../design/screen.png
    const nestedRoot = document.createElement('div')
    nestedRoot.innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" data-taco-source="../design/screen.png">'

    resolveEmbeddedMarkdownAssets(nestedRoot, testBundle, testBundle.files[1])

    const nestedImage = nestedRoot.querySelector('img')
    expect(nestedImage?.getAttribute('src')).toBe(pngDataUrl)
    expect(nestedImage?.dataset.tacoSource).toBe('../design/screen.png')

    // Idempotency: re-running does not alter data-taco-source or src
    resolveEmbeddedMarkdownAssets(nestedRoot, testBundle, testBundle.files[1])
    expect(nestedImage?.getAttribute('src')).toBe(pngDataUrl)
    expect(nestedImage?.dataset.tacoSource).toBe('../design/screen.png')
  })
})
