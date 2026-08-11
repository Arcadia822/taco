import { fileKind, type TacoFile } from './model.ts'
import { el } from './ui-primitives.ts'

export interface OutlineControllerOptions {
  getViewer: () => HTMLElement
  getSelected: () => TacoFile | null
  getNoHeadingsLabel: () => string
  onSelectHeading: (file: TacoFile, headingId: string) => void
  onVisibilityChange: () => void
}

export class OutlineController {
  private list: HTMLElement | null = null
  private frame = 0

  constructor(private readonly options: OutlineControllerOptions) {}

  mount(list: HTMLElement): void {
    this.list = list
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
    this.list = null
  }

  paint(): void {
    if (!this.list) return
    this.list.replaceChildren()
    const selected = this.options.getSelected()
    if (!selected || fileKind(selected) !== 'markdown') {
      this.options.onVisibilityChange()
      return
    }
    const headings = this.headings()
    const occurrences = new Map<string, number>()
    if (!headings.length) {
      this.list.append(el('p', 'outline-empty', this.options.getNoHeadingsLabel()))
      this.options.onVisibilityChange()
      return
    }
    const list = el('ol', 'outline-list')
    for (const heading of headings) {
      const base = this.headingSlug(heading.textContent ?? '')
      const occurrence = occurrences.get(base) ?? 0
      occurrences.set(base, occurrence + 1)
      const id = occurrence ? `${base}-${occurrence + 1}` : base
      const item = el('li', `outline-item outline-level-${heading.tagName.slice(1)}`)
      const link = el('button', 'outline-link', heading.textContent?.trim() || this.options.getNoHeadingsLabel()) as HTMLButtonElement
      link.type = 'button'
      link.dataset.headingId = id
      link.addEventListener('click', () => {
        this.scrollToHeading(id, 'smooth')
        this.options.onSelectHeading(selected, id)
        this.markActive(id)
      })
      item.append(link)
      list.append(item)
    }
    this.list.append(list)
    this.options.onVisibilityChange()
    this.scheduleActive()
  }

  scheduleActive(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.updateActive()
    })
  }

  scrollToHeading(id: string, behavior: ScrollBehavior): void {
    const heading = this.findVisibleHeading(id)
    if (!heading) return
    const viewer = this.options.getViewer()
    const viewerTop = viewer.getBoundingClientRect().top
    const targetTop = Math.max(0, viewer.scrollTop + heading.getBoundingClientRect().top - viewerTop - 8)
    viewer.scrollTo({ top: targetTop, behavior })
  }

  private headings(): HTMLElement[] {
    return Array.from(this.options.getViewer().querySelectorAll<HTMLElement>('.tiptap h1, .tiptap h2, .tiptap h3'))
  }

  private findVisibleHeading(id: string): HTMLElement | null {
    const outlineIndex = Array.from(this.list?.querySelectorAll<HTMLButtonElement>('.outline-link') ?? [])
      .findIndex((link) => link.dataset.headingId === id)
    const outlineHeading = outlineIndex >= 0 ? this.headings()[outlineIndex] : undefined
    if (outlineHeading) return outlineHeading
    const viewer = this.options.getViewer()
    const candidates = Array.from(viewer.querySelectorAll<HTMLElement>('[id]'))
      .filter((candidate) => candidate.id === id)
    const visibleCandidate = candidates.find((candidate) => {
      const rect = candidate.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    if (visibleCandidate) return visibleCandidate

    const normalizedId = decodeURIComponent(id).replace(/^#/, '').toLocaleLowerCase()
    const heading = this.headings()
      .find((candidate) => candidate.textContent?.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') === normalizedId)
    return candidates.find((candidate) => !candidate.closest('[hidden]')) ?? candidates.at(-1) ?? heading ?? null
  }

  private headingSlug(text: string): string {
    return text.trim().toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  }

  private updateActive(): void {
    if (!this.list || this.list.hidden) return
    const headings = this.headings()
    const links = Array.from(this.list.querySelectorAll<HTMLButtonElement>('.outline-link'))
    if (!headings.length) return
    const viewerTop = this.options.getViewer().getBoundingClientRect().top + 24
    let activeIndex = 0
    for (const [index, heading] of headings.entries()) {
      if (heading.getBoundingClientRect().top > viewerTop) break
      activeIndex = index
    }
    const activeId = links[activeIndex]?.dataset.headingId
    if (activeId) this.markActive(activeId)
  }

  private markActive(id: string): void {
    if (!this.list) return
    for (const link of this.list.querySelectorAll<HTMLButtonElement>('.outline-link')) {
      const active = link.dataset.headingId === id
      link.classList.toggle('is-active', active)
      if (active) link.setAttribute('aria-current', 'location')
      else link.removeAttribute('aria-current')
    }
  }
}
