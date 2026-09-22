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
- \`taco-cli\` is the client dedicated to cloud/remote workflows (TacoHub / Tacobin): publishing shared specs to a Host and streaming live review events over Server-Sent Events.
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
- \`taco-cli\` publishes and reads; it does not update, close, delete, or export a Host Taco.
`

const PUBLISHING_GUIDE_MD = `# Publishing Guide

## Single-Request Publish
1. \`taco-cli publish <file.taco.html> --dry-run\` reads the local container, projects it, and validates it without any network call; its summary carries \`contentHash\`, \`files\`, and \`payloadBytes\`.
2. \`taco-cli publish <file.taco.html> --host <origin>\` repeats that projection and validation, then sends exactly one \`POST /v1/tacos\` request asking the Host to store the Taco.
3. The Host replies with \`command\`, \`host\`, \`id\`, \`tacoId\`, \`title\`, \`blobUrl\`, \`url\`, and \`createdAt\`. Give the reviewer \`url\`, which is \`<origin>/t/<tacoId>\`.

## What Travels
- The request body is pure \`taco/files\` v1 data: \`{ protocol: "taco-host/1", snapshot: {...}, importedComments: [...] }\`. The \`snapshot\` keeps the same file model, anchors, and navigation as the local container.
- Cryptographic collaboration state (relay keys, sync credentials, session material) never leaves the machine.
- Authored \`file:\` URLs and other local absolute references are reduced to safe relative paths, so a published Taco never points at the publisher's disk.

## Limits And Ownership
- There is no account, login, or ApiKey in this flow: publishing needs no credential and asks for nothing interactive.
- Because the Host has no owner for a published paste, no command can update, close, or delete it afterwards; publish a corrected file as a new Taco instead.
- Verify the projection with \`--dry-run\` before the first network publish, and re-run it after any edit to the canonical Markdown.
- Everything published is public. Never publish a file whose payload contains secrets, and see the credential boundary in the installation guide before sharing.
`

const REVIEWING_GUIDE_MD = `# Reviewing Guide

## Review Workflow
1. Publish first, then subscribe with \`taco-cli subscribe <tacoId> --host <origin>\`. The stream is Server-Sent Events over \`GET /v1/tacos/<tacoId>/subscribe\`.
2. Wait for the \`ready\` frame and read its \`cursor\` and \`mode\`: \`live\` means no cursor was requested, \`replay\` means the Host is replaying from the cursor you passed in \`--after\`.
3. Treat each \`event\` frame as one review fact. Every frame carries \`id\`, \`sequence\`, \`tacoId\`, \`type\`, \`occurredAt\`, \`data\`, and \`actor\`; the Host assigns \`actor\` and \`occurredAt\`, so a client cannot forge either.
4. After any interruption, reconnect with the last confirmed cursor in \`--after <sequence>\`, which the client also reuses automatically when a Host rotates its instance.
5. Page the same log without a stream through \`taco-cli events <tacoId> [--after <sequence>]\`, which returns \`events\`, \`throughSequence\`, \`nextCursor\`, and \`hasMore\`.

## What To Expect
- Reviewers write from the review page at \`<origin>/t/<tacoId>\`; \`taco-cli\` is a reader of what they publish there.
- A comment carries an anchor with the file \`path\`, a \`position\`, and a \`quote\`; nested block identity and no anchor at all are both valid. Comments re-open against the same content, so a quote the document no longer contains is stale rather than silently attached elsewhere.
- A \`TACO_CLOSED\` error closes the stream with exit code 4: read what was recorded with \`events\` instead of subscribing again.
- Events are stored by the Host, so a stream that reconnects resumes from your cursor rather than from the live watermark.
`

const EMBEDDED_SKILLS: Record<
  string,
  { version: string; description: string; files: Record<string, string> }
> = {
  taco: {
    version: '1.2.0',
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
