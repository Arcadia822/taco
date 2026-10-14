// Variant and public-UI coverage: theme and language preferences through the real menus, the
// responsive panel/keyboard path, Complete offline operation, Lite CDN-blocked source fallback,
// and sandboxed hostile HTML that cannot reach the app or the network.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { saveDownload, selectFile, typeAtEnd } from './ui.mjs'

export const feature = 'variants'

const writeState = async (h, name, value) => {
  await mkdir(h.outDir, { recursive: true })
  await writeFile(resolve(h.outDir, `${name}.state.json`), JSON.stringify(value, null, 2))
}

// The harness is suite-scoped, so a preference that survives a real reload proves persistence.
const waitForBoot = async (page) => {
  await page.waitForFunction(() => Boolean(window.taco), undefined, { timeout: 20_000 })
  await page.locator('#taco-splash').waitFor({ state: 'detached', timeout: 20_000 })
}

const reloadAndBoot = async (page) => {
  await page.reload({ waitUntil: 'load' })
  await waitForBoot(page)
}

const watchNetwork = (page) => {
  const seen = { finished: [], failed: [] }
  page.on('requestfinished', (request) => seen.finished.push(request.url()))
  page.on('requestfailed', (request) => seen.failed.push(request.url()))
  return seen
}

const originOf = (url) => {
  try {
    return new URL(url).origin
  } catch {
    return 'unparsable'
  }
}

const isAppOrigin = (url, origin) => {
  try {
    const parsed = new URL(url)
    return parsed.origin === origin || parsed.protocol === 'data:' || parsed.protocol === 'blob:'
  } catch {
    return false
  }
}

// Fixture paths go into CSS attribute selectors, so escape instead of interpolating raw.
const attr = (name, value) => `[${name}="${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`

const themeState = (page) =>
  page.evaluate(() => ({
    theme: document.documentElement.dataset.theme ?? null,
    stored: localStorage.getItem('taco-theme'),
    icon: document.querySelector('button.theme-toggle .ui-icon')?.getAttribute('data-icon') ?? null,
    background: getComputedStyle(document.body).backgroundColor,
  }))

const chooseTheme = async (page, label) => {
  await page.locator('button.theme-toggle').click()
  const menu = page.locator('.topbar-popover.theme-menu')
  await menu.waitFor({ state: 'visible' })
  await menu.getByRole('menuitem', { name: new RegExp(`^${label}(?: ✓)?$`) }).click()
  await menu.waitFor({ state: 'detached' })
}

const languageButton = (page) => page.locator('button.control-button:has(svg[data-icon="globe"])')

const chooseLanguage = async (page, label) => {
  await languageButton(page).click()
  const menu = page.locator('.topbar-popover.language-menu')
  await menu.waitFor({ state: 'visible' })
  await menu.getByRole('menuitem', { name: new RegExp(`^${label}(?: ✓)?$`) }).click()
  await menu.waitFor({ state: 'detached' })
}

const localeState = (page) =>
  page.evaluate(() => ({
    lang: document.documentElement.lang,
    stored: localStorage.getItem('taco-locale'),
    saveLabel: document.querySelector('button.save-button')?.getAttribute('aria-label') ?? null,
    checkpointLabel:
      document.querySelector('button.checkpoint-nav-item')?.textContent?.trim() ?? null,
  }))

const isLatinOnly = (value) => /^[\u0000-\u007F]*$/.test(value ?? '')

// A viewport change is applied by a media-query listener, so wait for the settled layout
// (both panels at once) instead of sleeping or reading a state that may already hold.
const waitForLayout = (page, { sidebarClosed, panelOpen }) =>
  page.waitForFunction(
    (expected) => {
      const app = document.getElementById('app')
      return (
        Boolean(app) &&
        app.classList.contains('sidebar-closed') === expected.sidebarClosed &&
        app.classList.contains('comment-panel-open') === expected.panelOpen
      )
    },
    { sidebarClosed, panelOpen },
  )

export const cases = [
  {
    id: 'variants/theme:menu',
    feature,
    async run(h) {
      const { page } = h
      const initial = await themeState(page)
      h.assert.equal(
        initial.theme,
        'light',
        'the light context resolves the system preference to light',
      )
      h.assert.equal(initial.icon, 'monitor', 'the system preference shows the monitor icon')
      h.assert.equal(initial.stored, null, 'no theme is stored before the first choice')

      await h.step('variants/theme:menu: choose Dark through the theme menu', async () => {
        await chooseTheme(page, 'Dark')
        const dark = await themeState(page)
        h.assert.equal(dark.theme, 'dark')
        h.assert.equal(dark.stored, 'dark', 'the choice is stored for the next boot')
        h.assert.equal(dark.icon, 'moon')
        h.assert.notEqual(
          dark.background,
          initial.background,
          'dark actually restyles the document',
        )
      })
      await h.capture('variants-theme-dark')

      await h.step('variants/theme:menu: the stored theme survives a real reload', async () => {
        await reloadAndBoot(page)
        const after = await themeState(page)
        h.assert.equal(after.theme, 'dark', 'the reloaded document boots dark')
        h.assert.equal(after.icon, 'moon')
        h.assert.equal(after.stored, 'dark')
      })

      await h.step(
        'variants/theme:menu: choose Light, then System, distinguishing their rendering',
        async () => {
          await chooseTheme(page, 'Light')
          const light = await themeState(page)
          h.assert.equal(light.theme, 'light')
          h.assert.equal(light.icon, 'sun', 'an explicit light choice is not the system choice')
          h.assert.equal(light.stored, 'light')
          await chooseTheme(page, 'System')
          const system = await themeState(page)
          h.assert.equal(system.stored, 'system')
          h.assert.equal(system.icon, 'monitor')
          h.assert.equal(
            system.theme,
            'light',
            'the system choice follows the emulated color scheme',
          )
          h.assert.equal(system.background, light.background)
        },
      )
      await h.capture('variants-theme-system')
      await writeState(h, 'variants-theme', await themeState(page))
    },
  },

  {
    id: 'variants/language:menu',
    feature,
    async run(h) {
      const { page } = h
      const english = await localeState(page)
      h.assert.equal(english.lang, 'en')
      h.assert.equal(english.stored, null)
      h.assert.ok(isLatinOnly(english.saveLabel), 'the default chrome is English')

      await h.step(
        'variants/language:menu: choose 简体中文 through the language menu',
        async () => {
          await chooseLanguage(page, '简体中文')
          const chinese = await localeState(page)
          h.assert.equal(chinese.lang, 'zh-Hans')
          h.assert.equal(chinese.stored, 'zh-Hans', 'the choice is stored for the next boot')
          h.assert.notEqual(chinese.saveLabel, english.saveLabel, 'the chrome is relabelled')
          h.assert.equal(isLatinOnly(chinese.saveLabel), false, 'the chrome is no longer English')
          h.assert.notEqual(chinese.checkpointLabel, english.checkpointLabel)
          h.assert.equal(
            chinese.checkpointLabel,
            await page.locator('button.checkpoint-nav-item').innerText(),
          )
        },
      )
      await h.capture('variants-language-chinese')

      await h.step(
        'variants/language:menu: the stored language survives a real reload',
        async () => {
          await reloadAndBoot(page)
          const after = await localeState(page)
          h.assert.equal(
            after.lang,
            'zh-Hans',
            'the reloaded document boots in the stored language',
          )
          h.assert.equal(after.stored, 'zh-Hans')
          h.assert.equal(isLatinOnly(after.saveLabel), false)
        },
      )

      await h.step('variants/language:menu: return to English through the same menu', async () => {
        await chooseLanguage(page, 'English')
        const restored = await localeState(page)
        h.assert.equal(restored.lang, 'en')
        h.assert.equal(restored.stored, 'en')
        h.assert.equal(restored.saveLabel, english.saveLabel, 'the English chrome is restored')
        h.assert.equal(restored.checkpointLabel, english.checkpointLabel)
      })
      await h.capture('variants-language-english')
      await writeState(h, 'variants-language', await localeState(page))
    },
  },

  {
    id: 'variants/responsive:panel-and-keyboard',
    feature,
    async run(h) {
      const { page } = h
      const guide = h.fixture.dataPaths.guide
      const root = () => page.locator('#app')
      const sidebar = () => page.locator('nav.file-sidebar')
      const sidebarToggle = () => page.locator('button.panel-toggle')
      const workspaceToggle = () => page.locator('button.workspace-left-toggle')
      const commentToggle = () => page.locator('button.comment-toggle')
      const commentsPanel = () => page.locator('#taco-comments')

      await h.step(
        'variants/responsive:panel-and-keyboard: a wide viewport keeps both panels open',
        async () => {
          await page.setViewportSize({ width: 1440, height: 1000 })
          h.assert.equal(
            await root().evaluate((node) => node.classList.contains('sidebar-closed')),
            false,
          )
          h.assert.equal(await sidebar().getAttribute('aria-hidden'), 'false')
          h.assert.equal(await sidebarToggle().getAttribute('aria-expanded'), 'true')
          h.assert.equal(await commentToggle().getAttribute('aria-expanded'), 'true')
          const widePanel = await commentsPanel().boundingBox()
          h.assert.ok(
            widePanel.x + widePanel.width <= 1440 && widePanel.width > 0,
            'the open right panel is on screen',
          )
        },
      )

      await h.step(
        'variants/responsive:panel-and-keyboard: Escape closes the right panel and returns focus',
        async () => {
          await page.keyboard.press('Escape')
          h.assert.equal(await commentToggle().getAttribute('aria-expanded'), 'false')
          h.assert.equal(
            await commentToggle().evaluate((node) => document.activeElement === node),
            true,
            'the keyboard path returns focus to the toggle',
          )
          await commentToggle().click()
          h.assert.equal(await commentToggle().getAttribute('aria-expanded'), 'true')
        },
      )
      await h.capture('variants-responsive-wide')

      await h.step(
        'variants/responsive:panel-and-keyboard: a narrow viewport closes both panels',
        async () => {
          await page.setViewportSize({ width: 640, height: 900 })
          await waitForLayout(page, { sidebarClosed: true, panelOpen: false })
          h.assert.equal(
            await root().evaluate((node) => node.classList.contains('sidebar-closed')),
            true,
          )
          h.assert.equal(await sidebar().getAttribute('aria-hidden'), 'true')
          h.assert.equal(await sidebar().evaluate((node) => node.hasAttribute('inert')), true)
          h.assert.equal(await sidebarToggle().getAttribute('aria-expanded'), 'false')
          h.assert.equal(await commentToggle().getAttribute('aria-expanded'), 'false')
          const narrowPanel = await commentsPanel().boundingBox()
          h.assert.ok(narrowPanel.x >= 639, 'the closed right panel sits off the narrow viewport')
        },
      )
      await h.capture('variants-responsive-narrow')

      await h.step(
        'variants/responsive:panel-and-keyboard: choosing a file collapses the sidebar again',
        async () => {
          await workspaceToggle().click()
          await waitForLayout(page, { sidebarClosed: false, panelOpen: false })
          h.assert.equal(await sidebar().getAttribute('aria-hidden'), 'false')
          await selectFile(page, guide)
          await waitForLayout(page, { sidebarClosed: true, panelOpen: false })
          h.assert.equal(
            await root().evaluate((node) => node.classList.contains('sidebar-closed')),
            true,
            'a narrow selection returns the reader to the document',
          )
          h.assert.equal(await commentToggle().getAttribute('aria-expanded'), 'false')
          h.assert.equal(
            await page
              .locator(`button.file-row${attr('data-path', guide)}`)
              .evaluate((node) => node.classList.contains('is-selected')),
            true,
          )
        },
      )

      await h.step(
        'variants/responsive:panel-and-keyboard: a wide viewport restores the layout',
        async () => {
          await page.setViewportSize({ width: 1440, height: 1000 })
          await waitForLayout(page, { sidebarClosed: false, panelOpen: true })
          h.assert.equal(
            await root().evaluate((node) => node.classList.contains('sidebar-closed')),
            false,
          )
          h.assert.equal(await sidebar().evaluate((node) => node.hasAttribute('inert')), false)
          h.assert.equal(await sidebarToggle().getAttribute('aria-expanded'), 'true')
          h.assert.equal(
            await commentToggle().getAttribute('aria-expanded'),
            'true',
            'the desktop panel explicitly reopened by the user stays open',
          )
        },
      )
      await h.capture('variants-responsive-restored')
      await h.step(
        'variants/responsive:panel-and-keyboard: an explicitly closed desktop panel stays closed after resizing',
        async () => {
          await page.keyboard.press('Escape')
          h.assert.equal(await commentToggle().getAttribute('aria-expanded'), 'false')
          await page.setViewportSize({ width: 640, height: 900 })
          await waitForLayout(page, { sidebarClosed: true, panelOpen: false })
          await page.setViewportSize({ width: 1440, height: 1000 })
          await waitForLayout(page, { sidebarClosed: false, panelOpen: false })
          h.assert.equal(
            await commentToggle().getAttribute('aria-expanded'),
            'false',
            'resizing preserves the explicit desktop closed preference',
          )
        },
      )
      await h.capture('variants-responsive-closed-preference')
      await writeState(h, 'variants-responsive', {
        viewport: page.viewportSize(),
        sidebarClosed: await root().evaluate((node) => node.classList.contains('sidebar-closed')),
        commentPanelOpen: await commentToggle().getAttribute('aria-expanded'),
      })
    },
  },

  {
    id: 'variants/offline:complete',
    feature,
    async run(h) {
      const { page } = h
      const origin = new URL(h.url).origin
      const net = watchNetwork(page)

      await h.step(
        'variants/offline:complete: boot the single file with no external request',
        async () => {
          await reloadAndBoot(page)
          h.assert.ok(net.finished.length > 0, 'the boot itself must be observed')
          h.assert.deepEqual(
            net.finished.filter((url) => !isAppOrigin(url, origin)),
            [],
            'the Complete build fetches nothing outside its own origin',
          )
          h.assert.deepEqual(
            net.failed,
            [],
            'the Complete build never reaches for external resources',
          )
        },
      )

      await h.step(
        'variants/offline:complete: the bundled app state is complete and valid',
        async () => {
          const state = await page.evaluate(() => ({
            format: window.taco.format,
            files: window.taco.listFiles().length,
            validation: window.taco.validate(),
            checkpoints: window.taco.getCheckpoints().valid,
          }))
          h.assert.equal(state.format, 'taco/files')
          h.assert.ok(state.files > 0)
          h.assert.equal(state.validation.ok, true)
          h.assert.equal(state.validation.counts.error, 0)
          h.assert.equal(state.checkpoints, true)
        },
      )
      await h.doctor()

      await h.step(
        'variants/offline:complete: a Mermaid diagram renders from the bundled runtime',
        async () => {
          await selectFile(page, h.fixture.dataPaths.mermaid)
          await page.locator('.taco-mermaid-render .surface svg').waitFor({ state: 'visible' })
          h.assert.equal(await page.locator('.taco-mermaid-render .surface.is-error').count(), 0)
          h.assert.deepEqual(
            net.finished.filter((url) => !isAppOrigin(url, origin)),
            [],
            'no CDN is needed for Mermaid',
          )
        },
      )
      await h.capture('variants-offline-complete-mermaid')

      await h.step(
        'variants/offline:complete: a structured source file edits offline',
        async () => {
          const json = h.fixture.dataPaths.json
          await selectFile(page, json)
          const editor = page.locator('textarea.source-editor-input')
          await editor.waitFor({ state: 'visible' })
          const content = await page.evaluate((path) => window.taco.readFile(path).content, json)
          h.assert.equal(await editor.inputValue(), content)
          h.assert.equal(await page.locator('.taco-mermaid-render .surface.is-error').count(), 0)
          h.assert.deepEqual(
            net.finished.filter((url) => !isAppOrigin(url, origin)),
            [],
          )
        },
      )
      await h.capture('variants-offline-complete-source')
      await writeState(h, 'variants-offline-complete', {
        finished: net.finished,
        failed: net.failed,
      })
    },
  },

  {
    id: 'variants/offline:lite-source-fallback',
    feature,
    variant: 'lite',
    async run(h) {
      const { page } = h
      const origin = new URL(h.url).origin
      const net = watchNetwork(page)
      const guide = h.fixture.dataPaths.guide
      const marker = 'lite offline fallback edit'

      await h.step(
        'variants/offline:lite-source-fallback: the Lite build boots with every CDN blocked',
        async () => {
          await reloadAndBoot(page)
          const state = await page.evaluate(() => ({
            files: window.taco.listFiles().length,
            validation: window.taco.validate(),
          }))
          h.assert.ok(state.files > 0)
          h.assert.equal(state.validation.ok, true)
          h.assert.ok(
            net.failed.some((url) => !isAppOrigin(url, origin)),
            'the blocked CDN modules must have been attempted and observed',
          )
          h.assert.deepEqual(
            net.finished.filter(
              (url) => !isAppOrigin(url, origin) && originOf(url) !== 'https://cdn.jsdelivr.net',
            ),
            [],
            'only the pinned Mermaid mirror may answer; every other provider stays blocked',
          )
        },
      )

      await h.step(
        'variants/offline:lite-source-fallback: Markdown degrades to the editable source',
        async () => {
          await selectFile(page, guide)
          await page.locator('.editor-error').waitFor({ state: 'visible' })
          const editor = page.locator('textarea.source-editor-input')
          await editor.waitFor({ state: 'visible' })
          const content = await page.evaluate((path) => window.taco.readFile(path).content, guide)
          h.assert.equal(
            await editor.inputValue(),
            content,
            'the fallback keeps the original markdown',
          )
          h.assert.equal(await editor.isEditable(), true, 'the fallback stays editable')
          h.assert.equal(
            await page.locator('.editor-error .editor-error-primary').count(),
            1,
            'the reader is told why the rich editor is unavailable',
          )
        },
      )
      await h.capture('variants-offline-lite-fallback')

      await h.step(
        'variants/offline:lite-source-fallback: the fallback editor really edits the document',
        async () => {
          const editor = page.locator('textarea.source-editor-input')
          await typeAtEnd(page, `\n${marker}`)
          await page.waitForFunction(
            ([path, text]) => window.taco.readFile(path).content.includes(text),
            [guide, marker],
          )
          h.assert.ok(
            (await editor.inputValue()).endsWith(marker),
            'the typed text lands at the end of the degraded source editor',
          )
          // getReviewHandoff speaks root-relative paths; the sidebar data-path is the full bundle path.
          const relativeGuide = h.fixture.paths.guide
          const review = await page.evaluate(() =>
            window.taco.getReviewHandoff().changedFiles.map((file) => file.path),
          )
          h.assert.deepEqual(review, [relativeGuide])
        },
      )

      const saved = await saveDownload(h, 'variants-lite-offline.taco.html')
      const reopened = await h.reopen(saved)
      await h.step(
        'variants/offline:lite-source-fallback: the degraded edit persists in the downloaded copy',
        async () => {
          const stored = reopened.bundle.files.find((file) => file.path === guide)
          h.assert.ok(stored, 'the saved bundle still holds the document')
          h.assert.ok(stored.content.trimEnd().endsWith(marker))
          await selectFile(reopened.page, guide)
          await reopened.page.locator('.editor-error').waitFor({ state: 'visible' })
          const editor = reopened.page.locator('textarea.source-editor-input')
          await editor.waitFor({ state: 'visible' })
          h.assert.ok(
            (await editor.inputValue()).includes(marker),
            'the reopened copy still shows the fallback source',
          )
        },
      )
      await h.capture('variants-offline-lite-reopened')
      await writeState(h, 'variants-offline-lite', { finished: net.finished, failed: net.failed })
    },
  },

  {
    id: 'variants/hostile-content:sandboxed-html',
    feature,
    async run(h) {
      const { page } = h
      const origin = new URL(h.url).origin
      const html = h.fixture.dataPaths.html
      const externalUrl = h.fixture.externalUrl
      h.assert.ok(externalUrl, 'the fixture must name the external reference it refuses')
      const net = watchNetwork(page)

      await h.step(
        'variants/hostile-content:sandboxed-html: open the hostile document',
        async () => {
          await selectFile(page, html)
          await page.locator('iframe.html-document-preview').waitFor({ state: 'visible' })
          h.assert.ok(
            (await page.evaluate((path) => window.taco.readFile(path).content, html)).includes(
              externalUrl,
            ),
            'the fixture document really references the external URL',
          )
        },
      )
      const before = await page.evaluate(() => ({
        validation: window.taco.validate(),
        frames: document.querySelectorAll('iframe').length,
        api: typeof window.taco.getCheckpoints,
      }))

      await h.step(
        'variants/hostile-content:sandboxed-html: the frame is an opaque sandbox',
        async () => {
          const sandbox = await page.locator('iframe.html-document-preview').getAttribute('sandbox')
          h.assert.ok(sandbox, 'the embedded document is sandboxed')
          h.assert.ok(
            sandbox.includes('allow-scripts'),
            'the document may run its own inline script',
          )
          h.assert.equal(
            sandbox.includes('allow-same-origin'),
            false,
            'it never shares the app origin',
          )
          h.assert.equal(
            await page.locator('iframe.html-document-preview').getAttribute('referrerpolicy'),
            'no-referrer',
          )
          h.assert.equal(
            await page
              .locator('iframe.html-document-preview')
              .evaluate((node) => node.contentDocument === null),
            true,
            'the app cannot reach into the embedded document',
          )
          h.assert.ok(
            (
              await page.locator('iframe.html-document-preview').evaluate((node) => node.srcdoc)
            ).includes('Content-Security-Policy'),
            'the embedded document carries its own CSP',
          )
        },
      )

      await h.step(
        'variants/hostile-content:sandboxed-html: the embedded document runs but cannot escape',
        async () => {
          const handle = await page.locator('iframe.html-document-preview').elementHandle()
          const frame = await handle.contentFrame()
          h.assert.ok(frame, 'the sandboxed frame is attached')
          const probe = await frame.evaluate(async (url) => {
            const reach = (fn) => {
              try {
                return fn()
              } catch {
                return 'blocked'
              }
            }
            const image = document.querySelector('img')
            return {
              origin: location.origin,
              marker: document.documentElement.dataset.verifyInlineMarker ?? null,
              parentDocument: reach(() => window.parent.document.title),
              parentApi: reach(() => window.parent.taco.getCheckpoints().valid),
              externalImage: image ? image.naturalWidth : 'absent',
              fetchExternal: await fetch(url).then(
                () => 'allowed',
                () => 'blocked',
              ),
            }
          }, externalUrl)
          h.assert.equal(probe.origin, 'null', 'the embedded document runs on an opaque origin')
          h.assert.equal(
            probe.marker,
            h.fixture.markers.htmlInline,
            'the inline script ran inside its sandbox',
          )
          h.assert.equal(probe.parentDocument, 'blocked')
          h.assert.equal(probe.parentApi, 'blocked', 'hostile content cannot call the app API')
          h.assert.ok(
            probe.externalImage === 'absent' || probe.externalImage === 0,
            'no external media loads',
          )
          h.assert.equal(
            probe.fetchExternal,
            'blocked',
            'the embedded CSP blocks the external request',
          )
        },
      )
      await h.capture('variants-hostile-sandboxed-html')

      await h.step(
        'variants/hostile-content:sandboxed-html: the app stays untouched and valid',
        async () => {
          const after = await page.evaluate(() => ({
            validation: window.taco.validate(),
            frames: document.querySelectorAll('iframe').length,
            api: typeof window.taco.getCheckpoints,
            checkpoints: window.taco.getCheckpoints().valid,
          }))
          h.assert.equal(after.validation.ok, true)
          h.assert.deepEqual(after.validation.counts, before.validation.counts)
          h.assert.equal(after.frames, before.frames)
          h.assert.equal(after.api, before.api)
          h.assert.equal(after.checkpoints, true)
          h.assert.deepEqual(
            net.finished.filter((url) => !isAppOrigin(url, origin)),
            [],
          )
          h.assert.equal(
            net.finished.includes(externalUrl),
            false,
            'the external script was never allowed through',
          )
        },
      )
      await writeState(h, 'variants-hostile-content', {
        finished: net.finished,
        failed: net.failed,
      })
    },
  },
]
