import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseBundle } from '../src/model.ts'
import { resolveDocumentNavigation } from '../src/navigation.ts'

const packScript = resolve('skills/taco/scripts/pack.mjs')
const skillShell = resolve('skills/taco/taco-shell.html')
const dataBlock = /(<script\b(?=[^>]*\bid=["']taco-document["'])[^>]*>)([\s\S]*?)(<\/script>)/i

const fixtureDir = () => mkdtempSync(join(tmpdir(), 'taco-skill-pack-'))

const write = (path: string, content: string | Buffer) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

const pack = (args: string[]) =>
  execFileSync(process.execPath, [packScript, ...args], { encoding: 'utf8' })

const readBundle = (path: string) => {
  const html = readFileSync(path, 'utf8')
  const match = html.match(dataBlock)
  if (!match) throw new Error('missing #taco-document data block')
  return { html, json: match[2].trim(), parsed: parseBundle(match[2].trim()) }
}

const writeBundle = (path: string, mutate: (bundle: Record<string, unknown>) => void) => {
  const { json } = readBundle(path)
  const bundle = JSON.parse(json) as Record<string, unknown>
  mutate(bundle)
  const html = readFileSync(path, 'utf8')
  const escaped = JSON.stringify(bundle, null, 2).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
  writeFileSync(path, html.replace(dataBlock, (_match, open, _content, close) => `${open}${escaped}${close}`), 'utf8')
}

const freeFormDirectory = () => {
  const directory = join(fixtureDir(), 'roguelike-tactics-game')
  write(join(directory, 'research.md'), '# Roguelike Tactics Research\n\nGoal: pick a combat model.\n')
  write(join(directory, 'combat-model.md'), '# Combat Model\n\nOptions.\n')
  write(join(directory, 'notes', 'round-2.md'), '# Round 2 Notes\n\nOpen questions.\n')
  return directory
}

describe('skill packer', () => {
  it('assembles a free-form directory without inventing template or stage groups', () => {
    const directory = freeFormDirectory()
    pack(['--dir', directory, '--title', 'Roguelike Tactics Research'])

    const artifact = join(directory, 'Roguelike_Tactics_Research.taco.html')
    const { parsed } = readBundle(artifact)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    // The reported badcase: a non-Spec Kit directory must not grow spec/plan/tasks.
    expect(parsed.bundle.checkpoints).toBeUndefined()
    const navigation = resolveDocumentNavigation(parsed.bundle)
    expect(navigation.checkpointGroups).toEqual([])
    expect(navigation.groups.map((group) => group.title)).toEqual(['notes'])
    expect(navigation.unassigned.map((file) => file.path)).toEqual([
      'roguelike-tactics-game/combat-model.md',
      'roguelike-tactics-game/research.md',
    ])
  })

  it('reports the presented structure so the shape is stated before review', () => {
    const directory = freeFormDirectory()
    const output = pack(['--dir', directory, '--title', 'Roguelike Tactics Research', '--dry-run'])

    expect(output).toContain('groups:')
    expect(output).toContain('notes')
    expect(output).toContain('unassigned:')
    expect(output).not.toContain('Specification')
    expect(output).not.toContain('Plan')
  })

  it('round-trips content a hand-written packer would corrupt', () => {
    const directory = join(fixtureDir(), 'tricky')
    const hostile = [
      '## $& and $` and $\' and $1',
      '</script><script>alert(1)</script>',
      `line separator: ${String.fromCodePoint(0x2028)} paragraph separator: ${String.fromCodePoint(0x2029)}`,
      '& < > ampersands',
    ].join('\n')
    write(join(directory, 'tricky.md'), hostile)

    pack(['--dir', directory, '--title', 'Tricky'])
    const artifact = join(directory, 'Tricky.taco.html')
    const { json, parsed } = readBundle(artifact)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.bundle.files[0].content).toBe(hostile)
    expect(json).not.toContain('</script>')
    expect(json).not.toContain(String.fromCodePoint(0x2028))
    expect(json).not.toContain(String.fromCodePoint(0x2029))
  })

  it('preserves identity and review state across a refresh', () => {
    const directory = freeFormDirectory()
    pack(['--dir', directory, '--title', 'Roguelike Tactics Research'])
    const artifact = join(directory, 'Roguelike_Tactics_Research.taco.html')

    writeBundle(artifact, (bundle) => {
      bundle.comments = [
        {
          id: 'thread-1',
          status: 'open',
          createdAt: '2026-09-24T10:00:00.000Z',
          updatedAt: '2026-09-24T10:00:00.000Z',
          anchor: {
            path: 'roguelike-tactics-game/research.md',
            position: { start: 0, end: 5 },
            quote: { exact: 'Roguelike', prefix: '# ', suffix: ' Tactics' },
          },
          messages: [
            {
              id: 'message-1',
              author: 'Arcadia',
              body: 'Please split this section.',
              createdAt: '2026-09-24T10:00:00.000Z',
            },
          ],
        },
      ]
      bundle.checkpoints = {
        version: 1,
        nodes: [{ id: 'review', title: 'Review', after: [], documents: [{ path: 'roguelike-tactics-game/research.md' }] }],
        documents: [{ path: 'roguelike-tactics-game/research.md', status: 'in_progress', updatedAt: '2026-09-24T10:00:00.000Z' }],
      }
      bundle.navigation = { version: 1, entry: 'research.md', groups: [{ id: 'group-1', title: 'Research', paths: ['research.md'] }] }
      bundle.vendorField = { keep: true }
      const files = bundle.files as Array<Record<string, unknown>>
      for (const file of files) {
        file.id = `stable-${String(file.path)}`
        file.blocks = [{ id: 'block-1', type: 'paragraph', html: '<p>cached</p>' }]
      }
    })
    const before = readBundle(artifact)
    const beforeJson = JSON.parse(before.json) as Record<string, unknown>
    const beforeFiles = beforeJson.files as Array<Record<string, unknown>>

    write(join(directory, 'combat-model.md'), '# Combat Model\n\nOptions. Edited.\n')
    pack(['--dir', directory, '--title', 'Roguelike Tactics Research'])

    const after = readBundle(artifact)
    expect(after.parsed.ok).toBe(true)
    if (!after.parsed.ok) return
    const afterJson = JSON.parse(after.json) as Record<string, unknown>
    const afterFiles = afterJson.files as Array<Record<string, unknown>>

    expect(afterJson.docId).toBe(beforeJson.docId)
    expect(afterJson.comments).toEqual(beforeJson.comments)
    expect(afterJson.checkpoints).toEqual(beforeJson.checkpoints)
    expect(afterJson.navigation).toEqual(beforeJson.navigation)
    expect(afterJson.vendorField).toEqual({ keep: true })

    for (const file of afterFiles) {
      const previous = beforeFiles.find((candidate) => candidate.path === file.path)
      expect(file.id).toBe(previous?.id)
    }
    const edited = afterFiles.find((file) => file.path === 'roguelike-tactics-game/combat-model.md')
    const untouched = afterFiles.find((file) => file.path === 'roguelike-tactics-game/research.md')
    expect(edited?.blocks).toBeUndefined()
    expect(untouched?.blocks).toEqual([{ id: 'block-1', type: 'paragraph', html: '<p>cached</p>' }])
  })

  it('surfaces transplanted checkpoint documents that do not exist', () => {
    const directory = freeFormDirectory()
    pack(['--dir', directory, '--title', 'Roguelike Tactics Research'])
    const artifact = join(directory, 'Roguelike_Tactics_Research.taco.html')

    // The second half of the badcase: a starter pack's Checkpoint graph copied into
    // a directory that has none of those documents.
    const specPack = JSON.parse(
      readFileSync(resolve('skills/taco/templates/spec/bundle.json'), 'utf8'),
    ) as { checkpoints: unknown }
    writeBundle(artifact, (bundle) => {
      bundle.checkpoints = specPack.checkpoints
    })

    const result = spawnSync(process.execPath, [packScript, 'verify', artifact], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stdout).toContain('not created')
    expect(result.stdout).toContain('Specification')
  })

  it('fails loudly instead of silently dropping a malformed navigation manifest', () => {
    const directory = freeFormDirectory()
    pack(['--dir', directory, '--title', 'Roguelike Tactics Research'])
    const artifact = join(directory, 'Roguelike_Tactics_Research.taco.html')

    writeBundle(artifact, (bundle) => {
      bundle.navigation = { version: 1, groups: [{ id: 'group-1', title: 'Broken' }] }
    })

    const result = spawnSync(process.execPath, [packScript, '--dir', directory, '--title', 'Roguelike Tactics Research'], {
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('navigation must be a v1 manifest')
  })

  it('ships the assembly path the skill documents', () => {
    const skill = readFileSync(resolve('skills/taco/SKILL.md'), 'utf8')
    expect(readFileSync(resolve('skills/taco/references/bundle-format.md'), 'utf8')).toContain('taco/files')
    expect(skill).toContain('scripts/pack.mjs')
    expect(skill).toContain('references/bundle-format.md')
    // The absolute claim that forced agents to invent their own packer.
    expect(skill).not.toMatch(/^No CLI is required\.$/m)
  })

  it('takes the group structure the agent declares, and rejects paths it cannot place', () => {
    const directory = freeFormDirectory()
    pack([
      '--dir',
      directory,
      '--title',
      'Roguelike Tactics Research',
      '--entry',
      'research.md',
      '--group',
      'Research=research.md,combat-model.md',
      '--group',
      'Notes=notes/round-2.md',
    ])

    const artifact = join(directory, 'Roguelike_Tactics_Research.taco.html')
    const { parsed } = readBundle(artifact)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.bundle.navigation).toEqual({
      version: 1,
      entry: 'research.md',
      groups: [
        { id: 'group-1', title: 'Research', paths: ['research.md', 'combat-model.md'] },
        { id: 'group-2', title: 'Notes', paths: ['notes/round-2.md'] },
      ],
    })
    const navigation = resolveDocumentNavigation(parsed.bundle)
    expect(navigation.groups.map((group) => group.title)).toEqual(['Research', 'Notes'])

    const misplaced = spawnSync(
      process.execPath,
      [packScript, '--dir', directory, '--title', 'Roguelike Tactics Research', '--group', 'Research=nope.md'],
      { encoding: 'utf8' },
    )
    expect(misplaced.status).toBe(1)
    expect(misplaced.stderr).toContain('--group lists a file that is not in the bundle')
  })

  it('ships a minimal bundle skeleton the runtime actually accepts', () => {
    const reference = readFileSync(resolve('skills/taco/references/bundle-format.md'), 'utf8')
    const skeleton = reference.match(/## You are authoring a document model[\s\S]*?```json\n([\s\S]*?)\n```/)
    expect(skeleton, 'the reference must carry a copy-paste minimal bundle').not.toBeNull()

    const parsed = parseBundle(skeleton![1])
    expect(parsed.ok, 'the documented skeleton must load in the runtime').toBe(true)
    if (parsed.ok) {
      expect(parsed.bundle.files.length).toBeGreaterThan(0)
      expect(parsed.bundle.docId).toBeTruthy()
    }
  })

  it('ships the same PNG validator the runtime enforces', () => {
    const mirrored = readFileSync(resolve('skills/taco/scripts/png.mjs'))
    const canonical = readFileSync(resolve('extensions/taco/bin/png.mjs'))
    expect(mirrored.equals(canonical), 'skills/taco/scripts/png.mjs must stay byte-identical').toBe(true)
  })

  it('refuses a PNG the runtime would reject', () => {
    const directory = join(fixtureDir(), 'broken-png')
    // A PNG signature and nothing else: the old check accepted it, then the artifact opened in Recovery.
    write(join(directory, 'diagram.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

    const result = spawnSync(process.execPath, [packScript, '--dir', directory, '--title', 'Broken'], { encoding: 'utf8' })
    expect(result.status).toBe(1)
  })

  it('keeps the shell variant across a refresh', () => {
    const directory = freeFormDirectory()
    pack(['--dir', directory, '--title', 'Roguelike Tactics Research', '--shell', resolve('skills/taco/taco-shell-lite.html')])
    const artifact = join(directory, 'Roguelike_Tactics_Research.taco.html')
    expect(readFileSync(artifact, 'utf8')).toContain('name="taco-shell-variant" content="lite"')

    pack(['--dir', directory, '--title', 'Roguelike Tactics Research'])
    expect(readFileSync(artifact, 'utf8')).toContain('name="taco-shell-variant" content="lite"')
  })

  it('refuses to downgrade a bundle written by a newer format version', () => {
    const directory = freeFormDirectory()
    pack(['--dir', directory, '--title', 'Roguelike Tactics Research'])
    const artifact = join(directory, 'Roguelike_Tactics_Research.taco.html')
    writeBundle(artifact, (bundle) => {
      bundle.version = 9
    })

    const result = spawnSync(process.execPath, [packScript, '--dir', directory, '--title', 'Roguelike Tactics Research'], {
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('will not downgrade')
  })

  it('keeps a commented source whose file disappeared', () => {
    const directory = freeFormDirectory()
    pack(['--dir', directory, '--title', 'Roguelike Tactics Research'])
    const artifact = join(directory, 'Roguelike_Tactics_Research.taco.html')
    writeBundle(artifact, (bundle) => {
      bundle.comments = [
        {
          id: 'thread-1',
          status: 'open',
          createdAt: '2026-09-26T10:00:00.000Z',
          updatedAt: '2026-09-26T10:00:00.000Z',
          anchor: {
            path: 'roguelike-tactics-game/combat-model.md',
            position: { start: 0, end: 6 },
            quote: { exact: 'Combat', prefix: '# ', suffix: '' },
          },
          messages: [{ id: 'm1', author: 'Arcadia', body: 'keep this', createdAt: '2026-09-26T10:00:00.000Z' }],
        },
      ]
    })
    rmSync(join(directory, 'combat-model.md'))

    const output = pack(['--dir', directory, '--title', 'Roguelike Tactics Research'])
    expect(output).toContain('commented source is gone from the directory')

    const { parsed } = readBundle(artifact)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.bundle.files.map((file) => file.path)).toContain('roguelike-tactics-game/combat-model.md')
    }
  })

  it('applies an entry without inventing groups', () => {
    const directory = freeFormDirectory()
    pack(['--dir', directory, '--title', 'Roguelike Tactics Research', '--entry', 'research.md'])
    const artifact = join(directory, 'Roguelike_Tactics_Research.taco.html')

    const { parsed } = readBundle(artifact)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.bundle.navigation?.entry).toBe('research.md')
    // An entry needs a manifest, and a manifest suppresses directory grouping: the groups must be
    // the ones the directory already produced, so asking for an entry does not reshuffle the sidebar.
    expect(parsed.bundle.navigation?.groups.map((group) => group.title)).toEqual(['notes'])
    expect(resolveDocumentNavigation(parsed.bundle).unassigned.map((file) => file.path)).toEqual([
      'roguelike-tactics-game/combat-model.md',
      'roguelike-tactics-game/research.md',
    ])
  })

  it('writes a shell whose data block the runtime accepts', () => {
    const directory = freeFormDirectory()
    pack(['--dir', directory, '--title', 'Roguelike Tactics Research'])
    const artifact = join(directory, 'Roguelike_Tactics_Research.taco.html')
    const shell = readFileSync(skillShell, 'utf8')

    expect(readFileSync(artifact, 'utf8').startsWith(shell.slice(0, shell.indexOf('<title')))).toBe(true)
    const { parsed } = readBundle(artifact)
    expect(parsed.ok).toBe(true)
  })
})
