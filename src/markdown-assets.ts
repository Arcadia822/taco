import { relativePath, type TacoBundle, type TacoFile } from './model.ts'

const marketingDocument = (bundle: TacoBundle, file: TacoFile): boolean =>
  bundle.docId === 'taco-product-spec' && relativePath(bundle, file) === 'README.md'

export const resolveEmbeddedMarkdownAssets = (
  root: ParentNode,
  bundle: TacoBundle,
  file: TacoFile,
): void => {
  if (!marketingDocument(bundle, file)) return
  for (const image of root.querySelectorAll<HTMLImageElement>('img')) {
    const source = image.dataset.tacoSource ?? image.getAttribute('src') ?? ''
    const embedded = __EMBEDDED_ASSETS__[source]
    if (!embedded) continue
    image.dataset.tacoSource = source
    if (image.getAttribute('src') !== embedded) image.setAttribute('src', embedded)
  }
}
