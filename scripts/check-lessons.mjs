#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const LESSONS_FILE = path.resolve('LESSONS.md');

if (!fs.existsSync(LESSONS_FILE)) {
  console.error('Error: LESSONS.md not found in repository root.');
  process.exit(1);
}

const content = fs.readFileSync(LESSONS_FILE, 'utf8');

// Validate basic structure and required headings
const requiredHeadings = [
  '# Agent Development & Review Lessons Learned (LESSONS.md)',
  '## Escalation Index',
  '## Lessons Register',
];

for (const heading of requiredHeadings) {
  if (!content.includes(heading)) {
    console.error(`Error: LESSONS.md missing required heading: "${heading}"`);
    process.exit(1);
  }
}

// Parse lesson blocks
const lessonRegex = /### (LESSON-\d{3}):\s*([^\n]+)/g;
const matches = [...content.matchAll(lessonRegex)];

if (matches.length === 0) {
  console.error('Error: No lessons found in LESSONS.md (expected pattern "### LESSON-XXX: Title")');
  process.exit(1);
}

let hasError = false;

for (const match of matches) {
  const lessonId = match[1];
  const lessonTitle = match[2].trim();

  // Find block content up to the next lesson or EOF
  const startIndex = match.index;
  const nextMatch = content.slice(startIndex + match[0].length).search(/### LESSON-\d{3}:/);
  const block = nextMatch === -1
    ? content.slice(startIndex)
    : content.slice(startIndex, startIndex + match[0].length + nextMatch);

  // Check required metadata fields
  const occurrencesMatch = block.match(/- \*\*Occurrences\*\*:\s*(\d+)/i);
  const statusMatch = block.match(/- \*\*Status\*\*:\s*`?(active|escalated|archived)`?/i);
  const enforcementMatch = block.match(/- \*\*Enforcement\*\*:\s*(.+)/i);

  if (!occurrencesMatch) {
    console.error(`Error in ${lessonId}: Missing "- **Occurrences**: <number>"`);
    hasError = true;
    continue;
  }

  if (!statusMatch) {
    console.error(`Error in ${lessonId}: Missing or invalid "- **Status**: active|escalated|archived"`);
    hasError = true;
    continue;
  }

  if (!enforcementMatch) {
    console.error(`Error in ${lessonId}: Missing "- **Enforcement**: <details>"`);
    hasError = true;
    continue;
  }

  const occurrences = parseInt(occurrencesMatch[1], 10);
  const status = statusMatch[1].toLowerCase();

  // Escalation rule check: occurrences >= 3 must be marked 'escalated'
  if (occurrences >= 3 && status !== 'escalated') {
    console.error(`Error in ${lessonId} ("${lessonTitle}"): Occurrences is ${occurrences} >= 3, but status is "${status}". Must be escalated to a structural mechanism per AGENTS.md.`);
    hasError = true;
  }
}

if (hasError) {
  process.exit(1);
}

console.log(`LESSONS.md validation passed: ${matches.length} lessons verified.`);
