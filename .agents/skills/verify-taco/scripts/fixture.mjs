// SPDX-License-Identifier: MIT
// Deterministic verification fixture for the Taco browser scenarios.
//
// The fixture is data, not a build product: writeFixture() copies a generated
// shell and replaces only its #taco-document data block, so the shipped
// Complete/Lite shells stay byte-identical and no .taco.html is committed.

import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ROOT = 'verify'
const DOC_ID = 'taco-verify-fixture'
const TITLE = 'Taco verification fixture'

const MARKERS = {
  intro: 'Verify fixture intro marker',
  guide: 'Verify fixture guide marker',
  duplicateA: 'Verify fixture duplicateA marker',
  duplicateB: 'Verify fixture duplicateB marker',
  text: 'Verify fixture text marker',
  htmlInline: 'Verify fixture html inline marker',
}

const INSTRUCTION =
  'Verify fixture plan instruction: review the plan file, then create the missing tasks file.'

// A reserved TLD that never resolves; the shell sandbox CSP and the runner route
// both refuse it, which is what the offline assertion needs.
const EXTERNAL_URL = 'https://example.invalid/taco-verify-external.js'

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const INTRO = `# Verify fixture overview

${MARKERS.intro}: sidebar browsing, outline and search coverage.

See [the guide](guides/guide.md).

![Fixture pixel](assets/pixel.png)
`

const GUIDE = `# Guide

${MARKERS.guide}: nested folder navigation inside a named group.

See [plan](../spec/plan.md).

## Navigation details

${Array.from({ length: 20 }, (_, index) => `Navigation paragraph ${index + 1}: this review section makes the final heading begin outside the reader viewport so an Outline click must scroll to reveal it.`).join('\n\n')}

## Final guide section

This section is reached through Outline navigation after the document has scrolled.

${Array.from({ length: 20 }, (_, index) => `Final section paragraph ${index + 1}: the content below the heading permits scrolling it to the reader's leading edge and observing the active Outline entry.`).join('\n\n')}
`

const DUPLICATE_A = `# Guides index

${MARKERS.duplicateA}: same basename as notes/readme.md in another folder.
`

const DUPLICATE_B = `# Notes index

${MARKERS.duplicateB}: duplicate basename that must stay distinguishable.
`

const PROPERTIES = `---
title: Verify properties
owner: fixture
status: in_progress
tags:
  - verify
  - properties
reviewers:
  - Ada
  - Linus
---

# Properties

Verify fixture properties marker: frontmatter properties stay editable.
`

// Unclosed frontmatter is a supported editor state: the properties panel must
// report it instead of silently rewriting the source.
const UNCLOSED_FRONTMATTER = `---
title: Broken
owner: fixture
`

const YAML = `# Verify fixture configuration
service: taco-verify
version: 1
features:
  browsing: true
  checkpoints: true
`

const SAMPLE_JSON = `{
  "service": "taco-verify",
  "version": 1,
  "files": [
    { "path": "README.md", "kind": "markdown" },
    { "path": "data/sample.json", "kind": "json" }
  ]
}
`

const OPENAPI = `openapi: 3.0.3
info:
  title: Verify fixture API
  version: 1.0.0
paths:
  /tacos:
    get:
      summary: List tacos
      responses:
        '200':
          description: A list of tacos
`

const MERMAID = `flowchart LR
  Spec[Spec] --> Plan[Plan]
  Plan --> Tasks[Tasks]
`

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Verify fixture preview</title>
    <script>
      document.documentElement.dataset.verifyInlineMarker = '${MARKERS.htmlInline}'
    </script>
    <script src="${EXTERNAL_URL}"></script>
  </head>
  <body>
    <h1>Verify fixture preview</h1>
    <p>Sandboxed preview page served from the bundle data block.</p>
  </body>
</html>
`

const SPEC = `# Spec document

Checkpoint graph root. Frozen, so the plan node becomes available.
`

const PLAN = `# Plan document

${INSTRUCTION}
`

const PLAIN_TEXT = `${MARKERS.text}: plain text file kept as text.
`

const FILES = [
  { path: `${ROOT}/README.md`, mediaType: 'text/markdown', content: INTRO },
  { path: `${ROOT}/guides/guide.md`, mediaType: 'text/markdown', content: GUIDE },
  { path: `${ROOT}/guides/readme.md`, mediaType: 'text/markdown', content: DUPLICATE_A },
  { path: `${ROOT}/notes/readme.md`, mediaType: 'text/markdown', content: DUPLICATE_B },
  { path: `${ROOT}/notes/properties.md`, mediaType: 'text/markdown', content: PROPERTIES },
  { path: `${ROOT}/notes/plain.txt`, mediaType: 'text/plain', content: PLAIN_TEXT },
  {
    path: `${ROOT}/notes/unclosed-frontmatter.md`,
    mediaType: 'text/markdown',
    content: UNCLOSED_FRONTMATTER,
  },
  { path: `${ROOT}/data/config.yaml`, mediaType: 'text/yaml', content: YAML },
  { path: `${ROOT}/data/sample.json`, mediaType: 'application/json', content: SAMPLE_JSON },
  { path: `${ROOT}/api/openapi.yaml`, mediaType: 'text/yaml', content: OPENAPI },
  { path: `${ROOT}/diagrams/flow.mmd`, mediaType: 'text/vnd.taco.mermaid', content: MERMAID },
  { path: `${ROOT}/pages/preview.html`, mediaType: 'text/html', content: HTML },
  { path: `${ROOT}/assets/pixel.png`, mediaType: 'image/png', content: PNG_DATA_URL },
  { path: `${ROOT}/spec/spec.md`, mediaType: 'text/markdown', content: SPEC },
  { path: `${ROOT}/spec/plan.md`, mediaType: 'text/markdown', content: PLAN },
]

const NAVIGATION = {
  version: 1,
  entry: `${ROOT}/README.md`,
  groups: [
    {
      id: 'group-guides',
      title: 'Guides',
      paths: [`${ROOT}/guides/guide.md`, `${ROOT}/guides/readme.md`],
    },
    {
      id: 'group-data',
      title: 'Data',
      paths: [`${ROOT}/data/config.yaml`, `${ROOT}/data/sample.json`],
    },
    { id: 'group-api', title: 'API', paths: [`${ROOT}/api/openapi.yaml`] },
    { id: 'group-diagrams', title: 'Diagrams', paths: [`${ROOT}/diagrams/flow.mmd`] },
    {
      id: 'group-media',
      title: 'Media',
      paths: [`${ROOT}/assets/pixel.png`, `${ROOT}/pages/preview.html`],
    },
  ],
}

// Checkpoint document paths are bundle paths, unlike the root-relative manifest
// paths in FIXTURE.paths: the protocol requires them inside the bundle root.
// spec -> plan -> tasks. tasks.md is intentionally absent so the sidebar renders
// a placeholder row and the dashboard reports a declared-but-missing document.
const CHECKPOINTS = {
  version: 1,
  template: 'checkpoint',
  nodes: [
    { id: 'spec', title: 'Spec', after: [], documents: [{ path: `${ROOT}/spec/spec.md` }] },
    {
      id: 'plan',
      title: 'Plan',
      after: ['spec'],
      documents: [{ path: `${ROOT}/spec/plan.md`, instruction: INSTRUCTION }],
    },
    {
      id: 'tasks',
      title: 'Tasks',
      after: ['plan'],
      documents: [{ path: `${ROOT}/spec/tasks.md` }],
    },
  ],
  // Only files that exist carry a record: a declared-but-missing document has no
  // status until it is created, which is what the Checkpoint cases assert.
  documents: [
    { path: `${ROOT}/spec/spec.md`, status: 'freeze', updatedAt: '2026-01-02T03:04:05Z' },
    { path: `${ROOT}/spec/plan.md`, status: 'in_progress', updatedAt: '2026-01-02T03:05:06Z' },
  ],
}

const CANONICAL = {
  format: 'taco/files',
  version: 1,
  docId: DOC_ID,
  title: TITLE,
  root: ROOT,
  files: FILES,
  comments: [],
  navigation: NAVIGATION,
  checkpoints: CHECKPOINTS,
}

const full = (key) => `${ROOT}/${PATHS[key]}`

const PATHS = {
  intro: 'README.md',
  guide: 'guides/guide.md',
  duplicateA: 'guides/readme.md',
  duplicateB: 'notes/readme.md',
  properties: 'notes/properties.md',
  yaml: 'data/config.yaml',
  json: 'data/sample.json',
  openapi: 'api/openapi.yaml',
  mermaid: 'diagrams/flow.mmd',
  html: 'pages/preview.html',
  png: 'assets/pixel.png',
  text: 'notes/plain.txt',
  unclosedFrontmatter: 'notes/unclosed-frontmatter.md',
  spec: 'spec/spec.md',
  plan: 'spec/plan.md',
  tasks: 'spec/tasks.md',
}

/** Root-relative paths; dataPaths holds the exact sidebar data-path values. */
const DATA_PATHS = Object.fromEntries(Object.keys(PATHS).map((key) => [key, full(key)]))

const freeze = (value) => {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freeze(entry)))
  if (value && typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freeze(entry)])),
    )
  }
  return value
}

export const FIXTURE = freeze({
  root: ROOT,
  docId: DOC_ID,
  title: TITLE,
  paths: PATHS,
  dataPaths: DATA_PATHS,
  markers: MARKERS,
  instruction: INSTRUCTION,
  externalUrl: EXTERNAL_URL,
  pngDataUrl: PNG_DATA_URL,
  navigation: NAVIGATION,
  groups: NAVIGATION.groups.map(({ id, title }) => ({ id, title })),
  checkpointGroups: CHECKPOINTS.nodes.map(({ id, title }) => ({
    id: `checkpoint-${id}`,
    title,
    checkpointId: id,
  })),
  checkpoints: CHECKPOINTS,
  otherStage: 'other',
  shells: {
    complete: 'dist-single/Taco_Spec.taco.html',
    lite: 'dist-single/Taco_Spec_Lite.taco.html',
  },
})

/** A fresh, mutable bundle for one case. FIXTURE itself stays immutable data. */
export function fixtureBundle() {
  return structuredClone(CANONICAL)
}

const DATA_BLOCK = /<script\b[^>]*\bid=["']taco-document["'][^>]*>[\s\S]*?<\/script>/i

/** Replace only the #taco-document data block of an existing generated shell. */
export async function writeFixture({ shell, out }) {
  assert(typeof shell === 'string' && shell, 'writeFixture requires the shell path')
  assert(typeof out === 'string' && out, 'writeFixture requires the output path')
  const html = await readFile(shell, 'utf8')
  const block = DATA_BLOCK.exec(html)
  assert(block, `Shell has no #taco-document data block: ${shell}`)
  const bundle = fixtureBundle()
  // Escaping '<' keeps the JSON valid and makes a '</script>' sequence impossible.
  const json = JSON.stringify(bundle).replaceAll('<', '\\u003c')
  const next = `${html.slice(0, block.index)}<script type="application/taco+json" id="taco-document">${json}</script>${html.slice(block.index + block[0].length)}`
  await mkdir(dirname(resolve(out)), { recursive: true })
  await writeFile(out, next)
  return { artifact: out, bundle, fixture: FIXTURE }
}
