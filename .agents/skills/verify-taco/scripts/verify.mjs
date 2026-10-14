#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Standalone entry point: run one ad-hoc scenario, or every case of a case
// module, against any built .taco.html bundle. Each run owns its resources and
// keeps its evidence.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT, runVerification } from './harness.mjs'

const USAGE =
  'Usage: verify.mjs [--artifact path.taco.html] [--scenario path.mjs] [--out new-directory]'

const args = process.argv.slice(2)
const allowed = new Set(['--artifact', '--scenario', '--out'])
const options = {}
for (let i = 0; i < args.length; i += 2) {
  assert(allowed.has(args[i]) && args[i + 1] && !args[i + 1].startsWith('--'), USAGE)
  options[args[i]] = args[i + 1]
}

const artifact = resolve(REPO_ROOT, options['--artifact'] ?? 'dist-single/Taco_Spec.taco.html')
const scenario = resolve(
  REPO_ROOT,
  options['--scenario'] ?? '.agents/skills/verify-taco/scripts/browse.mjs',
)
const outDir = resolve(
  REPO_ROOT,
  options['--out'] ??
    `artifacts/verify-taco/${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`,
)

const drive = await import(pathToFileURL(scenario).href)
const label = relative(REPO_ROOT, scenario)
const caseDirFor = (index, id) =>
  resolve(outDir, `${String(index + 1).padStart(2, '0')}-${id.replace(/[^A-Za-z0-9._-]+/g, '-')}`)

let ok
if (typeof drive.default === 'function') {
  const result = await runVerification({
    artifact,
    outDir,
    run: drive.default,
    fixture: drive.fixture ?? null,
    label,
  })
  ok = result.ok
} else {
  const cases = Array.isArray(drive.cases) ? drive.cases : null
  assert(
    cases?.length,
    'Scenario must export default async function(harness) or a non-empty cases array',
  )
  // The multi-case form keeps a fresh directory proof at the run root.
  await mkdir(outDir, { recursive: true })
  try {
    await writeFile(
      resolve(outDir, 'run.json'),
      JSON.stringify(
        { scenario: relative(REPO_ROOT, scenario), started: new Date().toISOString() },
        null,
        2,
      ),
      { flag: 'wx' },
    )
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(
        `Evidence directory already holds a run: ${relative(REPO_ROOT, outDir)}; pass a fresh --out directory`,
      )
    }
    throw error
  }
  ok = true
  for (const [index, entry] of cases.entries()) {
    assert(typeof entry?.id === 'string' && entry.id, 'Every case needs a human-readable id')
    assert(typeof entry.run === 'function', `Case ${entry.id} does not implement run(h)`)
    const result = await runVerification({
      artifact,
      outDir: caseDirFor(index, entry.id),
      run: (h) => entry.run(h),
      fixture: drive.fixture ?? null,
      label: entry.id,
    })
    if (!result.ok) ok = false
  }
}

console.error(
  JSON.stringify({
    phase: 'verify-complete',
    ok,
    scenario: label,
    outDir: relative(REPO_ROOT, outDir),
  }),
)
if (!ok) process.exitCode = 1
