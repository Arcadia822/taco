import { completeRichEditorAdapter } from './rich-editor-tiptap.ts'
import { completeHighlighter } from './highlighter-lowlight.ts'
import { loadEmbeddedMermaid } from './mermaid-complete.ts'
import { MermaidRuntime } from './mermaid.ts'
import { bootCommon, recoveryGate } from './main-common.ts'
import { readEmbeddedDoc } from './kernel/save.ts'
import { parseBundle } from './model.ts'

const embedded = readEmbeddedDoc()
const parsed = parseBundle(embedded ?? '')
if (parsed.ok) {
  const mermaidRuntime = new MermaidRuntime(loadEmbeddedMermaid)
  bootCommon(parsed.bundle, {
    richEditorAdapter: completeRichEditorAdapter,
    highlighter: completeHighlighter,
    mermaidRuntime,
  })
} else {
  recoveryGate(embedded, parsed.err === 'empty' ? 'The bundle block is empty.' : `${parsed.err}: ${parsed.detail}`)
}
