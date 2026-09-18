#!/usr/bin/env node
import { runCli } from './runner.ts'

const main = async () => {
  const result = await runCli(process.argv.slice(2))
  if (result.stdout) {
    process.stdout.write(`${result.stdout}\n`)
  }
  if (result.stderr) {
    process.stderr.write(`${result.stderr}\n`)
  }
  process.exit(result.exitCode)
}

main().catch((err: unknown) => {
  process.stderr.write(
    JSON.stringify({ error: { code: 'LOCAL_IO_ERROR', message: (err as Error).message } }) + '\n',
  )
  process.exit(1)
})
