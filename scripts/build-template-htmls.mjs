import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const shellPath = resolve(projectRoot, 'extensions/taco/assets/taco-shell.html')
const templatesDir = resolve(projectRoot, 'extensions/taco/templates')

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

async function buildTemplateHtmls() {
  const shell = await readFile(shellPath, 'utf8')
  const entries = await readdir(templatesDir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const dirPath = join(templatesDir, entry.name)
      const bundlePath = join(dirPath, 'bundle.json')
      try {
        const bundleJson = await readFile(bundlePath, 'utf8')
        const bundle = JSON.parse(bundleJson)
        const html = embedBundle(shell, bundle)
        const outputPath = join(dirPath, 'empty.taco.html')
        await writeFile(outputPath, html, 'utf8')
        console.log(`Generated ${entry.name}/empty.taco.html`)
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`Error building html for ${entry.name}:`, err)
        }
      }
    }
  }
}

buildTemplateHtmls().catch((err) => {
  console.error(err)
  process.exit(1)
})
