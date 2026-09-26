import { fileKind, parseBundle } from './model.ts'
import { MermaidRuntime } from './mermaid.ts'
import { bootCommon, recoveryGate } from './main-common.ts'
import { readEmbeddedDoc } from './kernel/save.ts'
import { loadLiteRichEditorAdapter, loadLiteHighlighter, loadLiteMermaid } from './lite-cdn-loader.ts'

const embedded = readEmbeddedDoc()
const parsed = parseBundle(embedded ?? '')
if (parsed.ok) {
  const bundle = parsed.bundle
  const hasMarkdown = bundle.files.some((f) => fileKind(f) === 'markdown')
  const hasCode = bundle.files.some((f) => {
    const k = fileKind(f)
    return k === 'json' || k === 'yaml' || k === 'mermaid'
  })
  const hasMermaidFile = bundle.files.some((f) => fileKind(f) === 'mermaid')

  const richEditorAdapter = hasMarkdown ? loadLiteRichEditorAdapter() : undefined
  const highlighter = hasCode ? loadLiteHighlighter() : undefined

  let mermaidLoadAttempt = 0
  let preloadedMermaid = hasMermaidFile ? loadLiteMermaid(mermaidLoadAttempt++) : undefined
  const mermaidRuntime = new MermaidRuntime(() => {
    const pending = preloadedMermaid
    preloadedMermaid = undefined
    return pending ?? loadLiteMermaid(mermaidLoadAttempt++)
  })

  bootCommon(bundle, {
    richEditorAdapter,
    highlighter,
    mermaidRuntime,
  }, Promise.allSettled([richEditorAdapter, highlighter, preloadedMermaid]))
} else {
  recoveryGate(embedded, parsed.err === 'empty' ? 'The bundle block is empty.' : `${parsed.err}: ${parsed.detail}`)
}
