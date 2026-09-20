import { copyFile, mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const shellPath = resolve(projectRoot, 'extensions/taco/assets/taco-shell.html')
const skillShellPath = resolve(projectRoot, 'skills/taco/taco-shell.html')
const templatesDir = resolve(projectRoot, 'extensions/taco/templates')
const skillTemplatesDir = resolve(projectRoot, 'skills/taco/templates')

const DATA_BLOCK = /<script\b[^>]*\bid=["']taco-document["'][^>]*>([\s\S]*?)<\/script>/i

const encodeBundle = (bundle) =>
  JSON.stringify(bundle, null, 2).replace(
    /[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )

const embedBundle = (shell, bundle) => {
  if (!DATA_BLOCK.test(shell)) throw new Error('Taco shell does not contain #taco-document')
  const json = encodeBundle(bundle)
  const withBundle = shell.replace(
    DATA_BLOCK,
    () => `<script type="application/taco+json" id="taco-document">\n${json}\n</script>`,
  )
  const escapedTitle = `${bundle.title} — Taco`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(withBundle)) {
    return withBundle.replace(
      /<title\b[^>]*>[\s\S]*?<\/title>/i,
      () => `<title>${escapedTitle}</title>`,
    )
  }
  return withBundle.replace('</head>', () => `<title>${escapedTitle}</title></head>`)
}

const listFiles = async (directory, base = directory) => {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(absolute, base)))
    else if (entry.isFile()) files.push(relative(base, absolute).split(sep).join('/'))
  }
  return files
}

const pruneEmptyDirectories = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const absolute = join(directory, entry.name)
    await pruneEmptyDirectories(absolute)
    await rmdir(absolute).catch((error) => {
      if (error.code !== 'ENOTEMPTY') throw error
    })
  }
}

// The installed skill ships its own copy of every template pack so a standalone
// install needs no checkout. extensions/taco/templates stays canonical: generated
// packs are written into both trees, the remaining files are copied verbatim, and
// anything in the skill tree without a canonical counterpart is removed.
const syncSkillTemplates = async (generated) => {
  const canonical = await listFiles(templatesDir)
  for (const file of canonical) {
    if (generated.has(file)) continue
    const target = join(skillTemplatesDir, file)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(join(templatesDir, file), target)
  }
  const expected = new Set(canonical)
  for (const file of await listFiles(skillTemplatesDir)) {
    if (expected.has(file)) continue
    await rm(join(skillTemplatesDir, file))
    console.log(`Removed stale skill template ${file}`)
  }
  await pruneEmptyDirectories(skillTemplatesDir)
}

async function buildTemplateHtmls() {
  const shell = await readFile(shellPath, 'utf8')
  const skillShell = await readFile(skillShellPath, 'utf8')
  const generated = new Set()

  for (const entry of await readdir(templatesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const bundlePath = join(templatesDir, entry.name, 'bundle.json')
    let bundle
    try {
      bundle = JSON.parse(await readFile(bundlePath, 'utf8'))
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`Error building html for ${entry.name}:`, err)
      continue
    }
    const file = `${entry.name}/empty.taco.html`
    await writeFile(join(templatesDir, file), embedBundle(shell, bundle), 'utf8')
    const skillFile = join(skillTemplatesDir, file)
    await mkdir(dirname(skillFile), { recursive: true })
    await writeFile(skillFile, embedBundle(skillShell, bundle), 'utf8')
    generated.add(file)
    console.log(`Generated ${file}`)
  }

  await syncSkillTemplates(generated)
}

buildTemplateHtmls().catch((err) => {
  console.error(err)
  process.exit(1)
})
