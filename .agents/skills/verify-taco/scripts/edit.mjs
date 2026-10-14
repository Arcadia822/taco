// SPDX-License-Identifier: MIT
// TACO-81 edit/manage domain cases: Markdown, frontmatter properties, structured
// and text source editors, Mermaid, images and the new/rename/delete file paths.
//
// Mutations are user actions only. Every mutating case ends with the documented
// download fallback plus an independent reopen of the saved artifact, then asserts
// on both the parsed bundle and the rendered UI.
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { saveDownload, selectFile, typeAtEnd } from './ui.mjs'

export const feature = 'edit-files'

const fixturePath = (h, key) => {
  const value = h.fixture?.dataPaths?.[key] ?? h.fixture?.paths?.[key]
  if (typeof value !== 'string' || !value)
    throw new Error(`Fixture path "${key}" is missing from the manifest`)
  return fullPath(h, value)
}

const fullPath = (h, value) => {
  const trimmed = String(value).replace(/^\//, '')
  return trimmed.startsWith(`${h.bundle.root}/`) ? trimmed : `${h.bundle.root}/${trimmed}`
}

const apiPath = (h, path) =>
  path.startsWith(`${h.bundle.root}/`) ? path.slice(h.bundle.root.length + 1) : path

const fileOf = (h, path) => {
  const file = h.bundle.files.find((entry) => entry.path === path)
  if (!file) throw new Error(`Fixture has no file at ${path}`)
  return file
}

const readFile = (page, h, path) =>
  page.evaluate((target) => window.taco.readFile(target), apiPath(h, path))

const listPaths = (page) => page.evaluate(() => window.taco.listFiles().map((entry) => entry.path))

const selectedPath = (page) =>
  page.locator('nav.file-sidebar button.file-row.is-selected[data-path]').getAttribute('data-path')

const editorBody = (page) => page.locator('main#taco-main .tiptap-editor-host .ProseMirror')

const sourceInput = (page) => page.locator('main#taco-main textarea.source-editor-input')

const stateFile = (h, name, value) =>
  writeFile(resolve(h.outDir, name), JSON.stringify(value, null, 2))

/**
 * Persistence proof: save through the product entry point, reopen the downloaded
 * artifact, assert the saved bundle content, then select the path in the reopened
 * UI so the caller can assert on rendered state.
 */
const roundTrip = async (h, { name, path, contains }) => {
  const saved = await saveDownload(h, name)
  const reopened = await h.reopen(saved)
  const savedFile = reopened.bundle.files.find((entry) => entry.path === path)
  h.assert(savedFile, `${path} must survive the saved artifact`)
  for (const text of contains ?? []) {
    h.assert(
      savedFile.content.includes(text),
      `Saved bundle content must keep ${JSON.stringify(text)}`,
    )
  }
  await selectFile(reopened.page, path)
  return { saved, reopened, savedFile }
}

/** Open a file's row Actions menu through hover plus a real click. */
const fileMenu = async (page, path, label) => {
  const row = page.locator(`nav.file-sidebar button.file-row[data-path="${path}"]`)
  await row.hover()
  await row.getByRole('button', { name: 'Actions', exact: true }).click()
  const popover = page.locator('.navigation-popover')
  await popover.waitFor({ state: 'visible' })
  return popover.getByRole('button', { name: label, exact: true })
}

const confirmDialog = (page) => page.locator('dialog.confirmation-dialog')

const promptDialog = (page) => page.locator('dialog.prompt-dialog')

export const cases = [
  {
    id: 'edit/markdown',
    feature,
    entry: 'Rich Markdown document body',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'guide')
      const before = (await readFile(page, h, target)).content
      const marker = 'TACO-81 rich editor marker: appended paragraph stays after save.'
      h.assert(!before.includes(marker), 'The marker must be new in this run')
      await selectFile(page, target)
      await h.capture('edit-markdown-before')
      await h.step('edit/markdown: append a paragraph through the rich editor', async () => {
        await typeAtEnd(page, marker)
        await page.waitForFunction(
          ({ path, text }) =>
            window.taco
              .getReviewHandoff()
              .changedFiles.some(
                (entry) =>
                  (entry.path === path || entry.path.endsWith(path.split('/').pop())) &&
                  entry.content?.includes(text),
              ),
          { path: apiPath(h, target), text: marker },
        )
        h.assert(
          (await editorBody(page).innerText()).includes(marker),
          'The reader must show the typed paragraph',
        )
      })
      await h.capture('edit-markdown-after')
      const { reopened } = await h.step('edit/markdown: save and reopen the artifact', () =>
        roundTrip(h, { name: 'edit-markdown.taco.html', path: target, contains: [marker] }),
      )
      h.assert(
        (await editorBody(reopened.page).innerText()).includes(marker),
        'The reopened document must render the typed paragraph',
      )
      await h.capture('edit-markdown-reopened', reopened.page)
      await stateFile(h, 'edit-markdown-state.json', {
        feature,
        entryPoint: 'edit/markdown',
        path: target,
        marker,
        persistedInBundle: true,
        visibleAfterReopen: true,
      })
    },
  },
  {
    id: 'edit/properties:title',
    feature,
    entry: 'Document title field',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'properties')
      const file = fileOf(h, target)
      const nextTitle = 'Verify properties (edited title)'
      h.assert(!file.content.includes(nextTitle), 'The title must be new in this run')
      await selectFile(page, target)
      await h.capture('edit-title-before')
      const observed = await h.step(
        'edit/properties:title: edit the title without renaming the file',
        async () => {
          const titleField = page.getByRole('textbox', {
            name: 'File title; does not rename the file or change its path',
            exact: true,
          })
          await titleField.waitFor({ state: 'visible' })
          await titleField.fill(nextTitle)
          await page.keyboard.press('Tab')
          await page.waitForFunction(
            (value) => window.taco.readFile('notes/properties.md').content.includes(value),
            nextTitle,
          )
          h.assert.equal(
            await selectedPath(page),
            target,
            'Editing the title must not move the selection',
          )
          h.assert(
            (await listPaths(page)).includes(apiPath(h, target)),
            'Editing the title must not rename the file',
          )
          const property = page.getByRole('textbox', { name: 'title value', exact: true })
          h.assert.equal(
            await property.inputValue(),
            nextTitle,
            'The properties panel must show the canonical frontmatter title',
          )
          h.assert.equal(
            await titleField.textContent(),
            nextTitle,
            'The inline title shows the edited value',
          )
          return { title: nextTitle }
        },
      )
      await h.capture('edit-title-after')
      const { reopened } = await h.step('edit/properties:title: save and reopen the artifact', () =>
        roundTrip(h, { name: 'edit-title.taco.html', path: target, contains: [nextTitle] }),
      )
      h.assert.equal(
        await reopened.page.getByRole('textbox', { name: 'title value', exact: true }).inputValue(),
        nextTitle,
        'The reopened properties panel must show the persisted title',
      )
      await h.capture('edit-title-reopened', reopened.page)
      await stateFile(h, 'edit-title-state.json', {
        feature,
        entryPoint: 'edit/properties-title',
        path: target,
        ...observed,
      })
    },
  },
  {
    id: 'edit/properties:add-and-rejected-edit',
    feature,
    entry: 'Add property and rejected duplicate key',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'properties')
      await selectFile(page, target)
      await h.capture('edit-properties-before')
      const observed = await h.step('edit/properties:add: add a frontmatter property', async () => {
        const panel = page.locator('.document-properties')
        await panel.waitFor({ state: 'visible' })
        await page.locator('.document-properties-add').click()
        const keyInputs = page.locator('.document-property-key')
        const added = keyInputs.nth((await keyInputs.count()) - 1)
        await page.waitForFunction(() =>
          window.taco.readFile('notes/properties.md').content.includes('property:'),
        )
        await added.fill('verified_by')
        await added.press('Tab')
        const value = page.getByRole('textbox', { name: 'verified_by value', exact: true })
        await value.waitFor({ state: 'visible' })
        await value.fill('TACO-81')
        await value.press('Tab')
        await page.waitForFunction(
          (text) => window.taco.readFile('notes/properties.md').content.includes(text),
          'verified_by: "TACO-81"',
        )
        return { addedKey: 'verified_by', value: 'TACO-81' }
      })
      const rejected = await h.step(
        'edit/properties:invalid: rename onto an existing key is rejected, not discarded',
        async () => {
          const contentBefore = (await readFile(page, h, target)).content
          const keyInputs = page.locator('.document-property-key')
          const key = keyInputs.nth((await keyInputs.count()) - 1)
          await key.fill('owner')
          await key.press('Tab')
          await page.waitForFunction(
            () => !!document.querySelector('.document-properties')?.dataset.propertyError,
          )
          const error = await page
            .locator('.document-properties')
            .getAttribute('data-property-error')
          h.assert(
            /already exists/.test(error ?? ''),
            `The duplicate key must be reported: ${error}`,
          )
          h.assert.equal(
            (await readFile(page, h, target)).content,
            contentBefore,
            'A rejected edit must not change the file content',
          )
          return { propertyError: error }
        },
      )
      await h.capture('edit-properties-after')
      const { reopened } = await h.step('edit/properties:add: save and reopen the artifact', () =>
        roundTrip(h, {
          name: 'edit-properties.taco.html',
          path: target,
          contains: ['verified_by: "TACO-81"'],
        }),
      )
      const keys = await reopened.page
        .locator('.document-property-key')
        .evaluateAll((nodes) => nodes.map((node) => node.value))
      h.assert(
        keys.includes('verified_by'),
        'The reopened properties panel must list the added property',
      )
      await h.capture('edit-properties-reopened', reopened.page)
      await stateFile(h, 'edit-properties-state.json', {
        feature,
        entryPoint: 'edit/properties',
        path: target,
        ...observed,
        ...rejected,
        persistedInBundle: true,
      })
    },
  },
  {
    id: 'edit/source:json',
    feature,
    entry: 'JSON source editor',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'json')
      await selectFile(page, target)
      await h.capture('edit-json-before')
      const edited = await h.step(
        'edit/source:json: rewrite the JSON source through the editor',
        async () => {
          const viewer = page.locator('main#taco-main .structured-file-viewer')
          await viewer.waitFor({ state: 'visible' })
          h.assert(
            await viewer.evaluate((node) => node.className.includes('structured-file-json')),
            'JSON files use the structured viewer',
          )
          const input = sourceInput(page)
          await input.waitFor({ state: 'visible' })
          h.assert.equal(await input.getAttribute('aria-label'), 'JSON source editor')
          const original = await input.inputValue()
          const parsed = JSON.parse(original)
          parsed.version = (Number(parsed.version) || 0) + 1
          const next = `${JSON.stringify(parsed, null, 2)}\n`
          await input.fill(next)
          await page.waitForFunction(
            (text) => window.taco.readFile('data/sample.json').content === text,
            next,
          )
          h.assert.equal(
            (await readFile(page, h, target)).content,
            next,
            'The canonical file must hold the edited JSON exactly',
          )
          await selectFile(page, fixturePath(h, 'intro'))
          await selectFile(page, target)
          h.assert.equal(
            await sourceInput(page).inputValue(),
            next,
            'Leaving and returning must keep the edited source',
          )
          return { changed: 'version', value: parsed.version }
        },
      )
      await h.capture('edit-json-after')
      const { reopened } = await h.step('edit/source:json: save and reopen the artifact', () =>
        roundTrip(h, { name: 'edit-json.taco.html', path: target }),
      )
      h.assert.equal(
        await sourceInput(reopened.page).inputValue(),
        (await readFile(page, h, target)).content,
        'The reopened editor must show the persisted JSON',
      )
      await h.capture('edit-json-reopened', reopened.page)
      await stateFile(h, 'edit-json-state.json', {
        feature,
        entryPoint: 'edit/source-json',
        path: target,
        ...edited,
        persistedInBundle: true,
      })
    },
  },
  {
    id: 'edit/source:yaml',
    feature,
    entry: 'YAML source editor with parse feedback',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'yaml')
      await selectFile(page, target)
      await h.capture('edit-yaml-before')
      const observed = await h.step(
        'edit/source:yaml: invalid YAML is reported and preserved',
        async () => {
          const input = sourceInput(page)
          await input.waitFor({ state: 'visible' })
          h.assert.equal(await input.getAttribute('aria-label'), 'YAML source editor')
          const broken = 'service: taco-verify\nreplicas: [unclosed\n'
          await input.fill(broken)
          const diagnostics = page.locator('.structured-file-diagnostics')
          await diagnostics.waitFor({ state: 'visible' })
          const message = (await diagnostics.innerText()).trim()
          h.assert(message.length > 0, 'A parse error must be reported')
          h.assert.equal(
            (await readFile(page, h, target)).content,
            broken,
            'The invalid source stays in the canonical file instead of being discarded',
          )
          return { invalidMessage: message.slice(0, 120) }
        },
      )
      const edited = await h.step('edit/source:yaml: repair and change a value', async () => {
        const input = sourceInput(page)
        const original = fileOf(h, target).content
        const next = original.replace('version: 1', 'version: 2')
        h.assert.notEqual(next, original, 'The fixture YAML must carry a version line')
        await input.fill(next)
        await page.waitForFunction(
          (text) => window.taco.readFile('data/config.yaml').content === text,
          next,
        )
        h.assert.equal(
          (await page.locator('.structured-file-diagnostics').innerText()).trim(),
          '',
          'A valid document clears the diagnostics',
        )
        return { changed: 'version', value: 2 }
      })
      await h.capture('edit-yaml-after')
      const { reopened } = await h.step('edit/source:yaml: save and reopen the artifact', () =>
        roundTrip(h, { name: 'edit-yaml.taco.html', path: target, contains: ['version: 2'] }),
      )
      h.assert(
        (await sourceInput(reopened.page).inputValue()).includes('version: 2'),
        'The reopened YAML editor shows the persisted source',
      )
      await h.capture('edit-yaml-reopened', reopened.page)
      await stateFile(h, 'edit-yaml-state.json', {
        feature,
        entryPoint: 'edit/source-yaml',
        path: target,
        ...observed,
        ...edited,
        persistedInBundle: true,
      })
    },
  },
  {
    id: 'edit/source:text',
    feature,
    entry: 'Plain text source editor',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'text')
      const file = fileOf(h, target)
      const addition = 'TACO-81 appended text line.'
      await selectFile(page, target)
      await h.capture('edit-text-before')
      await h.step('edit/source:text: append a line through the text editor', async () => {
        const input = sourceInput(page)
        await input.waitFor({ state: 'visible' })
        h.assert.equal(
          await input.inputValue(),
          file.content,
          'The text editor starts from the canonical content',
        )
        await input.fill(`${file.content}${addition}\n`)
        await page.waitForFunction(
          (text) => window.taco.readFile('notes/plain.txt').content.includes(text),
          addition,
        )
        h.assert.equal((await readFile(page, h, target)).content, `${file.content}${addition}\n`)
      })
      await h.capture('edit-text-after')
      const { reopened } = await h.step('edit/source:text: save and reopen the artifact', () =>
        roundTrip(h, { name: 'edit-text.taco.html', path: target, contains: [addition] }),
      )
      h.assert(
        (await sourceInput(reopened.page).inputValue()).includes(addition),
        'The reopened text editor shows the persisted content',
      )
      await h.capture('edit-text-reopened', reopened.page)
      await stateFile(h, 'edit-text-state.json', {
        feature,
        entryPoint: 'edit/source-text',
        path: target,
        addition,
        persistedInBundle: true,
      })
    },
  },
  {
    id: 'edit/source:openapi-toggle',
    feature,
    entry: 'OpenAPI overview and canonical source',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'openapi')
      const file = fileOf(h, target)
      const nextTitle = 'Verify fixture API (edited)'
      h.assert(!file.content.includes(nextTitle), 'The edited title must be new in this run')
      await selectFile(page, target)
      await h.capture('edit-openapi-before')
      const observed = await h.step(
        'edit/source:openapi: edit the canonical source behind the derived overview',
        async () => {
          const overview = page.locator('main#taco-main .openapi-overview')
          const overviewTab = page.locator(
            '.structured-file-toolbar .segmented-control-option[data-segmented-value="overview"]',
          )
          const sourceTab = page.locator(
            '.structured-file-toolbar .segmented-control-option[data-segmented-value="source"]',
          )
          await overview.waitFor({ state: 'visible' })
          h.assert.equal(
            await overviewTab.getAttribute('aria-selected'),
            'true',
            'A parsed OpenAPI file opens as the derived overview',
          )
          h.assert(
            (await overview.innerText()).includes('Verify fixture API'),
            'The overview renders the documented API',
          )
          await sourceTab.click()
          const input = sourceInput(page)
          await input.waitFor({ state: 'visible' })
          const edited = file.content.replace('title: Verify fixture API', `title: ${nextTitle}`)
          h.assert.notEqual(edited, file.content, 'The fixture OpenAPI must carry the info title')
          await input.fill(edited)
          await page.waitForFunction(
            (text) => window.taco.readFile('api/openapi.yaml').content.includes(text),
            nextTitle,
          )
          h.assert(
            (await readFile(page, h, target)).content.includes('openapi: 3.0.3'),
            'The canonical source keeps its OpenAPI structure',
          )
          await overviewTab.click()
          await overview.waitFor({ state: 'visible' })
          h.assert(
            (await overview.innerText()).includes(nextTitle),
            'The derived overview must re-render from the edited canonical source',
          )
          return { editedTitle: nextTitle, canonical: true, derived: true }
        },
      )
      await h.capture('edit-openapi-after')
      const { reopened } = await h.step('edit/source:openapi: save and reopen the artifact', () =>
        roundTrip(h, { name: 'edit-openapi.taco.html', path: target, contains: [nextTitle] }),
      )
      h.assert(
        (await reopened.page.locator('main#taco-main .openapi-overview').innerText()).includes(
          nextTitle,
        ),
        'The reopened derived overview reflects the persisted canonical source',
      )
      await h.capture('edit-openapi-reopened', reopened.page)
      await stateFile(h, 'edit-openapi-state.json', {
        feature,
        entryPoint: 'edit/source-openapi',
        path: target,
        ...observed,
        persistedInBundle: true,
      })
    },
  },
  {
    id: 'edit/source:mermaid',
    feature,
    entry: 'Mermaid source panel and rendered preview',
    evidence: 'user-path',
    async run(h) {
      const { page, context } = h
      const cdnRequests = []
      const onRequest = (request) => {
        if (/cdn\.jsdelivr\.net|esm\.sh/.test(request.url())) cdnRequests.push(request.url())
      }
      context.on('request', onRequest)
      const releaseListener = () => context.off('request', onRequest)
      const target = fixturePath(h, 'mermaid')
      const file = fileOf(h, target)
      const node = file.content.match(/\[([A-Za-z0-9 _-]+)\]/)
      h.assert(node, 'The fixture diagram needs a labelled node')
      const renamed = `${node[1]} verified`
      await selectFile(page, target)
      await h.capture('edit-mermaid-before')
      const observed = await h.step(
        'edit/source:mermaid: change the diagram through its source panel',
        async () => {
          const diagram = page
            .locator('.standalone-mermaid-preview svg[aria-roledescription]')
            .first()
          await diagram.waitFor({ state: 'visible', timeout: 30000 })
          // The Complete shell renders from its embedded payload; a CDN request at
          // any point would mean the offline render path leaked.
          h.assert.deepEqual(
            cdnRequests,
            [],
            'The preview must render without any Mermaid CDN request',
          )
          const toggle = page.locator('.standalone-mermaid-source')
          h.assert.equal(
            await toggle.getAttribute('aria-pressed'),
            'false',
            'The code panel starts closed',
          )
          await toggle.click()
          h.assert.equal(
            await toggle.getAttribute('aria-pressed'),
            'true',
            'The code panel toggle reports its state',
          )
          const input = sourceInput(page)
          await input.waitFor({ state: 'visible' })
          const next = (await input.inputValue()).replace(`[${node[1]}]`, `[${renamed}]`)
          h.assert.notEqual(
            next,
            await input.inputValue(),
            'The fixture source must contain the node label',
          )
          await input.fill(next)
          await page.waitForFunction(
            (text) =>
              document.querySelector('.standalone-mermaid-preview')?.textContent?.includes(text),
            renamed,
          )
          h.assert(
            await diagram.textContent().then((text) => text.includes(renamed)),
            'The rendered SVG must reflect the edited source',
          )
          await page.waitForFunction(
            (text) => window.taco.readFile('diagrams/flow.mmd').content.includes(text),
            renamed,
          )
          return { node: node[1], renamed, cdnRequests: cdnRequests.length }
        },
      )
      releaseListener()
      await h.capture('edit-mermaid-after')
      const { reopened } = await h.step('edit/source:mermaid: save and reopen the artifact', () =>
        roundTrip(h, { name: 'edit-mermaid.taco.html', path: target, contains: [`[${renamed}]`] }),
      )
      const reopenedDiagram = reopened.page
        .locator('.standalone-mermaid-preview svg[aria-roledescription]')
        .first()
      await reopenedDiagram.waitFor({ state: 'visible', timeout: 30000 })
      h.assert(
        (await reopenedDiagram.textContent()).includes(renamed),
        'The reopened preview renders the persisted diagram',
      )
      await h.capture('edit-mermaid-reopened', reopened.page)
      await stateFile(h, 'edit-mermaid-state.json', {
        feature,
        entryPoint: 'edit/source-mermaid',
        path: target,
        ...observed,
        persistedInBundle: true,
      })
    },
  },
  {
    id: 'edit/image:png',
    feature,
    entry: 'Standalone PNG display and preview dialog',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'png')
      const file = fileOf(h, target)
      h.assert.equal(file.mediaType, 'image/png', 'The fixture image must be a PNG')
      await selectFile(page, target)
      await h.capture('edit-png-before')
      await h.step('edit/image:png: display the bundled PNG and open its preview', async () => {
        const image = page.locator('main#taco-main img.media-document-preview')
        await image.waitFor({ state: 'visible' })
        await page.waitForFunction(
          (src) =>
            document
              .querySelector('main#taco-main img.media-document-preview')
              ?.getAttribute('src') === src,
          file.content,
        )
        await page.waitForFunction(
          () =>
            document.querySelector('main#taco-main img.media-document-preview')?.naturalWidth === 1,
        )
        h.assert.equal(
          await image.getAttribute('src'),
          file.content,
          'The viewer renders the inline PNG payload',
        )
        h.assert.equal(
          await image.evaluate((node) => `${node.naturalWidth}x${node.naturalHeight}`),
          '1x1',
          'The bundled PNG must decode',
        )
        await image.click()
        const preview = page.locator('dialog.png-preview')
        await preview.waitFor({ state: 'visible' })
        h.assert.equal(
          await preview.getAttribute('aria-label'),
          target,
          'The preview dialog names the bundled file',
        )
        h.assert.equal(await preview.locator('img').getAttribute('src'), file.content)
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => !document.querySelector('dialog.png-preview'))
      })
      await h.capture('edit-png-after')
      await stateFile(h, 'edit-png-state.json', {
        feature,
        entryPoint: 'edit/image-png',
        path: target,
        mediaType: 'image/png',
        previewDialog: true,
      })
    },
  },
  {
    id: 'files/create:confirm',
    feature,
    entry: 'Add file dialog with type and category',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const anchor = fixturePath(h, 'json')
      const group = declaredGroup(h, anchor)
      const groupTitle = h.fixture?.groups?.find((entry) => entry.id === group)?.title
      const name = 'verification-note'
      const created = `${h.bundle.root}/${name}.md`
      h.assert(
        !(await listPaths(page)).includes(apiPath(h, created)),
        'The created file must be new in this run',
      )
      await h.capture('files-create-before')
      const observed = await h.step(
        `files/create: add a Markdown file to the "${groupTitle ?? group}" category`,
        async () => {
          const summary = page.locator(`nav.file-sidebar details[data-stage="${group}"] > summary`)
          await summary.locator('button.add-file-to-group-btn').click()
          const dialog = page.locator('dialog.new-file-dialog')
          await dialog.waitFor({ state: 'visible' })
          await page.locator('#taco-new-file-name').fill(name)
          await page
            .locator('.new-file-type-list button')
            .filter({ hasText: 'Markdown (.md)' })
            .first()
            .click()
          await page.locator('#taco-new-file-category').selectOption({ label: groupTitle })
          await page.locator('.new-file-confirm').click()
          await dialog.waitFor({ state: 'detached' })
          h.assert.equal(
            await selectedPath(page),
            created,
            'The dialog must select the created file',
          )
          const created2 = await readFile(page, h, created)
          h.assert.equal(
            created2.mediaType,
            'text/markdown',
            'The chosen type decides the media type',
          )
          h.assert(
            created2.content.startsWith(`# ${name}`),
            'The new document starts from the type template',
          )
          const grouped = page.locator(
            `nav.file-sidebar details[data-stage="${group}"] button.file-row[data-path="${created}"]`,
          )
          h.assert.equal(
            await grouped.count(),
            1,
            'The created file must be listed under its chosen category',
          )
          return { path: created, mediaType: 'text/markdown', group }
        },
      )
      await h.capture('files-create-after')
      const saved = await saveDownload(h, 'files-create.taco.html')
      const reopened = await h.reopen(saved)
      const savedFile = reopened.bundle.files.find((entry) => entry.path === created)
      h.assert(savedFile, 'The created file must survive the saved artifact')
      const manifest = reopened.bundle.navigation?.groups?.find((entry) => entry.id === group)
      h.assert(
        manifest?.paths?.some((value) => fullPath(h, value) === created),
        'The saved navigation manifest must keep the category assignment',
      )
      await selectFile(reopened.page, created)
      h.assert(
        (await editorBody(reopened.page).innerText()).includes(name),
        'The reopened document renders the created file',
      )
      await h.capture('files-create-reopened', reopened.page)
      await stateFile(h, 'files-create-state.json', {
        feature,
        entryPoint: 'files/create-confirm',
        ...observed,
        persistedInBundle: true,
      })
    },
  },
  {
    id: 'files/create:cancel',
    feature,
    entry: 'Add file dialog cancel',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const group = declaredGroup(h, fixturePath(h, 'json'))
      await h.capture('files-create-cancel-before')
      await h.step('files/create:cancel: abandon the dialog without adding a file', async () => {
        const before = await listPaths(page)
        const summary = page.locator(`nav.file-sidebar details[data-stage="${group}"] > summary`)
        await summary.locator('button.add-file-to-group-btn').click()
        const dialog = page.locator('dialog.new-file-dialog')
        await dialog.waitFor({ state: 'visible' })
        await page.locator('#taco-new-file-name').fill('cancelled-note')
        await page.locator('.new-file-cancel').click()
        await dialog.waitFor({ state: 'detached' })
        h.assert.deepEqual(await listPaths(page), before, 'A cancelled dialog must not add a file')
        h.assert.equal(
          await page
            .locator(`nav.file-sidebar button.file-row[data-path$="cancelled-note"]`)
            .count(),
          0,
          'No cancelled row may appear in the sidebar',
        )
      })
      await h.capture('files-create-cancel-after')
      await stateFile(h, 'files-create-cancel-state.json', {
        feature,
        entryPoint: 'files/create-cancel',
        added: false,
      })
    },
  },
  {
    id: 'files/rename:actions-menu',
    feature,
    entry: 'Row Actions menu rename',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'yaml')
      const file = fileOf(h, target)
      const renamed = `${target.slice(0, target.lastIndexOf('/'))}/renamed-config.yaml`
      await selectFile(page, target)
      await h.capture('files-rename-before')
      const observed = await h.step(
        `files/rename: rename ${target} through the Actions menu`,
        async () => {
          const action = await fileMenu(page, target, 'Rename file')
          await action.click()
          const dialog = promptDialog(page)
          await dialog.waitFor({ state: 'visible' })
          await page.locator('.prompt-dialog-input').fill('renamed-config')
          await dialog.locator('.control-button-primary').click()
          await dialog.waitFor({ state: 'detached' })
          h.assert.equal(await selectedPath(page), renamed, 'The renamed file stays selected')
          const paths = await listPaths(page)
          h.assert(paths.includes(apiPath(h, renamed)), 'The file list must hold the new path')
          h.assert(!paths.includes(apiPath(h, target)), 'The old path must be gone')
          h.assert.equal(
            (await readFile(page, h, renamed)).content,
            file.content,
            'Renaming keeps the content and the extension',
          )
          return { from: target, to: renamed }
        },
      )
      await h.capture('files-rename-after')
      const saved = await saveDownload(h, 'files-rename.taco.html')
      const reopened = await h.reopen(saved)
      h.assert(
        reopened.bundle.files.some((entry) => entry.path === renamed),
        'The renamed path must survive the saved artifact',
      )
      h.assert(
        !reopened.bundle.files.some((entry) => entry.path === target),
        'The old path must not survive the saved artifact',
      )
      const manifest = reopened.bundle.navigation?.groups?.find((entry) =>
        entry.paths?.some((value) => fullPath(h, value) === renamed),
      )
      h.assert(manifest, 'The renamed file must keep its navigation group')
      h.assert(
        !manifest.paths.some((value) => fullPath(h, value) === target),
        'The manifest must drop the old path',
      )
      await selectFile(reopened.page, renamed)
      h.assert(
        (await sourceInput(reopened.page).inputValue()).includes('service: taco-verify'),
        'The reopened YAML viewer shows the renamed file',
      )
      await h.capture('files-rename-reopened', reopened.page)
      await stateFile(h, 'files-rename-state.json', {
        feature,
        entryPoint: 'files/rename-actions',
        ...observed,
        persistedInBundle: true,
      })
    },
  },
  {
    id: 'files/rename:context-menu',
    feature,
    entry: 'Row context menu rename',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'text')
      const file = fileOf(h, target)
      const renamed = `${target.slice(0, target.lastIndexOf('/'))}/plain-renamed.txt`
      await selectFile(page, target)
      await h.capture('files-rename-context-before')
      const observed = await h.step(
        `files/rename: rename ${target} through the row context menu`,
        async () => {
          const row = page.locator(`nav.file-sidebar button.file-row[data-path="${target}"]`)
          await row.click({ button: 'right' })
          const popover = page.locator('.navigation-popover')
          await popover.waitFor({ state: 'visible' })
          await popover.getByRole('button', { name: 'Rename file', exact: true }).click()
          const dialog = promptDialog(page)
          await dialog.waitFor({ state: 'visible' })
          await page.locator('.prompt-dialog-input').fill('plain-renamed.txt')
          await dialog.locator('.control-button-primary').click()
          await dialog.waitFor({ state: 'detached' })
          const paths = await listPaths(page)
          h.assert(
            paths.includes(apiPath(h, renamed)),
            'The context-menu rename keeps the typed name and extension',
          )
          h.assert(!paths.includes(apiPath(h, target)), 'The old text path must be gone')
          h.assert.equal(
            (await readFile(page, h, renamed)).content,
            file.content,
            'Renaming keeps the content',
          )
          return { from: target, to: renamed }
        },
      )
      await h.capture('files-rename-context-after')
      const { reopened } = await h.step('files/rename: save and reopen the artifact', () =>
        roundTrip(h, { name: 'files-rename-context.taco.html', path: renamed }),
      )
      h.assert(
        !reopened.bundle.files.some((entry) => entry.path === target),
        'The old path must not survive the saved artifact',
      )
      await h.capture('files-rename-context-reopened', reopened.page)
      await stateFile(h, 'files-rename-context-state.json', {
        feature,
        entryPoint: 'files/rename-context',
        ...observed,
        persistedInBundle: true,
      })
    },
  },
  {
    id: 'files/delete:cancel-confirm',
    feature,
    entry: 'Row context menu delete with cancel and confirm',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'json')
      const tasks = fixturePath(h, 'tasks')
      h.assert(
        !h.bundle.files.some((entry) => entry.path === tasks),
        'The tasks requirement must stay absent for the placeholder proof',
      )
      await selectFile(page, target)
      await h.capture('files-delete-before')
      const observed = await h.step(
        `files/delete: cancel, then confirm deleting ${target}`,
        async () => {
          const row = page.locator(`nav.file-sidebar button.file-row[data-path="${target}"]`)
          await row.click({ button: 'right' })
          await page
            .locator('.navigation-popover')
            .getByRole('button', { name: 'Delete file', exact: true })
            .click()
          const dialog = confirmDialog(page)
          await dialog.waitFor({ state: 'visible' })
          await dialog
            .locator('.confirmation-dialog-actions button')
            .filter({ hasText: 'Cancel' })
            .click()
          await dialog.waitFor({ state: 'detached' })
          h.assert(
            (await listPaths(page)).includes(apiPath(h, target)),
            'Cancelling keeps the file',
          )
          await row.click({ button: 'right' })
          await page
            .locator('.navigation-popover')
            .getByRole('button', { name: 'Delete file', exact: true })
            .click()
          await confirmDialog(page).locator('.control-button-primary').click()
          await confirmDialog(page).waitFor({ state: 'detached' })
          h.assert(
            !(await listPaths(page)).includes(apiPath(h, target)),
            'Confirming removes the file',
          )
          h.assert.equal(
            await page.locator(`nav.file-sidebar button.file-row[data-path="${target}"]`).count(),
            0,
            'The deleted row must leave the sidebar',
          )
          const placeholder = page.locator(
            `.checkpoint-file-row [data-placeholder="true"][data-path="${tasks}"]`,
          )
          h.assert.equal(
            await placeholder.count(),
            1,
            'The required checkpoint path must stay a missing placeholder',
          )
          return { deleted: target, cancelledFirst: true }
        },
      )
      await h.capture('files-delete-after')
      const saved = await saveDownload(h, 'files-delete.taco.html')
      const reopened = await h.reopen(saved)
      h.assert(
        !reopened.bundle.files.some((entry) => entry.path === target),
        'The deleted path must not survive the saved artifact',
      )
      const manifest = reopened.bundle.navigation?.groups?.find(
        (entry) => entry.id === declaredGroup(h, target),
      )
      h.assert(
        !manifest?.paths?.some((value) => fullPath(h, value) === target),
        'The saved manifest must drop the deleted path',
      )
      await reopened.page
        .locator(`.checkpoint-file-row [data-placeholder="true"][data-path="${tasks}"]`)
        .waitFor({ state: 'visible' })
      await h.capture('files-delete-reopened', reopened.page)
      await stateFile(h, 'files-delete-state.json', {
        feature,
        entryPoint: 'files/delete',
        ...observed,
        persistedInBundle: true,
      })
    },
  },
  {
    id: 'edit/properties:unclosed-frontmatter',
    feature,
    entry: 'Invalid frontmatter source and its repair',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'unclosedFrontmatter')
      const file = fileOf(h, target)
      const yaml = file.content.replace(/^---\r?\n/, '').replace(/\r?\n$/, '')
      const repaired = `${yaml}\nstatus: repaired`
      await selectFile(page, target)
      await h.capture('edit-invalid-yaml-before')
      const observed = await h.step(
        'edit/properties:invalid: surface the unclosed frontmatter',
        async () => {
          const panel = page.locator('.document-properties')
          await panel.waitFor({ state: 'visible' })
          h.assert(
            await panel.evaluate((node) => node.classList.contains('has-invalid-yaml')),
            'Unclosed frontmatter must mark the properties panel invalid',
          )
          const raw = page.locator('.document-properties-invalid-source')
          await raw.waitFor({ state: 'visible' })
          h.assert(
            (await raw.inputValue()).includes('title: Broken'),
            'The invalid source keeps the authored YAML for editing',
          )
          const message = (
            await page.locator('.document-properties-invalid-message').innerText()
          ).trim()
          h.assert(message.length > 0, 'The invalid message must explain the defect')
          return { message: message.slice(0, 120) }
        },
      )
      const repairedState = await h.step(
        'edit/properties:invalid: repair the YAML through the invalid source editor',
        async () => {
          const raw = page.locator('.document-properties-invalid-source')
          await raw.fill(repaired)
          await page.keyboard.press('Tab')
          await page.waitForFunction(
            () =>
              (
                document.querySelector('.document-properties-invalid-message')?.textContent ?? ''
              ).trim() === '',
          )
          h.assert.equal(
            await raw.getAttribute('aria-invalid'),
            'false',
            'The repaired source must clear its invalid state',
          )
          // The panel repaints on the next editor mount: leave and return through the sidebar.
          await selectFile(page, fixturePath(h, 'guide'))
          await selectFile(page, target)
          await page.waitForFunction(
            () => !document.querySelector('.document-properties-invalid-source'),
            undefined,
            { timeout: 15000 },
          )
          await page.waitForFunction(
            (text) => window.taco.readFile('notes/unclosed-frontmatter.md').content.includes(text),
            'status: repaired',
          )
          const content = (await readFile(page, h, target)).content
          h.assert(
            (
              await page
                .locator('.document-property-key')
                .evaluateAll((nodes) => nodes.map((node) => node.value))
            ).includes('status'),
            'The repaired properties panel must list the repaired keys',
          )
          return { repaired: true }
        },
      )
      await h.capture('edit-invalid-yaml-after')
      const { reopened } = await h.step(
        'edit/properties:invalid: save and reopen the artifact',
        () =>
          roundTrip(h, {
            name: 'edit-invalid-yaml.taco.html',
            path: target,
            contains: ['status: repaired'],
          }),
      )
      h.assert.equal(
        await reopened.page.locator('.document-properties-invalid-source').count(),
        0,
        'The reopened document must show the repaired properties, not the invalid source',
      )
      await h.capture('edit-invalid-yaml-reopened', reopened.page)
      await stateFile(h, 'edit-invalid-yaml-state.json', {
        feature,
        entryPoint: 'edit/properties-invalid',
        path: target,
        ...observed,
        ...repairedState,
        persistedInBundle: true,
      })
    },
  },
]

/** The navigation group the sidebar resolves for a path, read from the bundle manifest. */
function declaredGroup(h, path) {
  for (const group of h.bundle.navigation?.groups ?? []) {
    for (const candidate of group.paths ?? []) {
      if (fullPath(h, candidate) === path) return group.id
    }
  }
  return h.fixture?.otherStage ?? 'other'
}
