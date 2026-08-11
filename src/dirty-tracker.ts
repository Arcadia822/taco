import type { StoreChange } from './store.ts'
import type { TacoBundle, TacoFile } from './model.ts'

const documentSignature = (bundle: TacoBundle): string => {
  const { files: _files, comments: _comments, collab: _collab, ...document } = bundle
  return JSON.stringify(document)
}

const fileSignature = (file: TacoFile): string => {
  const { blocks: _blocks, ...canonical } = file
  return JSON.stringify(canonical)
}

const commentsSignature = (bundle: TacoBundle): string => JSON.stringify(bundle.comments ?? [])

export class BundleDirtyTracker {
  private savedDocument = ''
  private savedFiles = new Map<string, string>()
  private savedComments = ''
  private documentDirty = false
  private dirtyFiles = new Set<string>()
  private commentsDirty = false

  constructor(private readonly bundle: TacoBundle) {
    this.markSaved()
  }

  isDirty(): boolean {
    return this.documentDirty || this.commentsDirty || this.dirtyFiles.size > 0
  }

  note(change: StoreChange): void {
    if (change.kind === 'all') {
      this.documentDirty = documentSignature(this.bundle) !== this.savedDocument
      this.commentsDirty = commentsSignature(this.bundle) !== this.savedComments
      this.dirtyFiles.clear()
      for (const file of this.bundle.files) this.compareFile(file)
      return
    }
    if (change.kind === 'document') {
      this.documentDirty = documentSignature(this.bundle) !== this.savedDocument
      return
    }
    if (change.kind === 'comments') {
      this.commentsDirty = commentsSignature(this.bundle) !== this.savedComments
      return
    }
    const file = this.bundle.files.find((candidate) => candidate.id === change.fileId)
    if (file) this.compareFile(file)
    else this.dirtyFiles.add(change.fileId)
  }

  markSaved(): void {
    this.savedDocument = documentSignature(this.bundle)
    this.savedComments = commentsSignature(this.bundle)
    this.savedFiles = new Map(this.bundle.files.map((file) => [file.id ?? file.path, fileSignature(file)]))
    this.documentDirty = false
    this.commentsDirty = false
    this.dirtyFiles.clear()
  }

  private compareFile(file: TacoFile): void {
    const id = file.id ?? file.path
    if (fileSignature(file) === this.savedFiles.get(id)) this.dirtyFiles.delete(id)
    else this.dirtyFiles.add(id)
  }
}
