#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const targetArg = process.argv[2]
const LESSONS_FILE = targetArg ? path.resolve(targetArg) : path.resolve('LESSONS.md')
const REPO_ROOT = process.env.REPO_ROOT ? path.resolve(process.env.REPO_ROOT) : process.cwd()
if (!fs.existsSync(LESSONS_FILE)) {
  console.error(`Error: LESSONS.md not found at ${LESSONS_FILE}`)
  process.exit(1)
}

const content = fs.readFileSync(LESSONS_FILE, 'utf8')

const requiredHeadings = [
  '# Agent Development & Review Lessons Learned (LESSONS.md)',
  '## Escalation Index',
  '## Lessons Register',
]

for (const heading of requiredHeadings) {
  if (!content.includes(heading)) {
    console.error(`Error: LESSONS.md missing required heading: "${heading}"`)
    process.exit(1)
  }
}

const lines = content.split('\n')
let insideFence = false
let fenceChar = ''
let fenceLen = 0

const parsedLines = lines.map((text, idx) => {
  const lineNum = idx + 1
  const trimmed = text.trim()
  const matchFence = trimmed.match(/^(`{3,}|~{3,})(.*)$/)
  if (matchFence) {
    const delim = matchFence[1]
    const rest = matchFence[2]
    const char = delim[0]
    const len = delim.length
    if (!insideFence) {
      insideFence = true
      fenceChar = char
      fenceLen = len
      return { text, lineNum, isCode: false }
    } else if (char === fenceChar && len >= fenceLen && rest.trim() === '') {
      insideFence = false
      fenceChar = ''
      fenceLen = 0
      return { text, lineNum, isCode: false }
    }
  }
  return { text, lineNum, isCode: insideFence }
})

const indexStartLineIdx = parsedLines.findIndex(
  (l) => !l.isCode && l.text.startsWith('## Escalation Index'),
)
const registerStartLineIdx = parsedLines.findIndex(
  (l) => !l.isCode && l.text.startsWith('## Lessons Register'),
)

if (
  indexStartLineIdx === -1 ||
  registerStartLineIdx === -1 ||
  indexStartLineIdx >= registerStartLineIdx
) {
  console.error(
    'Error: Could not locate ## Escalation Index and ## Lessons Register sections properly.',
  )
  process.exit(1)
}

const indexRows = []
for (let i = indexStartLineIdx + 1; i < registerStartLineIdx; i++) {
  const lineObj = parsedLines[i]
  if (lineObj.isCode) continue
  const text = lineObj.text.trim()
  if (!text.startsWith('|')) continue
  const cells = text
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim())
  if (cells.length < 5) continue
  if (cells[0].match(/^:?-+:?$/)) continue
  if (cells[0].toLowerCase() === 'id' && cells[1].toLowerCase() === 'title') continue

  const idMatch = cells[0].match(/LESSON-\d{3}/)
  if (!idMatch) {
    console.error(
      `Error on line ${lineObj.lineNum}: Escalation Index row missing valid LESSON-NNN ID: "${text}"`,
    )
    process.exit(1)
  }
  const id = idMatch[0]
  const title = cells[1].replace(/\[|\]/g, '').trim()

  const occClean = cells[2].replace(/\*/g, '').trim()
  if (!/^\d+$/.test(occClean)) {
    console.error(
      `Error on line ${lineObj.lineNum} for ${id}: Invalid Occurrences in Escalation Index: "${cells[2]}"`,
    )
    process.exit(1)
  }
  const occurrences = parseInt(occClean, 10)

  const statusClean = cells[3].replace(/[*`]/g, '').trim().toLowerCase()
  if (!['open', 'escalated', 'archived'].includes(statusClean)) {
    console.error(
      `Error on line ${lineObj.lineNum} for ${id}: Invalid Status in Escalation Index: "${cells[3]}". Expected open, escalated, or archived.`,
    )
    process.exit(1)
  }

  const guard = cells[4]
  indexRows.push({ id, title, occurrences, status: statusClean, guard, lineNum: lineObj.lineNum })
}

const lessonHeadings = []
for (let i = registerStartLineIdx + 1; i < parsedLines.length; i++) {
  const l = parsedLines[i]
  if (l.isCode) continue
  const match = l.text.match(/^###\x20(LESSON-\d{3}):\x20*([^\n]+)$/)
  if (match) {
    lessonHeadings.push({
      id: match[1],
      title: match[2].trim(),
      lineIdx: i,
      lineNum: l.lineNum,
    })
  }
}

if (lessonHeadings.length === 0) {
  console.error(
    'Error: No lessons found in LESSONS.md (expected pattern "### LESSON-XXX: Title" at line start outside code blocks)',
  )
  process.exit(1)
}

const seenHeadingIds = new Set()
for (const h of lessonHeadings) {
  if (seenHeadingIds.has(h.id)) {
    console.error(`Error on line ${h.lineNum}: Duplicate lesson heading ID "${h.id}"`)
    process.exit(1)
  }
  seenHeadingIds.add(h.id)
}

const detailLessons = new Map()
let hasError = false

for (let idx = 0; idx < lessonHeadings.length; idx++) {
  const h = lessonHeadings[idx]
  const nextHeading = lessonHeadings[idx + 1]
  const endLineIdx = nextHeading ? nextHeading.lineIdx : parsedLines.length

  const blockLines = parsedLines.slice(h.lineIdx, endLineIdx)

  const idLine = blockLines.find((l) => !l.isCode && /^[ \t]*-[ \t]+\*\*ID\*\*:[ \t]*/.test(l.text))
  const categoryLine = blockLines.find(
    (l) => !l.isCode && /^[ \t]*-[ \t]+\*\*Category\*\*:[ \t]*/.test(l.text),
  )
  const occLine = blockLines.find(
    (l) => !l.isCode && /^[ \t]*-[ \t]+\*\*Occurrences\*\*:[ \t]*/.test(l.text),
  )
  const statusLine = blockLines.find(
    (l) => !l.isCode && /^[ \t]*-[ \t]+\*\*Status\*\*:[ \t]*/.test(l.text),
  )
  const guardLine = blockLines.find(
    (l) => !l.isCode && /^[ \t]*-[ \t]+\*\*Guard\*\*:[ \t]*/.test(l.text),
  )

  if (!idLine) {
    console.error(`Error in ${h.id}: Missing "- **ID**: \`${h.id}\`" metadata line`)
    hasError = true
    continue
  }
  const idMatch = idLine.text.match(/^[ \t]*-[ \t]+\*\*ID\*\*:[ \t]+`?(LESSON-\d{3})`?[ \t]*$/)
  if (!idMatch) {
    console.error(`Error in ${h.id}: Invalid "- **ID**" format in line: "${idLine.text}"`)
    hasError = true
    continue
  }
  const detailId = idMatch[1]
  if (detailId !== h.id) {
    console.error(`Error in ${h.id}: Metadata ID "${detailId}" does not match heading ID "${h.id}"`)
    hasError = true
    continue
  }

  if (!categoryLine) {
    console.error(`Error in ${h.id}: Missing "- **Category**: <category>" metadata line`)
    hasError = true
    continue
  }
  const categoryMatch = categoryLine.text.match(
    /^[ \t]*-[ \t]+\*\*Category\*\*:[ \t]+(`?[a-zA-Z0-9_-]+`?)[ \t]*$/,
  )
  if (!categoryMatch) {
    console.error(
      `Error in ${h.id}: Invalid "- **Category**" format in line: "${categoryLine.text}"`,
    )
    hasError = true
    continue
  }
  const category = categoryMatch[1].replace(/`/g, '')

  if (!occLine) {
    console.error(`Error in ${h.id}: Missing "- **Occurrences**: <number>" metadata line`)
    hasError = true
    continue
  }
  const occMatch = occLine.text.match(/^[ \t]*-[ \t]+\*\*Occurrences\*\*:[ \t]+(\d+)[ \t]*$/)
  if (!occMatch) {
    console.error(
      `Error in ${h.id}: Invalid "- **Occurrences**" format in line: "${occLine.text}". Expected a whole nonnegative integer.`,
    )
    hasError = true
    continue
  }
  const occurrences = parseInt(occMatch[1], 10)

  if (!statusLine) {
    console.error(
      `Error in ${h.id}: Missing "- **Status**: \`open|escalated|archived\`" metadata line`,
    )
    hasError = true
    continue
  }
  const statusMatch = statusLine.text.match(
    /^[ \t]*-[ \t]+\*\*Status\*\*:[ \t]+`?(open|escalated|archived)`?[ \t]*$/i,
  )
  if (!statusMatch) {
    console.error(
      `Error in ${h.id}: Invalid "- **Status**" format in line: "${statusLine.text}". Expected open, escalated, or archived.`,
    )
    hasError = true
    continue
  }
  const status = statusMatch[1].toLowerCase()

  if (!guardLine) {
    console.error(`Error in ${h.id}: Missing "- **Guard**: <details>" metadata line`)
    hasError = true
    continue
  }
  const guardMatch = guardLine.text.match(/^[ \t]*-[ \t]+\*\*Guard\*\*:[ \t]+(.+)$/)
  if (!guardMatch || guardMatch[1].trim().length === 0) {
    console.error(
      `Error in ${h.id}: Invalid or empty "- **Guard**" metadata line: "${guardLine.text}"`,
    )
    hasError = true
    continue
  }
  const guard = guardMatch[1].trim()

  const extractSectionLines = (headingRegex) => {
    let capturing = false
    const secLines = []
    for (const bl of blockLines) {
      if (!bl.isCode && headingRegex.test(bl.text)) {
        capturing = true
        continue
      }
      if (capturing && !bl.isCode && /^####?\x20/.test(bl.text)) {
        break
      }
      if (capturing) {
        secLines.push(bl)
      }
    }
    return capturing ? secLines : null
  }

  const symptomLines = extractSectionLines(/^####\x20Symptom[ \t]*$/i)
  const rootCauseLines = extractSectionLines(/^####\x20Root Cause[ \t]*$/i)
  const evidenceLinesObj = extractSectionLines(/^####\x20Evidence[ \t]*$/i)
  const preventionLines = extractSectionLines(/^####\x20Prevention(?:\x20&\x20Escalation)?[ \t]*$/i)

  if (
    symptomLines === null ||
    symptomLines.length === 0 ||
    symptomLines.every((l) => l.text.trim() === '')
  ) {
    console.error(`Error in ${h.id}: Missing or empty "#### Symptom" section`)
    hasError = true
  }
  if (
    rootCauseLines === null ||
    rootCauseLines.length === 0 ||
    rootCauseLines.every((l) => l.text.trim() === '')
  ) {
    console.error(`Error in ${h.id}: Missing or empty "#### Root Cause" section`)
    hasError = true
  }
  if (
    preventionLines === null ||
    preventionLines.length === 0 ||
    preventionLines.every((l) => l.text.trim() === '')
  ) {
    console.error(`Error in ${h.id}: Missing or empty "#### Prevention & Escalation" section`)
    hasError = true
  }

  if (
    evidenceLinesObj === null ||
    evidenceLinesObj.length === 0 ||
    evidenceLinesObj.every((l) => l.text.trim() === '')
  ) {
    console.error(`Error in ${h.id}: Missing or empty "#### Evidence" section`)
    hasError = true
  } else {
    const topLevelEvidence = evidenceLinesObj.filter(
      (l) => !l.isCode && /^[ \t]*-[ \t]+/.test(l.text) && !/^[ \t]{2,}-[ \t]+/.test(l.text),
    )
    if (topLevelEvidence.length !== occurrences) {
      console.error(
        `Error in ${h.id}: Occurrences count (${occurrences}) does not match evidence list item count (${topLevelEvidence.length})`,
      )
      hasError = true
    }
  }

  if (occurrences >= 3 && status !== 'escalated') {
    console.error(
      `Error in ${h.id} ("${h.title}"): Occurrences is ${occurrences} >= 3, but status is "${status}". Must be escalated to a structural mechanism per AGENTS.md.`,
    )
    hasError = true
  }

  const backtickedPaths = [...guard.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  for (const p of backtickedPaths) {
    if (p.includes('/') || p.includes('.')) {
      const resolved = path.resolve(REPO_ROOT, p)
      if (!fs.existsSync(resolved)) {
        console.error(`Error in ${h.id}: Guard references non-existent path "${p}"`)
        hasError = true
      }
    }
  }

  detailLessons.set(h.id, {
    id: h.id,
    title: h.title,
    category,
    occurrences,
    status,
    guard,
    lineNum: h.lineNum,
  })
}

const seenIndexIds = new Set()
for (const row of indexRows) {
  if (seenIndexIds.has(row.id)) {
    console.error(`Error on line ${row.lineNum}: Duplicate ID "${row.id}" in Escalation Index`)
    hasError = true
  }
  seenIndexIds.add(row.id)

  const detail = detailLessons.get(row.id)
  if (!detail) {
    console.error(
      `Error in Escalation Index: ID "${row.id}" has no matching detail block in Lessons Register`,
    )
    hasError = true
    continue
  }

  if (row.occurrences !== detail.occurrences) {
    console.error(
      `Error in Escalation Index for ${row.id}: Occurrences mismatch. Index row has ${row.occurrences}, detail block has ${detail.occurrences}.`,
    )
    hasError = true
  }

  if (row.status !== detail.status) {
    console.error(
      `Error in Escalation Index for ${row.id}: Status mismatch. Index row has "${row.status}", detail block has "${detail.status}".`,
    )
    hasError = true
  }

  const indexBacktickedPaths = [...row.guard.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  for (const p of indexBacktickedPaths) {
    if (p.includes('/') || p.includes('.')) {
      const resolved = path.resolve(REPO_ROOT, p)
      if (!fs.existsSync(resolved)) {
        console.error(
          `Error in Escalation Index for ${row.id}: Guard references non-existent path "${p}"`,
        )
        hasError = true
      }
    }
  }
}

for (const [id, detail] of detailLessons.entries()) {
  if (!seenIndexIds.has(id)) {
    console.error(
      `Error in Lessons Register: Detail block ${id} is missing from Escalation Index table`,
    )
    hasError = true
  }
}

if (hasError) {
  process.exit(1)
}

console.log(`LESSONS.md validation passed: ${lessonHeadings.length} lessons verified.`)
