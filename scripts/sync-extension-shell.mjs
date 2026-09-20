import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const source = resolve(process.argv[2] || 'dist-single/Taco_Spec.taco.html')
const target = resolve(process.argv[3] || 'extensions/taco/assets/taco-shell.html')
const skillTarget = resolve('skills/taco/taco-shell.html')

const DOCUMENT_BLOCK = /(<script\b[^>]*\bid=["']taco-document["'][^>]*>)[\s\S]*?(<\/script>)/gi
const SHELL_TITLE = /(<title\b[^>]*>)[\s\S]*?(<\/title>)/i
const SKILL_TITLE = 'Taco'

await stat(source)
await mkdir(dirname(target), { recursive: true })
await copyFile(source, target)

const shell = await readFile(source, 'utf8')
if ((shell.match(DOCUMENT_BLOCK) ?? []).length !== 1) {
  throw new Error(`${source} must contain exactly one #taco-document block`)
}

// The installed skill ships the same runtime with no document: an empty data block
// and a neutral title the agent replaces when it writes a bundle. Only the block and
// the title change — the runtime, security markers, and styles stay production-identical.
const emptyDocument = shell.replace(DOCUMENT_BLOCK, (_match, open, close) => `${open}${close}`)
const skillShell = SHELL_TITLE.test(emptyDocument)
  ? emptyDocument.replace(SHELL_TITLE, (_match, open, close) => `${open}${SKILL_TITLE}${close}`)
  : emptyDocument.replace('</head>', () => `<title>${SKILL_TITLE}</title></head>`)

await mkdir(dirname(skillTarget), { recursive: true })
await writeFile(skillTarget, skillShell, 'utf8')

process.stdout.write(`Updated ${target} from ${source}\n`)
process.stdout.write(`Updated ${skillTarget} with an empty document block\n`)
