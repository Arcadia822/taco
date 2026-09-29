#!/usr/bin/env node
// Packages the Spec Kit extension for a release.
//
// One build produces two assets on the Taco release:
//   taco-extension-v<version>.zip  versioned; skills/taco/scripts/check-update.mjs
//                                  matches exactly this name to decide whether an
//                                  installed extension has a newer installable package.
//   taco-extension.zip             stable name; the website install command and the
//                                  docs point here so they never need a version bump.
//
// Layout contract: the archive is flat. `extension.yml` must sit at its root,
// because `specify extension add <name> --from <url>` reads the manifest from the
// archive root. GitHub's generated source archives nest everything under a
// directory and are therefore not installable (see extensions/taco/README.md).
//
//   node scripts/package-extension.mjs --version 1.2.3 [--source extensions/taco] [--out-dir dist-extension]

import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SEMVER = /^\d+\.\d+\.\d+$/
const USAGE =
  'usage: package-extension.mjs --version <x.y.z> [--source <dir>] [--out-dir <dir>]'
// Entries that are never part of an installable extension, whatever .extensionignore says.
const ALWAYS_EXCLUDED = ['node_modules']

const parseOptions = (argv) => {
  const options = {
    version: null,
    source: resolve(projectRoot, 'extensions/taco'),
    outDir: resolve(projectRoot, 'dist-extension'),
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const take = (name) => {
      const value = argv[index + 1]
      if (!value || value.startsWith('-')) throw new Error(`${name} requires a value`)
      index += 1
      return value
    }
    if (flag === '--version') options.version = take(flag)
    else if (flag === '--source') options.source = resolve(take(flag))
    else if (flag === '--out-dir') options.outDir = resolve(take(flag))
    else throw new Error(`unknown argument: ${flag}\n${USAGE}`)
  }
  if (!options.version || !SEMVER.test(options.version)) {
    throw new Error(`--version must be a plain semver triple\n${USAGE}`)
  }
  return options
}

// `tests/` excludes the directory's contents; a bare name excludes it at any depth,
// because zip's own `*` does not cross directory separators.
const exclusionGlobs = (patterns) =>
  patterns.flatMap((pattern) =>
    pattern.endsWith('/')
      ? [`${pattern}*`, `*/${pattern}*`]
      : [pattern, `*/${pattern}`],
  )

const readVersionOfManifest = (text) =>
  text.match(/^\s{2}version:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1] ?? null

const main = async () => {
  const options = parseOptions(process.argv.slice(2))
  const manifestPath = resolve(options.source, 'extension.yml')
  const manifest = await readFile(manifestPath, 'utf8').catch(() => null)
  if (manifest === null) throw new Error(`no extension manifest at ${manifestPath}`)

  const manifestVersion = readVersionOfManifest(manifest)
  if (manifestVersion !== options.version) {
    throw new Error(
      `extension.yml declares ${manifestVersion}, but the release is ${options.version}; ` +
        'bump the manifest before packaging',
    )
  }

  const ignoreFile = await readFile(resolve(options.source, '.extensionignore'), 'utf8').catch(
    () => '',
  )
  const patterns = ignoreFile
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
  const excluded = exclusionGlobs([...ALWAYS_EXCLUDED, ...patterns])

  const versioned = resolve(options.outDir, `taco-extension-v${options.version}.zip`)
  const stable = resolve(options.outDir, 'taco-extension.zip')
  await mkdir(options.outDir, { recursive: true })
  await Promise.all([rm(versioned, { force: true }), rm(stable, { force: true })])

  const zipArgs = ['-r', '-X', '-q', versioned, '.', ...excluded.flatMap((glob) => ['-x', glob])]
  execFileSync('zip', zipArgs, { cwd: options.source, stdio: ['ignore', 'ignore', 'inherit'] })

  const entries = execFileSync('unzip', ['-Z1', versioned], { encoding: 'utf8' })
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  if (!entries.includes('extension.yml')) {
    throw new Error(
      `the archive does not carry extension.yml at its root: ${entries.slice(0, 5).join(', ')}`,
    )
  }

  await copyFile(versioned, stable)
  process.stdout.write(
    `taco package-extension: ${versioned} (${entries.length} entries, extension.yml at root)\n` +
      `taco package-extension: ${stable}\n`,
  )
}

await main()
