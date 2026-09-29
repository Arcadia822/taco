#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { rm, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'

const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const outDir = resolve(projectRoot, 'dist-single')

function run(script, args = []) {
  execFileSync(process.execPath, [resolve(projectRoot, script), ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
  })
}

process.env.SINGLEFILE = '1'

const requestedVariant = process.argv[2] ?? process.env.TACO_VARIANT
const allVariants = [
  { variant: 'complete', outputName: 'Taco_Spec.taco.html' },
  { variant: 'lite', outputName: 'Taco_Spec_Lite.taco.html' },
  { variant: 'host', outputName: 'Taco_Spec_Host.taco.html' },
]

const variants = requestedVariant
  ? allVariants.filter((v) => v.variant === requestedVariant)
  : allVariants

if (variants.length === 0) {
  throw new Error(`Unknown variant "${requestedVariant}"; must be complete, lite, or host`)
}

if (!requestedVariant) {
  await rm(outDir, { recursive: true, force: true })
}

for (const { variant, outputName } of variants) {
  process.env.TACO_VARIANT = variant
  console.log(`\n=== Building Taco ${variant.toUpperCase()} Shell ===`)
  await build({
    configFile: resolve(projectRoot, 'vite.config.ts'),
    root: projectRoot,
    build: {
      outDir,
      emptyOutDir: false,
    },
  })
  const builtHtml = resolve(outDir, 'index.html')
  const targetHtml = resolve(outDir, outputName)
  await rename(builtHtml, targetHtml)

  console.log(`=== Compressing ${outputName} ===`)
  run('scripts/postbuild-compress.mjs', [targetHtml])

  console.log(`=== Gating ${outputName} (${variant}) ===`)
  run('scripts/shell-gate.mjs', [targetHtml, variant])
}

console.log('\n=== Synchronizing Extension, Skill, and Host Shells ===')
run('scripts/sync-extension-shell.mjs', requestedVariant ? [requestedVariant] : [])
if (!requestedVariant || requestedVariant === 'complete') {
  console.log('\n=== Building Template HTMLs ===')
  run('scripts/build-template-htmls.mjs', [])

  console.log('\n=== Synchronizing the Skill Version Marker ===')
  run('scripts/sync-skill-version.mjs', [])
}
