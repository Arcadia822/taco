import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  atomicWrite,
  collectFiles,
  embedBundle,
  readBundleFromHtml,
  sha256Hex,
  shellVariantOf,
  validateBundle,
  type TacoBundle,
  type TacoFile,
} from '../../../skills/taco/scripts/pack.mjs'
import { decodePng } from '../../../skills/taco/scripts/png.mjs'
import { EXIT_CODES, makeCliError } from './errors.ts'
import {
  assertSafeDestination,
  verifyNoSymlinksInAncestry,
  verifyNotForbidden,
} from './local-paths.ts'

export interface RefreshOptions {
  filePath: string
  handoffPath: string
  dirPath?: string
  dryRun?: boolean
}

interface FileContentCheck {
  path: string
  status: 'handled' | 'pending' | 'conflict' | 'unmodified' | 'added' | 'deleted'
  reason?: string
}

export const executeRefresh = async (
  options: RefreshOptions,
): Promise<{ exitCode: number; stdout?: string; stderr?: string }> => {
  const artifactPath = resolve(options.filePath)
  if (!existsSync(artifactPath)) {
    const err = makeCliError('LOCAL_IO_ERROR', `Artifact file not found: ${artifactPath}`)
    return { exitCode: EXIT_CODES.LOCAL_IO_ERROR, stderr: JSON.stringify(err) }
  }

  // Pre-check artifact destination: refuses symlinks and forbidden ancestors
  try {
    await assertSafeDestination(artifactPath)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const error = makeCliError('VALIDATION_ERROR', msg)
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  // Read original artifact
  let originalHtml: string
  let originalBundle: TacoBundle
  try {
    const res = await readBundleFromHtml(artifactPath)
    originalHtml = res.html
    originalBundle = res.bundle
  } catch (err) {
    const error = makeCliError('VALIDATION_ERROR', `Failed to parse artifact: ${(err as Error).message}`)
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  // Read handoff
  let rawHandoffText: string
  try {
    if (options.handoffPath === '-') {
      rawHandoffText = readFileSync(0, 'utf8')
    } else {
      const p = resolve(options.handoffPath)
      if (!existsSync(p)) {
        const err = makeCliError('LOCAL_IO_ERROR', `Handoff file not found: ${p}`)
        return { exitCode: EXIT_CODES.LOCAL_IO_ERROR, stderr: JSON.stringify(err) }
      }
      rawHandoffText = await readFile(p, 'utf8')
    }
  } catch (err) {
    const error = makeCliError('LOCAL_IO_ERROR', 'Failed to read handoff file')
    return { exitCode: EXIT_CODES.LOCAL_IO_ERROR, stderr: JSON.stringify(error) }
  }

  let handoffJson: unknown
  try {
    handoffJson = JSON.parse(rawHandoffText)
  } catch {
    const error = makeCliError('VALIDATION_ERROR', 'Invalid JSON syntax in handoff')
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  if (!handoffJson || typeof handoffJson !== 'object') {
    const error = makeCliError('VALIDATION_ERROR', 'Handoff JSON must be an object')
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  const handoffRecord = handoffJson as Record<string, unknown>
  const payloadRaw = handoffRecord.payload !== undefined ? handoffRecord.payload : handoffRecord

  if (!payloadRaw || typeof payloadRaw !== 'object') {
    const error = makeCliError('VALIDATION_ERROR', 'Handoff payload must be an object')
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  // Extract LocalHandoff payload (either direct or wrapped in LocalReceipt)
  const payload = payloadRaw as {
    schema?: unknown
    handoffId?: unknown
    sessionId?: unknown
    docId?: unknown
    baseline?: TacoBundle
    snapshot?: TacoBundle
  }

  const baseline = payload.baseline
  const snapshot = payload.snapshot

  if (!baseline || !snapshot) {
    const error = makeCliError(
      'VALIDATION_ERROR',
      'Handoff payload must contain baseline and snapshot',
    )
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  // Schema validation: a Handoff declares its schema explicitly
  if (payload.schema !== 'taco-local-handoff/1') {
    const error = makeCliError(
      'VALIDATION_ERROR',
      payload.schema === undefined
        ? 'Handoff payload is missing the taco-local-handoff/1 schema marker'
        : `Unsupported handoff schema: ${String(payload.schema)}`,
    )
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  try {
    validateBundle(baseline)
    validateBundle(snapshot)
  } catch (err) {
    const error = makeCliError(
      'VALIDATION_ERROR',
      `Invalid bundle structure in handoff: ${(err as Error).message}`,
    )
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  // 1. Identity & root checks
  if (payload.docId !== originalBundle.docId) {
    const error = makeCliError(
      'CONFLICT_ERROR',
      `Handoff docId does not match artifact docId`,
    )
    return { exitCode: EXIT_CODES.CONFLICT_ERROR, stderr: JSON.stringify(error) }
  }

  if (baseline.docId !== originalBundle.docId || snapshot.docId !== originalBundle.docId) {
    const error = makeCliError(
      'CONFLICT_ERROR',
      `Handoff baseline/snapshot docId does not match artifact docId`,
    )
    return { exitCode: EXIT_CODES.CONFLICT_ERROR, stderr: JSON.stringify(error) }
  }

  if (baseline.root !== originalBundle.root || snapshot.root !== originalBundle.root) {
    const error = makeCliError(
      'CONFLICT_ERROR',
      `Handoff root does not match artifact root`,
    )
    return { exitCode: EXIT_CODES.CONFLICT_ERROR, stderr: JSON.stringify(error) }
  }

  // 2. Strict baseline membership & content match against original artifact
  // "Matching docId/root but baseline differs from original artifact (including membership/PNG) reject stale earlier/copy. Round2 artifact same identity but original A baseline payload must reject after first refresh."
  const originalFilesMap = new Map(originalBundle.files.map((f) => [f.path, f]))
  const baselineFilesMap = new Map(baseline.files.map((f) => [f.path, f]))

  if (originalFilesMap.size !== baselineFilesMap.size) {
    const error = makeCliError(
      'CONFLICT_ERROR',
      `Baseline file count (${baselineFilesMap.size}) does not match artifact file count (${originalFilesMap.size}); rejecting stale review baseline`,
    )
    return { exitCode: EXIT_CODES.CONFLICT_ERROR, stderr: JSON.stringify(error) }
  }

  for (const [path, baseFile] of baselineFilesMap.entries()) {
    const origFile = originalFilesMap.get(path)
    if (!origFile) {
      const error = makeCliError(
        'CONFLICT_ERROR',
        `Baseline contains file '${path}' not found in artifact; rejecting stale review baseline`,
      )
      return { exitCode: EXIT_CODES.CONFLICT_ERROR, stderr: JSON.stringify(error) }
    }
    if (origFile.content !== baseFile.content) {
      const error = makeCliError(
        'CONFLICT_ERROR',
        `Baseline content for '${path}' differs from current artifact; rejecting stale review baseline (artifact may have been refreshed already)`,
      )
      return { exitCode: EXIT_CODES.CONFLICT_ERROR, stderr: JSON.stringify(error) }
    }
  }

  // 3. Metadata drift check: original title/nav/checkpoints must not mismatch supplied baseline unless matching snapshot
  if (originalBundle.title !== baseline.title && originalBundle.title !== snapshot.title) {
    const error = makeCliError(
      'CONFLICT_ERROR',
      `Artifact title has independent modifications mismatching baseline and snapshot`,
    )
    return { exitCode: EXIT_CODES.CONFLICT_ERROR, stderr: JSON.stringify(error) }
  }

  // Check navigation drift
  const origNav = JSON.stringify(originalBundle.navigation ?? null)
  const baseNav = JSON.stringify(baseline.navigation ?? null)
  const snapNav = JSON.stringify(snapshot.navigation ?? null)
  if (origNav !== baseNav && origNav !== snapNav) {
    const error = makeCliError(
      'CONFLICT_ERROR',
      `Artifact navigation has independent modifications mismatching baseline and snapshot`,
    )
    return { exitCode: EXIT_CODES.CONFLICT_ERROR, stderr: JSON.stringify(error) }
  }

  // Check checkpoints drift
  const origCp = JSON.stringify(originalBundle.checkpoints ?? null)
  const baseCp = JSON.stringify(baseline.checkpoints ?? null)
  const snapCp = JSON.stringify(snapshot.checkpoints ?? null)
  if (origCp !== baseCp && origCp !== snapCp) {
    const error = makeCliError(
      'CONFLICT_ERROR',
      `Artifact checkpoints have independent modifications mismatching baseline and snapshot`,
    )
    return { exitCode: EXIT_CODES.CONFLICT_ERROR, stderr: JSON.stringify(error) }
  }

  // 4. Canonical directory check: require canonical directory
  let canonicalDir = options.dirPath ? resolve(options.dirPath) : null
  if (!canonicalDir) {
    // Attempt resolving from originalBundle.root if it's a valid relative directory
    if (originalBundle.root && originalBundle.root !== '.' && existsSync(resolve(originalBundle.root))) {
      canonicalDir = resolve(originalBundle.root)
    } else {
      const error = makeCliError(
        'VALIDATION_ERROR',
        'Missing required canonical source directory argument (--dir <canonicalDir>)',
      )
      return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
    }
  }

  if (!existsSync(canonicalDir)) {
    const error = makeCliError('LOCAL_IO_ERROR', `Canonical directory not found: ${canonicalDir}`)
    return { exitCode: EXIT_CODES.LOCAL_IO_ERROR, stderr: JSON.stringify(error) }
  }

  // Verify canonical directory destination security (no symlinks in ancestry or forbidden targets)
  try {
    await verifyNoSymlinksInAncestry(canonicalDir)
    await verifyNotForbidden(canonicalDir)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const error = makeCliError('VALIDATION_ERROR', msg)
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  // Canonical collectFiles to find ALL current files in directory supporting excludes/packOptions
  const ignores = originalBundle.packOptions?.ignore ?? []
  let canonicalCollected: TacoFile[]
  try {
    const collectedRes = await collectFiles(
      canonicalDir,
      originalBundle.root,
      originalFilesMap,
      ignores,
    )
    canonicalCollected = collectedRes.files
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const error = makeCliError('VALIDATION_ERROR', `Failed collecting canonical files: ${msg}`)
    return { exitCode: EXIT_CODES.VALIDATION_ERROR, stderr: JSON.stringify(error) }
  }

  const canonicalCollectedMap = new Map(canonicalCollected.map((f) => [f.path, f]))
  const snapshotFilesMap = new Map(snapshot.files.map((f) => [f.path, f]))
  const allPaths = new Set([
    ...baselineFilesMap.keys(),
    ...snapshotFilesMap.keys(),
    ...canonicalCollectedMap.keys(),
  ])

  const checks: FileContentCheck[] = []
  const canonicalLoadedFiles: TacoFile[] = []

  const computeFileHash = async (file: { content: string; mediaType: string; path: string }): Promise<string> => {
    if (file.mediaType === 'image/png' || file.path.toLowerCase().endsWith('.png')) {
      const rawBytes = decodePng(file.content, file.path)
      return await sha256Hex(rawBytes)
    }
    return await sha256Hex(file.content)
  }

  for (const bundlePath of allPaths) {
    const baseFile = baselineFilesMap.get(bundlePath)
    const snapFile = snapshotFilesMap.get(bundlePath)
    const origFile = originalFilesMap.get(bundlePath)
    const canonicalFile = canonicalCollectedMap.get(bundlePath)

    if (!baseFile && snapFile) {
      // Addition in review: canonical source must hold the reviewed content
      if (!canonicalFile) {
        checks.push({
          path: bundlePath,
          status: 'pending',
          reason: `Addition '${bundlePath}' not found in canonical directory`,
        })
      } else if (canonicalFile.content !== snapFile.content) {
        checks.push({
          path: bundlePath,
          status: 'conflict',
          reason: `Addition '${bundlePath}' in canonical directory does not match reviewed content`,
        })
      } else {
        checks.push({ path: bundlePath, status: 'handled' })
        const hash = await computeFileHash(canonicalFile)
        canonicalLoadedFiles.push({
          ...snapFile,
          content: canonicalFile.content,
          sourceHash: hash,
          ...(snapFile.blocks ? { blocks: snapFile.blocks } : {}),
        })
      }
    } else if (baseFile && !snapFile) {
      // Deletion in review: handled only once the file is gone from canonical source
      if (canonicalFile) {
        checks.push({
          path: bundlePath,
          status: 'pending',
          reason: `Deleted file '${bundlePath}' is still present in canonical directory`,
        })
      } else {
        checks.push({ path: bundlePath, status: 'handled' })
      }
    } else if (baseFile && snapFile) {
      // Present in baseline and snapshot
      if (!canonicalFile) {
        checks.push({
          path: bundlePath,
          status: 'conflict',
          reason: `File '${bundlePath}' missing from canonical directory`,
        })
      } else if (baseFile.content === snapFile.content) {
        // Unmodified in review
        checks.push({ path: bundlePath, status: 'unmodified' })
        const loaded: TacoFile = {
          ...(origFile ?? {}),
          ...snapFile,
          content: canonicalFile.content,
          sourceHash: await computeFileHash(canonicalFile),
        }
        // `blocks` is a runtime render cache: keep it only while content is byte-identical.
        delete loaded.blocks
        if (canonicalFile.content === baseFile.content) {
          const blocks = snapFile.blocks ?? origFile?.blocks
          if (blocks !== undefined) {
            loaded.blocks = blocks
          }
        }
        canonicalLoadedFiles.push(loaded)
      } else if (canonicalFile.content === snapFile.content) {
        // Canonical matches the reviewed snapshot: handled
        checks.push({ path: bundlePath, status: 'handled' })
        const hash = await computeFileHash(canonicalFile)
        canonicalLoadedFiles.push({
          ...(origFile ?? {}),
          ...snapFile,
          content: canonicalFile.content,
          sourceHash: hash,
          ...(snapFile.blocks ? { blocks: snapFile.blocks } : {}),
        })
      } else if (canonicalFile.content === baseFile.content) {
        // Canonical is still baseline content: the review change is pending
        checks.push({
          path: bundlePath,
          status: 'pending',
          reason: `Review change for '${bundlePath}' is still pending in canonical directory (still baseline content)`,
        })
      } else {
        // Canonical holds an independent change: ambiguous, stop the whole refresh
        checks.push({
          path: bundlePath,
          status: 'conflict',
          reason: `Canonical directory content for '${bundlePath}' conflicts with both baseline and review snapshot`,
        })
      }
    } else if (canonicalFile) {
      // New canonical source file not present in the review baseline or snapshot
      checks.push({ path: bundlePath, status: 'added' })
      const hash = await computeFileHash(canonicalFile)
      canonicalLoadedFiles.push({
        ...canonicalFile,
        sourceHash: hash,
      })
    }
  }

  const pendingOrConflict = checks.filter(
    (c) => c.status === 'pending' || c.status === 'conflict',
  )
  if (pendingOrConflict.length > 0) {
    const summary = pendingOrConflict.map((c) => `${c.path}: ${c.reason}`).join('; ')
    const error = makeCliError(
      'CONFLICT_ERROR',
      `Cannot refresh: unresolved review changes in canonical directory. ${summary}`,
      { details: { checks } },
    )
    return { exitCode: EXIT_CODES.CONFLICT_ERROR, stderr: JSON.stringify(error) }
  }

  // 5. Assemble refreshed bundle using handled canonical files
  // Retain all comments from snapshot and earlier comments from original
  const existingCommentIds = new Set((snapshot.comments ?? []).map((c) => c.id))
  const preservedOriginalComments = (originalBundle.comments ?? []).filter(
    (c) => !existingCommentIds.has(c.id),
  )
  const mergedComments = [...preservedOriginalComments, ...(snapshot.comments ?? [])]

  // Retain checkpoints from snapshot, fallback to original
  const refreshedCheckpoints = snapshot.checkpoints ?? originalBundle.checkpoints

  // Retain navigation from snapshot, fallback to original
  const refreshedNavigation = snapshot.navigation ?? originalBundle.navigation

  // Retain unknown fields without dropping original access/collab credentials locally
  const unknownFields: Record<string, unknown> = {}
  const knownKeys: Record<string, true> = {
    format: true,
    version: true,
    docId: true,
    title: true,
    root: true,
    files: true,
    comments: true,
    checkpoints: true,
    navigation: true,
    packOptions: true,
    access: true,
    collab: true,
  }

  for (const [key, value] of Object.entries(originalBundle)) {
    if (!knownKeys[key]) {
      unknownFields[key] = value
    }
  }
  for (const [key, value] of Object.entries(snapshot)) {
    if (!knownKeys[key]) {
      unknownFields[key] = value
    }
  }

  const refreshedBundle: TacoBundle = {
    ...unknownFields,
    format: originalBundle.format,
    version: originalBundle.version,
    docId: originalBundle.docId,
    title: snapshot.title ?? originalBundle.title,
    root: originalBundle.root,
    files: canonicalLoadedFiles,
    comments: mergedComments,
    ...(refreshedCheckpoints ? { checkpoints: refreshedCheckpoints } : {}),
    ...(refreshedNavigation ? { navigation: refreshedNavigation } : {}),
    ...(originalBundle.packOptions ? { packOptions: originalBundle.packOptions } : {}),
    // Preserve local access and collab from original artifact
    ...(originalBundle.access !== undefined ? { access: originalBundle.access } : {}),
    ...(originalBundle.collab !== undefined ? { collab: originalBundle.collab } : {}),
  }

  validateBundle(refreshedBundle)

  if (!options.dryRun) {
    const updatedHtml = embedBundle(originalHtml, refreshedBundle)
    await atomicWrite(artifactPath, updatedHtml)
  }

  const result = {
    schema: 'taco-cli-refresh/1',
    docId: refreshedBundle.docId,
    title: refreshedBundle.title,
    root: refreshedBundle.root,
    dryRun: Boolean(options.dryRun),
    fileCount: refreshedBundle.files.length,
    commentCount: refreshedBundle.comments?.length ?? 0,
    checkpoints: Boolean(refreshedBundle.checkpoints),
    shellVariant: shellVariantOf(originalHtml),
  }

  return { exitCode: EXIT_CODES.OK, stdout: JSON.stringify(result, null, 2) }
}
