import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const DOCUMENT_BLOCK = /(<script\b[^>]*\bid=["']taco-document["'][^>]*>)[\s\S]*?(<\/script>)/gi
const SHELL_TITLE = /(<title\b[^>]*>)[\s\S]*?(<\/title>)/i
const SKILL_TITLE = 'Taco'

async function syncShell({ source, target, skillTarget, hostTarget }) {
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

  if (hostTarget) {
    await mkdir(dirname(hostTarget), { recursive: true })
    await copyFile(source, hostTarget)
    process.stdout.write(`Updated ${hostTarget} from ${source}\n`)
  }

  process.stdout.write(`Updated ${target} from ${source}\n`)
  process.stdout.write(`Updated ${skillTarget} with an empty document block\n`)
}

if (process.argv[2] && process.argv[3]) {
  await syncShell({
    source: resolve(process.argv[2]),
    target: resolve(process.argv[3]),
    skillTarget: resolve('skills/taco/taco-shell.html'),
  })
} else {
  await syncShell({
    source: resolve('dist-single/Taco_Spec.taco.html'),
    target: resolve('extensions/taco/assets/taco-shell.html'),
    skillTarget: resolve('skills/taco/taco-shell.html'),
    hostTarget: resolve('packages/host/assets/taco-shell.html'),
  })
  await syncShell({
    source: resolve('dist-single/Taco_Spec_Lite.taco.html'),
    target: resolve('extensions/taco/assets/taco-shell-lite.html'),
    skillTarget: resolve('skills/taco/taco-shell-lite.html'),
  })
}
