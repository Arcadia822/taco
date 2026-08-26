import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const read = (path: string): string => readFileSync(path, 'utf8')

describe('Taco Agent instructions', () => {
  it('uses a user-click local-file handoff in Codex', () => {
    const update = read('extensions/taco/commands/update.md')

    expect(update).toContain("native clickable local-file")
    expect(update).toContain("In Codex")
    expect(update).toContain("the user's click hands the file to Browser")
    expect(update).toContain("do not attempt to navigate Browser directly to `file://`")
    expect(update).toContain("Never substitute a `data:` URL")
  })

  it('installs a durable YAML-title and no-H1 authoring prompt', () => {
    const policy = read('extensions/taco/policies/taco-agent-policy.md')
    const installation = read('docs/agent-installation.md')
    const extension = read('extensions/taco/README.md')

    expect(policy).toContain('speckit.specify')
    expect(policy).toContain('YAML frontmatter')
    expect(policy).toContain('`title`')
    expect(policy).toMatch(/do not\s+add an ATX or Setext H1/)
    expect(policy).toContain('Begin the Markdown body at')
    expect(policy).toContain('H2 (`##`) or lower')
    expect(policy).toContain('`taco_scope`')
    expect(policy).toContain('Do not generate the legacy `**Taco scope**: ...` form')
    expect(installation).toContain('.specify/extensions/taco/policies/taco-agent-policy.md')
    expect(installation).toContain('a post-generation Taco hook cannot prevent malformed Markdown')
    expect(extension).toContain('new specs use YAML `title`, omit a duplicate H1')
  })

  it('replaces the core Spec Kit spec template with an unambiguous YAML contract', () => {
    const manifest = parse(read('extensions/taco/extension.yml')) as {
      provides: { templates: Array<{ name: string; file: string }> }
    }
    const declaration = manifest.provides.templates.find(({ name }) => name === 'spec-template')
    expect(declaration?.file).toBe('templates/spec-template.md')
    expect(read('docs/agent-installation.md')).toContain('prepare-template')

    const template = read(`extensions/taco/${declaration!.file}`)
    expect(template).toMatch(/^---\n/)
    const frontmatter = parse(template.match(/^---\n([\s\S]*?)\n---/)![1]) as Record<string, string>
    expect(frontmatter).toMatchObject({
      title: '[FEATURE NAME]',
      feature_id: '[###-feature-name]',
      created: '[DATE]',
      status: 'Draft',
      input: 'User description: "$ARGUMENTS"',
    })
    expect(template).not.toContain('Feature Branch')
    expect(template).not.toContain('git_branch')
    expect(template).not.toMatch(/^#\s/m)
    expect(template).toMatch(/^## User Scenarios & Testing/m)
  })

  it('keeps the repository routing prompt on YAML metadata', () => {
    const agents = read('AGENTS.md')

    expect(agents).toContain('taco_scope: spec')
    expect(agents).toContain('title')
    expect(agents).toContain('do not add an H1 solely to repeat that title')
    expect(agents).toContain('Do not generate the legacy `**Taco scope**: ...` form')
  })
})
