#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { chromium } from 'playwright'

const root = resolve(process.cwd())
const cli = process.argv.slice(2).length ? process.argv.slice(2) : [process.execPath, resolve(root, 'packages/cli/dist/main.js')]
const scratch = await mkdtemp(join(tmpdir(), 'taco-toolbox-smoke-'))
const source = join(scratch, 'source')
const artifact = join(scratch, 'Review.taco.html')
await mkdir(source)
const initial = '---\ntitle: Review\n---\n\n## Review\n\nOriginal paragraph.\n\nLiteral `</script>` $& $` $\' $1 and 中文.\n'
await writeFile(join(source, 'review.md'), initial)

const run = (args, expected = 0) => new Promise((resolveRun, reject) => {
  const child = spawn(cli[0], [...cli.slice(1), ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('close', (code) => {
    try {
      assert.equal(code, expected, `${args.join(' ')}: ${stderr || stdout}`)
      resolveRun({ stdout, stderr, json: stdout.trim() ? JSON.parse(stdout) : null })
    } catch (error) { reject(error) }
  })
})
const parseBundle = (html) => JSON.parse(html.match(/<script\b[^>]*\bid=["']taco-document["'][^>]*>([\s\S]*?)<\/script>/i)[1])
const replaceBundle = (html, bundle) => html.replace(/(<script\b[^>]*\bid=["']taco-document["'][^>]*>)[\s\S]*?(<\/script>)/i,
  (_match, opener, closer) => `${opener}${JSON.stringify(bundle).replace(/</g, '\\u003c')}${closer}`)

await run(['new', join(scratch, 'Empty.taco.html'), '--title', 'Empty'])
assert.deepEqual(parseBundle(await readFile(join(scratch, 'Empty.taco.html'), 'utf8')).files, [])
for (const template of ['spec', 'architecture', 'api-reference', 'adr']) {
  const target = join(scratch, template)
  await run(['init', target, '--template', template])
  const initialized = join(target, `${template}.taco.html`)
  await run(['verify', initialized])
  const initBundle = parseBundle(await readFile(initialized, 'utf8'))
  assert.equal(initBundle.checkpoints, undefined, 'init does not impose example Checkpoints')
  assert(initBundle.files[0].content.startsWith('---\n'), 'init creates real YAML frontmatter')
  assert(!/^# /m.test(initBundle.files[0].content), 'init starts body below H1')
  await run(['init', target, '--template', template], 4)
}
await run(['pack', source, '--title', 'Review', '--out', artifact])
const html = await readFile(artifact, 'utf8')
const bundled = parseBundle(html)
bundled.navigation = { version: 1, entry: 'review.md', groups: [] }
bundled.reviewMetadata = { owner: 'local-smoke', preserve: true }
bundled.files[0].reviewMetadata = { preserve: 'file metadata' }
bundled.files[0].id = 'review-file'
bundled.checkpoints = {
  version: 1,
  nodes: [{ id: 'review', title: 'Review', after: [], documents: [{ path: `${bundled.root}/review.md` }] }],
  documents: [],
}
await writeFile(artifact, replaceBundle(html, bundled))
await run(['verify', artifact])
await run(['inspect', artifact, '--credentials'])
const extracted = join(scratch, 'extracted')
await run(['extract', artifact, '--out-dir', extracted])
assert.equal(await readFile(join(extracted, 'review.md'), 'utf8'), initial)
const beforeDiff = await readFile(join(source, 'review.md'))
await run(['diff', artifact, '--dir', source])
assert.deepEqual(await readFile(join(source, 'review.md')), beforeDiff)

assert.equal(bundled.files[0].content, initial)
await run(['new', join(scratch, 'Empty.taco.html'), '--title', 'Empty'], 4)
assert.deepEqual(parseBundle(await readFile(join(scratch, 'Empty.taco.html'), 'utf8')).files, [])
const listener = () => {
  const child = spawn(cli[0], [...cli.slice(1), 'listen', artifact, '--no-open', '--timeout', '45'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let buffer = ''
  let errors = ''
  let readyResolve
  let readyReject
  const ready = new Promise((resolveReady, rejectReady) => { readyResolve = resolveReady; readyReject = rejectReady })
  const events = []
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n')
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        events.push(event)
        if (event.type === 'ready') readyResolve(event)
      } catch (error) { readyReject(error) }
    }
  })
  child.stderr.on('data', (chunk) => { errors += chunk })
  const done = new Promise((resolveDone, rejectDone) => {
    child.on('error', (error) => { readyReject(error); rejectDone(error) })
    child.on('close', (code) => {
      if (!events.some((event) => event.type === 'ready')) readyReject(new Error(errors || 'listener closed before ready'))
      try {
        assert.equal(code, 0, errors || JSON.stringify(events))
        resolveDone(events)
      } catch (error) { rejectDone(error) }
    })
  })
  void done.catch(() => {})
  return { child, ready, done }
}

const preview = createServer(async (_request, response) => {
  try {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(await readFile(artifact))
  } catch {
    response.writeHead(500)
    response.end('Artifact unavailable')
  }
})
await new Promise((resolvePreview) => preview.listen(0, '127.0.0.1', resolvePreview))
const previewOrigin = `http://127.0.0.1:${preview.address().port}`
const browser = await chromium.launch({ headless: true })
const active = new Set()
let roundOneContent
let roundOneReceiptPath
let roundOneThreadId
try {
  for (let round = 1; round <= 2; round += 1) {
    const waiting = listener()
    active.add(waiting.child)
    const ready = await waiting.ready
    assert.equal(ready.docId, bundled.docId)
    const endpoint = `http://127.0.0.1:${ready.port}/handoff`
    const rejected = await fetch(endpoint, { method: 'POST', headers: {
      'Authorization': 'Bearer invalid-token', 'X-Taco-Doc-Id': ready.docId,
      'X-Taco-Session-Id': ready.sessionId, 'Content-Type': 'application/json', 'Origin': 'null',
    }, body: '{}' })
    assert.equal(rejected.status, 401, 'listener refuses unauthenticated delivery and remains available')
    const page = await browser.newPage({ acceptDownloads: true })
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(`${previewOrigin}/Review.taco.html${new URL(ready.url).hash}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.taco && document.querySelector('.ProseMirror'))
    assert.equal(await page.locator('nav.file-sidebar button.file-row.is-selected').getAttribute('data-path'), `${bundled.root}/review.md`)
    const reviewed = `Round ${round} reviewed paragraph.`
    await page.locator('.ProseMirror').first().click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type(reviewed)
    await page.keyboard.press('ControlOrMeta+Shift+ArrowLeft')
    await page.locator('.selection-comment-button').click()
    await page.locator('.comment-composer textarea.comment-input').fill(`Please retain round ${round} feedback.`)
    await page.locator('.comment-composer button.comment-submit').click()
    const authorInput = page.locator('.author-name-dialog input.author-name-input')
    if (await authorInput.isVisible()) {
      await authorInput.fill('Reviewer')
      await page.locator('.author-name-dialog .control-button-primary').click()
    }
    const threadId = await page.locator('article.comment-thread').last().getAttribute('data-thread-id')
    await page.locator('.checkpoint-status-button').first().click()
    await page.locator('.checkpoint-status-option').nth(round === 1 ? 1 : 2).click()
    if (round === 2) {
      await page.evaluate(() => { window.showSaveFilePicker = undefined })
      const download = page.waitForEvent('download')
      await page.locator('.save-button').click()
      await page.locator('dialog.confirmation-dialog[open] .control-button-primary').click()
      const saved = await download
      await saved.saveAs(join(scratch, `saved-round-${round}.taco.html`))
    }
    if (round === 1) {
      const attempted = []
      await page.route(endpoint, async (route) => {
        attempted.push(JSON.parse(route.request().postData()))
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"Smoke delivery unavailable"}' })
      })
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await page.locator('button.copy-review-main').click()
        await page.waitForFunction(() => document.querySelector('button.copy-review-main')?.disabled === false)
      }
      assert.equal(attempted.length, 2)
      assert.deepEqual(attempted[0], attempted[1], 'retry preserves the entire pending Handoff including timestamp')
      assert((await page.locator('.ProseMirror').first().innerText()).includes(reviewed), 'failed delivery preserves editor content')
      await page.unroute(endpoint)
    }
    await page.locator('button.copy-review-main').click()
    const events = await waiting.done
    active.delete(waiting.child)
    const delivered = events.find((event) => event.type !== 'ready')
    assert(delivered, 'explicit Handoff emits a delivery event')
    const receiptPath = delivered.path ?? delivered.receipt?.path
    assert.equal(typeof receiptPath, 'string', 'delivery provides a durable receipt path')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    assert.equal(receipt.docId, bundled.docId)
    const snapshot = receipt.payload.snapshot
    const receivedFile = snapshot.files.find((file) => file.path === `${bundled.root}/review.md`)
    assert(receivedFile.content.includes(reviewed), 'receipt contains actual unsaved editor content')
    assert(snapshot.comments.some((thread) => thread.id === threadId), 'receipt contains current comment')
    assert.equal(snapshot.checkpoints.documents.find((record) => record.path === `${bundled.root}/review.md`).status,
      round === 1 ? 'in_progress' : 'complete', 'Handoff contains actual unsaved Checkpoint status')
    assert.equal(receipt.payload.baseline.docId, bundled.docId)
    const baselineFile = receipt.payload.baseline.files.find((file) => file.path === `${bundled.root}/review.md`)
    assert.equal(baselineFile.content, round === 1 ? initial : roundOneContent, 'Save does not advance review-start baseline')
    const beforeRefresh = await readFile(artifact, 'utf8')
    await run(['refresh', artifact, '--dir', source, '--handoff', receiptPath], 4)
    assert.equal(await readFile(artifact, 'utf8'), beforeRefresh, 'pending review edits refuse refresh without replacing artifact')
    assert.deepEqual(pageErrors, [])
    await writeFile(join(source, 'review.md'), receivedFile.content)
    await run(['refresh', artifact, '--dir', source, '--handoff', receiptPath])
    const refreshed = parseBundle(await readFile(artifact, 'utf8'))
    assert.equal(refreshed.docId, bundled.docId)
    assert(refreshed.comments.some((thread) => thread.id === (round === 1 ? threadId : roundOneThreadId)), 'next round retains earlier comments')
    assert(refreshed.comments.some((thread) => thread.id === threadId), 'refresh retains received feedback')
    assert.equal(refreshed.files.find((file) => file.path === `${bundled.root}/review.md`).content, receivedFile.content)
    assert.deepEqual(refreshed.navigation, bundled.navigation)
    assert.deepEqual(refreshed.reviewMetadata, bundled.reviewMetadata)
    assert.deepEqual(refreshed.checkpoints, snapshot.checkpoints)
    assert.deepEqual(refreshed.files[0].reviewMetadata, bundled.files[0].reviewMetadata)
    assert.equal(refreshed.files[0].id, bundled.files[0].id)
    assert.equal(refreshed.checkpoints.nodes[0].id, 'review')
    if (round === 1) {
      roundOneContent = receivedFile.content
      roundOneThreadId = threadId
      roundOneReceiptPath = receiptPath
    } else {
      const afterRefresh = await readFile(artifact, 'utf8')
      await run(['refresh', artifact, '--dir', source, '--handoff', roundOneReceiptPath], 4)
      assert.equal(await readFile(artifact, 'utf8'), afterRefresh, 'stale first-round feedback refuses after second refresh')
    }
    await page.screenshot({ path: join(scratch, `round-${round}.png`), fullPage: true })
    await page.close()
  }
  console.log(JSON.stringify({ ok: true, rounds: 2, artifact, scratch, cli }))
} finally {
  for (const child of active) child.kill('SIGTERM')
  await browser.close()
  await new Promise((resolvePreview) => preview.close(resolvePreview))
}
