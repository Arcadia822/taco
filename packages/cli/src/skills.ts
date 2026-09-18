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

Taco is local-first by design:
- The core \`taco\` skill operates completely offline on local \`.taco.html\` files and source Markdown directories. A single skill is fully capable of driving local document reviews without \`taco-cli\` or cloud accounts.
- \`taco-cli\` is the client dedicated to cloud/remote workflows (TacoHub / Tacobin): publishing shared specs, streaming live WebSocket review events, and coordinating remote review revisions.
## Start Here
1. Run \`taco-cli help\` and parse the returned \`taco-cli-help/1\` JSON before constructing a command.
2. Run \`taco-cli skills read taco references/publishing.md\` before publishing or updating a shared Taco.
3. Run \`taco-cli skills read taco references/reviewing.md\` before waiting for or processing review events.
4. Treat local canonical files as primary. Editing or commenting in a Taco does not modify disk files until the relevant local sync workflow applies those changes.

## Host Rules
- Published Taco spaces, revisions, comments, and uploaded assets are public by default.
- One-off commands emit one compact JSON object; event streams emit NDJSON. Parse output instead of scraping prose.
- Run \`taco-cli publish <file.taco.html> --dry-run\` before the first network publication.
- Subscribe with \`taco-cli subscribe <tacoId>\` before waiting for review; reconnect with the last confirmed sequence after interruption.
- Use \`--host https://tacobin.arcadia-han.com\` for the public Tacobin service unless the project specifies another Host.
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
    version: '1.1.0',
    description: 'Post-install workflow for AI agents publishing and reviewing Taco workspaces',
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
