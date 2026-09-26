import { completeRichEditorAdapter } from './rich-editor-tiptap.ts'
import { completeHighlighter } from './highlighter-lowlight.ts'
import { loadEmbeddedMermaid } from './mermaid-complete.ts'
import { MermaidRuntime } from './mermaid.ts'
import { bootCommon, recoveryGate } from './main-common.ts'
import { readEmbeddedDoc } from './kernel/save.ts'
import { fileKind, parseBundle } from './model.ts'

const embedded = readEmbeddedDoc()
const parsed = parseBundle(embedded ?? '')
if (parsed.ok) {
  const mermaidRuntime = new MermaidRuntime(loadEmbeddedMermaid)
  const mermaidReady = parsed.bundle.files.some((file) => fileKind(file) === 'mermaid')
    ? mermaidRuntime.load()
    : undefined
  bootCommon(parsed.bundle, {
    richEditorAdapter: completeRichEditorAdapter,
    highlighter: completeHighlighter,
    mermaidRuntime,
  }, mermaidReady)
} else {
  recoveryGate(embedded, parsed.err === 'empty' ? 'The bundle block is empty.' : `${parsed.err}: ${parsed.detail}`)
}
