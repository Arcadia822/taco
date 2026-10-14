#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Agent CLI authoring/review round trips (features/cli.md).
//
// Two cases drive the built CLI as real subprocesses (`node packages/cli/dist/main.js`,
// one fresh child per command) and reopen what it produced in the browser harness:
//
//   cli/pack-extract       pack a canonical directory with Unicode Markdown, a fixture PNG
//                          and embedded HTML; verify/inspect it; reopen it and read the
//                          rendered content; extract exact bytes with and without --files;
//                          prove write-free dry runs and the existing-target refusal.
//   cli/review-diff-extract  pack a second clean directory, edit it through the real browser
//                          UI, download and reopen the saved review, diff it against the
//                          packed artifact and against the canonical directory, then extract
//                          the reviewed bytes and the two refusal paths.
//
// Every command's argv, stdout, stderr, exit code and duration is appended to
// `cli-commands.json` before its assertions run, so failures keep full evidence. Helper
// scratch directories are created with mkdtemp outside the evidence directory and removed
// in a cleanup pass that records `cleanup-proof.json`; generated and downloaded Taco
// artifacts stay in the evidence directory.
//
// This module is an explicit ad-hoc scenario, not a registered suite case: the browser
// suite runs before the CLI is built in CI. Run it with:
//
//   npm run build && npm run build --workspace @tacobin/cli
//   node .agents/skills/verify-taco/scripts/verify.mjs \
//     --scenario .agents/skills/verify-taco/scripts/cli.mjs \
//     --out artifacts/verify-taco/cli-run

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

import { FIXTURE } from './fixture.mjs'
import { REPO_ROOT } from './harness.mjs'
import { saveDownload, selectFile, typeAtEnd } from './ui.mjs'

export const feature = 'cli'

const CLI_RELATIVE = 'packages/cli/dist/main.js'
const CLI_PATH = resolve(REPO_ROOT, CLI_RELATIVE)
/** Bounded below the harness default (180s) so a hung CLI fails as evidence, not as a timeout. */
const CLI_TIMEOUT_MS = 30000
const MAX_STDOUT_BYTES = 64 * 1024 * 1024
const PNG_PREFIX = 'data:image/png;base64,'
const execFileAsync = promisify(execFile)

const CASE_PACK_EXTRACT = 'cli/pack-extract'
const CASE_REVIEW_DIFF_EXTRACT = 'cli/review-diff-extract'

// ---------------------------------------------------------------------------
// shared subprocess + evidence plumbing
// ---------------------------------------------------------------------------

/** Local toolbox commands must never inherit a live Host endpoint from the caller. */
const childEnv = () => {
  const env = { ...process.env }
  delete env.TACO_HOST_URL
  return env
}

const commandLog = new Map()
const cleanupLog = new Map()

const exists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const writeEvidence = async (h, name, value) => {
  const path = resolve(h.outDir, name)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2))
  return path
}

/** Append one record and flush the whole file immediately: evidence exists before assertions. */
const appendEvidence = async (h, name, entry, store) => {
  const list = store.get(h.outDir) ?? []
  list.push(entry)
  store.set(h.outDir, list)
  await writeEvidence(h, name, list)
  return entry
}

/**
 * Run the built CLI once with an argument array (no shell), keep the complete stdout/stderr
 * for parsing, and record the receipt before returning it.
 */
const runCli = async (h, scope, label, args) => {
  const startedAt = new Date().toISOString()
  const began = Date.now()
  let outcome
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, ...args], {
      shell: false,
      cwd: REPO_ROOT,
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: MAX_STDOUT_BYTES,
      encoding: 'utf8',
      env: childEnv(),
    })
    outcome = { exitCode: 0, signal: null, timedOut: false, stdout, stderr }
  } catch (error) {
    outcome = {
      exitCode: typeof error?.code === 'number' ? error.code : null,
      signal: error?.signal ?? null,
      timedOut: Boolean(error?.killed),
      stdout: typeof error?.stdout === 'string' ? error.stdout : '',
      stderr: typeof error?.stderr === 'string' ? error.stderr : '',
    }
  }
  return appendEvidence(
    h,
    'cli-commands.json',
    {
      case: scope,
      label,
      command: `${process.execPath} ${CLI_RELATIVE}`,
      args,
      cwd: REPO_ROOT,
      startedAt,
      durationMs: Date.now() - began,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: outcome.timedOut,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
    },
    commandLog,
  )
}

const expectExit = (h, record, expected, what) => {
  h.assert.equal(
    record.exitCode,
    expected,
    `${what}: expected exit ${expected}, observed ${record.exitCode}` +
      `${record.timedOut ? ' (bounded 30s CLI timeout)' : ''}` +
      `${record.signal ? ` (signal ${record.signal})` : ''}; stderr: ${record.stderr.slice(0, 500)}`,
  )
}

/** Parse the complete stdout payload of a command that must succeed. */
const parseStdout = (h, record, what) => {
  expectExit(h, record, 0, what)
  try {
    return JSON.parse(record.stdout)
  } catch (error) {
    h.assert.ok(
      false,
      `${what}: stdout is not JSON (${error.message}); first bytes: ${JSON.stringify(record.stdout.slice(0, 200))}`,
    )
    return null
  }
}

const parseStderr = (record) => {
  try {
    return JSON.parse(record.stderr)
  } catch {
    return null
  }
}

/** Read the structured `error.code` a refused command reports, after checking its exit code. */
const expectErrorCode = (h, record, expectedExit, what) => {
  expectExit(h, record, expectedExit, what)
  const payload = parseStderr(record)
  h.assert.ok(
    payload?.error?.code,
    `${what}: stderr is not a structured CLI error: ${record.stderr.slice(0, 300)}`,
  )
  return payload.error.code
}

// ---------------------------------------------------------------------------
// filesystem helpers
// ---------------------------------------------------------------------------

const writeCanonical = async (root, entries) => {
  for (const [relativePath, content] of entries) {
    const target = join(root, ...relativePath.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}

/** Sorted relative-file snapshot with byte counts and hashes; the tree proof for extraction. */
const snapshotDir = async (root) => {
  const entries = []
  const visit = async (dir) => {
    const children = await readdir(dir, { withFileTypes: true })
    children.sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      const absolute = join(dir, child.name)
      if (child.isDirectory()) {
        await visit(absolute)
        continue
      }
      const bytes = await readFile(absolute)
      entries.push({
        path: relative(root, absolute).split(sep).join('/'),
        bytes: bytes.length,
        sha256: sha256(bytes),
      })
    }
  }
  if (await exists(root)) await visit(root)
  return entries
}

const sameBytes = (h, observed, expected, what) => {
  h.assert.equal(
    observed.length,
    expected.length,
    `${what}: byte length differs (${observed.length} vs ${expected.length})`,
  )
  h.assert.ok(observed.equals(expected), `${what}: bytes differ`)
}

const treePaths = (snapshot) => snapshot.map((entry) => entry.path)

/**
 * Own one scratch workspace outside the evidence directory: run the body, always remove the
 * scratch tree, record the cleanup proof (removed directory + retained artifacts that exist),
 * then rethrow the body's failure so real assertion errors stay visible.
 */
const withScratch = async (h, scope, retainedPaths, body) => {
  const base = await realpath(tmpdir())
  const scratch = await mkdtemp(join(base, `taco-verify-${scope.replace(/[^a-zA-Z0-9]+/g, '-')}-`))
  let failure = null
  let value = null
  try {
    value = await body(scratch)
  } catch (error) {
    failure = error
  }

  let removed = false
  let removalError = null
  try {
    await rm(scratch, { recursive: true, force: true })
    removed = !(await exists(scratch))
  } catch (error) {
    removalError = error.message
  }

  const retained = []
  for (const path of retainedPaths) {
    const present = await exists(path)
    const bytes = present ? await readFile(path) : null
    retained.push({
      path: relative(REPO_ROOT, path),
      exists: present,
      bytes: bytes?.length ?? 0,
      sha256: bytes ? sha256(bytes) : null,
    })
  }

  const proof = await appendEvidence(
    h,
    'cleanup-proof.json',
    {
      case: scope,
      at: new Date().toISOString(),
      scratch: {
        path: relative(REPO_ROOT, scratch),
        removed,
        ...(removalError ? { error: removalError } : {}),
      },
      retainedArtifacts: retained,
    },
    cleanupLog,
  )

  if (failure) throw failure
  h.assert.equal(
    proof.scratch.removed,
    true,
    `helper scratch directory was not removed: ${proof.scratch.path}`,
  )
  for (const entry of proof.retainedArtifacts) {
    h.assert.equal(
      entry.exists,
      true,
      `retained artifact is missing from the evidence directory: ${entry.path}`,
    )
  }
  return value
}

// ---------------------------------------------------------------------------
// canonical review content (case 1)
// ---------------------------------------------------------------------------

const SERIES_ROOT = 'cli-review'
const GUIDE_PATH = 'guide.md'
const EMBED_PATH = 'pages/embed.html'
const PIXEL_PATH = 'assets/pixel.png'
const IGNORED_PATH = 'private/secret.md'
const HIDDEN_PATH = '.hidden.md'
const NESTED_HIDDEN_PATH = '.cache/ignored.md'
const CONTAINER_PATH = 'leftovers.taco.html'

const GUIDE_HEADING = 'CLI review guide'
const EMBED_HEADING = 'CLI embedded heading'
const EMBED_MARKER = 'cli-embed-marker'
const SCRIPT_TERMINATOR = '</script>'
const REPLACEMENT_CHARACTER = '\uFFFD'
const LINE_SEPARATOR = '\u2028'
const UNICODE_SAMPLE = '中文标题 · café · Ω · ✓ · naïve'
// The JSON encoder escapes `<`, `>`, `&` and U+2028/9, so the packed shell must carry this
// escaped spelling instead of a raw container terminator.
const ESCAPED_TERMINATOR = '\\u003c/script\\u003e'

const GUIDE_TEXT = `---
title: "CLI review guide"
summary: "中文 · café · ✓"
status: in_progress
tags:
  - cli
  - review
---

# ${GUIDE_HEADING}

${UNICODE_SAMPLE}

A literal container terminator stays text inside the review: \`${SCRIPT_TERMINATOR}\`

An HTML code sample is preserved too: \`<script>window.__cliReviewInline = 'kept'</script>\`

Tokens: replacement ${REPLACEMENT_CHARACTER}, line separator ${LINE_SEPARATOR}, ampersand &lt; and 3 > 2.
`

const EMBED_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>CLI embedded preview</title>
    <script>document.documentElement.dataset.cliEmbedMarker = '${EMBED_MARKER}'</script>
  </head>
  <body>
    <h1>${EMBED_HEADING}</h1>
    <p>Embedded HTML body shipped inside the CLI-packed review.</p>
  </body>
</html>
`

/** Canonical review files and the shared PNG bytes they must preserve. */
const caseOneCanonical = () => {
  const png = Buffer.from(FIXTURE.pngDataUrl.slice(PNG_PREFIX.length), 'base64')
  return {
    png,
    guide: GUIDE_TEXT,
    embed: EMBED_HTML,
    entries: [
      [GUIDE_PATH, GUIDE_TEXT],
      [EMBED_PATH, EMBED_HTML],
      [PIXEL_PATH, png],
      [IGNORED_PATH, 'Private note that --ignore must exclude.\n'],
      [HIDDEN_PATH, 'Hidden file that the dotfile exclusion must drop.\n'],
      [NESTED_HIDDEN_PATH, 'Hidden nested file that recursion must also drop.\n'],
      [CONTAINER_PATH, 'Not a Taco bundle; the .taco.html exclusion must drop it.\n'],
    ],
  }
}

const packArgs = ({
  dir,
  out,
  title,
  entry = GUIDE_PATH,
  root = SERIES_ROOT,
  ignore = [],
  dryRun = false,
}) => {
  const args = ['pack', dir, '--entry', entry, '--root', root, '--title', title, '--out', out]
  for (const pattern of ignore) args.push('--ignore', pattern)
  if (dryRun) args.push('--dry-run')
  return args
}

/** Read the embedded HTML preview's heading through the shipped sandboxed iframe. */
const embeddedPreview = async (page) => {
  const frame = page.frameLocator('iframe.html-document-preview')
  await frame.locator('h1').first().waitFor({ state: 'visible', timeout: 15000 })
  return {
    heading: (await frame.locator('h1').first().innerText()).trim(),
    marker: await frame.locator('html').evaluate((node) => node.dataset.cliEmbedMarker ?? null),
  }
}

// ---------------------------------------------------------------------------
// case 1 — cli/pack-extract
// ---------------------------------------------------------------------------

const packExtractCase = async (h) => {
  const scope = CASE_PACK_EXTRACT
  // The product requires the artifact stem to be the portable form of its title
  // (pack: `tacoFileBase(outputPath) !== portableTitleBase(title)` is refused).
  const packedPath = resolve(h.outDir, 'CLI_review.taco.html')
  const evidence = {}
  const flush = () => writeEvidence(h, 'cli-pack-extract-evidence.json', evidence)

  return withScratch(h, scope, [packedPath], async (scratch) => {
    const canonical = join(scratch, 'canonical')
    const { png, guide, embed, entries } = caseOneCanonical()
    const guideBytes = Buffer.from(guide, 'utf8')
    const embedBytes = Buffer.from(embed, 'utf8')
    const expectedPaths = [PIXEL_PATH, GUIDE_PATH, EMBED_PATH].sort()

    await h.step(
      `${scope}: write the canonical review directory outside the evidence directory`,
      async () => {
        await writeCanonical(canonical, entries)
        const snapshot = await snapshotDir(canonical)
        evidence.canonical = snapshot
        await flush()
        h.assert.equal(snapshot.length, entries.length, 'every canonical entry must exist on disk')
        h.assert.ok(
          treePaths(snapshot).includes(IGNORED_PATH) && treePaths(snapshot).includes(HIDDEN_PATH),
          'the exclusions must be real files before packing, otherwise the exclusions prove nothing',
        )
      },
    )

    await h.step(
      `${scope}: pack --dry-run creates neither the artifact nor its parent`,
      async () => {
        const dryTarget = join(scratch, 'dry-run-target', 'nested', 'CLI_review.taco.html')
        const dry = await runCli(
          h,
          scope,
          'pack --dry-run into a new nested target',
          packArgs({
            dir: canonical,
            out: dryTarget,
            title: 'CLI review',
            ignore: ['private/**'],
            dryRun: true,
          }),
        )
        const payload = parseStdout(h, dry, 'pack --dry-run')
        h.assert.equal(payload.schema, 'taco-cli-pack/1')
        h.assert.equal(
          payload.outputPath,
          dryTarget,
          'the dry run must report the requested destination',
        )
        h.assert.equal(await exists(dryTarget), false, 'a dry run must not create the artifact')
        h.assert.equal(
          await exists(join(scratch, 'dry-run-target')),
          false,
          'a dry run must not create the destination parent',
        )
        evidence.dryRun = {
          exitCode: dry.exitCode,
          outputPath: payload.outputPath,
          lines: payload.lines,
        }
        await flush()
      },
    )

    await h.step(
      `${scope}: real pack reports every excluded entry and writes the artifact`,
      async () => {
        const record = await runCli(
          h,
          scope,
          'pack the canonical directory',
          packArgs({
            dir: canonical,
            out: packedPath,
            title: 'CLI review',
            ignore: ['private/**'],
          }),
        )
        const payload = parseStdout(h, record, 'pack')
        h.assert.equal(payload.schema, 'taco-cli-pack/1')
        h.assert.equal(payload.outputPath, packedPath)
        h.assert.equal(await exists(packedPath), true, 'pack must write the artifact')
        const bytes = await readFile(packedPath)
        h.assert.ok(
          bytes.toString('utf8').includes(ESCAPED_TERMINATOR),
          'the data block must carry the escaped container terminator, not a raw one',
        )
        evidence.pack = {
          exitCode: record.exitCode,
          outputPath: payload.outputPath,
          sha256: sha256(bytes),
          bytes: bytes.length,
          lines: payload.lines,
        }
        await flush()
      },
    )

    await h.step(`${scope}: verify accepts the packed artifact with no warnings`, async () => {
      const record = await runCli(h, scope, 'verify the packed artifact', ['verify', packedPath])
      const payload = parseStdout(h, record, 'verify')
      h.assert.equal(payload.schema, 'taco-cli-verify/1')
      h.assert.equal(payload.path, packedPath)
      h.assert.equal(payload.title, 'CLI review')
      h.assert.equal(payload.root, SERIES_ROOT)
      h.assert.equal(
        payload.fileCount,
        expectedPaths.length,
        'verify must count only the kept files',
      )
      h.assert.deepEqual(payload.warnings, [])
      h.assert.ok(
        typeof payload.docId === 'string' && payload.docId.length > 0,
        'verify must report a docId',
      )
      evidence.verify = {
        exitCode: record.exitCode,
        docId: payload.docId,
        fileCount: payload.fileCount,
      }
      await flush()
    })

    let inspected
    await h.step(
      `${scope}: inspect reports full bundle paths for the kept files only`,
      async () => {
        const record = await runCli(h, scope, 'inspect the packed artifact', [
          'inspect',
          packedPath,
        ])
        inspected = parseStdout(h, record, 'inspect')
        h.assert.equal(inspected.root, SERIES_ROOT)
        h.assert.equal(inspected.title, 'CLI review')
        h.assert.equal(
          inspected.entry,
          `${SERIES_ROOT}/${GUIDE_PATH}`,
          'inspect reports the declared bundle entry',
        )
        h.assert.equal(inspected.entryDeclared, true)
        h.assert.equal(inspected.files.count, expectedPaths.length)
        const paths = inspected.files.details.map((file) => file.path).sort()
        h.assert.deepEqual(
          paths,
          expectedPaths.map((path) => `${SERIES_ROOT}/${path}`),
          'inspect reports manifest (root-prefixed) paths',
        )
        const pixel = inspected.files.details.find((file) => file.path.endsWith(PIXEL_PATH))
        h.assert.equal(pixel.mediaType, 'image/png')
        h.assert.equal(pixel.size, png.length, 'inspect must report the decoded PNG size')
        h.assert.deepEqual(
          inspected.diagnostics.filter((entry) => entry.severity === 'error'),
          [],
          'a packed review must have no error diagnostics',
        )
        for (const excluded of [IGNORED_PATH, HIDDEN_PATH, NESTED_HIDDEN_PATH, CONTAINER_PATH]) {
          h.assert.ok(
            !paths.some((path) => path.endsWith(excluded)),
            `${excluded} must not appear in the manifest`,
          )
        }
        evidence.inspect = {
          exitCode: record.exitCode,
          docId: inspected.docId,
          entry: inspected.entry,
          files: inspected.files.details,
          diagnostics: inspected.diagnostics,
        }
        await flush()
      },
    )

    const reopened = await h.reopen(packedPath)
    const cliPage = reopened.page

    await h.step(
      `${scope}: the reopened page passes the read-only health gate and matches the CLI manifest`,
      async () => {
        h.assert.equal(
          reopened.bundle.docId,
          inspected.docId,
          'the mounted bundle keeps the inspected docId',
        )
        h.assert.equal(reopened.bundle.title, 'CLI review')
        h.assert.equal(reopened.bundle.root, SERIES_ROOT)
        const mounted = await cliPage.evaluate(() => ({
          validation: window.taco.validate(),
          files: window.taco.listFiles().map((file) => file.path),
          guide: window.taco.readFile('guide.md')?.content ?? null,
          embed: window.taco.readFile('pages/embed.html')?.content ?? null,
          pixel: window.taco.readFile('assets/pixel.png')?.content ?? null,
        }))
        h.assert.equal(
          mounted.validation.ok,
          true,
          `reopened document failed validation: ${JSON.stringify(mounted.validation.findings)}`,
        )
        h.assert.equal(mounted.validation.counts.error, 0)
        h.assert.deepEqual(
          mounted.files.sort(),
          expectedPaths,
          'the mounted file list must match the CLI manifest (root-relative)',
        )
        h.assert.equal(
          mounted.guide,
          guide,
          'the reopened Markdown must be byte-identical to the canonical file',
        )
        h.assert.equal(mounted.embed, embed, 'the reopened embedded HTML must be unchanged')
        h.assert.equal(
          mounted.pixel,
          FIXTURE.pngDataUrl,
          'the reopened PNG must keep the fixture bytes',
        )
        h.assert.ok(
          mounted.guide.includes(SCRIPT_TERMINATOR),
          'the literal container terminator must survive the round trip',
        )
        h.assert.ok(
          mounted.guide.includes(REPLACEMENT_CHARACTER),
          'the replacement character must survive',
        )
        h.assert.ok(
          mounted.guide.includes(LINE_SEPARATOR),
          'the U+2028 separator must survive escaping',
        )
        evidence.reopened = {
          validation: mounted.validation,
          files: mounted.files,
          guideMatchesCanonical: mounted.guide === guide,
          pngMatchesFixture: mounted.pixel === FIXTURE.pngDataUrl,
        }
        await flush()
      },
    )

    await h.step(`${scope}: the rendered Markdown, embedded HTML and PNG are visible`, async () => {
      await selectFile(cliPage, GUIDE_PATH)
      const editor = cliPage.locator('main#taco-main .tiptap-editor-host .ProseMirror').first()
      const headingLocator = editor.locator('h1').first()
      await headingLocator.waitFor({ state: 'visible', timeout: 15000 })
      const heading = await headingLocator.innerText()
      h.assert.equal(heading.trim(), GUIDE_HEADING, 'the Markdown heading must render exactly')
      const body = await editor.innerText()
      h.assert.ok(body.includes('中文标题'), 'the Unicode sample must render')
      h.assert.ok(body.includes('✓'), 'the Unicode punctuation must render')
      await h.capture('cli-pack-extract-markdown', cliPage)

      await selectFile(cliPage, EMBED_PATH)
      const embedded = await embeddedPreview(cliPage)
      h.assert.equal(
        embedded.heading,
        EMBED_HEADING,
        'the embedded document must render its exact heading',
      )
      h.assert.equal(
        embedded.marker,
        EMBED_MARKER,
        'the embedded inline script must run inside its sandbox',
      )
      await h.capture('cli-pack-extract-embedded-html', cliPage)

      await selectFile(cliPage, PIXEL_PATH)
      const image = cliPage.locator('img.media-document-preview.image-preview').first()
      await image.waitFor({ state: 'visible', timeout: 15000 })
      await cliPage.waitForFunction(
        () => {
          const node = document.querySelector('img.media-document-preview.image-preview')
          return Boolean(node && node.complete && node.naturalWidth > 0)
        },
        undefined,
        { timeout: 15000 },
      )
      const rendered = await image.evaluate((node) => ({
        width: node.naturalWidth,
        height: node.naturalHeight,
        prefix: node.src.slice(0, 22),
      }))
      h.assert.equal(rendered.width, 1, 'the fixture PNG must decode to its real 1px width')
      h.assert.equal(rendered.height, 1)
      h.assert.equal(rendered.prefix, PNG_PREFIX, 'the image preview must use the packed data URL')
      await h.capture('cli-pack-extract-png', cliPage)
      evidence.rendered = { heading, embedded, image: rendered }
      await flush()
    })

    await h.step(
      `${scope}: extract --dry-run plans the files without creating the directory`,
      async () => {
        const dryDir = join(scratch, 'extract-dry-run')
        const record = await runCli(h, scope, 'extract --dry-run', [
          'extract',
          packedPath,
          '--dry-run',
          '--out-dir',
          dryDir,
        ])
        const payload = parseStdout(h, record, 'extract --dry-run')
        h.assert.equal(payload.dryRun, true)
        h.assert.equal(payload.docId, inspected.docId)
        h.assert.equal(payload.totalFiles, expectedPaths.length)
        h.assert.ok(
          payload.extractedFiles.every((file) => file.written === false),
          'a dry run must report unwritten files',
        )
        h.assert.ok(
          payload.extractedFiles
            .map((file) => file.outputPath)
            .every((path) => typeof path === 'string'),
          'a dry run must report the planned targets',
        )
        h.assert.equal(
          await exists(dryDir),
          false,
          'extract --dry-run must not create the destination',
        )
        evidence.extractDryRun = {
          exitCode: record.exitCode,
          outDir: payload.outDir,
          extractedFiles: payload.extractedFiles,
        }
        await flush()
      },
    )

    await h.step(
      `${scope}: real extract reproduces the canonical bytes and skips exclusions`,
      async () => {
        const extractDir = join(scratch, 'extract-full')
        const record = await runCli(h, scope, 'extract', [
          'extract',
          packedPath,
          '--out-dir',
          extractDir,
        ])
        const payload = parseStdout(h, record, 'extract')
        h.assert.equal(payload.dryRun, false)
        h.assert.equal(payload.totalFiles, expectedPaths.length)
        h.assert.ok(payload.extractedFiles.every((file) => file.written === true))
        const snapshot = await snapshotDir(extractDir)
        h.assert.deepEqual(
          treePaths(snapshot),
          expectedPaths,
          'extraction must reproduce the packed tree only',
        )
        sameBytes(h, await readFile(join(extractDir, GUIDE_PATH)), guideBytes, 'extracted guide.md')
        sameBytes(
          h,
          await readFile(join(extractDir, ...EMBED_PATH.split('/'))),
          embedBytes,
          'extracted pages/embed.html',
        )
        sameBytes(
          h,
          await readFile(join(extractDir, ...PIXEL_PATH.split('/'))),
          png,
          'extracted assets/pixel.png',
        )
        for (const excluded of [IGNORED_PATH, HIDDEN_PATH, NESTED_HIDDEN_PATH, CONTAINER_PATH]) {
          h.assert.equal(
            await exists(join(extractDir, ...excluded.split('/'))),
            false,
            `${excluded} must not be extracted`,
          )
        }
        evidence.extract = { exitCode: record.exitCode, tree: snapshot }
        await flush()
      },
    )

    await h.step(
      `${scope}: --files extracts exactly the selected Markdown and PNG bytes`,
      async () => {
        const selectedDir = join(scratch, 'extract-selected')
        const record = await runCli(h, scope, 'extract --files', [
          'extract',
          packedPath,
          '--out-dir',
          selectedDir,
          '--files',
          `${GUIDE_PATH},${PIXEL_PATH}`,
        ])
        const payload = parseStdout(h, record, 'extract --files')
        h.assert.equal(payload.totalFiles, 2, 'the filter must select two files')
        h.assert.deepEqual(
          payload.extractedFiles.map((file) => file.path).sort(),
          [`${SERIES_ROOT}/${PIXEL_PATH}`, `${SERIES_ROOT}/${GUIDE_PATH}`].sort(),
        )
        const snapshot = await snapshotDir(selectedDir)
        h.assert.deepEqual(treePaths(snapshot), [PIXEL_PATH, GUIDE_PATH].sort())
        sameBytes(h, await readFile(join(selectedDir, GUIDE_PATH)), guideBytes, 'selected guide.md')
        sameBytes(
          h,
          await readFile(join(selectedDir, ...PIXEL_PATH.split('/'))),
          png,
          'selected assets/pixel.png',
        )
        evidence.extractSelected = { exitCode: record.exitCode, tree: snapshot }
        await flush()
      },
    )

    await h.step(
      `${scope}: packing onto the existing target is refused and leaves the bytes intact`,
      async () => {
        const before = sha256(await readFile(packedPath))
        const record = await runCli(
          h,
          scope,
          'pack onto an existing target',
          packArgs({
            dir: canonical,
            out: packedPath,
            title: 'CLI review',
            ignore: ['private/**'],
          }),
        )
        const code = expectErrorCode(h, record, 4, 'pack onto an existing target')
        h.assert.equal(code, 'CONFLICT_ERROR')
        h.assert.equal(
          await exists(packedPath),
          true,
          'the refused pack must leave the artifact in place',
        )
        h.assert.equal(
          sha256(await readFile(packedPath)),
          before,
          'a refused pack must not change the existing artifact',
        )
        evidence.packConflict = {
          exitCode: record.exitCode,
          error: parseStderr(record),
          sha256: before,
        }
        await flush()
      },
    )
  })
}

// ---------------------------------------------------------------------------
// case 2 — cli/review-diff-extract
// ---------------------------------------------------------------------------

const REVIEW_MARKER = 'CLI review round-trip marker 9c41'

const GUIDE_TWO = `# CLI review walkthrough

Baseline paragraph for the CLI review round trip.

The agent packs this file, the reviewer edits it in the browser, and the CLI diffs the result.
`

const NOTES_TWO = `# CLI review notes

Unchanged companion note that must not appear in the diff.
`

const reviewDiffExtractCase = async (h) => {
  const scope = CASE_REVIEW_DIFF_EXTRACT
  // Title 'CLI review round trip' must pack into CLI_review_round_trip.taco.html.
  const packedPath = resolve(h.outDir, 'CLI_review_round_trip.taco.html')
  const savedName = 'CLI_review_round_trip_saved.taco.html'
  const savedPath = resolve(h.outDir, savedName)
  const changedBundlePath = `${SERIES_ROOT}/${GUIDE_PATH}`
  const evidence = {}
  const flush = () => writeEvidence(h, 'cli-review-diff-extract-evidence.json', evidence)

  return withScratch(h, scope, [packedPath, savedPath], async (scratch) => {
    const canonical = join(scratch, 'canonical')
    const guideBytes = Buffer.from(GUIDE_TWO, 'utf8')
    const notesBytes = Buffer.from(NOTES_TWO, 'utf8')

    await h.step(`${scope}: pack a second clean canonical directory`, async () => {
      await writeCanonical(canonical, [
        [GUIDE_PATH, GUIDE_TWO],
        ['notes.md', NOTES_TWO],
      ])
      const record = await runCli(
        h,
        scope,
        'pack the second canonical directory',
        packArgs({ dir: canonical, out: packedPath, title: 'CLI review round trip' }),
      )
      const payload = parseStdout(h, record, 'pack')
      h.assert.equal(payload.outputPath, packedPath)
      h.assert.equal(await exists(packedPath), true)
      evidence.pack = {
        exitCode: record.exitCode,
        lines: payload.lines,
        sha256: sha256(await readFile(packedPath)),
      }
      await flush()
    })

    let sourceDocId
    const packedOpen = await h.reopen(packedPath)
    await h.step(`${scope}: the agent artifact passes the read-only health gate`, async () => {
      const state = await packedOpen.page.evaluate(() => ({
        validation: window.taco.validate(),
        files: window.taco.listFiles().map((file) => file.path),
      }))
      h.assert.equal(
        state.validation.ok,
        true,
        `packed artifact failed validation: ${JSON.stringify(state.validation.findings)}`,
      )
      h.assert.equal(state.validation.counts.error, 0)
      h.assert.deepEqual(state.files.sort(), [GUIDE_PATH, 'notes.md'].sort())
      sourceDocId = packedOpen.bundle.docId
      h.assert.ok(
        typeof sourceDocId === 'string' && sourceDocId.length > 0,
        'the packed artifact must carry a docId',
      )
      evidence.sourceDocId = sourceDocId
      await flush()
    })

    await h.step(
      `${scope}: the reviewer edits the visible Markdown through the real editor`,
      async () => {
        await selectFile(packedOpen.page, GUIDE_PATH)
        await typeAtEnd(packedOpen.page, REVIEW_MARKER)
        const edited = await packedOpen.page.evaluate(
          () => window.taco.readFile('guide.md')?.content ?? '',
        )
        h.assert.ok(
          edited.includes(REVIEW_MARKER),
          'the typed marker must reach the edited document',
        )
        await h.capture('cli-review-edited', packedOpen.page)
      },
    )

    await h.step(
      `${scope}: the saved download reopens with the marker and the same docId`,
      async () => {
        const saved = await saveDownload(h, savedName, { page: packedOpen.page })
        h.assert.equal(saved, savedPath)
        const reopened = await h.reopen(savedPath)
        const state = await reopened.page.evaluate(() => ({
          validation: window.taco.validate(),
          guide: window.taco.readFile('guide.md')?.content ?? '',
        }))
        h.assert.equal(
          state.validation.ok,
          true,
          `saved review failed validation: ${JSON.stringify(state.validation.findings)}`,
        )
        h.assert.equal(state.validation.counts.error, 0)
        h.assert.equal(
          reopened.bundle.docId,
          sourceDocId,
          'the saved review must preserve the source docId',
        )
        h.assert.ok(
          state.guide.includes(REVIEW_MARKER),
          'the saved bundle must keep the reviewed content',
        )
        await selectFile(reopened.page, GUIDE_PATH)
        const savedEditor = reopened.page
          .locator('main#taco-main .tiptap-editor-host .ProseMirror')
          .first()
        await savedEditor.waitFor({ state: 'visible', timeout: 15000 })
        const rendered = await savedEditor.innerText()
        h.assert.ok(
          rendered.includes(REVIEW_MARKER),
          'the marker must be visible in the independently reopened page',
        )
        await h.capture('cli-review-saved-reopened', reopened.page)
        evidence.savedReview = {
          docId: reopened.bundle.docId,
          validation: state.validation,
          renderedMarker: rendered.includes(REVIEW_MARKER),
        }
        await flush()
      },
    )

    const packedHashBefore = sha256(await readFile(packedPath))
    const canonicalGuideBefore = sha256(await readFile(join(canonical, GUIDE_PATH)))
    const canonicalNotesBefore = sha256(await readFile(join(canonical, 'notes.md')))

    let artifactDiff
    await h.step(
      `${scope}: diff packed vs downloaded reports exactly one modified path`,
      async () => {
        const record = await runCli(h, scope, 'diff packed vs saved review', [
          'diff',
          packedPath,
          savedPath,
        ])
        artifactDiff = parseStdout(h, record, 'diff packed vs saved review')
        h.assert.equal(artifactDiff.mode, 'taco-vs-taco')
        h.assert.equal(artifactDiff.trustedBaseline, true)
        h.assert.equal(artifactDiff.changedFiles.length, 1, 'only the edited file may change')
        const changed = artifactDiff.changedFiles[0]
        h.assert.equal(changed.path, changedBundlePath)
        h.assert.equal(changed.changeType, 'modified')
        h.assert.ok(
          changed.content.includes(REVIEW_MARKER),
          'the diff must carry the reviewed content',
        )
        h.assert.ok(
          changed.diff.includes(REVIEW_MARKER),
          'the unified diff must show the reviewed text',
        )
        h.assert.deepEqual(artifactDiff.summary, {
          additions: 0,
          modifications: 1,
          deletions: 0,
          totalChanges: 1,
          hasConflicts: false,
          hasIncremental: false,
        })
        evidence.diffArtifact = {
          exitCode: record.exitCode,
          mode: artifactDiff.mode,
          trustedBaseline: artifactDiff.trustedBaseline,
          changedFiles: artifactDiff.changedFiles.map((file) => ({
            path: file.path,
            changeType: file.changeType,
            oldSize: file.oldSize,
            newSize: file.newSize,
          })),
        }
        await flush()
      },
    )

    await h.step(
      `${scope}: diff saved review vs canonical reports the same path as unverified`,
      async () => {
        const record = await runCli(h, scope, 'diff saved review vs canonical directory', [
          'diff',
          savedPath,
          '--dir',
          canonical,
        ])
        const payload = parseStdout(h, record, 'diff saved review vs canonical directory')
        h.assert.equal(payload.mode, 'taco-vs-dir')
        h.assert.equal(
          payload.trustedBaseline,
          false,
          'a directory comparison has no trusted review baseline and must not be treated as authorized',
        )
        h.assert.ok(
          (payload.unverifiedWarnings ?? []).length > 0,
          'the untrusted baseline must be reported, not inferred from an empty conflict list',
        )
        h.assert.equal(payload.changedFiles.length, 1)
        h.assert.equal(payload.changedFiles[0].path, changedBundlePath)
        h.assert.equal(payload.changedFiles[0].changeType, 'modified')
        h.assert.equal(
          payload.changedFiles[0].content,
          artifactDiff.changedFiles[0].content,
          'both comparisons must describe the same reviewed content',
        )
        h.assert.ok(payload.changedFiles[0].content.includes(REVIEW_MARKER))
        evidence.diffDirectory = {
          exitCode: record.exitCode,
          mode: payload.mode,
          trustedBaseline: payload.trustedBaseline,
          changedPaths: payload.changedFiles.map((file) => file.path),
          unverifiedWarnings: payload.unverifiedWarnings ?? [],
        }
        await flush()
      },
    )

    await h.step(
      `${scope}: both diffs leave the artifact and the canonical files untouched`,
      async () => {
        h.assert.equal(
          sha256(await readFile(packedPath)),
          packedHashBefore,
          'diff must not rewrite the packed artifact',
        )
        h.assert.equal(
          sha256(await readFile(join(canonical, GUIDE_PATH))),
          canonicalGuideBefore,
          'diff must not rewrite the canonical Markdown',
        )
        h.assert.equal(
          sha256(await readFile(join(canonical, 'notes.md'))),
          canonicalNotesBefore,
          'diff must not rewrite the canonical notes',
        )
      },
    )

    let savedInspect
    await h.step(
      `${scope}: inspect the saved review keeps the docId and the manifest`,
      async () => {
        const record = await runCli(h, scope, 'inspect the saved review', ['inspect', savedPath])
        savedInspect = parseStdout(h, record, 'inspect the saved review')
        h.assert.equal(savedInspect.docId, sourceDocId)
        h.assert.equal(savedInspect.root, SERIES_ROOT)
        h.assert.equal(savedInspect.entry, changedBundlePath)
        const paths = savedInspect.files.details.map((file) => file.path).sort()
        h.assert.deepEqual(paths, [changedBundlePath, `${SERIES_ROOT}/notes.md`].sort())
        h.assert.deepEqual(
          savedInspect.diagnostics.filter((entry) => entry.severity === 'error'),
          [],
        )
        evidence.inspectSaved = {
          exitCode: record.exitCode,
          docId: savedInspect.docId,
          entry: savedInspect.entry,
          files: savedInspect.files.details,
        }
        await flush()
      },
    )

    await h.step(
      `${scope}: extracting the saved review writes exactly the reviewed bytes`,
      async () => {
        const reviewDir = join(scratch, 'extract-review')
        const record = await runCli(h, scope, 'extract the saved review', [
          'extract',
          savedPath,
          '--out-dir',
          reviewDir,
        ])
        const payload = parseStdout(h, record, 'extract the saved review')
        h.assert.equal(payload.docId, sourceDocId)
        h.assert.equal(payload.totalFiles, 2)
        const snapshot = await snapshotDir(reviewDir)
        h.assert.deepEqual(treePaths(snapshot), [GUIDE_PATH, 'notes.md'])
        const reviewed = await readFile(join(reviewDir, GUIDE_PATH))
        sameBytes(
          h,
          reviewed,
          Buffer.from(artifactDiff.changedFiles[0].content, 'utf8'),
          'extracted reviewed guide.md',
        )
        h.assert.ok(reviewed.toString('utf8').includes(REVIEW_MARKER))
        sameBytes(h, await readFile(join(reviewDir, 'notes.md')), notesBytes, 'extracted notes.md')
        h.assert.ok(
          !guideBytes.equals(reviewed),
          'the extracted review must differ from the untouched baseline',
        )
        evidence.extractSaved = {
          exitCode: record.exitCode,
          tree: snapshot,
          reviewedBytes: reviewed.length,
        }
        await flush()
      },
    )

    await h.step(
      `${scope}: extracting onto the canonical directory is refused with exit 4`,
      async () => {
        const record = await runCli(h, scope, 'extract onto the canonical directory', [
          'extract',
          savedPath,
          '--out-dir',
          canonical,
        ])
        const code = expectErrorCode(h, record, 4, 'extract onto the canonical directory')
        h.assert.equal(code, 'CONFLICT_ERROR')
        h.assert.equal(
          sha256(await readFile(join(canonical, GUIDE_PATH))),
          canonicalGuideBefore,
          'a refused extraction must not touch the canonical Markdown',
        )
        h.assert.equal(
          sha256(await readFile(join(canonical, 'notes.md'))),
          canonicalNotesBefore,
          'a refused extraction must not touch the canonical notes',
        )
        evidence.extractConflict = { exitCode: record.exitCode, error: parseStderr(record) }
        await flush()
      },
    )

    await h.step(
      `${scope}: an unknown --files filter is refused with exit 2 and writes nothing`,
      async () => {
        const unknownDir = join(scratch, 'extract-unknown')
        const record = await runCli(h, scope, 'extract with an unknown --files filter', [
          'extract',
          savedPath,
          '--out-dir',
          unknownDir,
          '--files',
          'missing.md',
        ])
        const code = expectErrorCode(h, record, 2, 'extract with an unknown --files filter')
        h.assert.equal(code, 'VALIDATION_ERROR')
        h.assert.equal(
          await exists(unknownDir),
          false,
          'a refused extraction must not create the destination',
        )
        evidence.extractUnknown = { exitCode: record.exitCode, error: parseStderr(record) }
        await flush()
      },
    )
  })
}

// ---------------------------------------------------------------------------
// scenario exports
// ---------------------------------------------------------------------------

/** Case metadata for documentation; `run(h)` drives the owned harness directly. */
export const cases = [
  { id: CASE_PACK_EXTRACT, run: (h) => packExtractCase(h) },
  { id: CASE_REVIEW_DIFF_EXTRACT, run: (h) => reviewDiffExtractCase(h) },
]

/**
 * Default scenario export: both cases run in sequence on the one owned harness, each with its
 * own scratch workspace and independent reopened pages. The browser suite does not register
 * this module because CI builds the CLI after the browser suite; the parent documents the
 * separate command.
 */
export default async function runCliScenarios(h) {
  for (const entry of cases) {
    await h.step(entry.id, () => entry.run(h))
  }
}
