import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import packageJson from '../package.json' with { type: 'json' }

describe('release version', () => {
  it('keeps the Spec Kit extension aligned with the Taco application', () => {
    const manifest = readFileSync(resolve('extensions/taco/extension.yml'), 'utf8')
    const extensionVersion = manifest.match(/^\s{2}version:\s*['"]([^'"]+)['"]\s*$/m)?.[1]

    expect(extensionVersion).toBe(packageJson.version)
  })
})
