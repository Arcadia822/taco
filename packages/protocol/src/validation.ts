import {
  MAX_BLOCK_HTML,
  MAX_COMMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_SNAPSHOT_FILES,
  SUPPORTED_BLOCK_TYPES,
  type DocumentSnapshot,
  type ImportedCommentMessage,
  type ImportedCommentThread,
  type NavigationConfig,
  type SnapshotFile,
  type StagedUploadContent,
  type TextAnchor,
} from './types.ts'

export const DELETED_COMMENT_BODY = '[Deleted message]'

const SAFE_PATH_PATTERN =
  /^(?![a-zA-Z]:)(?!(?:\.{1,2}(?:\/|$)))[^/\\\0]+(?:\/(?!(?:\.{1,2}(?:\/|$)))[^/\\\0]+)*$/
const SAFE_ROOT_PATTERN =
  /^(?:\.|(?![a-zA-Z]:)(?!(?:\.{1,2}(?:\/|$)))[^/\\\0]+(?:\/(?!(?:\.{1,2}(?:\/|$)))[^/\\\0]+)*)$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const DATA_URL_PNG_PATTERN = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/i

export const isSafePath = (path: string): boolean =>
  typeof path === 'string' && path.length > 0 && SAFE_PATH_PATTERN.test(path)

export const isSafeRootPath = (root: string): boolean =>
  typeof root === 'string' && root.length > 0 && SAFE_ROOT_PATTERN.test(root)

export const isValidSha256Hex = (hash: string): boolean =>
  typeof hash === 'string' && SHA256_PATTERN.test(hash)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isIsoTimestamp = (value: unknown): boolean =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value))

export const validateTextAnchor = (
  anchor: unknown,
): { ok: true; anchor: TextAnchor } | { ok: false; err: string } => {
  if (!isRecord(anchor)) return { ok: false, err: 'Anchor must be an object' }
  if (typeof anchor.path !== 'string' || !isSafePath(anchor.path)) {
    return { ok: false, err: `Anchor path is not a safe relative path: ${anchor.path}` }
  }
  if (!isRecord(anchor.position)) return { ok: false, err: 'Anchor position must be an object' }
  const start = anchor.position.start
  const end = anchor.position.end
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    Number(start) < 0 ||
    Number(end) <= Number(start)
  ) {
    return {
      ok: false,
      err: `Anchor position [${start}, ${end}) is invalid (requires UTF-16 end > start >= 0)`,
    }
  }
  if (!isRecord(anchor.quote)) return { ok: false, err: 'Anchor quote must be an object' }
  const { exact, prefix, suffix } = anchor.quote
  if (
    typeof exact !== 'string' ||
    exact.length === 0 ||
    typeof prefix !== 'string' ||
    typeof suffix !== 'string'
  ) {
    return {
      ok: false,
      err: 'Anchor quote exact must be non-empty string with string prefix and suffix',
    }
  }

  if (anchor.block !== undefined) {
    const b = anchor.block
    if (
      !isRecord(b) ||
      typeof b.id !== 'string' ||
      b.id.length === 0 ||
      b.type !== 'codeBlock' ||
      typeof b.language !== 'string'
    ) {
      return { ok: false, err: 'Anchor block must have valid id, type: codeBlock, and language' }
    }
  }

  return { ok: true, anchor: anchor as unknown as TextAnchor }
}

export const validateImportedThread = (
  thread: unknown,
): { ok: true; thread: ImportedCommentThread } | { ok: false; err: string } => {
  if (!isRecord(thread)) return { ok: false, err: 'Thread must be an object' }
  if (typeof thread.id !== 'string' || thread.id.length === 0)
    return { ok: false, err: 'Thread id must be non-empty string' }
  if (thread.status !== 'open' && thread.status !== 'resolved')
    return { ok: false, err: `Invalid thread status: ${thread.status}` }
  if (!isIsoTimestamp(thread.createdAt) || !isIsoTimestamp(thread.updatedAt))
    return { ok: false, err: 'Thread createdAt and updatedAt must be ISO timestamps' }

  let anchor: TextAnchor | null = null
  if (thread.anchor !== null && thread.anchor !== undefined) {
    const validatedAnchor = validateTextAnchor(thread.anchor)
    if (!validatedAnchor.ok) return validatedAnchor
    anchor = validatedAnchor.anchor
  }

  if (!Array.isArray(thread.messages) || thread.messages.length === 0) {
    return { ok: false, err: `Thread ${thread.id} has no messages` }
  }

  const validatedMessages: ImportedCommentMessage[] = []
  for (const msg of thread.messages) {
    if (!isRecord(msg))
      return { ok: false, err: `Message in thread ${thread.id} must be an object` }
    if (typeof msg.id !== 'string' || msg.id.length === 0)
      return { ok: false, err: `Message id must be non-empty string` }
    if (typeof msg.author !== 'string')
      return { ok: false, err: `Message ${msg.id} author must be string` }
    if (typeof msg.body !== 'string' || msg.body.length === 0)
      return { ok: false, err: `Message ${msg.id} body must be non-empty` }
    if (new TextEncoder().encode(msg.body).length > MAX_COMMENT_BYTES) {
      return { ok: false, err: `Message ${msg.id} body exceeds 16 KiB UTF-8 byte limit` }
    }
    if (!isIsoTimestamp(msg.createdAt))
      return { ok: false, err: `Message ${msg.id} createdAt must be ISO timestamp` }

    const isDeleted = msg.deletedAt !== undefined
    if (isDeleted) {
      if (!isIsoTimestamp(msg.deletedAt))
        return { ok: false, err: `Message ${msg.id} deletedAt must be ISO timestamp` }
      if (msg.body !== DELETED_COMMENT_BODY) {
        return {
          ok: false,
          err: `Message ${msg.id} with deletedAt must have body '${DELETED_COMMENT_BODY}'`,
        }
      }
    }

    validatedMessages.push({
      id: msg.id,
      author: msg.author,
      authorId: typeof msg.authorId === 'string' ? msg.authorId : undefined,
      body: msg.body,
      createdAt: msg.createdAt,
      updatedAt: typeof msg.updatedAt === 'string' ? msg.updatedAt : undefined,
      deletedAt: typeof msg.deletedAt === 'string' ? msg.deletedAt : undefined,
    })
  }

  return {
    ok: true,
    thread: {
      id: thread.id,
      anchor,
      status: thread.status,
      createdAt: thread.createdAt as string,
      updatedAt: thread.updatedAt as string,
      messages: validatedMessages,
    },
  }
}

export const validateSnapshotFile = (
  file: unknown,
  root: string,
): { ok: true; file: SnapshotFile } | { ok: false; err: string } => {
  if (!isRecord(file)) return { ok: false, err: 'File must be an object' }
  if (typeof file.path !== 'string' || !isSafePath(file.path)) {
    return { ok: false, err: `File path is not safe: ${file.path}` }
  }

  if (root !== '.' && !file.path.startsWith(`${root}/`)) {
    return { ok: false, err: `File path ${file.path} does not reside within root ${root}` }
  }

  if (typeof file.mediaType !== 'string' || file.mediaType.length === 0) {
    return { ok: false, err: `File mediaType is required: ${file.path}` }
  }

  if (typeof file.content !== 'string') {
    return { ok: false, err: `File content must be string: ${file.path}` }
  }

  if (file.sourceHash !== undefined && !isValidSha256Hex(file.sourceHash as string)) {
    return { ok: false, err: `File sourceHash is invalid 64-hex SHA-256: ${file.path}` }
  }

  if (file.mediaType === 'image/png') {
    const match = file.content.match(DATA_URL_PNG_PATTERN)
    if (!match) {
      return {
        ok: false,
        err: `image/png file must be valid data:image/png;base64,... URL: ${file.path}`,
      }
    }
    const base64Data = match[1]
    const estimatedBytes = Math.ceil((base64Data.length * 3) / 4)
    if (estimatedBytes > MAX_IMAGE_BYTES) {
      return { ok: false, err: `image/png file exceeds 10 MiB limit: ${file.path}` }
    }
  }

  if (file.blocks !== undefined) {
    if (!Array.isArray(file.blocks))
      return { ok: false, err: `File blocks must be an array: ${file.path}` }
    for (const b of file.blocks) {
      if (!isRecord(b)) return { ok: false, err: `Block must be an object: ${file.path}` }
      if (typeof b.id !== 'string' || b.id.length === 0)
        return { ok: false, err: `Block id must be non-empty: ${file.path}` }
      if (typeof b.type !== 'string' || !SUPPORTED_BLOCK_TYPES.has(b.type)) {
        return { ok: false, err: `Block type unsupported (${b.type}): ${file.path}` }
      }
      if (typeof b.html !== 'string' || b.html.length > MAX_BLOCK_HTML) {
        return {
          ok: false,
          err: `Block html exceeds MAX_BLOCK_HTML (${MAX_BLOCK_HTML}): ${file.path}`,
        }
      }
    }
  }

  return { ok: true, file: file as unknown as SnapshotFile }
}

export const validateDocumentSnapshot = (
  snapshot: unknown,
): { ok: true; snapshot: DocumentSnapshot } | { ok: false; err: string } => {
  if (!isRecord(snapshot)) return { ok: false, err: 'Snapshot must be an object' }
  if (snapshot.format !== 'taco/files')
    return { ok: false, err: `Unsupported format: ${snapshot.format}` }
  if (snapshot.version !== 1) return { ok: false, err: `Unsupported version: ${snapshot.version}` }
  if (typeof snapshot.docId !== 'string' || snapshot.docId.length === 0)
    return { ok: false, err: 'Snapshot docId must be non-empty' }
  if (typeof snapshot.title !== 'string' || snapshot.title.length === 0)
    return { ok: false, err: 'Snapshot title must be non-empty' }
  if (typeof snapshot.root !== 'string' || !isSafeRootPath(snapshot.root))
    return { ok: false, err: `Snapshot root path is invalid: ${snapshot.root}` }

  if (!Array.isArray(snapshot.files) || snapshot.files.length === 0) {
    return { ok: false, err: 'Snapshot files must be a non-empty array' }
  }
  if (snapshot.files.length > MAX_SNAPSHOT_FILES) {
    return { ok: false, err: `Snapshot files exceeds maximum ${MAX_SNAPSHOT_FILES}` }
  }

  const seenPaths = new Set<string>()
  const validatedFiles: SnapshotFile[] = []
  for (const f of snapshot.files) {
    const res = validateSnapshotFile(f, snapshot.root)
    if (!res.ok) return res
    if (seenPaths.has(res.file.path))
      return { ok: false, err: `Duplicate file path: ${res.file.path}` }
    seenPaths.add(res.file.path)
    validatedFiles.push(res.file)
  }

  let validatedNav: NavigationConfig | undefined = undefined
  if (snapshot.navigation !== undefined) {
    if (!isRecord(snapshot.navigation)) return { ok: false, err: 'Navigation must be an object' }
    if (snapshot.navigation.version !== 1) return { ok: false, err: 'Navigation version must be 1' }
    if (!Array.isArray(snapshot.navigation.groups))
      return { ok: false, err: 'Navigation groups must be array' }
    for (const g of snapshot.navigation.groups) {
      if (
        !isRecord(g) ||
        typeof g.id !== 'string' ||
        typeof g.title !== 'string' ||
        !Array.isArray(g.paths)
      ) {
        return { ok: false, err: 'Navigation group must have id, title, and paths array' }
      }
      for (const p of g.paths) {
        if (typeof p !== 'string' || !seenPaths.has(p)) {
          return { ok: false, err: `Navigation group refers to unknown file path: ${p}` }
        }
      }
    }
    validatedNav = snapshot.navigation as unknown as NavigationConfig
  }

  return {
    ok: true,
    snapshot: {
      format: 'taco/files',
      version: 1,
      docId: snapshot.docId,
      title: snapshot.title,
      root: snapshot.root,
      files: validatedFiles,
      navigation: validatedNav,
    },
  }
}

export const validateStagedUploadContent = (
  content: unknown,
): { ok: true; payload: StagedUploadContent } | { ok: false; err: string } => {
  if (!isRecord(content)) return { ok: false, err: 'Upload content must be an object' }
  if (content.protocol !== 'taco-host/1')
    return { ok: false, err: `Unsupported protocol: ${content.protocol}` }

  const snapshotRes = validateDocumentSnapshot(content.snapshot)
  if (!snapshotRes.ok) return snapshotRes

  const validatedThreads: ImportedCommentThread[] = []
  if (content.importedComments !== undefined) {
    if (!Array.isArray(content.importedComments))
      return { ok: false, err: 'importedComments must be array' }
    for (const th of content.importedComments) {
      const thRes = validateImportedThread(th)
      if (!thRes.ok) return thRes
      validatedThreads.push(thRes.thread)
    }
  }

  return {
    ok: true,
    payload: {
      protocol: 'taco-host/1',
      snapshot: snapshotRes.snapshot,
      importedComments: validatedThreads,
    },
  }
}
