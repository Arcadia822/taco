import {
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
import { harnessLogo } from './harness-logos.ts'
import {
  createControlButton,
  el,
  setButtonIcon,
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
    browser.setPrimaryHandoffHandler(async () => this.primaryHandoff(), this.t.hostHandoffTooltip, 'bot-handoff', this.t.hostHandoffCommand)
    browser.setCopyReviewMenuCustomizer((menu, defaultItems) => this.customizeHandoffMenu(menu, defaultItems))
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
    // Only mount presence button (icon-only, ghost style, positioned right before Handoff group)
    this.presenceButton = createControlButton('users', this.t.hostPresence, () => { void this.openPresenceMenu() }, 'host-presence-button')

    this.removeControls.push(this.browser.addHeaderControl(this.presenceButton, 'right'))

    this.syncPresenceButton()
  }

  private handleLocaleChange(): void {
    this.browser.setStructureLocked(true, this.t.hostSharedField)
    this.browser.setPrimaryHandoffHandler(async () => this.primaryHandoff(), this.t.hostHandoffTooltip, 'bot-handoff', this.t.hostHandoffCommand)
    this.syncPresenceButton()
  }

  private renderStatus(status: HostedStatus): void {
    if (this.destroyed) return
    const wasConflict = this.status?.save === 'conflict'
    const wasError = this.status?.save === 'error'
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
    if (status.save === 'error' && !wasError) {
      this.browser.toast(this.t.hostSaveErrorNotice)
    }
  }



  private syncPresenceButton(): void {
    const button = this.presenceButton
    if (!button) return
    const count = this.listeners?.listeners.length ?? 0
    const name = currentAuthorName() || this.t.guest
    button.title = `${this.t.hostPresence}: ${name}${count > 0 ? ` · ${count} ${this.t.hostActiveAgents}` : ''}`
    button.setAttribute('aria-label', button.title)
    setButtonIcon(button, count > 0 ? 'users' : 'user')
    button.querySelector('.host-listener-badge')?.remove()
    if (count > 0) {
      const badge = el('span', 'host-listener-badge', String(count))
      badge.setAttribute('aria-hidden', 'true')
      button.append(badge)
    }
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

  private editAuthor(row: HTMLElement): void {
    const name = row.querySelector<HTMLElement>('.host-member-name')
    if (!name || name.isContentEditable) return
    const previous = currentAuthorName()
    name.contentEditable = 'plaintext-only'
    name.setAttribute('role', 'textbox')
    name.setAttribute('aria-label', this.t.hostEditName)
    name.textContent = previous
    let finished = false
    const finish = (commit: boolean): void => {
      if (finished) return
      finished = true
      if (commit) setAuthorName((name.textContent ?? '').trim().slice(0, 64))
      name.contentEditable = 'false'
      name.removeEventListener('blur', onBlur)
      name.removeEventListener('keydown', onKey)
      this.syncPresenceButton()
      const menu = row.closest<HTMLElement>('.host-presence-menu')
      if (menu) this.fillPresenceMenu(menu)
    }
    const onBlur = (): void => finish(true)
    const onKey = (event: KeyboardEvent): void => {
      if (event.isComposing) return
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finish(event.key === 'Enter')
      }
    }
    name.addEventListener('blur', onBlur)
    name.addEventListener('keydown', onKey)
    name.focus()
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(name)
    selection?.removeAllRanges()
    selection?.addRange(range)
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

    // Section 1: Humans (人类)
    const humanSection = el('div', 'host-presence-section')
    humanSection.append(el('h3', 'host-presence-heading', this.t.hostActiveHumans))

    const avatar = el('span', 'host-avatar', currentName.charAt(0) || 'U')
    avatar.style.backgroundColor = this.hashColor(currentName)

    const editBtn = el('button', 'host-edit-name-btn') as HTMLButtonElement
    editBtn.type = 'button'
    editBtn.title = this.t.hostEditName
    editBtn.setAttribute('aria-label', this.t.hostEditName)
    editBtn.append(svgIcon('edit'))
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.editAuthor(humanRow)
    })

    const humanRow = sidebarRow('div', {
      className: 'host-member-row host-member-human', leading: avatar,
      label: currentName, labelClass: 'host-member-name', trailing: editBtn,
    })
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
  }

  private buildAgentRow(listener: HostListener): HTMLElement {
    const logo = harnessLogo(listener.harness)

    const infoTrigger = el('button', 'host-info-trigger') as HTMLButtonElement
    infoTrigger.type = 'button'
    infoTrigger.setAttribute('aria-label', this.t.hostListenerDetails)
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
    addCardRow(this.t.hostNameLabel, listener.name)
    addCardRow(this.t.hostSessionTitle, listener.sessionTitle)
    if (listener.connectedAt) addCardRow(this.t.hostStartedListening, this.formatListenerTime(listener.connectedAt))

    infoTrigger.append(card)
    const row = sidebarRow('div', {
      className: 'host-member-row host-member-agent', leading: logo,
      label: listener.name || this.t.hostListenerAnonymous, labelClass: 'host-member-name', trailing: infoTrigger,
    })
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
    if (open && !open.querySelector('[contenteditable="plaintext-only"]')) this.fillPresenceMenu(open)
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
