import { CLI_BINARY_VERSION, CLI_SCHEMA_SKILLS } from './help.ts'

export interface SkillEntry {
  id: string
  version: string
  description: string
  files: string[]
}

export interface SkillFileReadResult {
  schema: 'taco-cli-skills/1'
  binaryVersion: string
  id: string
  version: string
  path: string
  mediaType: 'text/markdown'
  content: string
}

const TACO_SKILL_MD = `# Taco Agent Guide

Taco is a single-file, local-first review artifact and workspace for humans and AI agents.

## Core Rules
1. **Local canonical files are primary**: Editing or commenting in a Taco does not modify disk files until \`sync\` or local edits are applied.
2. **All shared data is public**: Taco Host spaces, revisions, comments, and uploaded images are public by default.
3. **Always use JSON output**: \`taco-cli\` outputs single JSON objects for one-off commands and NDJSON for event streams.
4. **Subscribe before waiting for review**: Stream events using \`taco-cli subscribe <tacoId>\` to react in real time.
`

const PUBLISHING_GUIDE_MD = `# Publishing Guide

## Two-Phase Upload Protocol
1. \`taco-cli publish file.taco.html --dry-run\` validates the container locally and previews size and hashes.
2. Without an existing ApiKey, \`publish\` automatically bootstraps an anonymous credential and stores it securely.
3. The client uploads the snapshot directly to private storage, then commits the transaction to Taco Host.
`

const REVIEWING_GUIDE_MD = `# Reviewing Guide

## Review Workflow
1. Subscribe to events: \`taco-cli subscribe <tacoId>\`.
2. Wait for the \`ready\` frame before accepting incoming events.
3. Handle disconnection by reconnecting with the last confirmed sequence in \`--after\`.
4. Comment threads require explicit revision association and text anchor context.
`

const EMBEDDED_SKILLS: Record<
  string,
  { version: string; description: string; files: Record<string, string> }
> = {
  taco: {
    version: '1.0.0',
    description: 'Guidelines and procedures for AI agents using Taco and Taco Host',
    files: {
      'SKILL.md': TACO_SKILL_MD,
      'references/publishing.md': PUBLISHING_GUIDE_MD,
      'references/reviewing.md': REVIEWING_GUIDE_MD,
    },
  },
}

export const listSkills = (): {
  schema: 'taco-cli-skills/1'
  binaryVersion: string
  skills: SkillEntry[]
} => ({
  schema: CLI_SCHEMA_SKILLS,
  binaryVersion: CLI_BINARY_VERSION,
  skills: Object.entries(EMBEDDED_SKILLS).map(([id, s]) => ({
    id,
    version: s.version,
    description: s.description,
    files: Object.keys(s.files).sort(),
  })),
})

export const readSkillFile = (
  id: string,
  filePath = 'SKILL.md',
): { ok: true; result: SkillFileReadResult } | { ok: false; err: string } => {
  const skill = EMBEDDED_SKILLS[id]
  if (!skill) return { ok: false, err: `Unknown skill id: ${id}` }

  // Security: refuse path traversal or non-registered file paths
  if (filePath.includes('..') || filePath.startsWith('/') || filePath.includes('\\')) {
    return { ok: false, err: `Illegal skill path traversal: ${filePath}` }
  }

  const content = skill.files[filePath]
  if (content === undefined) {
    return { ok: false, err: `File '${filePath}' not found in skill '${id}'` }
  }

  return {
    ok: true,
    result: {
      schema: CLI_SCHEMA_SKILLS,
      binaryVersion: CLI_BINARY_VERSION,
      id,
      version: skill.version,
      path: filePath,
      mediaType: 'text/markdown',
      content,
    },
  }
}
