import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parse } from 'yaml'

it('provides a discoverable Spec Kit template with logical feature metadata', () => {
  const manifest = parse(readFileSync('extensions/taco/extension.yml', 'utf8')) as {
    provides: { templates: Array<{ name: string; file: string }> }
  }
  const declaration = manifest.provides.templates.find(({ name }) => name === 'spec-template')
  if (!declaration) throw new Error('Spec Kit cannot discover the spec-template')
  const template = readFileSync(`extensions/taco/${declaration.file}`, 'utf8')
  const match = template.match(/^---\n([\s\S]*?)\n---/)
  if (!match) throw new Error('Spec template is missing YAML metadata')
  const frontmatter = parse(match[1]) as Record<string, string>
  expect(frontmatter).toMatchObject({
    title: '[FEATURE NAME]',
    feature_id: '[###-feature-name]',
    created: '[DATE]',
    status: 'Draft',
    input: 'User description: "$ARGUMENTS"',
  })
  expect(frontmatter).not.toHaveProperty('git_branch')
})
