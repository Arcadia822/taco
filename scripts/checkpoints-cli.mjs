import { readFile } from 'node:fs/promises'
import { resolveCheckpoints } from '../packages/protocol/src/checkpoints.ts'

const DATA_BLOCK = /<script\b[^>]*\bid=["']taco-document["'][^>]*>([\s\S]*?)<\/script>/i

async function main() {
  if (process.argv.length !== 3) {
    throw new Error('Usage: node checkpoints.mjs <file.taco.html>')
  }
  const html = await readFile(process.argv[2], 'utf8')
  const block = DATA_BLOCK.exec(html)
  if (!block) throw new Error('Taco file does not contain #taco-document')
  const bundle = JSON.parse(block[1])
  if (!bundle || typeof bundle !== 'object' || typeof bundle.root !== 'string' || !Array.isArray(bundle.files)) {
    throw new Error('Invalid Taco bundle: expected root and files')
  }
  process.stdout.write(`${JSON.stringify(resolveCheckpoints(bundle))}\n`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
