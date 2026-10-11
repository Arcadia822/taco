import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

// Canonical Shell paths
const completeShellPath = join(root, 'skills/taco/taco-shell.html')
const liteShellPath = join(root, 'skills/taco/taco-shell-lite.html')

if (!existsSync(completeShellPath)) {
  throw new Error(`Canonical complete shell missing at ${completeShellPath}; run 'npm run build' first to build shells`)
}
if (!existsSync(liteShellPath)) {
  throw new Error(`Canonical lite shell missing at ${liteShellPath}; run 'npm run build' first to build shells`)
}

const completeShell = await readFile(completeShellPath, 'utf8')
const liteShell = await readFile(liteShellPath, 'utf8')

if (!completeShell.includes('id="taco-document"')) {
  throw new Error(`Complete shell at ${completeShellPath} does not contain #taco-document`)
}
if (!liteShell.includes('id="taco-document"')) {
  throw new Error(`Lite shell at ${liteShellPath} does not contain #taco-document`)
}

// Template files from extensions/taco/templates/
const templatesDir = join(root, 'extensions/taco/templates')
const templateNames = ['spec', 'architecture', 'api-reference', 'adr']
const templates = {}

for (const name of templateNames) {
  const dir = join(templatesDir, name)
  const templateMdPath = join(dir, 'template.md')
  const readmeMdPath = join(dir, 'README.md')
  if (!existsSync(templateMdPath)) {
    throw new Error(`Required template markdown missing at ${templateMdPath}`)
  }
  const templateMd = await readFile(templateMdPath, 'utf8')
  const readmeMd = existsSync(readmeMdPath) ? await readFile(readmeMdPath, 'utf8') : ''
  templates[name] = {
    name,
    templateMd,
    readmeMd,
  }
}

// Canonical Skill + references
const skillMdPath = join(root, 'skills/taco/SKILL.md')
if (!existsSync(skillMdPath)) {
  throw new Error(`Required canonical Skill guide missing at ${skillMdPath}`)
}
const skillMd = await readFile(skillMdPath, 'utf8')

const references = {}
const refDir = join(root, 'skills/taco/references')
if (!existsSync(refDir)) {
  throw new Error(`Required references directory missing at ${refDir}`)
}
const files = await readdir(refDir)
for (const file of files) {
  if (file.endsWith('.md')) {
    references[file] = await readFile(join(refDir, file), 'utf8')
  }
}

const outDir = join(root, 'packages/cli/src/generated')
await mkdir(outDir, { recursive: true })

const code = `// GENERATED FILE - DO NOT EDIT MANUALLY
// Run 'node scripts/build-cli-assets.mjs' to regenerate.

export const COMPLETE_SHELL_HTML: string = ${JSON.stringify(completeShell)}

export const LITE_SHELL_HTML: string = ${JSON.stringify(liteShell)}

export interface TemplateAsset {
  name: string
  templateMd: string
  readmeMd: string
}

export const TEMPLATES: Record<string, TemplateAsset> = ${JSON.stringify(templates, null, 2)}

export const CANONICAL_SKILL_MD: string = ${JSON.stringify(skillMd)}

export const CANONICAL_REFERENCES: Record<string, string> = ${JSON.stringify(references, null, 2)}
`

await writeFile(join(outDir, 'assets.ts'), code, 'utf8')
console.log(`[build-cli-assets] Successfully generated packages/cli/src/generated/assets.ts`)
