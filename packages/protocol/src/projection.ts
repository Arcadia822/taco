import { validateCheckpoints } from './checkpoints.ts'
import { computeSnapshotContentHash } from './jcs.ts'
import type {
  DocumentSnapshot,
  ImportedCommentThread,
  SnapshotFile,
  StagedUploadContent,
} from './types.ts'

export interface StrippedFieldSummary {
  strippedCategories: string[]
  unsupportedFieldErrors: string[]
}

const KNOWN_STRIPPED_TOP_FIELDS = new Set([
  'access',
  'collab',
  'packOptions',
  'credentials',
  'sourceUrl',
])

const ALLOWED_TOP_LEVEL_PROPERTIES = new Set([
  'format',
  'version',
  'docId',
  'title',
  'root',
  'files',
  'navigation',
  'checkpoints',
  'comments', // legacy local comments property, stripped/converted to importedComments
  ...KNOWN_STRIPPED_TOP_FIELDS,
])

/**
 * Projects a local Taco document bundle into a safe StagedUploadContent payload for upload to Taco Host.
 * Known local-only and secret fields (collab credentials, packOptions, access, sourceUrl) are cleanly stripped.
 * Any unknown / undeclared extensions trigger an explicit error with the property path.
 */
export const projectLocalBundleToUploadContent = (
  rawBundle: Record<string, unknown>,
):
  | { ok: true; content: StagedUploadContent; strippedCategories: string[] }
  | { ok: false; err: string } => {
  const strippedCategories = new Set<string>()

  // Check top-level properties
  for (const key of Object.keys(rawBundle)) {
    if (!ALLOWED_TOP_LEVEL_PROPERTIES.has(key)) {
      return { ok: false, err: `Undeclared top-level property rejected: ${key}` }
    }
    if (KNOWN_STRIPPED_TOP_FIELDS.has(key)) {
      strippedCategories.add(key)
    }
  }

  if (rawBundle.format !== 'taco/files') {
    return { ok: false, err: `Unsupported bundle format: ${rawBundle.format}` }
  }
  if (rawBundle.version !== 1) {
    return { ok: false, err: `Unsupported bundle version: ${rawBundle.version}` }
  }
  if (
    typeof rawBundle.docId !== 'string' ||
    typeof rawBundle.title !== 'string' ||
    typeof rawBundle.root !== 'string'
  ) {
    return { ok: false, err: 'Missing required docId, title, or root' }
  }
  if (!Array.isArray(rawBundle.files)) {
    return { ok: false, err: 'Bundle files must be an array' }
  }
  const checkpoints = rawBundle.checkpoints === undefined
    ? undefined
    : validateCheckpoints(rawBundle.checkpoints, rawBundle.root)
  if (checkpoints && !checkpoints.ok) {
    return { ok: false, err: `Checkpoints invalid at ${checkpoints.path}: ${checkpoints.err}` }
  }

  const projectedFiles: SnapshotFile[] = []
  for (let i = 0; i < rawBundle.files.length; i += 1) {
    const file = rawBundle.files[i]
    if (typeof file !== 'object' || file === null || Array.isArray(file)) {
      return { ok: false, err: `File at index ${i} is not an object` }
    }
    const fRecord = file as Record<string, unknown>

    if (fRecord.sourceUrl !== undefined) {
      strippedCategories.add('sourceUrl')
    }

    projectedFiles.push({
      id: typeof fRecord.id === 'string' ? fRecord.id : undefined,
      title: typeof fRecord.title === 'string' ? fRecord.title : undefined,
      path: fRecord.path as string,
      mediaType: fRecord.mediaType as string,
      content: fRecord.content as string,
      sourceHash: typeof fRecord.sourceHash === 'string' ? fRecord.sourceHash : undefined,
      blocks: Array.isArray(fRecord.blocks)
        ? (fRecord.blocks as SnapshotFile['blocks'])
        : undefined,
    })
  }

  const snapshot: DocumentSnapshot = {
    format: 'taco/files',
    version: 1,
    docId: rawBundle.docId,
    title: rawBundle.title,
    root: rawBundle.root,
    files: projectedFiles,
    navigation: rawBundle.navigation as DocumentSnapshot['navigation'],
    ...(checkpoints?.ok ? { checkpoints: checkpoints.value } : {}),
  }

  const importedComments: ImportedCommentThread[] = Array.isArray(rawBundle.comments)
    ? (rawBundle.comments as ImportedCommentThread[])
    : []

  return {
    ok: true,
    content: {
      protocol: 'taco-host/1',
      snapshot,
      importedComments,
    },
    strippedCategories: Array.from(strippedCategories).sort(),
  }
}

export interface DryRunProjectionSummary {
  command: 'publish' | 'update'
  dryRun: true
  host: string
  contentHash: string
  payloadBytes: number
  files: Array<{
    path: string
    mediaType: string
    bytes: number
  }>
  importedThreadCount: number
  strippedFieldCategories: string[]
  baseRevisionId?: string
}

export const computeDryRunProjectionSummary = async (
  uploadContent: StagedUploadContent,
  options: { command: 'publish' | 'update'; host: string; baseRevisionId?: string },
): Promise<DryRunProjectionSummary> => {
  const contentHash = await computeSnapshotContentHash(uploadContent.snapshot)
  const payloadBytes = new TextEncoder().encode(JSON.stringify(uploadContent)).length

  const filesSummary = uploadContent.snapshot.files.map((file) => ({
    path: file.path,
    mediaType: file.mediaType,
    bytes: new TextEncoder().encode(file.content).length,
  }))

  return {
    command: options.command,
    dryRun: true,
    host: options.host,
    contentHash,
    payloadBytes,
    files: filesSummary,
    importedThreadCount: uploadContent.importedComments?.length ?? 0,
    strippedFieldCategories: [],
    ...(options.baseRevisionId ? { baseRevisionId: options.baseRevisionId } : {}),
  }
}
