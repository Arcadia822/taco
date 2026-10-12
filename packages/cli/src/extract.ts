import { constants as fsConstants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  rmdir,
  unlink,
  writeFile,
  type FileHandle,
} from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { isSafePath, validateBundle, type TacoBundle } from '../../../skills/taco/scripts/pack.mjs'
import { decodePng } from '../../../skills/taco/scripts/png.mjs'
import { extractTacoBundleFromHtml } from './inspect.ts'
import { canonicalizeSystemPrefix, verifyNotForbidden } from './local-paths.ts'

export interface ExtractedFileInfo {
  path: string
  outputPath?: string
  mediaType: string
  size: number
  written: boolean
  skipped?: boolean
  reason?: string
}

export interface ExtractOutput {
  docId: string
  title: string
  root: string
  outDir?: string
  dryRun: boolean
  totalFiles: number
  extractedFiles: ExtractedFileInfo[]
  files?: Array<{
    path: string
    mediaType: string
    content: string
    size: number
  }>
}

export interface OwnedResource {
  path: string
  dev: number
  ino: number
}

export interface ExtractOptions {
  filePath: string
  outDir?: string
  files?: string[]
  dryRun?: boolean
  _faultSeam?: 'before-write' | 'during-write' | 'after-close'
}

export async function rollbackExtraction(
  createdFiles: OwnedResource[],
  createdDirs: Iterable<OwnedResource>,
): Promise<void> {
  for (const created of [...createdFiles].reverse()) {
    try {
      const st = await lstat(created.path)
      if (st.dev === created.dev && st.ino === created.ino) {
        await unlink(created.path)
      }
    } catch {
      // ignore best-effort removal
    }
  }
  const sortedDirs = Array.from(createdDirs).sort((a, b) => b.path.length - a.path.length)
  for (const dir of sortedDirs) {
    try {
      const st = await lstat(dir.path)
      if (st.isDirectory() && st.dev === dir.dev && st.ino === dir.ino) {
        await rmdir(dir.path)
      }
    } catch {
      // ignore if non-empty or unable to remove
    }
  }
}

interface ErrorWithCode extends Error {
  code?: string
  path?: string
}

function hasErrorCode(err: unknown): err is ErrorWithCode {
  return err instanceof Error && 'code' in err
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function createTypedError(code: string, message: string): Error & { code: string } {
  const error = new Error(message)
  return Object.assign(error, { code })
}

async function verifyNoSymlinksInAncestry(targetPath: string): Promise<void> {
  const norm = canonicalizeSystemPrefix(resolve(targetPath))
  let current = norm
  while (true) {
    if (
      process.platform === 'darwin' &&
      (current === '/var' ||
        current === '/tmp' ||
        current === '/private/var' ||
        current === '/private/tmp')
    ) {
      const parent = dirname(current)
      if (parent === current) break
      current = parent
      continue
    }

    try {
      const stats = await lstat(current)
      if (stats.isSymbolicLink()) {
        throw createTypedError(
          'VALIDATION_ERROR',
          `Symlinks are rejected: '${current}' is a symbolic link`,
        )
      }
    } catch (err) {
      if (hasErrorCode(err)) {
        if (err.code === 'VALIDATION_ERROR') throw err
        if (err.code === 'ENOENT') {
          // Path component does not exist yet, continue checking parent
        } else {
          throw createTypedError(
            'LOCAL_IO_ERROR',
            `Failed to inspect path '${current}': ${getErrorMessage(err)}`,
          )
        }
      } else {
        throw createTypedError(
          'LOCAL_IO_ERROR',
          `Failed to inspect path '${current}': ${getErrorMessage(err)}`,
        )
      }
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}

export async function executeExtract(options: ExtractOptions): Promise<ExtractOutput> {
  let rawHtml: string
  try {
    rawHtml = await readFile(options.filePath, 'utf8')
  } catch (err) {
    throw createTypedError(
      'LOCAL_IO_ERROR',
      `Failed to read input file '${options.filePath}': ${getErrorMessage(err)}`,
    )
  }

  const rawBundle = extractTacoBundleFromHtml(rawHtml)
  const bundle = validateBundle(rawBundle) as TacoBundle
  const docId = bundle.docId
  const title = bundle.title
  const root = bundle.root

  let candidateFiles = bundle.files

  if (options.files && options.files.length > 0) {
    const requestedFilters = options.files.map((p) => p.trim()).filter((p) => p.length > 0)
    if (requestedFilters.length === 0) {
      throw createTypedError('VALIDATION_ERROR', 'No valid file paths specified in filter')
    }

    const matchedFilterIndices = new Set<number>()
    const matchedFiles: typeof bundle.files = []

    for (const file of bundle.files) {
      const relFromRoot =
        root !== '.' && file.path.startsWith(`${root}/`)
          ? file.path.slice(root.length + 1)
          : file.path

      let matched = false
      requestedFilters.forEach((filterPath, index) => {
        const cleanFilter = filterPath.replace(/^(\.\/)+/, '').replace(/^\/+/, '')
        if (
          file.path === filterPath ||
          file.path === cleanFilter ||
          relFromRoot === filterPath ||
          relFromRoot === cleanFilter
        ) {
          matched = true
          matchedFilterIndices.add(index)
        }
      })

      if (matched) {
        matchedFiles.push(file)
      }
    }

    for (let i = 0; i < requestedFilters.length; i++) {
      if (!matchedFilterIndices.has(i)) {
        throw createTypedError(
          'VALIDATION_ERROR',
          `Filter file not found in bundle: '${requestedFilters[i]}'`,
        )
      }
    }

    if (matchedFiles.length === 0) {
      throw createTypedError('VALIDATION_ERROR', 'No files matched the specified filter')
    }

    candidateFiles = matchedFiles
  }

  // Pre-decode and validate all files (especially PNG bytes via decodePng)
  interface PreparedFile {
    file: (typeof candidateFiles)[0]
    targetPath?: string
    buffer?: Buffer
    text?: string
    size: number
  }

  const prepared: PreparedFile[] = []

  for (const file of candidateFiles) {
    const isPng = file.mediaType === 'image/png' || /\.png$/i.test(file.path)
    if (isPng) {
      // Must be valid data URL and pass full PNG chunk & CRC verification
      try {
        const pngBytes = decodePng(file.content, file.path)
        const buffer = Buffer.from(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength)
        prepared.push({
          file,
          buffer,
          size: pngBytes.byteLength,
        })
      } catch (err) {
        throw createTypedError(
          'VALIDATION_ERROR',
          `Invalid PNG image '${file.path}': ${getErrorMessage(err)}`,
        )
      }
    } else {
      prepared.push({
        file,
        text: file.content,
        size: Buffer.byteLength(file.content, 'utf8'),
      })
    }
  }

  const isDryRun = options.dryRun === true
  const extractedFiles: ExtractedFileInfo[] = []

  if (!options.outDir) {
    // In-memory projection
    for (const item of prepared) {
      extractedFiles.push({
        path: item.file.path,
        mediaType: item.file.mediaType,
        size: item.size,
        written: false,
      })
    }

    return {
      docId,
      title,
      root,
      dryRun: isDryRun,
      totalFiles: extractedFiles.length,
      extractedFiles,
      files: prepared.map((item) => ({
        path: item.file.path,
        mediaType: item.file.mediaType,
        content: item.file.content,
        size: item.size,
      })),
    }
  }

  const resolvedOutDir = canonicalizeSystemPrefix(resolve(options.outDir))

  // 1. Preflight outDir symlink and forbidden destination checks
  await verifyNoSymlinksInAncestry(resolvedOutDir)
  await verifyNotForbidden(resolvedOutDir)

  // Verify that if resolvedOutDir exists, it is a directory
  try {
    const stats = await lstat(resolvedOutDir)
    if (!stats.isDirectory()) {
      throw createTypedError(
        'CONFLICT_ERROR',
        `Output path '${resolvedOutDir}' exists and is not a directory`,
      )
    }
  } catch (err) {
    if (hasErrorCode(err)) {
      if (err.code === 'CONFLICT_ERROR' || err.code === 'VALIDATION_ERROR') throw err
      if (err.code !== 'ENOENT') {
        throw createTypedError(
          'LOCAL_IO_ERROR',
          `Failed to inspect output directory '${resolvedOutDir}': ${getErrorMessage(err)}`,
        )
      }
    } else {
      throw createTypedError(
        'LOCAL_IO_ERROR',
        `Failed to inspect output directory '${resolvedOutDir}': ${getErrorMessage(err)}`,
      )
    }
  }

  // 2. Preflight all target paths and planned collisions before any write
  const plannedFileTargets = new Set<string>()
  const plannedDirPrefixes = new Set<string>()

  for (const item of prepared) {
    const relPath =
      root !== '.' && item.file.path.startsWith(`${root}/`)
        ? item.file.path.slice(root.length + 1)
        : item.file.path
    const safeRel = relPath.replace(/^(\.\/)+/, '').replace(/^\/+/, '')
    const targetPath = canonicalizeSystemPrefix(resolve(resolvedOutDir, safeRel))

    // Traversal check
    if (!targetPath.startsWith(resolvedOutDir + sep) && targetPath !== resolvedOutDir) {
      throw createTypedError(
        'VALIDATION_ERROR',
        `Path traversal detected: target path '${targetPath}' escapes output directory '${resolvedOutDir}'`,
      )
    }

    if (targetPath === resolvedOutDir) {
      throw createTypedError(
        'VALIDATION_ERROR',
        `Target path '${targetPath}' cannot be the output directory itself`,
      )
    }

    // Check duplicate target paths within bundle
    if (plannedFileTargets.has(targetPath)) {
      throw createTypedError(
        'VALIDATION_ERROR',
        `Planned target collision: multiple files map to '${targetPath}'`,
      )
    }
    plannedFileTargets.add(targetPath)

    let parentDir = dirname(targetPath)
    while (parentDir.length >= resolvedOutDir.length) {
      plannedDirPrefixes.add(parentDir)
      if (parentDir === resolvedOutDir) break
      const nextParent = dirname(parentDir)
      if (nextParent === parentDir) break
      parentDir = nextParent
    }

    item.targetPath = targetPath
  }

  // Planned file-vs-dir collision check
  for (const filePath of plannedFileTargets) {
    if (plannedDirPrefixes.has(filePath)) {
      throw createTypedError(
        'VALIDATION_ERROR',
        `Planned file-vs-directory collision: '${filePath}' is both a target file and an ancestor directory of another file`,
      )
    }
  }

  // 3. Inspect target paths on filesystem: symlinks, existing files, non-directory parents
  for (const item of prepared) {
    const targetPath = item.targetPath!

    // Verify no symlinks in entire ancestry
    await verifyNoSymlinksInAncestry(targetPath)
    await verifyNotForbidden(targetPath)

    // Check if targetPath already exists on disk (refuse overwrite)
    try {
      await lstat(targetPath)
      throw createTypedError(
        'CONFLICT_ERROR',
        `Refusing to overwrite existing file at '${targetPath}'`,
      )
    } catch (err) {
      if (hasErrorCode(err)) {
        if (err.code === 'CONFLICT_ERROR' || err.code === 'VALIDATION_ERROR') throw err
        if (err.code !== 'ENOENT') {
          throw createTypedError(
            'LOCAL_IO_ERROR',
            `Failed to inspect target path '${targetPath}': ${getErrorMessage(err)}`,
          )
        }
      } else {
        throw createTypedError(
          'LOCAL_IO_ERROR',
          `Failed to inspect target path '${targetPath}': ${getErrorMessage(err)}`,
        )
      }
    }

    // Check if any ancestor exists and is NOT a directory
    let ancestor = dirname(targetPath)
    while (ancestor.length >= resolvedOutDir.length) {
      try {
        const stats = await lstat(ancestor)
        if (!stats.isDirectory()) {
          throw createTypedError(
            'CONFLICT_ERROR',
            `Refusing to create target under non-directory parent '${ancestor}' for '${targetPath}'`,
          )
        }
      } catch (err) {
        if (hasErrorCode(err)) {
          if (err.code === 'CONFLICT_ERROR' || err.code === 'VALIDATION_ERROR') throw err
          if (err.code !== 'ENOENT') {
            throw createTypedError(
              'LOCAL_IO_ERROR',
              `Failed to inspect ancestor directory '${ancestor}': ${getErrorMessage(err)}`,
            )
          }
        } else {
          throw createTypedError(
            'LOCAL_IO_ERROR',
            `Failed to inspect ancestor directory '${ancestor}': ${getErrorMessage(err)}`,
          )
        }
      }
      if (ancestor === resolvedOutDir) break
      const nextAncestor = dirname(ancestor)
      if (nextAncestor === ancestor) break
      ancestor = nextAncestor
    }
  }

  // 4. If dry-run, return planned results without writing
  if (isDryRun) {
    for (const item of prepared) {
      extractedFiles.push({
        path: item.file.path,
        outputPath: item.targetPath,
        mediaType: item.file.mediaType,
        size: item.size,
        written: false,
      })
    }

    return {
      docId,
      title,
      root,
      outDir: resolvedOutDir,
      dryRun: true,
      totalFiles: extractedFiles.length,
      extractedFiles,
    }
  }

  // 5. Write all prepared files with exclusive creation (wx) and rollback on failure
  const createdFiles: OwnedResource[] = []
  const createdDirs = new Map<string, OwnedResource>()

  // Collect all directories that need to exist, from resolvedOutDir down to leaf directories
  const dirsToEnsure = new Set<string>()
  for (const item of prepared) {
    let curDir = dirname(item.targetPath!)
    while (curDir.length >= resolvedOutDir.length) {
      dirsToEnsure.add(curDir)
      if (curDir === resolvedOutDir) break
      const parent = dirname(curDir)
      if (parent === curDir) break
      curDir = parent
    }
  }

  // Sort shortest length to longest length (parent before child)
  const sortedDirsToEnsure = Array.from(dirsToEnsure).sort((a, b) => a.length - b.length)
  for (const dir of sortedDirsToEnsure) {
    let exists = false
    try {
      await lstat(dir)
      exists = true
    } catch (err) {
      if (!hasErrorCode(err) || err.code !== 'ENOENT') {
        throw createTypedError(
          'LOCAL_IO_ERROR',
          `Failed to inspect directory '${dir}': ${getErrorMessage(err)}`,
        )
      }
    }
    if (!exists) {
      await mkdir(dir)
      const st = await lstat(dir)
      createdDirs.set(dir, { path: dir, dev: st.dev, ino: st.ino })
    }
  }

  const realOutDir = canonicalizeSystemPrefix(await realpath(resolvedOutDir))
  const openFlags =
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0)

  try {
    for (const item of prepared) {
      const targetPath = item.targetPath!

      let handle: FileHandle | null = null
      try {
        handle = await open(targetPath, openFlags, 0o666)
        const fileStat = await handle.stat()
        // Register ownership immediately after exclusive open succeeds (before writing)
        createdFiles.push({ path: targetPath, dev: fileStat.dev, ino: fileStat.ino })

        if (options._faultSeam === 'before-write') {
          throw Object.assign(new Error('ENOSPC: test simulated write fault'), { code: 'ENOSPC' })
        }

        // Before writing, verify realpath(dirname(target)) equals expected resolved directory
        const relDir = relative(resolvedOutDir, dirname(targetPath))
        const expectedDir = canonicalizeSystemPrefix(resolve(realOutDir, relDir))
        const actualDirBefore = canonicalizeSystemPrefix(await realpath(dirname(targetPath)))
        if (actualDirBefore !== expectedDir) {
          throw createTypedError(
            'CONFLICT_ERROR',
            `Ancestor directory path verification failed for '${dirname(targetPath)}': expected '${expectedDir}', got '${actualDirBefore}'`,
          )
        }

        if (item.buffer) {
          await handle.writeFile(item.buffer)
        } else if (item.text !== undefined) {
          await handle.writeFile(item.text, 'utf8')
        }
        await handle.sync()

        if (options._faultSeam === 'during-write') {
          throw Object.assign(new Error('ENOSPC: test simulated write fault'), { code: 'ENOSPC' })
        }
      } finally {
        if (handle) {
          await handle.close().catch(() => {})
        }
      }

      // After closing, verify realpath(dirname(target)) equals expected resolved directory
      const relDir = relative(resolvedOutDir, dirname(targetPath))
      const expectedDir = canonicalizeSystemPrefix(resolve(realOutDir, relDir))
      const actualDirAfter = canonicalizeSystemPrefix(await realpath(dirname(targetPath)))
      if (actualDirAfter !== expectedDir) {
        throw createTypedError(
          'CONFLICT_ERROR',
          `Ancestor directory path verification failed for '${dirname(targetPath)}' after write: expected '${expectedDir}', got '${actualDirAfter}'`,
        )
      }

      extractedFiles.push({
        path: item.file.path,
        outputPath: targetPath,
        mediaType: item.file.mediaType,
        size: item.size,
        written: true,
      })
    }
  } catch (writeErr) {
    await rollbackExtraction(createdFiles, createdDirs.values())

    if (hasErrorCode(writeErr)) {
      if (writeErr.code === 'EEXIST') {
        const pathSuffix = writeErr.path ? ` at '${writeErr.path}'` : ''
        throw createTypedError('CONFLICT_ERROR', `Refusing to overwrite existing file${pathSuffix}`)
      }
      if (writeErr.code === 'VALIDATION_ERROR' || writeErr.code === 'CONFLICT_ERROR') {
        throw writeErr
      }
    }
    throw createTypedError(
      'LOCAL_IO_ERROR',
      `Failed to write extracted file: ${getErrorMessage(writeErr)}`,
    )
  }

  return {
    docId,
    title,
    root,
    outDir: resolvedOutDir,
    dryRun: false,
    totalFiles: extractedFiles.length,
    extractedFiles,
  }
}
