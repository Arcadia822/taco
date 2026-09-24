#!/usr/bin/env node

/**
 * check-changes.mjs
 * 
 * Inspects commits between the latest tags of taco, taco-cli, and tacobin
 * against a target git ref (default: origin/main or HEAD) and determines
 * which components have changes and recommend version bump type.
 *
 * Usage:
 *   node skills/taco-release/scripts/check-changes.mjs [--ref <ref>] [--json]
 */

import { execSync } from 'node:child_process'

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    return ''
  }
}

const args = process.argv.slice(2)
let targetRef = 'origin/main'
let jsonOutput = false

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ref' && args[i + 1]) {
    targetRef = args[++i]
  } else if (args[i] === '--json') {
    jsonOutput = true
  }
}

// Ensure ref exists; fallback to HEAD if origin/main is not fetched
const resolvedRef = run(`git rev-parse --verify ${targetRef}`) ? targetRef : 'HEAD'
const headSha = run(`git rev-parse --short ${resolvedRef}`)

const COMPONENTS = [
  {
    name: 'taco',
    displayName: 'Taco (本体 / Core)',
    tagPattern: 'v[0-9]*.[0-9]*.[0-9]*',
    tagPrefix: 'v',
    paths: [
      'src',
      'extensions',
      'skills/taco',
      'dist-single',
      'package.json',
      'scripts'
    ],
    versionFiles: ['package.json', 'extensions/taco/extension.yml'],
    releaseType: 'github-release + changelog + tag v*'
  },
  {
    name: 'taco-cli',
    displayName: 'taco-cli (CLI 工具)',
    tagPattern: 'taco-cli-v*',
    tagPrefix: 'taco-cli-v',
    paths: ['packages/cli'],
    versionFiles: ['packages/cli/package.json'],
    releaseType: 'ci release-cli.yml (npm + binary + github-release) via tag taco-cli-v*'
  },
  {
    name: 'tacobin',
    displayName: 'tacobin (网页端 / Webpage)',
    tagPattern: 'tacobin-v*',
    tagPrefix: 'tacobin-v',
    paths: ['packages/host', 'examples'],
    versionFiles: ['packages/host/package.json'],
    releaseType: 'ci deploy-tacobin.yml (Vercel deploy hook) via tag tacobin-v*'
  }
]

function getLatestTag(pattern) {
  const raw = run(`git tag -l "${pattern}" --sort=-v:refname`)
  if (!raw) return null
  const tags = raw.split('\n').map(t => t.trim()).filter(Boolean)
  return tags[0] || null
}

function parseSemver(tag, prefix) {
  const versionStr = tag.startsWith(prefix) ? tag.slice(prefix.length) : tag
  const match = versionStr.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/)
  if (!match) return { major: 0, minor: 0, patch: 0, raw: versionStr }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
    raw: versionStr
  }
}

function recommendNextVersion(currentVersion, bumpType) {
  const { major, minor, patch } = currentVersion
  if (bumpType === 'major') return `${major + 1}.0.0`
  if (bumpType === 'minor') return `${major}.${minor + 1}.0`
  if (bumpType === 'patch') return `${major}.${minor}.${patch + 1}`
  return `${major}.${minor}.${patch}`
}

function analyzeCommits(tag, ref, paths) {
  if (!tag) {
    return { count: 0, commits: [], bump: 'minor', breaking: [], feats: [], fixes: [], others: [] }
  }

  const pathFilter = paths.join(' ')
  // %x1f field / %x1e record separators keep entries intact across multiline commit bodies
  const logCmd = `git log ${tag}..${ref} --pretty=format:"%h%x1f%s%x1f%b%x1f%an%x1e" -- ${pathFilter}`
  const rawLog = run(logCmd)

  if (!rawLog) {
    return { count: 0, commits: [], bump: 'none', breaking: [], feats: [], fixes: [], others: [] }
  }

  const lines = rawLog.split('\x1e').map(s => s.trim()).filter(Boolean)
  const commits = []
  const breaking = []
  const feats = []
  const fixes = []
  const others = []

  let hasBreaking = false
  let hasFeat = false
  let hasFixOrOther = false

  for (const line of lines) {
    const [hash, subject, body, author] = line.split('\x1f')
    const item = { hash, subject, author }
    commits.push(item)

    // Check breaking: bang marker in subject or explicit BREAKING CHANGE marker in subject/body
    if (/BREAKING CHANGE|!:/i.test(subject) || /BREAKING CHANGE:/i.test(body || '')) {
      hasBreaking = true
      breaking.push(item)
    } else if (/^feat(\(.*\))?:/i.test(subject)) {
      hasFeat = true
      feats.push(item)
    } else if (/^fix(\(.*\))?:/i.test(subject)) {
      hasFixOrOther = true
      fixes.push(item)
    } else {
      hasFixOrOther = true
      others.push(item)
    }
  }

  let bump = 'none'
  if (hasBreaking) bump = 'major'
  else if (hasFeat) bump = 'minor'
  else if (hasFixOrOther || commits.length > 0) bump = 'patch'

  return {
    count: commits.length,
    commits,
    bump,
    breaking,
    feats,
    fixes,
    others
  }
}

const report = {
  targetRef: resolvedRef,
  targetSha: headSha,
  timestamp: new Date().toISOString(),
  components: []
}

for (const comp of COMPONENTS) {
  const latestTag = getLatestTag(comp.tagPattern)
  const currentVersion = latestTag ? parseSemver(latestTag, comp.tagPrefix) : null
  const analysis = analyzeCommits(latestTag, resolvedRef, comp.paths)

  const hasChanges = analysis.count > 0
  const nextVersion = hasChanges && currentVersion ? recommendNextVersion(currentVersion, analysis.bump) : null

  report.components.push({
    name: comp.name,
    displayName: comp.displayName,
    latestTag,
    currentVersion: currentVersion ? currentVersion.raw : null,
    hasChanges,
    commitCount: analysis.count,
    recommendedBump: analysis.bump,
    recommendedVersion: nextVersion,
    releaseType: comp.releaseType,
    monitoredPaths: comp.paths,
    versionFiles: comp.versionFiles,
    details: analysis
  })
}

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

// Pretty terminal / markdown output
console.log(`\n======================================================`)
console.log(`🌮 Taco 多组件变动检查报告 (Ref: ${resolvedRef} [${headSha}])`)
console.log(`======================================================\n`)

let anyChanges = false

for (const c of report.components) {
  console.log(`📦 【${c.displayName}】`)
  console.log(`   - 上次发版 Tag:   ${c.latestTag || '(无历史 tag)'}`)
  console.log(`   - 当前版本号:     ${c.currentVersion || 'N/A'}`)
  console.log(`   - 监控目录范围:   ${c.monitoredPaths.join(', ')}`)
  console.log(`   - 是否存在变更:   ${c.hasChanges ? `⚠️ 是 (${c.commitCount} 个新提交)` : '✅ 否 (无新提交)'}`)

  if (c.hasChanges) {
    anyChanges = true
    console.log(`   - 推荐版本变更:   ${c.recommendedBump.toUpperCase()} -> ${c.recommendedVersion}`)
    console.log(`   - 触发发版操作:   ${c.releaseType}`)
    console.log(`   - 涉及版本文件:   ${c.versionFiles.join(', ')}`)
    console.log(`   - 提交明细:`)
    for (const commit of c.details.commits.slice(0, 5)) {
      console.log(`       * ${commit.hash} ${commit.subject} (${commit.author})`)
    }
    if (c.details.commits.length > 5) {
      console.log(`       * ... 以及其他 ${c.details.commits.length - 5} 个提交`)
    }
  }
  console.log('')
}

console.log(`------------------------------------------------------`)
if (anyChanges) {
  const changedList = report.components.filter(c => c.hasChanges).map(c => c.displayName).join('、')
  console.log(`🔔 判定结论：今晚需要为 [${changedList}] 执行发版流程。`)
} else {
  console.log(`💤 判定结论：当前所有组件均无未发布的变动，今晚无需执行任何发版。`)
}
console.log(`------------------------------------------------------\n`)
