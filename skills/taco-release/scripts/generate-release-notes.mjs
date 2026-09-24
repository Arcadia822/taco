#!/usr/bin/env node

/**
 * generate-release-notes.mjs
 * 
 * Generates Conventional Commits compatible release notes
 * and changelog entries from git history between tags.
 *
 * Usage:
 *   node skills/taco-release/scripts/generate-release-notes.mjs \
 *     [--from <tag>] [--to <ref>] [--version <version>] [--update-changelog] [--outfile <path>]
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    return ''
  }
}

const args = process.argv.slice(2)
let fromTag = null
let toRef = 'HEAD'
let version = null
let updateChangelog = false
let outfile = null

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from' && args[i + 1]) {
    fromTag = args[++i]
  } else if (args[i] === '--to' && args[i + 1]) {
    toRef = args[++i]
  } else if (args[i] === '--version' && args[i + 1]) {
    version = args[++i]
  } else if (args[i] === '--update-changelog') {
    updateChangelog = true
  } else if (args[i] === '--outfile' && args[i + 1]) {
    outfile = args[++i]
  }
}

if (!fromTag) {
  // Find latest v* tag
  const raw = run(`git tag -l "v[0-9]*.[0-9]*.[0-9]*" --sort=-v:refname`)
  const tags = raw.split('\n').map(t => t.trim()).filter(Boolean)
  fromTag = tags[0] || null
}

if (!fromTag) {
  console.error('Error: No starting tag found. Please specify --from <tag>.')
  process.exit(1)
}

if (!version) {
  // Try reading version from root package.json
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    version = pkg.version
  } catch (e) {
    version = 'unknown'
  }
}

const REPO_URL = 'https://github.com/Arcadia822/taco'
const range = `${fromTag}..${toRef}`

// Retrieve git log with full body to parse breaking changes
// format: commit-hash%x1fsubject%x1fbody%x1fauthor-name
const rawLogs = run(`git log ${range} --pretty=format:"%H%x1f%s%x1f%b%x1f%an%x1e"`)
const rawEntries = rawLogs.split('\x1e').map(s => s.trim()).filter(Boolean)

const features = []
const bugFixes = []
const perf = []
const breaking = []
const others = []

const CONVENTIONAL_REGEX = /^([a-zA-Z0-9_\-]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/

for (const raw of rawEntries) {
  const parts = raw.split('\x1f')
  const hash = parts[0] || ''
  const subject = parts[1] || ''
  const body = parts[2] || ''
  const author = parts[3] || ''

  const shortHash = hash.slice(0, 7)
  const commitLink = `([${shortHash}](${REPO_URL}/commit/${hash}))`

  // Check for breaking change in body or subject
  let isBreaking = false
  let breakingDesc = ''
  if (/BREAKING CHANGE:\s*(.+)/i.test(body)) {
    isBreaking = true
    breakingDesc = body.match(/BREAKING CHANGE:\s*(.+)/i)[1]
  }

  const match = subject.match(CONVENTIONAL_REGEX)
  if (match) {
    const [, type, scope, exclamation, desc] = match
    if (exclamation) isBreaking = true

    const formattedScope = scope ? `**${scope}**: ` : ''
    const item = `* ${formattedScope}${desc} ${commitLink}`

    if (isBreaking) {
      breaking.push(`* ${formattedScope}${breakingDesc || desc} ${commitLink}`)
    }

    const lowerType = type.toLowerCase()
    if (lowerType === 'feat') {
      features.push(item)
    } else if (lowerType === 'fix') {
      bugFixes.push(item)
    } else if (lowerType === 'perf') {
      perf.push(item)
    } else {
      others.push(`* ${type}: ${formattedScope}${desc} ${commitLink}`)
    }
  } else {
    // Non-conventional commit
    others.push(`* ${subject} ${commitLink}`)
  }
}

const today = new Date().toISOString().slice(0, 10)
let markdown = `## [${version}](${REPO_URL}/compare/${fromTag}...v${version}) (${today})\n\n`

if (breaking.length > 0) {
  markdown += `### ⚠ BREAKING CHANGES\n\n`
  for (const item of breaking) markdown += `${item}\n`
  markdown += `\n`
}

if (features.length > 0) {
  markdown += `### Features\n\n`
  for (const item of features) markdown += `${item}\n`
  markdown += `\n`
}

if (bugFixes.length > 0) {
  markdown += `### Bug Fixes\n\n`
  for (const item of bugFixes) markdown += `${item}\n`
  markdown += `\n`
}

if (perf.length > 0) {
  markdown += `### Performance Improvements\n\n`
  for (const item of perf) markdown += `${item}\n`
  markdown += `\n`
}

if (others.length > 0) {
  markdown += `### Chores & Maintenance\n\n`
  for (const item of others) markdown += `${item}\n`
  markdown += `\n`
}

if (breaking.length === 0 && features.length === 0 && bugFixes.length === 0 && perf.length === 0 && others.length === 0) {
  markdown += `* Maintenance release, dependency updates, and internal synchronizations.\n\n`
}

if (outfile) {
  writeFileSync(resolve(outfile), markdown.trim() + '\n', 'utf8')
  console.log(`Saved release notes to ${outfile}`)
}

if (updateChangelog) {
  const changelogPaths = ['extensions/taco/CHANGELOG.md']
  for (const p of changelogPaths) {
    if (existsSync(p)) {
      const original = readFileSync(p, 'utf8')
      let updated = ''
      if (original.startsWith('# Changelog\n\n')) {
        updated = `# Changelog\n\n${markdown}${original.slice('# Changelog\n\n'.length)}`
      } else {
        updated = `# Changelog\n\n${markdown}${original}`
      }
      writeFileSync(p, updated, 'utf8')
      console.log(`Updated changelog at ${p}`)
    }
  }
    const extYmlPath = 'extensions/taco/extension.yml'
    if (existsSync(extYmlPath)) {
      const original = readFileSync(extYmlPath, 'utf8')
      const updated = original.replace(/(\n\s+version:\s*)[^\n]+/, `$1'${version}'`)
      writeFileSync(extYmlPath, updated, 'utf8')
      console.log(`Updated extension manifest at ${extYmlPath}`)
    }
  }

console.log(markdown.trim())
