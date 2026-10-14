// Checkpoint coverage: dashboard graph and readiness, sidebar/dashboard status menus,
// existing and missing required files, document instructions, and missing-path retention.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { openPanelTab, saveDownload, selectFile } from './ui.mjs'

export const feature = 'checkpoints'

// The product ships deterministic English labels (src/i18n.ts checkpointEn); menus are driven by name.
const STATUS_LABELS = {
  todo: 'To do',
  in_progress: 'In progress',
  complete: 'Complete',
  freeze: 'Frozen',
}

const writeState = async (h, name, value) => {
  await mkdir(h.outDir, { recursive: true })
  await writeFile(resolve(h.outDir, `${name}.state.json`), JSON.stringify(value, null, 2))
}

// Fixture paths go into CSS attribute selectors, so escape instead of interpolating raw.
const attr = (name, value) => `[${name}="${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`

const readCheckpoints = (page) =>
  page.evaluate(() => {
    const state = window.taco.getCheckpoints()
    if (!state.valid) return { valid: false, error: state.error }
    return {
      valid: true,
      frontier: state.frontier,
      layout: state.layout,
      nodes: state.nodes.map((node) => ({
        id: node.id,
        title: node.title,
        after: node.after,
        aggregate: node.aggregate,
        available: node.available,
        missing: node.missing,
        documents: node.documents.map((doc) => ({
          path: doc.path,
          status: doc.status,
          exists: doc.exists,
          optional: doc.optional,
          ...(doc.instruction !== undefined && { instruction: doc.instruction }),
        })),
      })),
      documents: state.documents.map((doc) => ({
        path: doc.path,
        status: doc.status,
        exists: doc.exists,
      })),
    }
  })

const readCheckpointChanges = (page) =>
  page.evaluate(() => window.taco.getReviewHandoff().checkpointChanges)

// The required paths of the graph, independent of node grouping and document order.
const requiredPaths = (bundle) =>
  bundle.checkpoints.nodes.flatMap((node) => node.documents.map((doc) => doc.path)).sort()

const nodeFor = (state, path) =>
  state.nodes.find((node) => node.documents.some((doc) => doc.path === path))
const docFor = (state, path) =>
  state.nodes.flatMap((node) => node.documents).find((doc) => doc.path === path)

const rowWithStatusButton = (page, path) =>
  page.locator(`.checkpoint-file-row:has(button.checkpoint-file-select${attr('data-path', path)})`)

const documentRow = (page, path) =>
  page.locator('.checkpoint-document').filter({
    has: page.locator(`button.checkpoint-document-name${attr('title', path)}`),
  })

const openStatusMenu = async (page, anchor) => {
  await anchor.click()
  const menu = page.locator('.checkpoint-status-menu')
  await menu.waitFor({ state: 'visible' })
  return menu
}

const chooseStatus = async (page, anchor, label) => {
  const menu = await openStatusMenu(page, anchor)
  await menu.getByRole('menuitemradio', { name: new RegExp(`^${label}`) }).click()
  await menu.waitFor({ state: 'detached' })
}

// A rendered-text sample taken from the document the API reports, so the assertion follows the fixture.
const sampleOf = (content) => {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const heading = body.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading
  const line = body
    .split('\n')
    .map((value) =>
      value
        .replace(/^[\s>*#|\-]+/, '')
        .replace(/[*_`]/g, '')
        .trim(),
    )
    .find((value) => value.length >= 8)
  return line ?? ''
}

export const cases = [
  {
    id: 'checkpoints/dashboard',
    feature,
    async run(h) {
      const { page } = h
      const tasks = h.fixture.dataPaths.tasks

      await h.step(
        'checkpoints/dashboard: open the Checkpoints dashboard from the sidebar',
        async () => {
          await page.locator('button.checkpoint-nav-item').click()
          await page
            .locator('section.checkpoint-view .checkpoint-graph')
            .waitFor({ state: 'visible' })
        },
      )
      const state = await readCheckpoints(page)
      await h.capture('checkpoints-dashboard-before')
      h.assert.equal(state.valid, true, `checkpoint graph must resolve: ${state.error ?? ''}`)
      h.assert.ok(state.nodes.length > 1, 'the fixture graph must contain dependent nodes')

      await h.step(
        'checkpoints/dashboard: compare every rendered card with the resolved graph',
        async () => {
          const cards = page.locator('article.checkpoint-card')
          h.assert.equal(await cards.count(), state.nodes.length, 'one card per resolved node')
          for (const [index, node] of state.nodes.entries()) {
            const card = cards.nth(index)
            h.assert.equal(await card.locator('h2').innerText(), node.title, `card ${index} title`)
            const className = await card.getAttribute('class')
            h.assert.equal(
              className.includes('is-waiting'),
              !node.available,
              `${node.id} waiting presentation must follow availability`,
            )
            h.assert.equal(
              className.includes('is-frontier'),
              node.available && node.aggregate !== 'freeze',
              `${node.id} frontier presentation must follow availability`,
            )
            h.assert.equal(
              await card.locator('.checkpoint-card-status .ui-icon').getAttribute('data-icon'),
              `status-${node.aggregate}`,
              `${node.id} aggregate status icon`,
            )
            const names = await card
              .locator('button.checkpoint-document-name')
              .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('title')))
            h.assert.deepEqual(
              names,
              node.documents.map((doc) => doc.path),
              `${node.id} document names`,
            )
            for (const doc of node.documents) {
              const rendered = await documentRow(page, doc.path)
                .locator('button.checkpoint-document-status')
                .count()
              h.assert.equal(rendered, doc.exists ? 1 : 0, `${doc.path} status affordance`)
            }
          }
        },
      )

      await h.step(
        'checkpoints/dashboard: require dependency readiness, not just rendered labels',
        async () => {
          for (const node of state.nodes) {
            const expected = node.after.every(
              (id) => state.nodes.find((candidate) => candidate.id === id).aggregate === 'freeze',
            )
            h.assert.equal(
              node.available,
              expected,
              `${node.id} availability must follow frozen predecessors`,
            )
          }
          h.assert.deepEqual(
            state.frontier,
            state.nodes
              .filter((node) => node.available && node.aggregate !== 'freeze')
              .map((node) => node.id),
          )
          h.assert.ok(state.frontier.length > 0, 'at least one node must be actionable')
          h.assert.ok(
            state.nodes.some((node) => !node.available),
            'a dependent node must stay waiting',
          )
          h.assert.ok(
            state.documents.some((doc) => doc.exists === false),
            'the fixture tracks an absent requirement',
          )
        },
      )

      await h.step(
        'checkpoints/dashboard: the absent requirement renders as a missing document',
        async () => {
          const missing = state.documents.find((doc) => doc.path === tasks)
          h.assert.ok(missing, 'the fixture must track the absent tasks document')
          h.assert.equal(missing.exists, false)
          const row = documentRow(page, tasks)
          h.assert.equal(await row.locator('button.checkpoint-document-status').count(), 0)
          h.assert.ok(
            (await row.locator('.checkpoint-document-attribute').innerText()).trim().length > 0,
            'the missing row shows a placeholder attribute',
          )
          h.assert.equal(nodeFor(state, tasks).documents.length, 1)
        },
      )
      await h.capture('checkpoints-dashboard-after')
      await writeState(h, 'checkpoints-dashboard', state)
    },
  },

  {
    id: 'checkpoints/status:sidebar',
    feature,
    async run(h) {
      const { page } = h
      const plan = h.fixture.dataPaths.plan
      const planName = plan.split('/').at(-1)
      const statusButton = (target = page) =>
        rowWithStatusButton(target, plan).locator('button.checkpoint-status-button')

      await h.step('checkpoints/status:sidebar: open the tracked document', async () => {
        await selectFile(page, plan)
      })
      const initial = docFor(await readCheckpoints(page), plan).status
      await h.step(
        'checkpoints/status:sidebar: the sidebar reports the tracked status',
        async () => {
          h.assert.equal(
            await statusButton().getAttribute('aria-label'),
            `${planName} · ${STATUS_LABELS[initial]}`,
          )
          h.assert.equal(
            await rowWithStatusButton(page, plan)
              .locator('button.checkpoint-file-select')
              .getAttribute('data-path'),
            plan,
          )
        },
      )
      await h.capture('checkpoints-status-sidebar-before')

      await h.step(
        'checkpoints/status:sidebar: the menu shows the current status as the checked option',
        async () => {
          const menu = await openStatusMenu(page, statusButton())
          const checked = menu.locator('[role="menuitemradio"][aria-checked="true"]')
          h.assert.equal(await checked.count(), 1, 'exactly one status is checked')
          h.assert.equal(
            await menu
              .getByRole('menuitemradio', { name: new RegExp(`^${STATUS_LABELS[initial]}`) })
              .getAttribute('aria-checked'),
            'true',
            'the initial status radio item is checked',
          )
          await page.keyboard.press('Escape')
          await menu.waitFor({ state: 'detached' })
          h.assert.equal(
            await statusButton().evaluate((element) => document.activeElement === element),
            true,
            'Escape returns focus to the status button',
          )
        },
      )

      await h.step('checkpoints/status:sidebar: cycle every status through the menu', async () => {
        for (const [label, status] of [
          [STATUS_LABELS.complete, 'complete'],
          [STATUS_LABELS.freeze, 'freeze'],
          [STATUS_LABELS.todo, 'todo'],
          [STATUS_LABELS.in_progress, 'in_progress'],
        ]) {
          await chooseStatus(page, statusButton(), label)
          h.assert.equal(
            docFor(await readCheckpoints(page), plan).status,
            status,
            `${label} status`,
          )
          const expectedChanges =
            status === initial ? [] : [{ path: plan, from: initial, to: status }]
          h.assert.deepEqual(
            await readCheckpointChanges(page),
            expectedChanges,
            `${label} handoff change`,
          )
          h.assert.equal(await statusButton().getAttribute('aria-label'), `${planName} · ${label}`)
        }
      })

      await h.step(
        'checkpoints/status:sidebar: leave a changed status and download the Taco',
        async () => {
          await chooseStatus(page, statusButton(), STATUS_LABELS.complete)
        },
      )
      const saved = await saveDownload(h, 'checkpoints-status-sidebar.taco.html')
      const reopened = await h.reopen(saved)

      await h.step('checkpoints/status:sidebar: the downloaded copy keeps the status', async () => {
        const record = reopened.bundle.checkpoints.documents.find((entry) => entry.path === plan)
        h.assert.equal(record?.status, 'complete', 'the saved bundle carries the changed status')
        h.assert.match(record.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/)
        h.assert.deepEqual(
          requiredPaths(reopened.bundle),
          requiredPaths(h.bundle),
          'required paths are unchanged',
        )
        h.assert.equal(docFor(await readCheckpoints(reopened.page), plan).status, 'complete')
        await selectFile(reopened.page, plan)
        h.assert.equal(
          await statusButton(reopened.page).getAttribute('aria-label'),
          `${planName} · ${STATUS_LABELS.complete}`,
        )
      })
      await h.capture('checkpoints-status-sidebar-after')
      await writeState(h, 'checkpoints-status-sidebar', {
        saved: saved.replace(`${h.outDir}/`, ''),
        persisted: reopened.bundle.checkpoints.documents,
      })
    },
  },

  {
    id: 'checkpoints/status:dashboard-and-open-view',
    feature,
    async run(h) {
      const { page } = h
      const plan = h.fixture.dataPaths.plan
      const tasks = h.fixture.dataPaths.tasks
      const planRow = (target = page) => documentRow(target, plan)
      const tasksCard = (target) =>
        target.locator('article.checkpoint-card').filter({ has: documentRow(target, tasks) })

      await h.step('checkpoints/status:dashboard-and-open-view: open the dashboard', async () => {
        await page.locator('button.checkpoint-nav-item').click()
        await page
          .locator('section.checkpoint-view .checkpoint-graph')
          .waitFor({ state: 'visible' })
      })
      const before = await readCheckpoints(page)
      await h.capture('checkpoints-status-dashboard-before')
      h.assert.equal(
        nodeFor(before, tasks).available,
        false,
        'the last node waits on its predecessor',
      )

      await h.step(
        'checkpoints/status:dashboard-and-open-view: freeze the predecessor from its card',
        async () => {
          await chooseStatus(
            page,
            planRow().locator('button.checkpoint-document-status'),
            STATUS_LABELS.freeze,
          )
          const after = await readCheckpoints(page)
          h.assert.equal(docFor(after, plan).status, 'freeze')
          h.assert.equal(
            nodeFor(after, tasks).available,
            true,
            'freezing the predecessor must unlock the dependent node',
          )
          h.assert.equal(after.frontier.includes(nodeFor(after, tasks).id), true)
        },
      )

      await h.step(
        'checkpoints/status:dashboard-and-open-view: the rendered graph follows the new readiness',
        async () => {
          const state = await readCheckpoints(page)
          const className = await tasksCard(page).getAttribute('class')
          h.assert.equal(className.includes('is-frontier'), nodeFor(state, tasks).available)
          h.assert.equal(className.includes('is-waiting'), false)
          h.assert.equal(
            await tasksCard(page)
              .locator('.checkpoint-card-status .ui-icon')
              .getAttribute('data-icon'),
            'status-todo',
          )
          h.assert.equal(
            await planRow().locator('button.checkpoint-document-status').getAttribute('aria-label'),
            `${plan.split('/').at(-1)}: ${STATUS_LABELS.freeze}`,
          )
        },
      )

      await h.step(
        'checkpoints/status:dashboard-and-open-view: open the view from a document status menu',
        async () => {
          await selectFile(page, plan)
          h.assert.equal(
            await page
              .locator('button.checkpoint-nav-item')
              .evaluate((button) => button.classList.contains('is-selected')),
            false,
            'opening a document leaves the Checkpoints view',
          )
          const menu = await openStatusMenu(
            page,
            rowWithStatusButton(page, plan).locator('button.checkpoint-status-button'),
          )
          await menu
            .locator('button.popover-action')
            .filter({ hasText: 'Show in Checkpoints' })
            .click()
          await menu.waitFor({ state: 'detached' })
          await page
            .locator('section.checkpoint-view .checkpoint-graph')
            .waitFor({ state: 'visible' })
          h.assert.equal(
            await page
              .locator('button.checkpoint-nav-item')
              .evaluate((button) => button.classList.contains('is-selected')),
            true,
            'the sidebar marks the open Checkpoints view',
          )
          h.assert.equal(await planRow().locator('button.checkpoint-document-status').count(), 1)
        },
      )

      const saved = await saveDownload(h, 'checkpoints-status-dashboard.taco.html')
      const reopened = await h.reopen(saved)
      await h.step(
        'checkpoints/status:dashboard-and-open-view: the downloaded copy keeps the readiness',
        async () => {
          h.assert.equal(
            reopened.bundle.checkpoints.documents.find((entry) => entry.path === plan).status,
            'freeze',
            'the saved bundle carries the frozen status',
          )
          await reopened.page.locator('button.checkpoint-nav-item').click()
          await reopened.page
            .locator('section.checkpoint-view .checkpoint-graph')
            .waitFor({ state: 'visible' })
          const state = await readCheckpoints(reopened.page)
          h.assert.equal(docFor(state, plan).status, 'freeze')
          h.assert.equal(nodeFor(state, tasks).available, true)
          h.assert.equal(
            (await tasksCard(reopened.page).getAttribute('class')).includes('is-frontier'),
            true,
            'the reopened dashboard renders the unlocked node',
          )
        },
      )
      await h.capture('checkpoints-status-dashboard-after')
      await writeState(h, 'checkpoints-status-dashboard', await readCheckpoints(reopened.page))
    },
  },

  {
    id: 'checkpoints/files:open-existing',
    feature,
    async run(h) {
      const { page } = h
      const spec = h.fixture.dataPaths.spec
      const plan = h.fixture.dataPaths.plan
      const expectDocument = async (target, path) => {
        const sample = sampleOf(
          await target.evaluate((entry) => window.taco.readFile(entry).content, path),
        )
        h.assert.ok(sample.length >= 8, `the fixture document ${path} must expose renderable text`)
        await target.waitForFunction(
          (value) => (document.querySelector('#taco-main')?.innerText ?? '').includes(value),
          sample,
        )
      }

      await h.step(
        'checkpoints/files:open-existing: open a required document from its card',
        async () => {
          await page.locator('button.checkpoint-nav-item').click()
          await page
            .locator('section.checkpoint-view .checkpoint-graph')
            .waitFor({ state: 'visible' })
          await documentRow(page, spec).locator('button.checkpoint-document-name').click()
          await page
            .locator(`button.checkpoint-file-select${attr('data-path', spec)}`)
            .waitFor({ state: 'visible' })
          h.assert.equal(
            await page
              .locator(`button.checkpoint-file-select${attr('data-path', spec)}`)
              .evaluate((button) => button.classList.contains('is-selected')),
            true,
            'the graph opens the tracked document in the sidebar',
          )
          await expectDocument(page, spec)
        },
      )
      await h.capture('checkpoints-files-open-existing-before')

      await h.step(
        'checkpoints/files:open-existing: open another one from its sidebar row',
        async () => {
          await page.locator(`button.checkpoint-file-select${attr('data-path', plan)}`).click()
          h.assert.equal(
            await page
              .locator(`button.checkpoint-file-select${attr('data-path', plan)}`)
              .evaluate((button) => button.classList.contains('is-selected')),
            true,
          )
          await expectDocument(page, plan)
        },
      )
      await h.capture('checkpoints-files-open-existing-after')
      await writeState(h, 'checkpoints-files-open-existing', await readCheckpoints(page))
    },
  },

  {
    id: 'checkpoints/files:create-missing',
    feature,
    async run(h) {
      const { page } = h
      const tasks = h.fixture.dataPaths.tasks
      const tasksRow = (target = page) =>
        target.locator(`button.checkpoint-file-select${attr('data-path', tasks)}`)

      await h.step('checkpoints/files:create-missing: open the absent requirement', async () => {
        await page.locator('button.checkpoint-nav-item').click()
        await page
          .locator('section.checkpoint-view .checkpoint-graph')
          .waitFor({ state: 'visible' })
        await documentRow(page, tasks).locator('button.checkpoint-document-name').click()
        await page.locator('section.checkpoint-placeholder').waitFor({ state: 'visible' })
        h.assert.equal(await tasksRow().getAttribute('data-placeholder'), 'true')
        h.assert.equal(await page.locator('.checkpoint-placeholder-path').innerText(), tasks)
        h.assert.equal(await page.locator('button.checkpoint-create-button').count(), 1)
      })
      await h.capture('checkpoints-files-create-missing-before')
      h.assert.equal(docFor(await readCheckpoints(page), tasks).exists, false)

      await h.step(
        'checkpoints/files:create-missing: create the file from the placeholder',
        async () => {
          await page.locator('button.checkpoint-create-button').click()
          await page.locator('section.checkpoint-placeholder').waitFor({ state: 'detached' })
          h.assert.equal(
            await tasksRow().getAttribute('data-placeholder'),
            null,
            'the row becomes a real file row',
          )
          const state = await readCheckpoints(page)
          h.assert.equal(docFor(state, tasks).exists, true)
          h.assert.equal(docFor(state, tasks).status, 'todo')
          h.assert.equal(
            await page.evaluate((path) => window.taco.readFile(path).content, tasks),
            '',
          )
          h.assert.equal(
            await rowWithStatusButton(page, tasks)
              .locator('button.checkpoint-status-button')
              .count(),
            1,
            'the created file gets a status affordance',
          )
          h.assert.equal(
            await page.evaluate((path) => window.taco.readFile(path).path, tasks),
            tasks,
          )
        },
      )

      await h.step(
        'checkpoints/files:create-missing: the dashboard shows a real document row',
        async () => {
          await page.locator('button.checkpoint-nav-item').click()
          await page
            .locator('section.checkpoint-view .checkpoint-graph')
            .waitFor({ state: 'visible' })
          h.assert.equal(
            await documentRow(page, tasks).locator('button.checkpoint-document-status').count(),
            1,
          )
        },
      )
      await h.capture('checkpoints-files-create-missing-after')

      const saved = await saveDownload(h, 'checkpoints-files-create-missing.taco.html')
      const reopened = await h.reopen(saved)
      await h.step(
        'checkpoints/files:create-missing: the downloaded copy contains the created file',
        async () => {
          const file = reopened.bundle.files.find((entry) => entry.path === tasks)
          h.assert.ok(file, 'the saved bundle contains the created file')
          h.assert.equal(file.content, '')
          h.assert.equal(
            reopened.bundle.checkpoints.documents.some((entry) => entry.path === tasks),
            false,
            'creating a file is not a status change',
          )
          h.assert.deepEqual(requiredPaths(reopened.bundle), requiredPaths(h.bundle))
          const state = await readCheckpoints(reopened.page)
          h.assert.equal(docFor(state, tasks).exists, true)
          await reopened.page.locator('button.checkpoint-nav-item').click()
          await reopened.page
            .locator('section.checkpoint-view .checkpoint-graph')
            .waitFor({ state: 'visible' })
          h.assert.equal(
            await documentRow(reopened.page, tasks)
              .locator('button.checkpoint-document-status')
              .count(),
            1,
          )
          await writeState(h, 'checkpoints-files-create-missing', state)
        },
      )
    },
  },

  {
    id: 'checkpoints/instructions',
    feature,
    async run(h) {
      const { page } = h
      const plan = h.fixture.dataPaths.plan
      const spec = h.fixture.dataPaths.spec
      const instruction = h.fixture.instruction
      h.assert.ok(instruction, 'the fixture must carry a document instruction')

      await h.step(
        'checkpoints/instructions: choose the Instruction tab of a tracked document',
        async () => {
          await selectFile(page, plan)
          await openPanelTab(page, 'instruction')
          await page
            .locator('#taco-instruction-panel .instruction-body')
            .waitFor({ state: 'visible' })
          h.assert.equal(
            (await page.locator('#taco-instruction-panel .instruction-body').textContent()).trim(),
            instruction.trim(),
          )
          h.assert.equal(await page.locator('#taco-instruction-panel').isVisible(), true)
        },
      )
      await h.capture('checkpoints-instructions-plan')
      await writeState(h, 'checkpoints-instructions', {
        renderedInstruction: await page
          .locator('#taco-instruction-panel .instruction-body')
          .textContent(),
        graphInstruction: docFor(await readCheckpoints(page), plan)?.instruction,
      })

      await h.step(
        'checkpoints/instructions: a document without instructions keeps the tab out',
        async () => {
          await selectFile(page, spec)
          h.assert.equal(docFor(await readCheckpoints(page), spec)?.instruction, undefined)
          h.assert.equal(await page.locator('#taco-instruction-panel').isVisible(), false)
          h.assert.equal(
            await page
              .locator('.right-panel-tabs')
              .getByRole('tab', { name: 'Instruction', exact: true })
              .count(),
            0,
            'the Instruction tab is not offered for a document without an instruction',
          )
        },
      )
      await h.capture('checkpoints-instructions-spec')
    },
  },

  {
    id: 'checkpoints/missing:after-rename-delete',
    feature,
    async run(h) {
      const { page } = h
      const plan = h.fixture.dataPaths.plan
      const spec = h.fixture.dataPaths.spec
      const renamed = `${plan.slice(0, plan.lastIndexOf('/'))}/plan-renamed.md`
      const fileRow = (target, path) => target.locator(`button.file-row${attr('data-path', path)}`)
      // Checkpoint rows keep the Actions button as a sibling of the file-row button inside the row wrapper.
      const fileMenu = (target, path) =>
        target
          .locator(
            `div.checkpoint-file-row:has(button.file-row${attr('data-path', path)}) button.checkpoint-file-menu`,
          )
          .or(target.locator(`button.file-row${attr('data-path', path)} button.file-menu-btn`))
      const popoverAction = async (target, label) => {
        const menu = target.locator('.navigation-popover')
        await menu.waitFor({ state: 'visible' })
        await menu.getByRole('button', { name: label }).click()
        const dialog = target.locator('dialog.confirmation-dialog')
        await dialog.waitFor({ state: 'visible' })
        return dialog
      }

      await h.step(
        'checkpoints/missing:after-rename-delete: rename the required document through Actions',
        async () => {
          await selectFile(page, plan)
          await fileMenu(page, plan).click()
          const dialog = await popoverAction(page, 'Rename file')
          await dialog.locator('.prompt-dialog-input').fill('plan-renamed')
          await page.keyboard.press('Enter')
          await dialog.waitFor({ state: 'detached' })
          await selectFile(page, renamed)
          h.assert.equal(
            await fileRow(page, renamed).getAttribute('data-placeholder'),
            null,
            'the renamed file is a real file row',
          )
          h.assert.equal(
            await fileRow(page, plan).getAttribute('data-placeholder'),
            'true',
            'the original path is now a missing requirement',
          )
          h.assert.equal(
            await page.evaluate((path) => window.taco.readFile(path) === null, plan),
            true,
          )
          h.assert.equal(
            await page.evaluate((path) => window.taco.readFile(path) !== null, renamed),
            true,
          )
        },
      )
      await h.capture('checkpoints-missing-after-rename')

      await h.step(
        'checkpoints/missing:after-rename-delete: the required path stays a missing requirement',
        async () => {
          const state = await readCheckpoints(page)
          h.assert.ok(nodeFor(state, plan), 'the requirement keeps its original path')
          h.assert.equal(docFor(state, plan).exists, false)
          h.assert.equal(await fileRow(page, plan).getAttribute('data-placeholder'), 'true')
          await fileRow(page, plan).click()
          await page.locator('section.checkpoint-placeholder').waitFor({ state: 'visible' })
          h.assert.equal(await page.locator('.checkpoint-placeholder-path').innerText(), plan)
        },
      )
      await h.capture('checkpoints-missing-after-rename-placeholder')

      await h.step(
        'checkpoints/missing:after-rename-delete: delete another tracked document through Actions',
        async () => {
          await selectFile(page, spec)
          h.assert.equal(docFor(await readCheckpoints(page), spec).exists, true)
          await fileMenu(page, spec).click()
          const dialog = await popoverAction(page, 'Delete file')
          await dialog.locator('.confirmation-dialog-actions button.control-button-primary').click()
          await dialog.waitFor({ state: 'detached' })
          // Because spec was active and wasTracked, handleDeleteFile immediately selected the placeholder
          await page.locator('section.checkpoint-placeholder').waitFor({ state: 'visible' })
          h.assert.equal(await page.locator('.checkpoint-placeholder-path').innerText(), spec)
          h.assert.equal(
            await page.evaluate((path) => window.taco.readFile(path) === null, spec),
            true,
          )
          const state = await readCheckpoints(page)
          h.assert.equal(docFor(state, spec).exists, false)
          h.assert.ok(nodeFor(state, spec), 'the requirement node still holds the spec path')
          h.assert.equal(await fileRow(page, spec).getAttribute('data-placeholder'), 'true')
        },
      )
      await h.capture('checkpoints-missing-after-delete')

      const saved = await saveDownload(h, 'checkpoints-missing-rename-delete.taco.html')
      const reopened = await h.reopen(saved)
      await h.step(
        'checkpoints/missing:after-rename-delete: the downloaded copy keeps the original requirements',
        async () => {
          h.assert.deepEqual(
            requiredPaths(reopened.bundle),
            requiredPaths(h.bundle),
            'all required graph paths are preserved',
          )
          const paths = reopened.bundle.files.map((file) => file.path)
          h.assert.equal(
            paths.includes(plan),
            false,
            'renamed original path stays absent from files',
          )
          h.assert.equal(
            paths.includes(spec),
            false,
            'deleted tracked path stays absent from files',
          )
          h.assert.equal(paths.includes(renamed), true, 'renamed file is present in files')
          h.assert.equal(
            reopened.bundle.checkpoints.documents.some((entry) => entry.path === spec),
            false,
            'status record for deleted tracked file was removed',
          )
          h.assert.equal(
            reopened.bundle.checkpoints.documents.some((entry) => entry.path === plan),
            false,
            'status record for renamed tracked file was removed',
          )
          const state = await readCheckpoints(reopened.page)
          h.assert.equal(docFor(state, plan).exists, false)
          h.assert.equal(docFor(state, spec).exists, false)

          await reopened.page
            .locator(`button.checkpoint-file-select${attr('data-path', spec)}`)
            .click()
          await reopened.page
            .locator('section.checkpoint-placeholder')
            .waitFor({ state: 'visible' })
          h.assert.equal(
            await reopened.page.locator('.checkpoint-placeholder-path').innerText(),
            spec,
          )
          h.assert.equal(
            await reopened.page
              .locator(`button.checkpoint-file-select${attr('data-path', spec)}`)
              .getAttribute('data-placeholder'),
            'true',
          )

          await reopened.page
            .locator(`button.checkpoint-file-select${attr('data-path', plan)}`)
            .click()
          await reopened.page
            .locator('section.checkpoint-placeholder')
            .waitFor({ state: 'visible' })
          h.assert.equal(
            await reopened.page.locator('.checkpoint-placeholder-path').innerText(),
            plan,
          )
          h.assert.equal(
            await reopened.page
              .locator(`button.checkpoint-file-select${attr('data-path', plan)}`)
              .getAttribute('data-placeholder'),
            'true',
          )

          await writeState(h, 'checkpoints-missing-rename-delete', {
            filePaths: paths,
            requiredPaths: requiredPaths(reopened.bundle),
            checkpoints: state,
          })
        },
      )
      await h.capture('checkpoints-missing-after-reopen')
    },
  },
]
