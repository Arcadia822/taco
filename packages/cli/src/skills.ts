import { CANONICAL_REFERENCES, CANONICAL_SKILL_MD } from './generated/assets.ts'
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

const tacoFiles: Record<string, string> = {
  'SKILL.md': CANONICAL_SKILL_MD,
}
for (const [refName, refContent] of Object.entries(CANONICAL_REFERENCES)) {
  tacoFiles[`references/${refName}`] = refContent
}

const EMBEDDED_SKILLS: Record<
  string,
  { version: string; description: string; files: Record<string, string> }
> = {
  taco: {
    version: '1.2.0',
    description: 'Post-install workflow for AI agents publishing and reviewing Taco workspaces',
    files: tacoFiles,
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
