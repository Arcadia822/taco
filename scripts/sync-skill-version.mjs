#!/usr/bin/env node
// Keeps skills/taco/VERSION in sync with package.json.
//
// `skills/taco/VERSION` is the installed-version marker the update check reads
// (see skills/taco/scripts/check-update.mjs and specs/012-skill-update-notice).
// It is a generated file: the release flow runs `npm run sync:version` right
// after bumping package.json and before `npm run check`, because `check` runs
// tests before it builds. `npm run build` runs the same sync at the end so a
// completed build never leaves the working tree out of sync.
//
//   node scripts/sync-skill-version.mjs [--skill-dir <dir>]

import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const parseOptions = (argv) => {
  const options = { skillDir: resolve(projectRoot, 'skills/taco') }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--skill-dir') {
      const value = argv[index + 1]
      if (!value || value.startsWith('-')) throw new Error('--skill-dir requires a path')
      options.skillDir = resolve(value)
      index += 1
      continue
    }
    throw new Error(`unknown argument: ${flag}`)
  }
  return options
}

const main = async () => {
  const options = parseOptions(process.argv.slice(2))
  const manifest = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'))
  const version = manifest.version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`package.json version is not a plain semver triple: ${version}`)
  }

  const target = resolve(options.skillDir, 'VERSION')
  const next = `${version}\n`
  const previous = await readFile(target, 'utf8').catch(() => null)
  if (previous === next) {
    process.stdout.write(`taco sync-version: unchanged (${version})\n`)
    return
  }

  // Stage then rename so a failure never truncates the marker.
  const temporary = `${target}.tmp-${process.pid}`
  await writeFile(temporary, next, { encoding: 'utf8', flag: 'w', mode: 0o644 })
  await rename(temporary, target)
  process.stdout.write(`taco sync-version: ${previous === null ? 'created' : 'updated'} ${target} (${version})\n`)
}

await main()
