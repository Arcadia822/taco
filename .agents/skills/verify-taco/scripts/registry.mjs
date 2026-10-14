// SPDX-License-Identifier: MIT
// The registry is the single execution list for the Taco verification suite.
// It imports the six domain modules and reports structural problems instead of
// silently skipping anything.

export const DOMAIN_FILES = [
  'browse.mjs',
  'edit.mjs',
  'comments.mjs',
  'save.mjs',
  'checkpoints.mjs',
  'variants.mjs',
]

/** Features are the feature document basenames under .agents/skills/verify-taco/features/. */
export const FEATURES = [
  'browse-search',
  'edit-files',
  'comments',
  'save-handoff',
  'checkpoints',
  'variants',
]

/** Import every domain module; a broken module is a reported problem, not a skip. */
export async function loadRegistry(files = DOMAIN_FILES) {
  const modules = []
  for (const file of files) {
    try {
      const loaded = await import(new URL(file, import.meta.url).href)
      modules.push({ file, cases: Array.isArray(loaded.cases) ? loaded.cases : null, error: null })
    } catch (error) {
      modules.push({ file, cases: null, error: error.message })
    }
  }
  return modules
}

/** Structural problems that must fail the suite: unimplemented modules, bad cases, duplicate ids. */
export function registryProblems(modules, features = FEATURES) {
  const problems = []
  const known = new Set(features)
  for (const module of modules) {
    if (module.error) {
      problems.push(`${module.file} could not be imported: ${module.error}`)
      continue
    }
    if (!module.cases?.length) {
      problems.push(`${module.file} does not export a non-empty cases array`)
      continue
    }
    for (const entry of module.cases) {
      const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
      if (!id) problems.push(`${module.file} has a case without a human-readable id`)
      else if (typeof entry.feature !== 'string' || !known.has(entry.feature)) {
        problems.push(`${id} declares the unknown feature ${JSON.stringify(entry.feature)}`)
      } else if (typeof entry.run !== 'function') {
        problems.push(`${id} does not implement run(h)`)
      }
    }
  }
  const owners = new Map()
  for (const module of modules) {
    for (const entry of module.cases ?? []) {
      const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
      if (!id) continue
      const owner = owners.get(id)
      if (owner) problems.push(`duplicate case id ${id} in ${owner} and ${module.file}`)
      else owners.set(id, module.file)
    }
  }
  return problems
}

/** Flat case list, each case tagged with the module that owns it. */
export function registryCases(modules) {
  return modules.flatMap((module) =>
    (module.cases ?? []).map((entry) => ({ ...entry, file: module.file })),
  )
}

/** Local filters. CI rejects them in suite.mjs so the full registry always runs. */
export function selectCases(cases, { caseIds = [], features = [] } = {}) {
  return cases.filter((entry) => {
    if (caseIds.length && !caseIds.includes(entry.id)) return false
    if (features.length && !features.includes(entry.feature)) return false
    return true
  })
}
