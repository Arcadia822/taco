import { currentAuthorName, displayAuthorName, setAuthorName } from './identity.ts'
import { copy, type Locale } from './i18n.ts'
import { localId } from './local-id.ts'
import { bundleCanWrite, type TacoBundle, type TacoFile } from './model.ts'
import { canWriteInPlace, type SaveResult } from './kernel/save.ts'
import { storageGet } from './kernel/storage.ts'
import { saveEditorInvite, saveSealedReader, collabRole, isCollabOwner } from './sharing.ts'
import {
  onlineTransport,
  rotateKeys,
  sharingOn,
  startSharing,
  stopSharing,
  syncHost,
  type OnlineTransport,
} from './sync/online.ts'
import type { TacoPeer, TacoSyncSession } from './sync/session.ts'
import type { TacoStore } from './store.ts'
import { createControlButton, el, sidebarRow, type svgIcon } from './ui-primitives.ts'

interface MenuButtonOptions {
  active?: boolean
  icon?: Parameters<typeof svgIcon>[0]
  menuitem?: boolean
}

export interface ShareControllerOptions {
  bundle: TacoBundle
  store: TacoStore
  sync: TacoSyncSession
  getLocale: () => Locale
  openPopover: (anchor: HTMLElement, className: string) => HTMLElement
  menuButton: (label: string, action: () => void | Promise<void>, options?: MenuButtonOptions) => HTMLButtonElement
  selectFile: (file: TacoFile) => void
  paintPresence: () => void
  confirmDownload: (credentialBearing: boolean) => Promise<boolean>
  reportExport: (result: SaveResult) => void
  toast: (message: string) => void
}

export class ShareController {
  private button: HTMLButtonElement | null = null
  private menu: HTMLElement | null = null

  constructor(private readonly options: ShareControllerOptions) {}

  mount(button: HTMLButtonElement): void {
    this.button = button
    this.updateButtonStatus()
  }

  destroy(): void {
    this.menu?.remove()
    this.menu = null
    this.button = null
  }

  open(anchor: HTMLElement): void {
    const menu = this.options.openPopover(anchor, 'share-menu')
    menu.setAttribute('role', 'dialog')
    menu.setAttribute('aria-label', this.t.share)
    this.menu = menu
    this.render(menu)
  }

  refresh(): void {
    if (this.menu?.isConnected) this.render(this.menu)
  }

  wireOnlineStatus(transport: OnlineTransport | null): void {
    if (transport) transport.onStatus = () => {
      this.updateButtonStatus()
      this.refresh()
    }
    this.updateButtonStatus()
  }

  private get t() { return copy[this.options.getLocale()] }

  private render(menu: HTMLElement): void {
    menu.replaceChildren()
    const identity = el('div', 'collab-identity')
    const nameLabel = el('label', 'collab-name-label', this.t.yourName)
    const nameInput = el('input', 'collab-name-input') as HTMLInputElement
    const nameInputId = `taco-collab-name-${localId('field')}`
    nameLabel.htmlFor = nameInputId
    nameInput.id = nameInputId
    nameInput.name = 'displayName'
    nameInput.autocomplete = 'off'
    nameInput.type = 'text'
    nameInput.maxLength = 64
    nameInput.placeholder = this.t.guest
    nameInput.value = currentAuthorName()
    nameInput.title = this.t.nameHint
    nameInput.addEventListener('input', () => {
      const name = setAuthorName(nameInput.value)
      this.options.sync.setPresence({ name: name || this.t.guest })
      this.options.paintPresence()
    })
    identity.append(nameLabel, nameInput)
    menu.append(identity)

    const roleName = (role: ReturnType<typeof collabRole> | TacoPeer['role']): string => {
      if (role === 'owner') return this.t.owner
      if (role === 'editor') return this.t.editor
      if (role === 'viewer') return this.t.viewer
      if (role === 'offline-reader') return this.t.offlineReader
      return ''
    }
    const fingerprint = (pub?: string): string => pub ? `${pub.slice(0, 4)}·${pub.slice(4, 8)}·${pub.slice(8, 12)}` : ''
    const collab = this.options.bundle.collab
    const peers = this.options.sync.collaborators()
    if (collab || peers.length || this.options.bundle.access === 'reader') {
      menu.append(el('div', 'share-section-label', this.t.people))
      const people = el('div', 'share-people')
      const myRole = collabRole(this.options.bundle)
      const myPub = myRole === 'owner' ? collab?.owner : storageGet(`taco-member-${this.options.bundle.docId}`)
      let memberPub = myPub ?? undefined
      if (myRole === 'editor' && myPub?.startsWith('{')) {
        try { memberPub = (JSON.parse(myPub) as { pub?: string }).pub } catch { memberPub = undefined }
      }
      const meDot = el('span', 'share-person-dot')
      meDot.style.backgroundColor = this.options.sync.color
      const me = sidebarRow('div', {
        className: 'share-person is-me',
        leading: meDot,
        label: `${displayAuthorName()} (${this.t.you})`,
        labelClass: 'share-person-main',
        trailing: el('span', 'share-person-meta', [roleName(myRole), fingerprint(memberPub)].filter(Boolean).join(' · ')),
      })
      people.append(me)
      for (const peer of peers) {
        const row = el('div', 'share-person')
        const dot = el('span', 'share-person-dot')
        dot.style.backgroundColor = peer.color
        const follow = sidebarRow('button', {
          className: 'share-person-follow',
          leading: dot,
          label: peer.name,
          labelClass: 'share-person-main',
          trailing: el('span', 'share-person-meta', [roleName(peer.role), fingerprint(peer.pub)].filter(Boolean).join(' · ')),
        }) as HTMLButtonElement
        follow.type = 'button'
        follow.title = peer.name
        follow.addEventListener('click', () => {
          const file = this.options.bundle.files.find((candidate) => candidate.id === peer.fileId)
          if (file) this.options.selectFile(file)
        })
        row.append(follow)
        if (isCollabOwner(this.options.bundle) && peer.pub && peer.pub !== collab?.owner) {
          row.append(createControlButton('x', this.t.removeMember(peer.name), () => void this.removeCollaborator(peer), 'share-person-remove'))
        }
        people.append(row)
      }
      menu.append(people)
    }

    const transport = onlineTransport(this.options.sync)
    const status = el('div', 'share-live-status')
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    if (sharingOn(this.options.store) && transport?.status === 'open') {
      status.classList.add('is-live')
      status.textContent = `● ${this.t.live} — ${this.t.connected(peers.length + 1)}`
    } else if (sharingOn(this.options.store)) {
      status.classList.add('is-connecting')
      status.textContent = `● ${this.t.connecting}`
    } else {
      status.textContent = `○ ${this.t.notLive}`
    }
    menu.append(status)

    if (bundleCanWrite(this.options.bundle)) {
      menu.append(el('div', 'share-section-label', this.t.shareCopy))
      menu.append(
        this.options.menuButton(this.t.inviteEdit, () => { void this.saveSharedVariant('editor') }, { icon: 'share', menuitem: false }),
        this.options.menuButton(this.t.readOnlyCopy, () => { void this.saveSharedVariant('sealed') }, { icon: 'presentation', menuitem: false }),
      )
      menu.append(el('div', 'share-separator'))
      menu.append(this.options.menuButton(sharingOn(this.options.store) ? this.t.stopSharing : this.t.goLive, async () => {
        if (sharingOn(this.options.store)) {
          stopSharing(this.options.sync, this.options.store)
          this.wireOnlineStatus(null)
        } else await this.goLive()
        this.render(menu)
      }, { icon: sharingOn(this.options.store) ? 'square' : 'radio', menuitem: false }))
      menu.append(this.options.menuButton(this.t.resetAccess, async () => {
        if (!window.confirm(this.t.resetConfirm)) return
        try {
          this.options.sync.enable()
          await rotateKeys(this.options.sync, this.options.store)
          await this.goLive()
          this.options.toast(this.t.resetDone)
          this.render(menu)
        } catch {
          this.options.toast(this.t.sharingFailed)
        }
      }, { icon: 'key', menuitem: false }))
    } else {
      menu.append(el('p', 'share-readonly-note', this.options.bundle.access === 'reader' ? this.t.offlineReadonlyNotice : this.t.readonlyNotice))
    }
    this.updateButtonStatus()
  }

  private async goLive(): Promise<OnlineTransport | null> {
    if (!this.options.bundle.collab?.room && !syncHost()) {
      this.options.toast(this.t.sharingUnavailable)
      return null
    }
    try {
      this.options.sync.enable()
      const transport = await startSharing(this.options.sync, this.options.store)
      this.wireOnlineStatus(transport)
      return transport
    } catch {
      this.options.toast(this.t.sharingFailed)
      return null
    }
  }

  private updateButtonStatus(): void {
    if (!this.button) return
    const transport = onlineTransport(this.options.sync)
    this.button.classList.toggle('is-live', transport?.status === 'open')
    this.button.classList.toggle('is-connecting', Boolean(sharingOn(this.options.store) && transport?.status !== 'open'))
  }

  private async saveSharedVariant(kind: 'editor' | 'sealed'): Promise<void> {
    try {
      if (!canWriteInPlace() && !await this.options.confirmDownload(kind === 'editor')) return
      if (kind === 'editor') {
        const transport = await this.goLive()
        if (!transport) return
        this.options.sync.stampInto(this.options.bundle)
      }
      const result = kind === 'editor'
        ? await saveEditorInvite(this.options.bundle)
        : await saveSealedReader(this.options.bundle)
      this.options.reportExport(result)
    } catch (error) {
      if (kind === 'editor' && !isCollabOwner(this.options.bundle) && !this.options.bundle.collab?.invite) {
        this.options.toast(this.t.ownerInviteOnly)
      } else this.options.toast(error instanceof Error ? error.message : this.t.saveFailed)
    }
  }

  private async removeCollaborator(peer: TacoPeer): Promise<void> {
    if (!peer.pub || !this.options.bundle.collab?.owner || !this.options.bundle.collab.ownerPriv) return
    if (!window.confirm(this.t.removeConfirm(peer.name))) return
    const removed = await onlineTransport(this.options.sync)?.revokeKey(
      peer.pub,
      this.options.bundle.collab.owner,
      this.options.bundle.collab.ownerPriv,
    )
    this.options.toast(removed ? this.t.memberRemoved(peer.name) : this.t.sharingFailed)
  }
}
