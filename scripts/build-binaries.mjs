import { execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const projectRoot = resolve(new URL('.', import.meta.url).pathname, '..')
const cliDir = join(projectRoot, 'packages', 'cli')
const distDir = join(cliDir, 'dist')

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true })
}

console.log('Compiling @taco/cli standalone binary with Bun...')

try {
  // Use bun build --compile to generate native standalone binary
  execSync(
    `bun build --compile --minify ./packages/cli/src/main.ts --outfile ./packages/cli/dist/taco-cli`,
    {
      cwd: projectRoot,
      stdio: 'inherit',
    },
  )
  console.log('Successfully compiled: packages/cli/dist/taco-cli-darwin-arm64')
} catch (err) {
  console.warn(
    'Native binary compile with bun skipped or requires bun installed on target:',
    err.message,
  )
}
