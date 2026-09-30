import {
  HOST_HARNESS_ICONS,
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
  private presenceButton: HTMLButtonElement | null = null
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
    browser.setCopyReviewMenuCustomizer((menu, defaultItems) => this.customizeHandoffMenu(menu, defaultItems))
    browser.setDurableCommentsOnlyCheck(() => this.session.currentStatus.readiness !== 'unsupported')
    browser.setPendingWritesCheck(() => this.session.hasPendingWrites())
    if (typeof document !== 'undefined') {
      document.querySelector('.file-workspace')?.classList.add('is-hosted')
    }
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
    this.statusButton = createControlButton('check', this.t.hostStatus, () => this.openStatusMenu(), 'host-status-button', true, false)
    this.presenceButton = createControlButton('users', this.t.hostPresence, () => { void this.openPresenceMenu() }, 'host-presence-button', true, false)

    this.removeControls.push(this.browser.addHeaderControl(this.statusButton))
    this.removeControls.push(this.browser.addHeaderControl(this.presenceButton))

    this.syncPresenceButton()
    this.syncStatusButton()
  }

  private handleLocaleChange(): void {
    this.browser.setStructureLocked(true, this.t.hostSharedField)
    this.browser.setCopyButtonTitle(this.t.hostHandoffTooltip)
    this.syncStatusButton()
    this.syncPresenceButton()
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

  private syncPresenceButton(): void {
    const button = this.presenceButton
    if (!button) return
    const count = this.listeners?.listeners.length ?? 0
    const name = currentAuthorName() || this.t.guest
    const label = count > 0 ? `${name} (${count})` : name
    const labelNode = button.querySelector('.button-label')
    if (labelNode) labelNode.textContent = label
    button.title = `${this.t.hostPresence}: ${name}${count > 0 ? ` · ${count} agent(s)` : ''}`
    button.setAttribute('aria-label', button.title)
    setButtonIcon(button, count > 0 ? 'users' : 'user')
  }

  private hashColor(name: string): string {
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
    const hue = Math.abs(hash % 360)
    return `hsl(${hue}, 65%, 45%)`
  }

  private customizeHandoffMenu(menu: HTMLElement, defaultItems: HTMLElement[]): void {
    // 1. Tacobin handoff action with robot + right arrow icon
    const handoffBtn = this.browser.menuButton(
      this.t.hostHandoffCommand,
      () => {
        menu.remove()
        void this.primaryHandoff()
      },
      { icon: 'bot-handoff', menuitem: false },
    )
    handoffBtn.classList.add('is-primary-handoff')
    menu.append(handoffBtn)

    // Divider separating Tacobin action from legacy/manual actions
    const divider = el('div', 'topbar-popover-divider')
    menu.append(divider)

    // Default items (Manual handoff + inspect prompt)
    menu.append(...defaultItems)
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
    this.syncPresenceButton()
    const openMenu = document.querySelector<HTMLElement>('.host-presence-menu')
    if (openMenu) this.fillPresenceMenu(openMenu)
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

  private async openPresenceMenu(): Promise<void> {
    const button = this.presenceButton
    if (!button) return
    const menu = this.browser.openPopover(button, 'host-presence-menu')
    menu.setAttribute('role', 'group')
    menu.setAttribute('aria-live', 'polite')
    this.fillPresenceMenu(menu)
    await this.session.refreshListeners()
  }

  private fillPresenceMenu(menu: HTMLElement): void {
    menu.replaceChildren()
    const currentName = currentAuthorName() || this.t.guest

    // Section 1: Active Reviewers (Human)
    const humanSection = el('div', 'host-presence-section')
    humanSection.append(el('h3', 'host-presence-heading', this.t.hostActiveHumans))

    const humanRow = el('div', 'host-member-row host-member-human')
    const humanMain = el('div', 'host-member-main')
    const avatar = el('span', 'host-avatar', currentName.charAt(0) || 'U')
    avatar.style.backgroundColor = this.hashColor(currentName)
    const nameSpan = el('span', 'host-member-name', currentName)
    humanMain.append(avatar, nameSpan)

    const editBtn = el('button', 'host-edit-name-btn') as HTMLButtonElement
    editBtn.type = 'button'
    editBtn.title = this.t.hostEditName
    editBtn.append(svgIcon('edit'))
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      void this.promptAuthor()
    })

    humanRow.append(humanMain, editBtn)
    humanSection.append(humanRow)
    menu.append(humanSection)

    // Divider
    menu.append(el('div', 'host-presence-divider'))

    // Section 2: Listening Agents
    const agentSection = el('div', 'host-presence-section')
    agentSection.append(el('h3', 'host-presence-heading', this.t.hostActiveAgents))

    const snapshot = this.listeners
    if (!snapshot || snapshot.listeners.length === 0) {
      agentSection.append(el('p', 'host-presence-empty', this.t.hostListenersNone))
    } else {
      for (const listener of snapshot.listeners) {
        agentSection.append(this.buildAgentRow(listener))
      }
    }
    menu.append(agentSection)
    menu.append(el('p', 'host-presence-note', this.t.hostListenerNote))
  }

  private buildAgentRow(listener: HostListener): HTMLElement {
    const row = el('div', 'host-member-row host-member-agent')
    const main = el('div', 'host-member-main')

    const harnessIconName = HOST_HARNESS_ICONS[listener.harness ?? ''] ?? 'bot'
    const iconWrapper = el('span', 'host-agent-icon')
    iconWrapper.append(svgIcon(harnessIconName))

    const name = el('span', 'host-member-name', listener.name || this.t.hostListenerAnonymous)
    main.append(iconWrapper, name)

    // Info trigger with hover card
    const infoTrigger = el('button', 'host-info-trigger') as HTMLButtonElement
    infoTrigger.type = 'button'
    infoTrigger.append(svgIcon('info'))

    const card = el('div', 'host-info-card')
    const addCardRow = (label: string, value: string | undefined) => {
      if (!value) return
      const r = el('div', 'host-info-card-row')
      r.append(el('span', 'host-info-card-label', label), el('span', 'host-info-card-value', value))
      card.append(r)
    }

    addCardRow(this.t.hostHarnessLabel, listener.harness)
    addCardRow(this.t.hostModelLabel, listener.modelId || listener.model)
    addCardRow('Name', listener.name)
    addCardRow(this.t.hostStartedListening, this.formatListenerTime(listener.lastSeenAt))

    infoTrigger.append(card)
    row.append(main, infoTrigger)
    return row
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
  private renderListeners(snapshot: HostListenerSnapshot): void {
    this.listeners = snapshot
    const open = document.querySelector<HTMLElement>('.host-presence-menu')
    if (open) this.fillPresenceMenu(open)
    this.syncPresenceButton()
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
    this.presenceButton = null
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
