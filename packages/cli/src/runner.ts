import { readFileSync } from 'node:fs'
import { TacoClient } from './client.ts'
import { executeLocalDryRun } from './dry-run.ts'
import { EXIT_CODES, makeCliError } from './errors.ts'
import { COMMAND_HELPS, DEFAULT_HOST, ROOT_HELP, type CommandHelpOutput } from './help.ts'
import { listSkills, readSkillFile } from './skills.ts'
import { TacoSubscriber, type WebSocketSessionAdapter } from './subscriber.ts'

export interface ParsedArgs {
  command: string[]
  positionals: string[]
  options: Record<string, string | boolean>
}

export const parseCliArgs = (argv: string[]): ParsedArgs => {
  const command: string[] = []
  const positionals: string[] = []
  const options: Record<string, string | boolean> = {}

  let idx = 0
  while (idx < argv.length) {
    const arg = argv[idx]
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=')
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx)
        const val = arg.slice(eqIdx + 1)
        options[key] = val
      } else {
        const key = arg.slice(2)
        const next = argv[idx + 1]
        if (next !== undefined && !next.startsWith('-')) {
          options[key] = next
          idx += 1
        } else {
          options[key] = true
        }
      }
    } else if (arg.startsWith('-')) {
      if (arg === '-h') {
        options['help'] = true
      } else {
        throw new Error(`Unknown short option: ${arg}`)
      }
    } else {
      if (command.length === 0) {
        command.push(arg)
      } else if (
        command[0] === 'skills' &&
        command.length === 1 &&
        (arg === 'list' || arg === 'read')
      ) {
        command.push(arg)
      } else {
        positionals.push(arg)
      }
    }
    idx += 1
  }

  return { command, positionals, options }
}

class SseSessionAdapter implements WebSocketSessionAdapter {
  private abortController: AbortController | null = null
  private onMsgCb: (msg: string) => void = () => {}
  private onClsCb: (code: number, reason: string) => void = () => {}
  private onErrCb: (err: Error) => void = () => {}

  async connect(url: string): Promise<void> {
    const httpUrl = url.replace(/^ws/, 'http')
    this.abortController = new AbortController()

    try {
      const res = await fetch(httpUrl, {
        signal: this.abortController.signal,
        headers: { Accept: 'text/event-stream' },
      })

      if (!res.ok) {
        throw new Error(`SSE connect failed: HTTP ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) {
        throw new Error('No readable response body')
      }

      const decoder = new TextDecoder()
      ;(async () => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const text = decoder.decode(value, { stream: true })
            for (const line of text.split('\n')) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim()
                if (data) this.onMsgCb(data)
              }
            }
          }
          this.onClsCb(1000, 'Stream closed')
        } catch (err) {
          if ((err as Error).name !== 'AbortError') {
            this.onErrCb(err as Error)
          }
        }
      })()
    } catch (err) {
      this.onErrCb(err as Error)
      throw err
    }
  }

  send(_data: string): void {}

  close(): void {
    this.abortController?.abort()
    this.onClsCb(1000, 'client-closed')
  }

  onMessage(cb: (msg: string) => void): void {
    this.onMsgCb = cb
  }

  onClose(cb: (code: number, reason: string) => void): void {
    this.onClsCb = cb
  }

  onError(cb: (err: Error) => void): void {
    this.onErrCb = cb
  }
}

export const runCli = async (
  argv: string[],
  injectedClient?: TacoClient,
): Promise<{ exitCode: number; stdout?: string; stderr?: string }> => {
  let parsed: ParsedArgs
  try {
    parsed = parseCliArgs(argv)
  } catch (err) {
    const error = makeCliError('VALIDATION_ERROR', (err as Error).message)
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  const { command, positionals, options } = parsed
  const primaryCmd = command[0]
  const host =
    typeof options['host'] === 'string'
      ? options['host']
      : process.env.TACO_HOST_URL || DEFAULT_HOST
  const client = injectedClient || new TacoClient(host)

  const forbiddenOption = ['json', 'ndjson', 'public'].find((name) => name in options)
  if (forbiddenOption) {
    const error = makeCliError('VALIDATION_ERROR', `Unsupported option: --${forbiddenOption}`)
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  // Handle Help requests
  if (primaryCmd === undefined || primaryCmd === 'help' || options['help'] === true) {
    let targetCmd = primaryCmd === 'help' ? positionals[0] : primaryCmd
    if (!targetCmd || targetCmd === 'help') {
      return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(ROOT_HELP, null, 2) }
    }
    const specificHelp = COMMAND_HELPS[targetCmd]
    if (!specificHelp) {
      const err = makeCliError('VALIDATION_ERROR', `Unknown command for help: ${targetCmd}`)
      return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(err) }
    }
    return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(specificHelp, null, 2) }
  }

  // Handle skills
  if (primaryCmd === 'skills') {
    const subCmd = command[1]
    if (subCmd === 'list') {
      return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(listSkills(), null, 2) }
    }
    if (subCmd === 'read') {
      const skillId = positionals[0]
      if (!skillId) {
        const err = makeCliError('VALIDATION_ERROR', 'Missing required skill id argument')
        return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(err) }
      }
      const readRes = readSkillFile(skillId, positionals[1] || 'SKILL.md')
      if (!readRes.ok) {
        return {
          exitCode: EXIT_CODES.VALIDATION_ERROR,
          stderr: JSON.stringify(makeCliError('VALIDATION_ERROR', readRes.err)),
        }
      }
      return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(readRes.result, null, 2) }
    }
  }

  // Handle publish (Pastebin style: pure data upload, no login required)
  if (primaryCmd === 'publish') {
    const filePath = positionals[0]
    if (!filePath) {
      return {
        exitCode: EXIT_CODES.VALIDATION_ERROR,
        stderr: JSON.stringify(makeCliError('VALIDATION_ERROR', 'Missing file path')),
      }
    }

    if (options['dry-run'] === true) {
      try {
        const summary = await executeLocalDryRun({ command: 'publish', filePath, host })
        return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(summary, null, 2) }
      } catch (err) {
        return {
          exitCode: EXIT_CODES.VALIDATION_ERROR,
          stderr: JSON.stringify(makeCliError('VALIDATION_ERROR', (err as Error).message)),
        }
      }
    }

    try {
      const rawHtml = readFileSync(filePath, 'utf8')
      const result = await client.publish({ rawHtml })
      return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(result, null, 2) }
    } catch (err) {
      return {
        exitCode: EXIT_CODES.LOCAL_IO_ERROR,
        stderr: JSON.stringify(makeCliError('LOCAL_IO_ERROR', (err as Error).message)),
      }
    }
  }

  if (primaryCmd === 'update') {
    const [tacoId, filePath] = positionals
    const baseRevisionId = options['base']
    if (!tacoId || !filePath || typeof baseRevisionId !== 'string') {
      const error = makeCliError(
        'VALIDATION_ERROR',
        'update requires <tacoId> <file> --base <revisionId>',
      )
      return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
    }
    if (options['dry-run'] !== true) {
      const error = makeCliError('VALIDATION_ERROR', 'Network update is not implemented')
      return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
    }
    try {
      const summary = await executeLocalDryRun({
        command: 'update',
        filePath,
        host,
        baseRevisionId,
      })
      return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(summary, null, 2) }
    } catch (err) {
      const error = makeCliError('VALIDATION_ERROR', (err as Error).message)
      return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
    }
  }
  // Handle subscribe
  if (primaryCmd === 'subscribe') {
    const tacoId = positionals[0]
    if (!tacoId) {
      return {
        exitCode: EXIT_CODES.VALIDATION_ERROR,
        stderr: JSON.stringify(makeCliError('VALIDATION_ERROR', 'Missing tacoId')),
      }
    }

    const subscriber = new TacoSubscriber(
      host,
      tacoId,
      {
        onFrame: (frame) => process.stdout.write(`${frame}\n`),
        onDiagnostic: (diag) =>
          process.stderr.write(`${JSON.stringify({ kind: 'diagnostic', ...diag })}\n`),
        onError: (err) =>
          process.stderr.write(`${JSON.stringify({ kind: 'error', error: err })}\n`),
      },
      () => new SseSessionAdapter(),
      { initialAfter: typeof options['after'] === 'string' ? options['after'] : null },
    )

    const subRes = await subscriber.start()
    return { exitCode: subRes.exitCode }
  }
  // Handle events
  if (primaryCmd === 'events') {
    const tacoId = positionals[0]
    if (!tacoId) {
      return {
        exitCode: EXIT_CODES.VALIDATION_ERROR,
        stderr: JSON.stringify(makeCliError('VALIDATION_ERROR', 'Missing tacoId')),
      }
    }
    try {
      const data = await client.getEvents(tacoId, {
        after: typeof options['after'] === 'string' ? options['after'] : undefined,
      })
      return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(data, null, 2) }
    } catch (err) {
      return {
        exitCode: EXIT_CODES.LOCAL_IO_ERROR,
        stderr: JSON.stringify(makeCliError('LOCAL_IO_ERROR', (err as Error).message)),
      }
    }
  }

  return {
    exitCode: EXIT_CODES.VALIDATION_ERROR,
    stderr: JSON.stringify(makeCliError('VALIDATION_ERROR', `Unknown command: ${primaryCmd}`)),
  }
}
