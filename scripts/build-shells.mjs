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
await rm(outDir, { recursive: true, force: true })

const variants = [
  { variant: 'complete', outputName: 'Taco_Spec.taco.html' },
  { variant: 'lite', outputName: 'Taco_Spec_Lite.taco.html' },
]

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

console.log('\n=== Synchronizing Extension and Skill Shells ===')
run('scripts/sync-extension-shell.mjs', [])

console.log('\n=== Building Template HTMLs ===')
run('scripts/build-template-htmls.mjs', [])
