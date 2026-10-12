import { readFileSync } from 'node:fs'
import { TacoClient } from './client.ts'
import { executeDiff } from './diff.ts'
import { executeLocalDryRun } from './dry-run.ts'
import { EXIT_CODES, makeCliError } from './errors.ts'
import { executeExtract } from './extract.ts'
import { COMMAND_HELPS, DEFAULT_HOST, ROOT_HELP, type CommandHelpOutput } from './help.ts'
import { executeInit } from './init.ts'
import { executeInspect } from './inspect.ts'
import { executeListen } from './listen.ts'
import { executeNew } from './new.ts'
import { executeOpen } from './open.ts'
import { executePack } from './pack.ts'
import { executeRefresh } from './refresh.ts'
import { listSkills, readSkillFile } from './skills.ts'
import { TacoSubscriber, type WebSocketSessionAdapter } from './subscriber.ts'
import { executeVerify } from './verify.ts'

export interface ParsedArgs {
  command: string[]
  positionals: string[]
  options: Record<string, string | boolean | string[]>
}

export const parseCliArgs = (argv: string[]): ParsedArgs => {
  const command: string[] = []
  const positionals: string[] = []
  const options: Record<string, string | boolean | string[]> = {}

  let idx = 0
  while (idx < argv.length) {
    const arg = argv[idx]
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=')
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx)
        const val = arg.slice(eqIdx + 1)
        if (key === 'group' || key === 'ignore') {
          const existing = options[key]
          if (Array.isArray(existing)) {
            existing.push(val)
          } else if (typeof existing === 'string') {
            options[key] = [existing, val]
          } else {
            options[key] = [val]
          }
        } else {
          options[key] = val
        }
      } else {
        const key = arg.slice(2)
        const next = argv[idx + 1]
        if (next !== undefined && (!next.startsWith('-') || next === '-')) {
          const val = next
          idx += 1
          if (key === 'group' || key === 'ignore') {
            const existing = options[key]
            if (Array.isArray(existing)) {
              existing.push(val)
            } else if (typeof existing === 'string') {
              options[key] = [existing, val]
            } else {
              options[key] = [val]
            }
          } else {
            options[key] = val
          }
        } else {
          options[key] = true
        }
      }
    } else if (arg.startsWith('-') && arg !== '-') {
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

export const MAX_TTL_SECONDS = 31536000 // 365 days

export const parseDurationToSeconds = (input: string): number | null => {
  const trimmed = input.trim().toLowerCase()
  if (
    trimmed === '0' ||
    trimmed === 'none' ||
    trimmed === 'never' ||
    trimmed === 'null' ||
    trimmed === 'infinite'
  ) {
    return null
  }
  const match = trimmed.match(
    /^(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hours?|d|days?|w|weeks?|y|years?)?$/,
  )
  if (!match) {
    throw new Error(
      `Invalid duration format for --ttl: "${input}". Expected format like 1h, 7d, 30d, 86400s, or 0/none for permanent.`,
    )
  }
  const amountStr = match[1]
  if (amountStr.length > 15) {
    throw new Error(
      `Invalid duration for --ttl: "${input}". Duration exceeds maximum allowed duration of 365 days (31536000 seconds).`,
    )
  }
  const amount = parseInt(amountStr, 10)
  if (!Number.isFinite(amount) || amount > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `Invalid duration for --ttl: "${input}". Duration exceeds maximum allowed duration of 365 days (31536000 seconds).`,
    )
  }
  if (amount === 0) {
    return null
  }
  const unit = match[2] || 's'
  let seconds: number
  switch (unit) {
    case 's':
    case 'sec':
    case 'second':
    case 'seconds':
      seconds = amount
      break
    case 'm':
    case 'min':
    case 'minute':
    case 'minutes':
      seconds = amount * 60
      break
    case 'h':
    case 'hour':
    case 'hours':
      seconds = amount * 3600
      break
    case 'd':
    case 'day':
    case 'days':
      seconds = amount * 86400
      break
    case 'w':
    case 'week':
    case 'weeks':
      seconds = amount * 7 * 86400
      break
    case 'y':
    case 'year':
    case 'years':
      seconds = amount * 365 * 86400
      break
    default:
      seconds = amount
      break
  }
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_TTL_SECONDS) {
    throw new Error(
      `Invalid duration for --ttl: "${input}". Duration exceeds maximum allowed duration of 365 days (31536000 seconds).`,
    )
  }
  return seconds
}

class SseSessionAdapter implements WebSocketSessionAdapter {
  private abortController: AbortController | null = null
  private closed = false
  private onMsgCb: (msg: string) => void = () => {}
  private onClsCb: (code: number, reason: string) => void = () => {}
  private onErrCb: (err: Error) => void = () => {}

  async connect(url: string, headers?: Record<string, string>): Promise<void> {
    const httpUrl = url.replace(/^ws/, 'http')
    this.abortController = new AbortController()

    const res = await fetch(httpUrl, {
      signal: this.abortController.signal,
      headers: {
        Accept: 'text/event-stream',
        ...headers,
      },
    })

    if (!res.ok) {
      if (res.status === 410) {
        let msg = 'Cursor has expired or Taco is gone (HTTP 410)'
        let errCode = 'CURSOR_EXPIRED'
        try {
          const errJson = (await res.json()) as { error?: { code?: string; message?: string } }
          if (errJson?.error?.message) {
            msg = errJson.error.message
          }
          if (errJson?.error?.code) {
            errCode = errJson.error.code
          }
        } catch {}
        const error = new Error(msg) as Error & { statusCode?: number; code?: string }
        error.statusCode = 410
        error.code = errCode === 'GONE' || errCode === 'TACO_GONE' ? 'TACO_GONE' : errCode
        throw error
      }
      if (res.status === 404) {
        const error = new Error(`Taco not found (HTTP 404)`) as Error & {
          statusCode?: number
          code?: string
        }
        error.statusCode = 404
        error.code = 'NOT_FOUND'
        throw error
      }
      if (res.status === 400) {
        let msg = 'Invalid request parameters (HTTP 400)'
        try {
          const errJson = (await res.json()) as { error?: { message?: string } }
          if (errJson?.error?.message) {
            msg = errJson.error.message
          }
        } catch {}
        const error = new Error(msg) as Error & { statusCode?: number; code?: string }
        error.statusCode = 400
        error.code = 'VALIDATION_ERROR'
        throw error
      }
      throw new Error(`SSE connect failed: HTTP ${res.status}`)
    }

    const reader = res.body?.getReader()
    if (!reader) {
      throw new Error('No readable response body')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let currentDataLines: string[] = []

    const processLine = (line: string) => {
      if (this.closed) return
      if (line === '') {
        if (currentDataLines.length > 0) {
          const message = currentDataLines.join('\n')
          currentDataLines = []
          this.onMsgCb(message)
        }
      } else if (line.startsWith('data:')) {
        let content = line.slice(5)
        if (content.startsWith(' ')) {
          content = content.slice(1)
        }
        currentDataLines.push(content)
      }
    }

    ;(async () => {
      try {
        while (!this.closed) {
          const { done, value } = await reader.read()
          if (done) break
          if (this.closed) break
          buffer += decoder.decode(value, { stream: true })
          let newlineIdx: number
          while (!this.closed && (newlineIdx = buffer.indexOf('\n')) !== -1) {
            let line = buffer.slice(0, newlineIdx)
            buffer = buffer.slice(newlineIdx + 1)
            if (line.endsWith('\r')) {
              line = line.slice(0, -1)
            }
            processLine(line)
          }
        }

        if (!this.closed) {
          buffer += decoder.decode()
          if (buffer.length > 0) {
            let newlineIdx: number
            while (!this.closed && (newlineIdx = buffer.indexOf('\n')) !== -1) {
              let line = buffer.slice(0, newlineIdx)
              buffer = buffer.slice(newlineIdx + 1)
              if (line.endsWith('\r')) {
                line = line.slice(0, -1)
              }
              processLine(line)
            }
            if (!this.closed && buffer.length > 0) {
              if (buffer.endsWith('\r')) {
                buffer = buffer.slice(0, -1)
              }
              processLine(buffer)
              buffer = ''
            }
          }
          if (!this.closed && currentDataLines.length > 0) {
            const message = currentDataLines.join('\n')
            currentDataLines = []
            this.onMsgCb(message)
          }
        }

        if (!this.closed) {
          this.onClsCb(1000, 'Stream closed')
        }
      } catch (err) {
        if (!this.closed && (err as Error).name !== 'AbortError') {
          this.onErrCb(err as Error)
        }
      }
    })()
  }

  send(_data: string): void {}

  close(): void {
    if (this.closed) return
    this.closed = true
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

  if ('timeout' in options) {
    const rawTimeout = options['timeout']
    const parsedTimeout = Number(rawTimeout)
    if (Number.isNaN(parsedTimeout) || !Number.isInteger(parsedTimeout) || parsedTimeout <= 0) {
      const error = makeCliError(
        'VALIDATION_ERROR',
        `--timeout must be a positive integer, found: ${String(rawTimeout)}`,
      )
      return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
    }
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

  // Handle local toolbox commands
  if (primaryCmd === 'new') {
    return executeNew({
      path: positionals[0],
      title: typeof options['title'] === 'string' ? options['title'] : undefined,
      lite: options['lite'] === true,
    })
  }

  if (primaryCmd === 'init') {
    return executeInit({
      target: positionals[0],
      template: typeof options['template'] === 'string' ? options['template'] : undefined,
      title: typeof options['title'] === 'string' ? options['title'] : undefined,
      lite: options['lite'] === true,
      listTemplates: options['list-templates'] === true,
    })
  }

  if (primaryCmd === 'pack') {
    const groups = Array.isArray(options['group'])
      ? options['group']
      : typeof options['group'] === 'string'
        ? [options['group']]
        : undefined
    const ignores = Array.isArray(options['ignore'])
      ? options['ignore']
      : typeof options['ignore'] === 'string'
        ? [options['ignore']]
        : undefined

    return executePack({
      dir: positionals[0] || (typeof options['dir'] === 'string' ? options['dir'] : ''),
      out: typeof options['out'] === 'string' ? options['out'] : undefined,
      title: typeof options['title'] === 'string' ? options['title'] : undefined,
      entry: typeof options['entry'] === 'string' ? options['entry'] : undefined,
      root: typeof options['root'] === 'string' ? options['root'] : undefined,
      group: groups,
      ignore: ignores,
      lite: options['lite'] === true,
      dryRun: options['dry-run'] === true,
    })
  }

  if (primaryCmd === 'verify') {
    return executeVerify(positionals[0])
  }

  if (primaryCmd === 'refresh') {
    return executeRefresh({
      filePath: positionals[0],
      handoffPath: typeof options['handoff'] === 'string' ? options['handoff'] : '',
      dirPath: typeof options['dir'] === 'string' ? options['dir'] : undefined,
      dryRun: options['dry-run'] === true,
    })
  }

  if (primaryCmd === 'diff') {
    try {
      const diffResult = await executeDiff({
        source: positionals[0] || (typeof options['dir'] === 'string' ? options['dir'] : ''),
        target: positionals[1],
        handoff: typeof options['handoff'] === 'string' ? options['handoff'] : undefined,
        dir: typeof options['dir'] === 'string' ? options['dir'] : undefined,
      })
      return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(diffResult, null, 2) }
    } catch (err) {
      const code = (err as { code?: string })?.code || 'VALIDATION_ERROR'
      const exitCode = code === 'LOCAL_IO_ERROR' ? EXIT_CODES.LOCAL_IO_ERROR
        : code === 'CONFLICT_ERROR' ? EXIT_CODES.CONFLICT_ERROR
          : EXIT_CODES.VALIDATION_ERROR
      const error = makeCliError(code, (err as Error).message)
      return { exitCode, stderr: JSON.stringify(error) }
    }
  }

  if (primaryCmd === 'inspect') {
    try {
      const inspectResult = await executeInspect({
        filePath: positionals[0],
        credentials: options['credentials'] === true,
      })
      return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(inspectResult, null, 2) }
    } catch (err) {
      const code = (err as { code?: string })?.code || 'VALIDATION_ERROR'
      const exitCode = code === 'LOCAL_IO_ERROR' ? EXIT_CODES.LOCAL_IO_ERROR : EXIT_CODES.VALIDATION_ERROR
      const error = makeCliError(code, (err as Error).message)
      return { exitCode, stderr: JSON.stringify(error) }
    }
  }

  if (primaryCmd === 'extract') {
    try {
      const filesOption = typeof options['files'] === 'string'
        ? options['files'].split(',').map((s) => s.trim())
        : undefined
      const extractResult = await executeExtract({
        filePath: positionals[0],
        outDir: typeof options['out-dir'] === 'string' ? options['out-dir'] : undefined,
        files: filesOption,
        dryRun: options['dry-run'] === true,
      })
      return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(extractResult, null, 2) }
    } catch (err) {
      const code = (err as { code?: string })?.code || 'VALIDATION_ERROR'
      const exitCode = code === 'LOCAL_IO_ERROR' ? EXIT_CODES.LOCAL_IO_ERROR
        : code === 'CONFLICT_ERROR' ? EXIT_CODES.CONFLICT_ERROR : EXIT_CODES.VALIDATION_ERROR
      const error = makeCliError(code, (err as Error).message)
      return { exitCode, stderr: JSON.stringify(error) }
    }
  }

  if (primaryCmd === 'listen') {
    return executeListen({
      filePath: positionals[0],
      port: typeof options['port'] === 'string' ? Number(options['port']) : undefined,
      timeout: typeof options['timeout'] === 'string' ? Number(options['timeout']) : undefined,
      noOpen: options['no-open'] !== false,
    })
  }

  if (primaryCmd === 'open') {
    return executeOpen({
      filePath: positionals[0],
      listen: options['listen'] === true,
      port: typeof options['port'] === 'string' ? Number(options['port']) : undefined,
      timeout: typeof options['timeout'] === 'string' ? Number(options['timeout']) : undefined,
      noOpen: options['no-open'] === true,
    })
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

    let ttlSeconds: number | null | undefined = undefined
    const rawTtl = options['ttl']
    if (rawTtl !== undefined) {
      if (typeof rawTtl !== 'string') {
        const error = makeCliError('VALIDATION_ERROR', 'Option --ttl requires a duration value (e.g. 7d, 30d)')
        return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
      }
      try {
        ttlSeconds = parseDurationToSeconds(rawTtl)
      } catch (err) {
        const error = makeCliError('VALIDATION_ERROR', (err as Error).message)
        return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
      }
    }

    if (options['dry-run'] === true) {
      try {
        const summary = await executeLocalDryRun({ command: 'publish', filePath, host, ttlSeconds })
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
      const result = await client.publish({ rawHtml, ttlSeconds })
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
    const baseOption = options['base']
    const baseRevisionId = typeof baseOption === 'string' ? baseOption : undefined
    if (!tacoId || !filePath || (baseOption !== undefined && typeof baseOption !== 'string')) {
      const error = makeCliError(
        'VALIDATION_ERROR',
        'update requires <tacoId> <file>; --base optionally specifies the expected revision',
      )
      return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
    }
    if (options['dry-run'] === true) {
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

    try {
      const rawHtml = readFileSync(filePath, 'utf8')
      const result = await client.update(tacoId, { rawHtml, baseRevisionId })
      return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(result, null, 2) }
    } catch (err) {
      const errObj = err as Error & {
        statusCode?: number
        code?: string
        errorDetails?: {
          error?: { code?: string; message?: string; details?: Record<string, unknown> }
        }
      }
      const serverError = errObj.errorDetails?.error
      if (
        errObj.statusCode === 410 ||
        errObj.code === 'GONE' ||
        errObj.code === 'TACO_GONE' ||
        serverError?.code === 'GONE' ||
        serverError?.code === 'TACO_GONE'
      ) {
        const message = serverError?.message || errObj.message || 'Taco has expired or was deleted'
        return {
          exitCode: EXIT_CODES.TACO_GONE,
          stderr: JSON.stringify(makeCliError('TACO_GONE', message, { details: serverError?.details })),
        }
      }
      if (
        errObj.statusCode === 409 ||
        errObj.code === 'CONFLICT_ERROR' ||
        serverError?.code === 'REVISION_CONFLICT' ||
        serverError?.code === 'CONFLICT'
      ) {
        const code = serverError?.code || 'CONFLICT_ERROR'
        const message = serverError?.message || errObj.message || 'Revision conflict'
        return {
          exitCode: EXIT_CODES.CONFLICT_ERROR,
          stderr: JSON.stringify(makeCliError(code, message, { details: serverError?.details })),
        }
      }
      if (
        errObj.statusCode === 404 ||
        errObj.code === 'NOT_FOUND' ||
        serverError?.code === 'NOT_FOUND'
      ) {
        const message = serverError?.message || errObj.message || 'Taco not found'
        return {
          exitCode: EXIT_CODES.VALIDATION_ERROR,
          stderr: JSON.stringify(makeCliError('NOT_FOUND', message, { details: serverError?.details })),
        }
      }
      if (
        errObj.statusCode === 400 ||
        errObj.statusCode === 422 ||
        errObj.code === 'VALIDATION_ERROR' ||
        serverError?.code === 'VALIDATION_ERROR' ||
        serverError?.code === 'BAD_REQUEST' ||
        serverError?.code === 'UNPROCESSABLE_ENTITY'
      ) {
        const code = serverError?.code || errObj.code || 'VALIDATION_ERROR'
        const message = serverError?.message || errObj.message || 'Validation error'
        return {
          exitCode: EXIT_CODES.VALIDATION_ERROR,
          stderr: JSON.stringify(makeCliError(code, message, { details: serverError?.details })),
        }
      }
      if (errObj.code === 'ENOENT') {
        return {
          exitCode: EXIT_CODES.LOCAL_IO_ERROR,
          stderr: JSON.stringify(makeCliError('LOCAL_IO_ERROR', errObj.message)),
        }
      }
      return {
        exitCode: EXIT_CODES.LOCAL_IO_ERROR,
        stderr: JSON.stringify(
          makeCliError(
            serverError?.code || 'LOCAL_IO_ERROR',
            serverError?.message || (err as Error).message,
            { details: serverError?.details },
          ),
        ),
      }
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

    // Validate metadata flags
    const validHarnesses = [
      'codex',
      'claude-code',
      'github-copilot',
      'cursor',
      'agy',
      'pi',
      'omp',
      'openclaw',
      'hermes',
      'opencode',
      'gemini-cli',
      'other',
    ] as const
    const validModels = ['gpt', 'claude', 'gemini', 'other'] as const

    const harness = options['harness']
    if (harness !== undefined) {
      if (
        typeof harness !== 'string' ||
        !validHarnesses.includes(harness as (typeof validHarnesses)[number])
      ) {
        const error = makeCliError(
          'VALIDATION_ERROR',
          `Invalid --harness: "${harness}". Expected one of: ${validHarnesses.join(', ')}`,
        )
        return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
      }
    }

    const model = options['model']
    if (model !== undefined) {
      if (
        typeof model !== 'string' ||
        !validModels.includes(model as (typeof validModels)[number])
      ) {
        const error = makeCliError(
          'VALIDATION_ERROR',
          `Invalid --model: "${model}". Expected one of: ${validModels.join(', ')}`,
        )
        return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
      }
    }

    const modelId = options['model-id']
    if (modelId !== undefined) {
      if (typeof modelId !== 'string' || modelId.length < 1 || modelId.length > 128) {
        const error = makeCliError(
          'VALIDATION_ERROR',
          'Invalid --model-id: must be a non-empty string with maximum 128 characters',
        )
        return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
      }
    }

    const rawName = options['name']
    let name: string | undefined = undefined
    if (rawName !== undefined) {
      if (typeof rawName !== 'string') {
        const error = makeCliError(
          'VALIDATION_ERROR',
          'Invalid --name: must be a non-empty string with maximum 64 characters',
        )
        return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
      }
      name = rawName.trim()
      if (name.length < 1 || name.length > 64) {
        const error = makeCliError(
          'VALIDATION_ERROR',
          'Invalid --name: must be a non-empty string with maximum 64 characters (leading/trailing whitespace trimmed)',
        )
        return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
      }
    }

    const rawSession = options['session']
    let sessionTitle: string | undefined = undefined
    if (rawSession !== undefined) {
      if (typeof rawSession !== 'string') {
        const error = makeCliError(
          'VALIDATION_ERROR',
          'Invalid --session: must be a non-empty string with maximum 256 characters',
        )
        return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
      }
      sessionTitle = rawSession.trim()
      if (sessionTitle.length < 1 || sessionTitle.length > 256) {
        const error = makeCliError(
          'VALIDATION_ERROR',
          'Invalid --session: must be a non-empty string with maximum 256 characters (leading/trailing whitespace trimmed)',
        )
        return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
      }
    }

    const afterOption = options['after']
    if (afterOption !== undefined) {
      if (typeof afterOption !== 'string' || !/^(0|[1-9][0-9]*)$/.test(afterOption)) {
        const error = makeCliError(
          'VALIDATION_ERROR',
          'Invalid --after cursor: must be a non-negative integer string',
        )
        return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
      }
    }
    const streamOption = options['stream'] ?? options['follow']
    let mode: 'handoff' | 'stream' = 'handoff'
    if (streamOption !== undefined) {
      if (typeof streamOption !== 'boolean' && streamOption !== 'true' && streamOption !== 'false') {
        const error = makeCliError(
          'VALIDATION_ERROR',
          'Invalid --stream: expected boolean flag',
        )
        return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
      }
      mode = streamOption === true || streamOption === 'true' ? 'stream' : 'handoff'
    }

    const listenerIdOption = options['listener-id']
    if (listenerIdOption !== undefined) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (typeof listenerIdOption !== 'string' || !uuidRegex.test(listenerIdOption)) {
        const error = makeCliError(
          'VALIDATION_ERROR',
          'Invalid --listener-id: must be a valid UUID',
        )
        return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
      }
    }
    const stableListenerId =
      typeof listenerIdOption === 'string' ? listenerIdOption : crypto.randomUUID()

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
      {
        initialAfter: typeof afterOption === 'string' ? afterOption : null,
        mode,
        metadata: {
          listenerId: stableListenerId,
          harness: typeof harness === 'string' ? harness : undefined,
          model: typeof model === 'string' ? model : undefined,
          modelId: typeof modelId === 'string' ? modelId : undefined,
          name: name !== undefined ? name : undefined,
          sessionTitle: sessionTitle !== undefined ? sessionTitle : undefined,
        },
      },
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
    const afterOption = options['after']
    if (afterOption !== undefined) {
      if (typeof afterOption !== 'string' || !/^(0|[1-9][0-9]*)$/.test(afterOption)) {
        const error = makeCliError(
          'VALIDATION_ERROR',
          'Invalid --after cursor: must be a non-negative integer string',
        )
        return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
      }
    }
    const throughOption = options['through']
    if (throughOption !== undefined && (typeof throughOption !== 'string' || !/^(0|[1-9][0-9]*)$/.test(throughOption))) {
      return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(makeCliError('VALIDATION_ERROR', 'Invalid --through sequence')) }
    }
    const limitOption = options['limit']
    if (limitOption !== undefined && (typeof limitOption !== 'string' || !/^[1-9][0-9]*$/.test(limitOption) || Number(limitOption) > 500)) {
      return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(makeCliError('VALIDATION_ERROR', 'Invalid --limit: expected 1 to 500')) }
    }
    try {
      const data = await client.getEvents(tacoId, {
        after: typeof afterOption === 'string' ? afterOption : undefined,
        through: typeof throughOption === 'string' ? throughOption : undefined,
        limit: typeof limitOption === 'string' ? Number(limitOption) : undefined,
      })
      return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(data, null, 2) }
    } catch (err) {
      const errObj = err as Error & {
        statusCode?: number
        code?: string
        errorDetails?: {
          error?: { code?: string; message?: string; details?: Record<string, unknown> }
        }
      }
      const goneError = errObj.errorDetails?.error
      if (
        errObj.code === 'GONE' ||
        errObj.code === 'TACO_GONE' ||
        goneError?.code === 'GONE' ||
        goneError?.code === 'TACO_GONE'
      ) {
        const message = goneError?.message || errObj.message || 'Taco has expired or was deleted'
        return {
          exitCode: EXIT_CODES.TACO_GONE,
          stderr: JSON.stringify(makeCliError('TACO_GONE', message, { details: goneError?.details })),
        }
      }
      if (errObj.statusCode === 410 || errObj.code === 'CURSOR_EXPIRED') {
        const serverError = errObj.errorDetails?.error
        const code = serverError?.code || 'CURSOR_EXPIRED'
        const message =
          serverError?.message || errObj.message || 'Cursor has expired and cannot be replayed'
        return {
          exitCode: EXIT_CODES.CURSOR_EXPIRED,
          stderr: JSON.stringify(makeCliError(code, message, { details: serverError?.details })),
        }
      }
      return {
        exitCode: EXIT_CODES.LOCAL_IO_ERROR,
        stderr: JSON.stringify(makeCliError('LOCAL_IO_ERROR', (err as Error).message)),
      }
    }
  }
  // Handle handoff
  if (primaryCmd === 'handoff') {
    const [tacoId, handoffId] = positionals
    if (!tacoId || !handoffId) {
      return {
        exitCode: EXIT_CODES.VALIDATION_ERROR,
        stderr: JSON.stringify(
          makeCliError('VALIDATION_ERROR', 'handoff requires <tacoId> <handoffId>'),
        ),
      }
    }
    try {
      const data = await client.getHandoff(tacoId, handoffId)
      return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(data, null, 2) }
    } catch (err) {
      const errObj = err as Error & {
        statusCode?: number
        code?: string
        errorDetails?: {
          error?: { code?: string; message?: string; details?: Record<string, unknown> }
        }
      }
      const goneError = errObj.errorDetails?.error
      if (
        errObj.code === 'GONE' ||
        errObj.code === 'TACO_GONE' ||
        goneError?.code === 'GONE' ||
        goneError?.code === 'TACO_GONE'
      ) {
        const message = goneError?.message || errObj.message || 'Taco has expired or was deleted'
        return {
          exitCode: EXIT_CODES.TACO_GONE,
          stderr: JSON.stringify(makeCliError('TACO_GONE', message, { details: goneError?.details })),
        }
      }
      if (errObj.statusCode === 410 || errObj.code === 'CURSOR_EXPIRED') {
        const serverError = errObj.errorDetails?.error
        const code = serverError?.code || 'CURSOR_EXPIRED'
        const message =
          serverError?.message || errObj.message || 'Handoff or Taco has expired or was deleted'
        return {
          exitCode: EXIT_CODES.CURSOR_EXPIRED,
          stderr: JSON.stringify(makeCliError(code, message, { details: serverError?.details })),
        }
      }
      if (errObj.statusCode === 404 || errObj.code === 'NOT_FOUND') {
        return {
          exitCode: EXIT_CODES.VALIDATION_ERROR,
          stderr: JSON.stringify(makeCliError('NOT_FOUND', errObj.message || 'Handoff not found')),
        }
      }
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
