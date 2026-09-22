import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/runner.ts'

const FIXTURE_TACO = resolve(
  process.cwd(),
  'specs/008-taco-host-contract/008-taco-host-contract.taco.html',
)

describe('taco-cli (Phase 1)', () => {
  it('outputs root help JSON on no arguments, help, or --help', async () => {
    const res1 = await runCli([])
    expect(res1.exitCode).toBe(0)
    const json1 = JSON.parse(res1.stdout!)
    expect(json1.schema).toBe('taco-cli-help/1')
    expect(json1.summary).toContain('Taco CLI')
    expect(
      json1.commands.some(
        (command: { name: string; summary: string }) =>
          command.name === 'skills read' && command.summary.includes('installation'),
      ),
    ).toBe(true)
    expect(
      json1.examples.some(
        (example: { invocation: string }) => example.invocation === 'taco-cli skills read taco',
      ),
    ).toBe(true)

    const res2 = await runCli(['help'])
    expect(res2.exitCode).toBe(0)
    expect(JSON.parse(res2.stdout!)).toEqual(json1)

    const res3 = await runCli(['--help'])
    expect(res3.exitCode).toBe(0)
    expect(JSON.parse(res3.stdout!)).toEqual(json1)
  })

  it('outputs subcommand help for publish, update, and subscribe', async () => {
    const res = await runCli(['help', 'publish'])
    expect(res.exitCode).toBe(0)
    const json = JSON.parse(res.stdout!)
    expect(json.command).toEqual(['publish'])
    expect(json.options.some((o: { name: string }) => o.name === '--dry-run')).toBe(true)

    const resUpdate = await runCli(['update', '--help'])
    expect(resUpdate.exitCode).toBe(0)
    const jsonUpdate = JSON.parse(resUpdate.stdout!)
    expect(jsonUpdate.command).toEqual(['update'])
    expect(jsonUpdate.options.some((o: { name: string }) => o.name === '--base')).toBe(true)
  })

  it('rejects forbidden legacy flags (--json, --ndjson, --public) with exit code 2', async () => {
    const res = await runCli(['publish', '--json'])
    expect(res.exitCode).toBe(2)
    const err = JSON.parse(res.stderr!)
    expect(err.error.code).toBe('VALIDATION_ERROR')
    expect(err.error.message).toContain('--json')
  })

  it('lists embedded skills and reads embedded guide markdown', async () => {
    const listRes = await runCli(['skills', 'list'])
    expect(listRes.exitCode).toBe(0)
    const listJson = JSON.parse(listRes.stdout!)
    expect(listJson.schema).toBe('taco-cli-skills/1')
    expect(listJson.skills.some((s: { id: string }) => s.id === 'taco')).toBe(true)

    const readRes = await runCli(['skills', 'read', 'taco'])
    expect(readRes.exitCode).toBe(0)
    const readJson = JSON.parse(readRes.stdout!)
    expect(readJson.id).toBe('taco')
    expect(readJson.path).toBe('SKILL.md')
    expect(readJson.content).toContain('# Taco Agent Guide')
    expect(readJson.version).toBe('1.2.0')
    expect(readJson.content).toContain('## Start Here')
    expect(readJson.content).toContain('references/publishing.md')

    const readRefRes = await runCli(['skills', 'read', 'taco', 'references/publishing.md'])
    expect(readRefRes.exitCode).toBe(0)
    const readRefJson = JSON.parse(readRefRes.stdout!)
    expect(readRefJson.content).toContain('# Publishing Guide')

    // Refuses directory traversal
    const badRead = await runCli(['skills', 'read', 'taco', '../../secret.txt'])
    expect(badRead.exitCode).toBe(2)
  })

  it('executes publish --dry-run projecting actual standalone Taco file', async () => {
    const res = await runCli(['publish', FIXTURE_TACO, '--dry-run'])
    expect(res.exitCode).toBe(0)
    const json = JSON.parse(res.stdout!)
    expect(json.command).toBe('publish')
    expect(json.dryRun).toBe(true)
    expect(json.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(json.files.length).toBeGreaterThan(0)
    expect(json.payloadBytes).toBeGreaterThan(0)
  })

  it('executes update --dry-run validating base revision parameter', async () => {
    // Missing base
    const noBase = await runCli([
      'update',
      '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
      FIXTURE_TACO,
      '--dry-run',
    ])
    expect(noBase.exitCode).toBe(2)

    // With base
    const res = await runCli([
      'update',
      '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
      FIXTURE_TACO,
      '--base',
      '993b05fd-2f80-48cc-aafd-1d7564781001',
      '--dry-run',
    ])
    expect(res.exitCode).toBe(0)
    const json = JSON.parse(res.stdout!)
    expect(json.command).toBe('update')
    expect(json.baseRevisionId).toBe('993b05fd-2f80-48cc-aafd-1d7564781001')
    expect(json.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('carries the requested resume cursor to the Host stream URL', async () => {
    const originalFetch = globalThis.fetch
    let requestedUrl = ''
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      requestedUrl = String(input)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(
            encoder.encode('data: {"kind":"ready","cursor":"7","mode":"replay"}\n\n'),
          )
          controller.enqueue(
            encoder.encode('data: {"kind":"error","error":{"code":"TACO_CLOSED"}}\n\n'),
          )
          controller.close()
        },
      })
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }

    try {
      const res = await runCli([
        'subscribe',
        '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001',
        '--after',
        '7',
        '--host',
        'https://host.example',
      ])
      expect(res.exitCode).toBe(4)
      expect(requestedUrl).toBe(
        'https://host.example/v1/tacos/8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001/subscribe?after=7',
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
