import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EXIT_CODES, makeCliError } from './errors.ts'
import { executeListen, type CliExecutionResult } from './listen.ts'

export interface OpenOptions {
  filePath: string
  listen?: boolean
  port?: number
  timeout?: number
  noOpen?: boolean
}

export const executeOpen = async (options: OpenOptions): Promise<CliExecutionResult> => {
  const artifactPath = resolve(options.filePath)
  if (!existsSync(artifactPath)) {
    const error = makeCliError('LOCAL_IO_ERROR', `File not found: ${artifactPath}`)
    return { exitCode: EXIT_CODES.LOCAL_IO_ERROR, stderr: JSON.stringify(error) }
  }

  if (options.listen) {
    return executeListen({
      filePath: artifactPath,
      port: options.port,
      timeout: options.timeout,
      noOpen: options.noOpen,
      openBrowser: true,
    })
  }

  if (!options.noOpen) {
    const targetUrl = pathToFileURL(artifactPath).href
    const [command, args]: [string, string[]] = process.platform === 'darwin'
      ? ['open', [targetUrl]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', targetUrl]]
        : ['xdg-open', [targetUrl]]
    try {
      await new Promise<void>((done, fail) => {
        const child = spawn(command, args, { stdio: 'ignore' })
        child.once('error', fail)
        child.once('close', (code) => code === 0 ? done() : fail(new Error(`Browser launcher exited ${code}`)))
      })
    } catch (err) {
      const error = makeCliError('LOCAL_IO_ERROR', `Unable to open browser: ${(err as Error).message}`)
      return { exitCode: EXIT_CODES.LOCAL_IO_ERROR, stderr: JSON.stringify(error) }
    }
  }

  const result = {
    schema: 'taco-cli-open/1',
    path: artifactPath,
    opened: !options.noOpen,
  }

  return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(result, null, 2) }
}
