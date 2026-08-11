import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const source = resolve(process.argv[2] || 'dist-single/Taco_Spec.taco.html')
const target = resolve(process.argv[3] || 'extensions/taco/assets/taco-shell.html')

await stat(source)
await mkdir(dirname(target), { recursive: true })
await copyFile(source, target)
process.stdout.write(`Updated ${target} from ${source}\n`)
