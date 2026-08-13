import { describe, expect, it } from 'vitest'
import { localFileReference, localFileUrl, portableLocalFileReference } from '../src/local-file-url.ts'

describe('local HTML file URLs', () => {
  const path = 'specs/001-demo/prototypes/checkout flow.html'

  it('accepts a canonical absolute file URL regardless of the Taco location', () => {
    const source = 'file:///Users/example/project/specs/001-demo/prototypes/checkout%20flow.html'
    expect(localFileUrl(source, path)).toBe(source)
  })

  it('resolves the built-in portable reference only from a local Taco page', () => {
    const reference = `../${path}`
    expect(portableLocalFileReference(reference, path)).toBe(true)
    expect(localFileReference(reference, path)).toBe(true)
    expect(localFileUrl(reference, path, 'file:///Users/example/project/dist-single/Taco_Spec.taco.html'))
      .toBe('file:///Users/example/project/specs/001-demo/prototypes/checkout%20flow.html')
    expect(localFileUrl(reference, path, 'https://example.test/Taco_Spec.taco.html')).toBeNull()
  })

  it.each([
    'data:text/html;base64,PGgxPkJhZDwvaDE+',
    'https://example.test/checkout.html',
    '../specs/001-demo/prototypes/other.html',
    'file:///Users/example/project/specs/other/checkout%20flow.html',
    'file:///Users/example/project/specs/001-demo/prototypes/checkout%20flow.html?query=1',
    'file:///Users/example/project/specs/001-demo/prototypes/checkout%20flow.html#hash',
  ])('rejects a non-canonical preview URL: %s', (source) => {
    expect(localFileUrl(source, path)).toBeNull()
  })
})
