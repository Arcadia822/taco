// Single-file build pattern adapted from bento/spaces under the MIT License.
// Copyright (c) 2026 The Bento authors.
import { defineConfig } from 'vitest/config'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const projectRoot = resolve(new URL('.', import.meta.url).pathname)
const specRoot = resolve(projectRoot, 'specs/001-taco-bento-product')
const bundleRoot = 'specs/001-taco-bento-product'

const embeddedAssets = {
  'src/assets/taco-logo.svg': `data:image/svg+xml;base64,${readFileSync(resolve(projectRoot, 'src/assets/taco-logo.svg')).toString('base64')}`,
  'docs/assets/taco-overview.png': `data:image/jpeg;base64,${readFileSync(resolve(projectRoot, 'docs/assets/taco-overview.png')).toString('base64')}`,
  'docs/assets/taco-overview.zh-CN.png': `data:image/jpeg;base64,${readFileSync(resolve(projectRoot, 'docs/assets/taco-overview.zh-CN.png')).toString('base64')}`,
}

const fileTitles: Record<string, string> = {
  'README.md': 'Taco',
  'checklists/implementation.md': 'Taco v0.3 Implementation Audit',
  'checklists/requirements.md': 'Specification Quality Checklist: Taco File Browser',
  'contracts/taco-document.md': 'Contract: Taco File Bundle v1',
  'data-model.md': 'Data Model: File-first Taco Bundle',
  'interaction-design.md': 'Interaction Design: Taco File Browser',
  'plan.md': 'Implementation Plan: Taco File Browser',
  'prototypes/taco-preview.html': 'Taco HTML Preview Demo',
  'quickstart.md': 'Quickstart: Validate Taco File Browsing',
  'research.md': 'Research: Spec Kit Artifact Boundary and Bento Mapping',
  'spec.md': 'Feature Specification: Taco File Browser',
  'tasks.md': 'Tasks: Taco File Browser',
  'visual-system.md': 'Visual System: Taco File Browser',
}

const mediaType = (path: string): string => {
  if (path.endsWith('.md')) return 'text/markdown'
  if (/\.html?$/i.test(path)) return 'text/html'
  if (/\.ya?ml$/.test(path)) return 'application/yaml'
  if (path.endsWith('.json')) return 'application/json'
  return 'text/plain'
}

interface EmbeddedFile {
  path: string
  mediaType: string
  content: string
  title?: string
  sourceUrl?: string
}

const readFiles = (directory: string): EmbeddedFile[] => {
  const files: EmbeddedFile[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...readFiles(absolute))
    else if (entry.isFile()) {
      const relativePath = relative(specRoot, absolute).split(sep).join('/')
      const path = `${bundleRoot}/${relativePath}`
      const type = mediaType(path)
      files.push({
        path,
        mediaType: type,
        content: readFileSync(absolute, 'utf8'),
        ...(fileTitles[relativePath] ? { title: fileTitles[relativePath] } : {}),
        // The committed showcase shell must be byte-identical across checkout locations.
        // Runtime resolves this exact portable reference to a canonical file: URL.
        ...(type === 'text/html' ? { sourceUrl: `../${path}` } : {}),
      })
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

const bundle = JSON.stringify({
  format: 'taco/files',
  version: 1,
  docId: 'taco-product-spec',
  title: 'Taco Spec',
  root: bundleRoot,
  files: readFiles(specRoot),
}, null, 2).replace(/</g, '\\u003c')

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEFAULT_LOCALE__: JSON.stringify(process.env.TACO_DEFAULT_LOCALE ?? ''),
    __EMBEDDED_ASSETS__: JSON.stringify(embeddedAssets),
  },
  plugins: [
    {
      name: 'taco-spec-files',
      transformIndexHtml(html: string) {
        return html.replace(
          '<script type="application/taco+json" id="taco-document"></script>',
          `<script type="application/taco+json" id="taco-document">\n${bundle}\n</script>`,
        )
      },
    },
    ...(process.env.SINGLEFILE ? [viteSingleFile()] : []),
  ],
  build: {
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4096,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  test: { environment: 'jsdom' },
})
