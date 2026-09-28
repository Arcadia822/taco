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

  it('keeps the installed-version marker aligned with the Taco application', () => {
    // skills/taco/VERSION is what the update check reports as the installed
    // version, so it must match the released package version (see
    // scripts/sync-skill-version.mjs and specs/012-skill-update-notice).
    const marker = readFileSync(resolve('skills/taco/VERSION'), 'utf8').trim()

    expect(marker).toBe(packageJson.version)
  })

  it('supports the validated Spec Kit 0.16 and 1.x release lines', () => {
    const manifest = readFileSync(resolve('extensions/taco/extension.yml'), 'utf8')
    const specKitRange = manifest.match(/^\s{2}speckit_version:\s*['"]([^'"]+)['"]\s*$/m)?.[1]

    expect(specKitRange).toBe('>=0.16.0,<2.0.0')
  })
})
