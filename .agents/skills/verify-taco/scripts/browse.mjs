// SPDX-License-Identifier: MIT
// TACO-81 browse/search domain cases plus the standalone arbitrary-bundle scenario.
//
// `cases` is executed by suite.mjs with a fresh browser context per case.
// The default export keeps verify.mjs's ad-hoc interface for any built product bundle.
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { openPanelTab, selectFile } from './ui.mjs'

export const feature = 'browse-search'

/** Sidebar data-path for a fixture key: the manifest's full path, whatever form it ships in. */
const fixturePath = (h, key) => {
  const value = h.fixture?.dataPaths?.[key] ?? h.fixture?.paths?.[key]
  if (typeof value !== 'string' || !value)
    throw new Error(`Fixture path "${key}" is missing from the manifest`)
  return fullPath(h, value)
}

const fixtureMarker = (h, key) => {
  const value = h.fixture?.markers?.[key]
  if (typeof value !== 'string' || !value)
    throw new Error(`Fixture marker "${key}" is missing from the manifest`)
  return value
}

const fullPath = (h, value) => {
  const trimmed = String(value).replace(/^\//, '')
  return trimmed.startsWith(`${h.bundle.root}/`) ? trimmed : `${h.bundle.root}/${trimmed}`
}

/** Bundle-relative path the public read-only API accepts. */
const apiPath = (h, path) =>
  path.startsWith(`${h.bundle.root}/`) ? path.slice(h.bundle.root.length + 1) : path

const fileOf = (h, path) => {
  const file = h.bundle.files.find((entry) => entry.path === path)
  if (!file) throw new Error(`Fixture has no file at ${path}`)
  return file
}

const headingsOf = (markdown) =>
  [...markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').matchAll(/^(#{1,6})\s+(.+)$/gm)].map(
    (match) => ({
      level: match[1].length,
      text: match[2].replace(/[*`]/g, '').trim(),
    }),
  )

const readFile = (page, h, path) =>
  page.evaluate((target) => window.taco.readFile(target), apiPath(h, path))

const selectedPath = (page) =>
  page.locator('nav.file-sidebar button.file-row.is-selected[data-path]').getAttribute('data-path')

const reader = (page) => page.locator('main#taco-main')

const editorBody = (page) => page.locator('main#taco-main .tiptap-editor-host .ProseMirror')

const searchDialog = (page) => page.locator('dialog.search-dialog')

const openSearch = async (page) => {
  await page.keyboard.press('ControlOrMeta+k')
  await searchDialog(page).locator('input.search-input').waitFor({ state: 'visible' })
  return searchDialog(page)
}

/** The navigation group the sidebar resolves for a path, read from the bundle manifest. */
const declaredGroup = (h, path) => {
  for (const group of h.bundle.navigation?.groups ?? []) {
    for (const candidate of group.paths ?? []) {
      if (fullPath(h, candidate) === path) return group.id
    }
  }
  return h.fixture?.otherStage ?? 'other'
}

const stateFile = (h, name, value) =>
  writeFile(resolve(h.outDir, name), JSON.stringify(value, null, 2))

export const cases = [
  {
    id: 'browse/sidebar',
    feature,
    entry: 'Files sidebar row click',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'guide')
      const file = fileOf(h, target)
      const heading = headingsOf(file.content)[0]
      h.assert(heading, 'Fixture guide needs a Markdown heading')
      const before = await selectedPath(page)
      await h.capture('browse-sidebar-before')
      const observed = await h.step(`browse/sidebar: select ${target}`, async () => {
        await selectFile(page, target)
        h.assert.notEqual(
          await selectedPath(page),
          before,
          'Selecting another file must move the sidebar selection',
        )
        await editorBody(page).waitFor({ state: 'visible' })
        const rendered = await editorBody(page).innerText()
        h.assert(rendered.includes(heading.text), `${target} heading did not render in the reader`)
        const read = await readFile(page, h, target)
        h.assert.equal(
          read.content,
          file.content,
          'Rendered document must match the bundle content',
        )
        h.assert.equal(read.path, target, 'readFile must report the full bundle path')
        const group = declaredGroup(h, target)
        const scoped = page.locator(
          `nav.file-sidebar details[data-stage="${group}"] button.file-row[data-path="${target}"]`,
        )
        h.assert.equal(
          await scoped.count(),
          1,
          `${target} must be listed under navigation group "${group}"`,
        )
        return { after: await selectedPath(page), group, rendered: rendered.slice(0, 120) }
      })
      await h.capture('browse-sidebar-after')
      await stateFile(h, 'browse-sidebar-state.json', {
        feature,
        entryPoint: 'sidebar',
        before,
        path: target,
        heading: heading.text,
        contentMatchesBundle: true,
        ...observed,
      })
    },
  },
  {
    id: 'browse/sidebar:collapsed-group',
    feature,
    entry: 'Collapsed ancestor group summary',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'duplicateA')
      const file = fileOf(h, target)
      const group = declaredGroup(h, target)
      const details = page.locator(`nav.file-sidebar details[data-stage="${group}"]`)
      await h.capture('browse-collapsed-before')
      const observed = await h.step(
        `browse/sidebar: collapse "${group}", then select ${target}`,
        async () => {
          h.assert.equal(
            await details.count(),
            1,
            `Navigation group "${group}" must render as a details element`,
          )
          h.assert(
            await details.evaluate((node) => node.open),
            'The group must start expanded for this comparison',
          )
          await details.locator(':scope > summary').first().click()
          await page.waitForFunction(
            (selector) => !document.querySelector(selector)?.open,
            `nav.file-sidebar details[data-stage="${group}"]`,
          )
          // Chromium keeps layout boxes under the animating ::details-content, so
          // the render tree is the authority: ask checkVisibility, not getBoundingClientRect.
          const row = page.locator(`nav.file-sidebar button.file-row[data-path="${target}"]`)
          await page.waitForFunction((selector) => {
            const node = document.querySelector(selector)
            return (
              node instanceof HTMLElement && node.checkVisibility({ checkOpacity: true }) === false
            )
          }, `nav.file-sidebar button.file-row[data-path="${target}"]`)
          h.assert.equal(
            await row.evaluate((node) => node.checkVisibility({ checkOpacity: true })),
            false,
            'A collapsed group must take its file rows out of the render tree',
          )
          await selectFile(page, target)
          h.assert(
            await details.evaluate((node) => node.open),
            'Selecting a hidden row must expand its ancestor group',
          )
          await page.waitForFunction((selector) => {
            const node = document.querySelector(selector)
            return (
              node instanceof HTMLElement && node.checkVisibility({ checkOpacity: true }) === true
            )
          }, `nav.file-sidebar button.file-row[data-path="${target}"]`)
          h.assert.equal(await selectedPath(page), target)
          h.assert.equal((await readFile(page, h, target)).content, file.content)
          return { group, collapsed: true, expandedBySelection: true }
        },
      )
      await h.capture('browse-collapsed-after')
      await stateFile(h, 'browse-collapsed-state.json', {
        feature,
        entryPoint: 'sidebar/group',
        path: target,
        ...observed,
      })
    },
  },
  {
    id: 'browse/sidebar:duplicate-basename',
    feature,
    entry: 'Rows sharing a basename',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const paths = [fixturePath(h, 'duplicateA'), fixturePath(h, 'duplicateB')]
      const [name] = new Set(paths.map((path) => path.split('/').pop()))
      h.assert.equal(
        new Set(paths.map((path) => path.split('/').pop())).size,
        1,
        'This case needs two files with the same basename',
      )
      const marker = {
        [paths[0]]: fixtureMarker(h, 'duplicateA'),
        [paths[1]]: fixtureMarker(h, 'duplicateB'),
      }
      await h.capture('browse-duplicate-before')
      const observed = await h.step(`browse/sidebar: distinguish rows named ${name}`, async () => {
        const rows = page.locator(`nav.file-sidebar button.file-row[data-path$="/${name}"]`)
        h.assert.equal(await rows.count(), 2, 'Both duplicate rows must be listed in the sidebar')
        const names = await rows.evaluateAll((nodes) =>
          nodes.map((node) => node.querySelector('.file-name')?.textContent),
        )
        h.assert.deepEqual([...new Set(names)], [name], 'Duplicate rows display the same file name')
        const selected = []
        for (const path of paths) {
          await selectFile(page, path)
          h.assert.equal(
            await selectedPath(page),
            path,
            'Row identity comes from the exact data-path',
          )
          const rendered = await editorBody(page).innerText()
          h.assert(
            rendered.includes(marker[path]),
            `${path} must render its own body, not the other duplicate`,
          )
          h.assert.equal((await readFile(page, h, path)).content, fileOf(h, path).content)
          selected.push({
            path,
            heading: headingsOf(fileOf(h, path).content)[0].text,
            marker: marker[path],
          })
        }
        return { names, selected }
      })
      await h.capture('browse-duplicate-after')
      await stateFile(h, 'browse-duplicate-state.json', {
        feature,
        entryPoint: 'sidebar/duplicate-basename',
        ...observed,
      })
    },
  },
  {
    id: 'browse/outline',
    feature,
    entry: 'Right panel Outline tab',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'guide')
      const headings = headingsOf(fileOf(h, target).content)
      h.assert(
        headings.length >= 2,
        'The outline target needs at least two headings to prove scroll navigation',
      )
      const last = headings[headings.length - 1]
      await selectFile(page, target)
      await h.capture('browse-outline-before')
      const observed = await h.step(
        'browse/outline: list the document headings in the right panel and navigate to a section',
        async () => {
          await openPanelTab(page, 'outline')
          await page.locator('#taco-outline').waitFor({ state: 'visible' })
          const labels = (await page.locator('#taco-outline button').allTextContents()).map(
            (value) => value.trim(),
          )
          h.assert.deepEqual(
            labels,
            headings.map((heading) => heading.text),
            'Outline must list every heading in document order',
          )

          const beforeScroll = await page.evaluate(
            ({ text, level }) => {
              const viewer = document.querySelector('main#taco-main')
              const heading = [...(viewer?.querySelectorAll(`h${level}`) ?? [])].find(
                (node) => node.textContent?.trim() === text,
              )
              if (!viewer || !heading) return null
              const vRect = viewer.getBoundingClientRect()
              const hRect = heading.getBoundingClientRect()
              return {
                scrollTop: viewer.scrollTop,
                inView: hRect.top < vRect.bottom && hRect.bottom > vRect.top,
              }
            },
            { text: last.text, level: last.level },
          )
          h.assert(beforeScroll, 'Viewer and target heading must exist')
          h.assert.equal(
            beforeScroll.inView,
            false,
            `"${last.text}" must start outside the reader viewport before clicking the outline link`,
          )

          const button = page
            .locator('#taco-outline')
            .getByRole('button', { name: last.text, exact: true })
          await button.click()
          await page.waitForFunction(
            ({ text, level, initialScrollTop }) => {
              const viewer = document.querySelector('main#taco-main')
              const heading = [...(viewer?.querySelectorAll(`h${level}`) ?? [])].find(
                (node) => node.textContent?.trim() === text,
              )
              const link = [...document.querySelectorAll('#taco-outline button')].find(
                (node) => node.textContent?.trim() === text,
              )
              if (!viewer || !heading || !link) return false
              const vRect = viewer.getBoundingClientRect()
              const hRect = heading.getBoundingClientRect()
              const inView = hRect.top >= vRect.top - 10 && hRect.top < vRect.bottom
              const hasScrolled = viewer.scrollTop > initialScrollTop
              const isCurrent = link.getAttribute('aria-current') === 'location'
              return hasScrolled && inView && isCurrent
            },
            { text: last.text, level: last.level, initialScrollTop: beforeScroll.scrollTop },
            { timeout: 15000 },
          )

          h.assert.equal(
            await button.getAttribute('aria-current'),
            'location',
            'The outline entry marks the current section',
          )

          const afterScroll = await page.evaluate(
            ({ text, level }) => {
              const viewer = document.querySelector('main#taco-main')
              const heading = [...(viewer?.querySelectorAll(`h${level}`) ?? [])].find(
                (node) => node.textContent?.trim() === text,
              )
              const vRect = viewer?.getBoundingClientRect()
              const hRect = heading?.getBoundingClientRect()
              return {
                scrollTop: viewer?.scrollTop ?? 0,
                inView: Boolean(
                  vRect && hRect && hRect.top >= vRect.top - 10 && hRect.top < vRect.bottom,
                ),
              }
            },
            { text: last.text, level: last.level },
          )
          h.assert(
            afterScroll.scrollTop > beforeScroll.scrollTop,
            'The reader scroll position must move after clicking the outline link',
          )
          h.assert.equal(
            afterScroll.inView,
            true,
            `The target heading "${last.text}" must enter the reader visible rectangle after scrolling`,
          )
          return {
            headings: labels,
            active: last.text,
            ariaCurrent: 'location',
            initialScrollTop: beforeScroll.scrollTop,
            scrolledTo: afterScroll.scrollTop,
            enteredViewport: true,
          }
        },
      )
      await h.capture('browse-outline-after')
      await stateFile(h, 'browse-outline-state.json', {
        feature,
        entryPoint: 'panel/outline',
        path: target,
        ...observed,
      })
    },
  },
  {
    id: 'search/keyboard:path',
    feature,
    entry: 'Cmd/Ctrl+K search by path',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'guide')
      const query = target.split('/').pop()
      await h.capture('search-path-before')
      const observed = await h.step(`search/keyboard: query the path "${query}"`, async () => {
        const dialog = await openSearch(page)
        await dialog.locator('input.search-input').fill(query)
        await page.waitForFunction(
          (text) =>
            [...document.querySelectorAll('dialog.search-dialog .search-result')].some((node) =>
              node.textContent?.includes(text),
            ),
          apiPath(h, target),
        )
        const labels = (await dialog.locator('button.search-result').allTextContents()).map(
          (value) => value.trim(),
        )
        h.assert(
          labels.some((label) => label.includes(apiPath(h, target))),
          `Search results must include ${apiPath(h, target)}`,
        )
        await dialog
          .locator('button.search-result')
          .filter({ hasText: apiPath(h, target) })
          .first()
          .click()
        await page.waitForFunction(() => !document.querySelector('dialog.search-dialog'))
        h.assert.equal(await selectedPath(page), target, 'Choosing a result selects that file')
        await editorBody(page).waitFor({ state: 'visible' })
        const heading = headingsOf(fileOf(h, target).content)[0]
        h.assert(
          (await editorBody(page).innerText()).includes(heading.text),
          'The searched document must render in the reader',
        )
        return { query, results: labels, selected: target }
      })
      await h.capture('search-path-after')
      await stateFile(h, 'search-path-state.json', {
        feature,
        entryPoint: 'search/keyboard-path',
        ...observed,
      })
    },
  },
  {
    id: 'search/keyboard:content',
    feature,
    entry: 'Cmd/Ctrl+K search by document body',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'guide')
      const query = fixtureMarker(h, 'guide')
      h.assert(
        fileOf(h, target).content.includes(query),
        'The guide fixture must contain its prose marker',
      )
      await h.capture('search-content-before')
      const observed = await h.step(`search/keyboard: query body prose "${query}"`, async () => {
        const dialog = await openSearch(page)
        await dialog.locator('input.search-input').fill(query)
        await page.waitForFunction(
          (text) =>
            [...document.querySelectorAll('dialog.search-dialog .search-result')].some((node) =>
              node.textContent?.includes(text),
            ),
          apiPath(h, target),
        )
        await dialog
          .locator('button.search-result')
          .filter({ hasText: apiPath(h, target) })
          .first()
          .click()
        await page.waitForFunction(() => !document.querySelector('dialog.search-dialog'))
        h.assert.equal(await selectedPath(page), target)
        await page.waitForFunction(
          (text) => document.querySelector('main#taco-main')?.textContent?.includes(text),
          query,
        )
        return { query, selected: target }
      })
      await h.capture('search-content-after')
      await stateFile(h, 'search-content-state.json', {
        feature,
        entryPoint: 'search/keyboard-content',
        ...observed,
      })
    },
  },
  {
    id: 'search/keyboard:empty-clear-escape',
    feature,
    entry: 'Search empty state, clear and Escape',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      await h.step('search/keyboard: empty state, clear and Escape', async () => {
        const dialog = await openSearch(page)
        const input = dialog.locator('input.search-input')
        h.assert.equal(await input.inputValue(), '', 'A fresh search dialog starts empty')
        await input.fill('absent-query-taco81-zzz')
        await dialog.locator('.empty-state').waitFor({ state: 'visible' })
        h.assert.equal(
          await dialog.locator('button.search-result').count(),
          0,
          'An absent query leaves no stale results',
        )
        await input.fill('')
        h.assert.equal(
          await dialog.locator('button.search-result').count(),
          0,
          'Clearing the query clears the results',
        )
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => !document.querySelector('dialog.search-dialog'))
        h.assert.equal(
          await page.locator('dialog.search-dialog').count(),
          0,
          'Escape closes and removes the dialog',
        )
        h.assert.equal(
          await page.locator('body > dialog[open]').count(),
          0,
          'No modal dialog remains open',
        )
      })
      await h.capture('search-empty-after')
      await stateFile(h, 'search-empty-state.json', {
        feature,
        entryPoint: 'search/keyboard-empty',
        emptyState: true,
        cleared: true,
        closedByEscape: true,
      })
    },
  },
  {
    id: 'browse/html',
    feature,
    entry: 'Sandboxed HTML preview',
    evidence: 'user-path',
    async run(h) {
      const { page, context } = h
      const target = fixturePath(h, 'html')
      const file = fileOf(h, target)
      const offOrigin = [
        ...file.content.matchAll(
          /<(?:script|img|link|iframe)\b[^>]*\b(?:src|href)=["'](https?:[^"']+)["']/gi,
        ),
      ].map((match) => match[1])
      const dataset = file.content.match(/dataset\.([A-Za-z0-9_]+)\s*=\s*['"]([^'"]+)['"]/)
      h.assert(dataset, 'The fixture HTML must expose its inline-script effect')
      const heading = file.content.match(/<h1[^>]*>([^<]+)<\/h1>/i)
      const requested = []
      const received = []
      const refused = []
      const onRequest = (request) => requested.push(request.url())
      const onResponse = (response) => received.push(response.url())
      const onRequestFailed = (request) => refused.push(request.url())
      context.on('request', onRequest)
      context.on('response', onResponse)
      context.on('requestfailed', onRequestFailed)
      await selectFile(page, target)
      await h.capture('browse-html-before')
      const observed = await h.step(
        'browse/html: inspect the sandboxed preview document',
        async () => {
          const iframe = page.locator('iframe.html-document-preview')
          await iframe.waitFor({ state: 'visible' })
          const attributes = await iframe.evaluate((node) => ({
            sandbox: node.getAttribute('sandbox'),
            referrerpolicy: node.getAttribute('referrerpolicy'),
            srcdoc: (node.getAttribute('srcdoc') ?? '').length,
          }))
          const sandbox = (attributes.sandbox ?? '').split(/\s+/).filter(Boolean)
          h.assert(sandbox.includes('allow-scripts'), 'The preview must allow its inline script')
          h.assert(
            !sandbox.includes('allow-same-origin'),
            'The preview must stay in an opaque origin',
          )
          h.assert.equal(attributes.referrerpolicy, 'no-referrer')
          h.assert(
            attributes.srcdoc > 0,
            'The preview renders the bundled source instead of fetching a URL',
          )
          const frame = page.frameLocator('iframe.html-document-preview')
          const policy = await frame
            .locator('meta[http-equiv="Content-Security-Policy"]')
            .getAttribute('content')
          h.assert(
            /default-src 'none'/.test(policy ?? ''),
            'The preview document must deny every default source',
          )
          h.assert(
            /connect-src 'none'/.test(policy ?? ''),
            'The preview document must deny outbound connections',
          )
          if (heading)
            h.assert(
              (await frame.locator('body').innerText()).includes(heading[1].trim()),
              'The bundled page must render its authored text',
            )
          const markerValue = await frame
            .locator('html')
            .evaluate((node, key) => node.dataset[key], dataset[1])
          h.assert.equal(
            markerValue,
            dataset[2],
            'The inline script must run inside the sandboxed document',
          )
          const isolation = await frame.locator('body').evaluate(() => {
            try {
              return `reachable:${window.parent.document.title}`
            } catch (error) {
              return `blocked:${error.name}`
            }
          })
          h.assert(
            isolation.startsWith('blocked:'),
            'An opaque origin must not reach the application document',
          )
          // The frame reports its own load, so the off-origin check below cannot
          // race a still-parsing document.
          await frame.locator('body').evaluate(
            () =>
              new Promise((resolve) => {
                if (document.readyState === 'complete') {
                  resolve(true)
                  return
                }
                window.addEventListener('load', () => resolve(true), { once: true })
              }),
          )
          for (const url of offOrigin) {
            h.assert(!received.includes(url), `Off-origin reference must never load: ${url}`)
            h.assert(
              !requested.includes(url) || refused.includes(url),
              `Off-origin reference must be refused, never answered: ${url}`,
            )
          }
          return {
            target,
            attributes,
            marker: `${dataset[1]}=${dataset[2]}`,
            offOrigin,
            requested: requested.length,
            refused: refused.length,
            isolation,
          }
        },
      )
      context.off('request', onRequest)
      context.off('response', onResponse)
      context.off('requestfailed', onRequestFailed)
      await h.capture('browse-html-after')
      await stateFile(h, 'browse-html-state.json', {
        feature,
        entryPoint: 'browse/html',
        ...observed,
      })
    },
  },
  {
    id: 'browse/link-and-image',
    feature,
    entry: 'Relative Markdown link and inline PNG',
    evidence: 'user-path',
    async run(h) {
      const { page } = h
      const target = fixturePath(h, 'intro')
      const file = fileOf(h, target)
      const link = file.content.match(/(?<!\!)\[[^\]]+\]\(([^)#?]+)/)
      h.assert(link, 'The intro fixture needs a relative Markdown link')
      const linkTarget = fullPath(h, link[1])
      h.assert(
        fileOf(h, linkTarget).mediaType === 'text/markdown',
        `${link[1]} must resolve to a document in the bundle`,
      )
      const image = file.content.match(/!\[[^\]]*\]\(([^)#?]+)/)
      h.assert(image, 'The intro fixture needs a relative PNG reference')
      const reference = fullPath(h, image[1])
      h.assert(
        fileOf(h, reference).mediaType === 'image/png',
        `${reference} must be the bundled PNG`,
      )
      await selectFile(page, target)
      const observed = await h.step(
        'browse/link-and-image: follow a relative link and open the inline PNG',
        async () => {
          const anchor = editorBody(page).locator('a[href]').first()
          await anchor.waitFor({ state: 'visible' })
          h.assert.equal(
            await anchor.getAttribute('href'),
            link[1],
            'The rendered link keeps its authored relative href',
          )
          await anchor.click()
          await page.waitForFunction(
            (path) =>
              document
                .querySelector('nav.file-sidebar button.file-row.is-selected')
                ?.getAttribute('data-path') === path,
            linkTarget,
          )
          h.assert.equal(
            await selectedPath(page),
            linkTarget,
            'A relative document link opens the linked file in place',
          )
          const linkedHeading = headingsOf(fileOf(h, linkTarget).content)[0]
          h.assert(
            (await editorBody(page).innerText()).includes(linkedHeading.text),
            'The linked document must render in the reader',
          )
          await selectFile(page, target)
          const rendered = editorBody(page).locator('img').first()
          await rendered.waitFor({ state: 'visible' })
          const payload = h.fixture?.pngDataUrl ?? fileOf(h, reference).content
          // The sanitizer mounts a transparent placeholder first; the reader swaps
          // in the bundled payload once the relative reference resolves.
          await page.waitForFunction(
            (src) =>
              document.querySelector('main#taco-main .ProseMirror img')?.getAttribute('src') ===
              src,
            payload,
          )
          await page.waitForFunction(
            () => document.querySelector('main#taco-main .ProseMirror img')?.naturalWidth === 1,
          )
          h.assert.equal(
            await rendered.getAttribute('src'),
            payload,
            'The inline PNG must resolve to the bundled asset payload',
          )
          h.assert.equal(
            await rendered.evaluate((node) => `${node.naturalWidth}x${node.naturalHeight}`),
            '1x1',
            'The bundled PNG must decode',
          )
          h.assert.equal(
            await rendered.evaluate((node) => node.dataset.tacoSource),
            image[1],
            'The reader keeps the authored relative source',
          )
          await rendered.click()
          const preview = page.locator('dialog.png-preview')
          await preview.waitFor({ state: 'visible' })
          h.assert.equal(
            await preview.getAttribute('aria-label'),
            reference,
            'The preview names the bundled file',
          )
          h.assert(
            (await preview.locator('img').getAttribute('src')).startsWith('data:image/png;base64,'),
            'The preview shows the bundled PNG payload',
          )
          await page.keyboard.press('Escape')
          await page.waitForFunction(() => !document.querySelector('dialog.png-preview'))
          return {
            target,
            link: link[1],
            followed: linkTarget,
            image: image[1],
            resolved: reference,
          }
        },
      )
      await h.capture('browse-link-after')
      await stateFile(h, 'browse-link-state.json', {
        feature,
        entryPoint: 'browse/link-and-image',
        ...observed,
      })
    },
  },
]

/**
 * Ad-hoc scenario for an arbitrary built product bundle (verify.mjs --scenario browse.mjs).
 * Picks a Markdown file other than the current selection, expands its collapsed ancestors through
 * the sidebar, and proves selection, rendered heading and bundle content agree.
 */
export default async function browse({ page, bundle, outDir, capture, step, assert }) {
  const files = bundle.files.filter((file) => file.mediaType === 'text/markdown')
  const current = await selectedPath(page)
  const target = files.find((file) => file.path !== current)
  assert(target, 'Browsing proof needs two Markdown files')
  await capture('browse-before')
  await step(`browse/sidebar: click ${target.path}`, async () => {
    await selectFile(page, target.path)
    await page.waitForFunction(
      (path) =>
        document
          .querySelector('nav.file-sidebar button.file-row.is-selected')
          ?.getAttribute('data-path') === path,
      target.path,
    )
    const editor = page.locator('main#taco-main .tiptap-editor-host .ProseMirror')
    await editor.waitFor({ state: 'visible' })
    const rendered = await editor.innerText()
    const read = await page.evaluate(
      (path) => window.taco.readFile(path),
      target.path.startsWith(`${bundle.root}/`)
        ? target.path.slice(bundle.root.length + 1)
        : target.path,
    )
    assert.equal(read.content, target.content)
    // Match actual paragraph/heading prose, not just the navigation selection.
    const plain = target.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    const line = plain.split('\n').find((value) => /^#{1,6}\s+\S/.test(value))
    assert(line, 'Select a fixture Markdown file with a visible heading')
    assert(
      rendered.includes(
        line
          .replace(/^#{1,6}\s+/, '')
          .replace(/[*`]/g, '')
          .trim(),
      ),
      'Selected document heading did not render',
    )
    await writeFile(
      resolve(outDir, 'browse-state.json'),
      JSON.stringify(
        {
          feature: 'browse-search',
          entryPoint: 'sidebar',
          before: current,
          after: target.path,
          heading: line,
          contentMatchesBundle: true,
        },
        null,
        2,
      ),
    )
  })
  await capture('browse-after')
}
