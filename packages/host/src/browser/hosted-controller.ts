import {
  HOST_HARNESS_ICONS,
  HOST_MODEL_ICONS,
  readHostCapability,
  type HostCapability,
} from './host-capability.ts'
import {
  HostClient,
  type HostListener,
  type HostListenerSnapshot,
} from './host-client.ts'
import {
  HostedSession,
  type HostedHandoffOutcome,
  type HostedStatus,
} from './hosted-session.ts'
import { hostCopy, type HostCopy } from './hosted-i18n.ts'
import { HOSTED_STYLES } from './hosted-styles.ts'
import {
  createControlButton,
  el,
  setButtonIcon,
  showPromptDialog,
  sidebarRow,
  svgIcon,
} from '../../../../src/ui-primitives.ts'
import { currentAuthorName, setAuthorName } from '../../../../src/identity.ts'
import type { FileBrowser } from '../../../../src/file-browser.ts'
import type { TacoFileApi } from '../../../../src/main-common.ts'

export class HostedBrowserController {
  private readonly client: HostClient
  readonly session: HostedSession
  private status: HostedStatus | null = null
  private listeners: HostListenerSnapshot | null = null
  private statusButton: HTMLButtonElement | null = null
  private authorButton: HTMLButtonElement | null = null
  private listenersButton: HTMLButtonElement | null = null
  private readonly removeControls: Array<() => void> = []
  private destroyed = false

  constructor(
    private readonly browser: FileBrowser,
    readonly capability: HostCapability,
  ) {
    this.ensureStyles()

    this.client = new HostClient(capability)
    this.session = new HostedSession({
      client: this.client,
      bridge: {
        bundle: browser.currentBundle,
        author: () => currentAuthorName() || this.t.guest,
        onStatus: (status) => this.renderStatus(status),
        adoptContent: (content) => browser.adoptBundleContent(content),
        adoptListeners: (snapshot) => this.renderListeners(snapshot),
      },
    })

    // Structure locked in hosted review mode
    browser.setStructureLocked(true, this.t.hostSharedField)
    browser.setPrimaryHandoffHandler(async () => this.primaryHandoff(), this.t.hostHandoffTooltip)
    browser.setDurableCommentsOnlyCheck(() => this.session.currentStatus.readiness !== 'unsupported')
    browser.setPendingWritesCheck(() => this.session.hasPendingWrites())

    const unsubDoc = browser.onDocumentChange((kind) => {
      if (kind === 'comments') this.session.markCommentsChanged()
      else this.session.markContentChanged()
    })
    this.removeControls.push(unsubDoc)

    const unsubLocale = browser.onLocaleChange(() => {
      this.handleLocaleChange()
    })
    this.removeControls.push(unsubLocale)

    const unsubDestruct = browser.onDestruct(() => {
      this.destroy()
    })
    this.removeControls.push(unsubDestruct)

    this.mountHeaderControls()
    void this.session.start()
  }

  private get t(): HostCopy {
    return hostCopy(this.browser.currentLocale)
  }

  private ensureStyles(): void {
    if (typeof document === 'undefined') return
    const id = 'taco-host-styles'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = HOSTED_STYLES
    document.head.appendChild(style)
  }

  private mountHeaderControls(): void {
    this.statusButton = createControlButton('check', this.t.hostStatus, () => this.openStatusMenu(), 'host-status-button', true)
    this.authorButton = createControlButton('user', this.t.hostAuthor, () => { void this.promptAuthor() }, 'host-author-button', true)
    this.listenersButton = createControlButton('users', this.t.hostListeners, () => { void this.openListenersMenu() }, 'host-listeners-button', true)

    this.removeControls.push(this.browser.addHeaderControl(this.statusButton))
    this.removeControls.push(this.browser.addHeaderControl(this.authorButton))
    this.removeControls.push(this.browser.addHeaderControl(this.listenersButton))

    this.syncAuthorButton()
    this.syncStatusButton()
  }

  private handleLocaleChange(): void {
    this.browser.setStructureLocked(true, this.t.hostSharedField)
    this.browser.setCopyButtonTitle(this.t.hostHandoffTooltip)
    this.syncStatusButton()
    this.syncAuthorButton()
    if (this.listeners) this.renderListeners(this.listeners)
  }

  private renderStatus(status: HostedStatus): void {
    if (this.destroyed) return
    const wasConflict = this.status?.save === 'conflict'
    this.status = status
    if (status.readiness === 'unsupported') {
      // No Host baseline after all: behave exactly like the plain reader page.
      this.browser.currentBundle.access = 'reader'
      this.browser.setStructureLocked(false)
      this.browser.setPrimaryHandoffHandler(null)
      this.destroyControlsOnly()
      this.browser.rebuild()
      return
    }
    if (status.save === 'conflict' && !wasConflict) {
      this.browser.toast(this.t.hostConflictNotice)
    }
    this.syncStatusButton()
  }

  private statusLabel(status: HostedStatus): string {
    if (status.readiness === 'loading') return this.t.hostConnecting
    if (status.readiness === 'failed') return this.t.saveFailed
    if (status.save === 'conflict') return this.t.hostConflict
    if (status.save === 'error') return this.t.saveFailed
    if (status.comments === 'error') return this.t.hostCommentsError
    if (status.save === 'saving') return this.t.hostSaving
    if (status.comments === 'pending') return this.t.hostCommentsPending
    if (status.save === 'dirty') return this.t.unsaved
    return this.t.hostSaved
  }

  private syncStatusButton(): void {
    const button = this.statusButton
    const status = this.status
    if (!button || !status) return
    const label = this.statusLabel(status)
    const troubled = status.readiness === 'failed'
      || status.save === 'error' || status.save === 'conflict' || status.comments === 'error'
    const busy = status.readiness === 'loading' || status.save === 'saving' || status.comments === 'pending'
    const labelNode = button.querySelector('.button-label')
    if (labelNode) labelNode.textContent = label
    button.title = label
    button.setAttribute('aria-label', `${this.t.hostStatus}: ${label}`)
    button.classList.toggle('is-trouble', troubled)
    setButtonIcon(button, troubled ? 'alert' : busy ? 'save' : 'check')
  }

  private syncAuthorButton(): void {
    const button = this.authorButton
    if (!button) return
    const name = currentAuthorName() || this.t.hostAuthorUnset
    const labelNode = button.querySelector('.button-label')
    if (labelNode) labelNode.textContent = name
    button.title = `${this.t.hostAuthor}: ${name}. ${this.t.hostAuthorHint}`
    button.setAttribute('aria-label', `${this.t.hostAuthor}: ${name}`)
  }

  private async promptAuthor(): Promise<void> {
    const next = await showPromptDialog({
      title: this.t.hostAuthor,
      placeholder: this.t.hostAuthorUnset,
      initialValue: currentAuthorName(),
      confirmLabel: this.t.save,
      cancelLabel: this.t.cancel,
    })
    if (next === null) return
    setAuthorName(next)
    this.syncAuthorButton()
  }

  private openStatusMenu(): void {
    const status = this.status
    const button = this.statusButton
    if (!status || !button) return
    if (status.save === 'conflict') {
      const menu = this.browser.openPopover(button, 'host-status-menu')
      menu.append(this.browser.menuButton(this.t.hostLoadLatest, () => {
        menu.remove()
        void this.session.discardLocalDraft()
      }, { icon: 'chevron-down' }))
      return
    }
    if (status.readiness === 'failed' || status.save === 'error' || status.comments === 'error') {
      const menu = this.browser.openPopover(button, 'host-status-menu')
      menu.append(this.browser.menuButton(this.t.hostRetry, () => {
        menu.remove()
        this.session.retry()
      }, { icon: 'save' }))
      return
    }
    this.browser.toast(`${this.statusLabel(status)}${status.detail ? ` · ${status.detail}` : ''}`)
  }

  private async openListenersMenu(): Promise<void> {
    const button = this.listenersButton
    if (!button) return
    const menu = this.browser.openPopover(button, 'host-listeners-menu')
    menu.setAttribute('role', 'group')
    menu.setAttribute('aria-live', 'polite')
    this.fillListenersMenu(menu)
    await this.session.refreshListeners()
  }

  private fillListenersMenu(menu: HTMLElement): void {
    menu.replaceChildren()
    const snapshot = this.listeners
    menu.append(el('h3', 'host-listeners-heading', this.t.hostListeners))
    if (!snapshot || snapshot.listeners.length === 0) {
      menu.append(el('p', 'host-listeners-empty', this.t.hostListenersNone))
    } else {
      for (const listener of snapshot.listeners) menu.append(this.buildListenerRow(listener))
      menu.append(el('p', 'host-listeners-time', this.t.hostListenersObservedAt(this.formatListenerTime(snapshot.observedAt))))
    }
    menu.append(el('p', 'host-listeners-note', this.t.hostListenerNote))
  }

  private formatListenerTime(iso: string): string {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return iso
    return date.toLocaleTimeString(this.browser.currentLocale === 'zh-Hans' ? 'zh-CN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  }

  private buildListenerRow(listener: HostListener): HTMLElement {
    const harnessIcon = svgIcon(HOST_HARNESS_ICONS[listener.harness ?? ''] ?? 'monitor')
    const modelIcon = svgIcon(HOST_MODEL_ICONS[listener.model ?? ''] ?? 'monitor')
    const meta = el('span', 'host-listener-meta')
    const modelSlot = el('span', 'host-listener-model')
    modelSlot.setAttribute('aria-hidden', 'true')
    modelSlot.append(modelIcon)
    const modelName = listener.modelId || listener.model
    if (modelName) meta.append(el('span', 'host-listener-model-name', modelName))
    meta.append(modelSlot)
    meta.append(el('span', 'host-listener-seen', this.t.hostListenerLastSeen(this.formatListenerTime(listener.lastSeenAt))))
    const row = sidebarRow('div', {
      className: 'host-listener-row',
      leading: harnessIcon,
      label: listener.name || this.t.hostListenerAnonymous,
      labelClass: 'host-listener-name',
      trailing: meta,
    })
    row.title = listener.harness ? `${listener.harness}${listener.model ? ` · ${listener.model}` : ''}` : this.t.hostListenerAnonymous
    return row
  }

  private renderListeners(snapshot: HostListenerSnapshot): void {
    this.listeners = snapshot
    const open = document.querySelector<HTMLElement>('.host-listeners-menu')
    if (open) this.fillListenersMenu(open)
    const button = this.listenersButton
    if (!button) return
    const count = snapshot.listeners.length
    const labelNode = button.querySelector('.button-label')
    if (labelNode) labelNode.textContent = count > 0 ? `${this.t.hostListeners} ${count}` : this.t.hostListeners
  }

  async primaryHandoff(): Promise<void> {
    await this.session.start()
    if (this.session.currentStatus.readiness === 'unsupported') {
      await this.browser.copyReviewFull()
      return
    }
    if (this.session.busy) {
      this.browser.toast(this.t.hostHandoffBusy)
      return
    }
    const outcome = await this.session.handoff()
    if (outcome.kind === 'done') this.browser.toast(this.t.hostHandoffDone)
    else if (outcome.kind === 'no-change') this.browser.toast(this.t.hostHandoffNoChange)
    else if (outcome.kind === 'conflict') this.browser.toast(this.t.hostHandoffConflict)
    else if (outcome.kind === 'unsupported') this.browser.toast(this.t.hostHandoffUnsupported)
    else if (outcome.kind === 'failed') this.browser.toast(this.t.hostHandoffFailed(outcome.detail))
    else if (outcome.save === 'saving') this.browser.toast(this.t.hostHandoffBusy)
    else if (outcome.save === 'error') this.browser.toast(this.t.hostSaveErrorNotice)
    else this.browser.toast(this.t.hostHandoffBlocked)
  }

  hostedInfo(): { tacoId: string; apiBase: string } | null {
    return { ...this.capability }
  }

  async handoffViaHost(): Promise<HostedHandoffOutcome> {
    await this.session.start()
    if (this.session.currentStatus.readiness === 'unsupported') return { kind: 'unsupported' }
    return this.session.handoff()
  }

  private destroyControlsOnly(): void {
    for (const remove of this.removeControls) remove()
    this.removeControls.length = 0
    this.statusButton = null
    this.authorButton = null
    this.listenersButton = null
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.destroyControlsOnly()
    this.session.destroy()
  }
}

export function attachHostedSession(browser: FileBrowser, api?: TacoFileApi): HostedBrowserController | null {
  const capability = readHostCapability()
  if (!capability) return null
  const controller = new HostedBrowserController(browser, capability)
  if (api) {
    api.hosted = () => controller.hostedInfo()
    api.handoff = () => controller.handoffViaHost()
  }
  return controller
}
