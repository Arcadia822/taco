import type { LanguageFn } from 'highlight.js'

export const mermaidLanguage: LanguageFn = (hljs) => ({
  name: 'Mermaid',
  aliases: ['mmd'],
  keywords: {
    keyword: [
      'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram-v2', 'erDiagram',
      'journey', 'gantt', 'pie', 'quadrantChart', 'requirementDiagram', 'gitGraph', 'mindmap',
      'timeline', 'sankey-beta', 'xychart-beta', 'block-beta', 'packet', 'architecture-beta', 'kanban',
      'subgraph', 'end', 'direction', 'participant', 'actor', 'autonumber', 'activate', 'deactivate',
      'loop', 'alt', 'else', 'opt', 'par', 'and', 'rect', 'critical', 'break', 'note', 'over',
      'left', 'right', 'of', 'as', 'classDef', 'class', 'click', 'style', 'linkStyle',
    ].join(' '),
  },
  contains: [
    { begin: /^---[ \t]*$/, end: /^---[ \t]*$/, subLanguage: 'yaml' },
    hljs.COMMENT('%%', '$'),
    hljs.QUOTE_STRING_MODE,
    { scope: 'symbol', begin: /(?:<-->|<--|-->|---|-\.->|==>|~~~|--x|--o|o--|x--)/ },
    { scope: 'title', begin: /\b[A-Za-z_][\w-]*(?=\s*[[(\{])/ },
    { scope: 'number', begin: hljs.NUMBER_RE },
  ],
})
