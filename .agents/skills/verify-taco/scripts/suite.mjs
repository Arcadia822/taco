#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Sequential verification suite: every registered case runs in its own fresh
// evidence directory, from a fixture written into the current generated shells.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { FIXTURE, writeFixture } from './fixture.mjs'
import { DEFAULT_TIMEOUT_MS, REPO_ROOT, runVerification } from './harness.mjs'
import { loadRegistry, registryCases, registryProblems, selectCases } from './registry.mjs'

const USAGE = 'Usage: suite.mjs [--out new-directory] [--case id] [--feature name]'

// Boundaries no automated run may claim: they stay human or environmental.
const HUMAN_BOUNDARIES = [
  'Native file picker permission and real OS file handling',
  'A real system default browser and already-open user session',
  'Live CDN availability for the Lite variant',
  'Production deployment and cloud storage permissions',
  'Actual agent consumption of the handed-off bundle',
]

const parseArgs = (args) => {
  const options = { out: null, caseIds: [], features: [] }
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]
    const value = args[i + 1]
    assert(
      ['--out', '--case', '--feature'].includes(flag) && value && !value.startsWith('--'),
      USAGE,
    )
    if (flag === '--out') options.out = value
    else if (flag === '--case') options.caseIds.push(value)
    else options.features.push(value)
  }
  return options
}

const exists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const dirNameFor = (index, id) =>
  `${String(index + 1).padStart(2, '0')}-${id.replace(/[^A-Za-z0-9._-]+/g, '-')}`

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  const ci = Boolean(process.env.CI) && process.env.CI !== 'false'
  assert(
    !(ci && (options.caseIds.length || options.features.length)),
    '--case/--feature filters are refused in CI: the suite must run every registered case',
  )
  const stamp = new Date().toISOString().replaceAll(':', '-')
  const outDir = resolve(
    REPO_ROOT,
    options.out ?? `artifacts/verify-taco/suite-${stamp}-${randomUUID().slice(0, 8)}`,
  )
  await mkdir(outDir, { recursive: true })
  const started = new Date()
  try {
    await writeFile(
      resolve(outDir, 'suite-run.json'),
      JSON.stringify(
        {
          started: started.toISOString(),
          ci,
          filters: { caseIds: options.caseIds, features: options.features },
        },
        null,
        2,
      ),
      { flag: 'wx' },
    )
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(
        `Suite evidence directory already holds a run: ${relative(REPO_ROOT, outDir)}; pass a fresh --out directory`,
      )
    }
    throw error
  }

  const modules = await loadRegistry()
  const problems = registryProblems(modules)
  const registered = registryCases(modules)
  const selected = selectCases(registered, options)
  const summary = {
    started: started.toISOString(),
    ci,
    filters: { caseIds: options.caseIds, features: options.features },
    registry: {
      modules: modules.map((module) => ({
        file: module.file,
        cases: module.cases?.length ?? 0,
        error: module.error,
      })),
      problems,
    },
    counts: {
      registered: registered.length,
      selected: selected.length,
      executed: 0,
      passed: 0,
      failed: 0,
      boundaries: 0,
    },
    humanBoundaries: HUMAN_BOUNDARIES,
    boundaries: [],
    cases: [],
  }
  const finish = async () => {
    summary.finished = new Date().toISOString()
    summary.ok = summary.counts.failed === 0 && summary.counts.executed > 0 && problems.length === 0
    await writeFile(resolve(outDir, 'suite.json'), JSON.stringify(summary, null, 2))
    console.log(
      JSON.stringify({
        phase: 'suite-complete',
        ok: summary.ok,
        outDir: relative(REPO_ROOT, outDir),
        executed: summary.counts.executed,
        failed: summary.counts.failed,
        problems: problems.length,
      }),
    )
    return summary.ok ? 0 : 1
  }

  if (problems.length) {
    for (const problem of problems) console.error(`registry: ${problem}`)
    return finish()
  }
  if (!selected.length) {
    console.error(
      `registry: no case selected; ${registered.length} registered, filters ${JSON.stringify(summary.filters)}`,
    )
    return finish()
  }

  const shells = {
    complete: resolve(REPO_ROOT, FIXTURE.shells.complete),
    lite: resolve(REPO_ROOT, FIXTURE.shells.lite),
  }
  for (const [variant, path] of Object.entries(shells)) {
    if (!(await exists(path)))
      throw new Error(
        `Missing the ${variant} shell ${relative(REPO_ROOT, path)}; build the product first`,
      )
  }

  for (const [index, entry] of selected.entries()) {
    const dir = dirNameFor(index, entry.id)
    const caseDir = resolve(outDir, dir)
    const shell = entry.variant === 'lite' ? shells.lite : shells.complete
    let result
    try {
      const { artifact } = await writeFixture({ shell, out: resolve(caseDir, 'fixture.taco.html') })
      result = await runVerification({
        artifact,
        outDir: caseDir,
        run: (h) => entry.run(h),
        fixture: FIXTURE,
        label: entry.id,
        timeout: entry.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      })
    } catch (error) {
      result = {
        ok: false,
        error: error.message,
        boundaries: [],
        cleanup: { run: 'not started' },
        outDir: relative(REPO_ROOT, caseDir),
      }
    }
    summary.counts.executed += 1
    if (result.ok) summary.counts.passed += 1
    else summary.counts.failed += 1
    for (const boundary of result.boundaries ?? []) {
      summary.boundaries.push({ case: entry.id, ...boundary })
    }
    summary.counts.boundaries = summary.boundaries.length
    summary.cases.push({
      id: entry.id,
      feature: entry.feature,
      file: entry.file,
      variant: entry.variant === 'lite' ? 'lite' : 'complete',
      dir,
      ok: result.ok === true,
      error: result.error ?? null,
      durationMs: result.durationMs ?? null,
      doctorOk: result.doctorOk ?? false,
      network: result.network ?? null,
      boundaries: (result.boundaries ?? []).map((boundary) => boundary.description),
      cleanup: result.cleanup ?? {},
    })
    console.error(
      `${result.ok ? 'ok' : 'FAIL'} ${entry.id} (${dir})${result.error ? `: ${result.error}` : ''}`,
    )
  }
  return finish()
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`suite: ${error.message}`)
  process.exitCode = 1
}
