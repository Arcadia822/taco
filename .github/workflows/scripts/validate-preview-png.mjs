#!/usr/bin/env node
/**
 * validate-preview-png.mjs
 *
 * Structural validator for the sanitized preview set. It never decodes pixels:
 * the sanitizer container already did the full decode and re-encode, so this
 * check exists to prove before upload and before publication that the directory
 * holds exactly the registered PNGs, in a plain single-frame RGB/RGBA form with
 * no ancillary chunk and no trailing bytes.
 *
 * Usage:
 *   node validate-preview-png.mjs --dir <directory> [--json]
 */

import { lstatSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FIXED_VIEWS, getViewByFilename } from './view-registry.mjs'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_FILE_SIZE = 8 * 1024 * 1024
const MAX_TOTAL_SIZE = 24 * 1024 * 1024
const ALLOWED_COLOR_TYPES = new Set([2, 6])

export class PngValidationError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'PngValidationError'
    this.code = code
  }
}

export function parsePngIhdr(buffer) {
  if (buffer.length < 33) {
    throw new PngValidationError('File too small to contain a PNG header and IHDR', 'ERR_TOO_SMALL')
  }
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new PngValidationError('Invalid PNG magic bytes signature', 'ERR_INVALID_MAGIC')
  }

  const ihdrLength = buffer.readUInt32BE(8)
  const ihdrType = buffer.toString('ascii', 12, 16)
  if (ihdrLength !== 13 || ihdrType !== 'IHDR') {
    throw new PngValidationError('First PNG chunk is not a valid 13-byte IHDR', 'ERR_INVALID_IHDR')
  }

  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const bitDepth = buffer.readUInt8(24)
  const colorType = buffer.readUInt8(25)
  const compression = buffer.readUInt8(26)
  const filter = buffer.readUInt8(27)
  const interlace = buffer.readUInt8(28)

  if (bitDepth !== 8 || !ALLOWED_COLOR_TYPES.has(colorType)) {
    throw new PngValidationError(
      `Unsupported PNG layout: bit depth ${bitDepth}, color type ${colorType}`,
      'ERR_LAYOUT',
    )
  }
  if (compression !== 0 || filter !== 0 || interlace !== 0) {
    throw new PngValidationError(
      `Unsupported PNG framing: compression ${compression}, filter ${filter}, interlace ${interlace}`,
      'ERR_FRAMING',
    )
  }

  return { width, height, bitDepth, colorType, compression, filter, interlace }
}

/** Walks the chunk table and refuses anything the sanitizer would have removed. */
export function assertCleanChunks(buffer) {
  let offset = 8
  let sawIhdr = false
  let sawIdat = false

  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) {
      throw new PngValidationError('PNG ends inside a chunk header', 'ERR_CORRUPT_CHUNK')
    }
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (!/^[A-Za-z]{4}$/.test(type)) {
      throw new PngValidationError('A PNG chunk name is not four ASCII letters', 'ERR_CHUNK_NAME')
    }
    const total = 12 + length
    if (offset + total > buffer.length) {
      throw new PngValidationError(`Chunk ${type} overruns the file`, 'ERR_CORRUPT_CHUNK')
    }

    if (type === 'IHDR') {
      if (sawIhdr) throw new PngValidationError('Duplicate IHDR chunk', 'ERR_LAYOUT')
      sawIhdr = true
    } else if (type === 'IDAT') {
      if (!sawIhdr) throw new PngValidationError('IDAT before IHDR', 'ERR_LAYOUT')
      sawIdat = true
    } else if (type === 'IEND') {
      if (!sawIdat) throw new PngValidationError('IEND before IDAT', 'ERR_LAYOUT')
      if (offset + total !== buffer.length) {
        throw new PngValidationError('Trailing bytes after IEND', 'ERR_TRAILING_BYTES')
      }
      return
    } else {
      throw new PngValidationError(`Unexpected ancillary chunk ${type}`, 'ERR_ANCILLARY_CHUNK')
    }

    offset += total
  }

  throw new PngValidationError('PNG is missing its IEND chunk', 'ERR_NO_IEND')
}

export function validateSinglePng(filePath, expectedFilename) {
  const info = lstatSync(filePath)
  if (info.isSymbolicLink()) {
    throw new PngValidationError(`File ${filePath} is a symbolic link`, 'ERR_SYMLINK')
  }
  if (!info.isFile()) {
    throw new PngValidationError(`File ${filePath} is not a regular file`, 'ERR_NOT_REGULAR')
  }
  if (info.nlink !== 1) {
    throw new PngValidationError(`File ${filePath} has ${info.nlink} hard links`, 'ERR_HARDLINK')
  }
  if (info.size <= 0 || info.size > MAX_FILE_SIZE) {
    throw new PngValidationError(
      `File ${filePath} size ${info.size} is outside 0 < size <= ${MAX_FILE_SIZE}`,
      'ERR_SIZE',
    )
  }

  const expectedView = getViewByFilename(expectedFilename)
  const targetWidth = expectedView ? expectedView.viewport.width : 1280
  const targetHeight = expectedView ? expectedView.viewport.height : 800

  const buffer = readFileSync(filePath)
  const ihdr = parsePngIhdr(buffer)
  if (ihdr.width !== targetWidth || ihdr.height !== targetHeight) {
    throw new PngValidationError(
      `Dimension mismatch for ${expectedFilename}: expected ${targetWidth}x${targetHeight}, got ${ihdr.width}x${ihdr.height}`,
      'ERR_DIMENSION_MISMATCH',
    )
  }
  assertCleanChunks(buffer)

  return {
    filename: expectedFilename,
    size: info.size,
    dimensions: `${ihdr.width}x${ihdr.height}`,
    colorType: ihdr.colorType,
    valid: true,
  }
}

export function validateDirectory(dirPath, options = {}) {
  const { plan = null } = options
  const resolvedDir = resolve(dirPath)
  if (!existsSync(resolvedDir)) {
    throw new PngValidationError(`Directory does not exist: ${resolvedDir}`, 'ERR_DIR_MISSING')
  }

  let expectedNames = []
  let manifest = null
  const manifestPath = join(resolvedDir, 'manifest.json')

  if (plan && plan.scenes && Array.isArray(plan.scenes)) {
    // Derive expected screenshots from the TRUSTED plan
    for (const scene of plan.scenes) {
      for (const step of scene.steps || []) {
        if (step.do === 'shot' && step.name) {
          expectedNames.push(`${scene.id}-${step.name}.png`)
        }
      }
    }
  }

  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      if (plan) {
        // Strict structural cross-validation against the trusted plan
        if (plan.source && manifest.planSource !== plan.source) {
          throw new PngValidationError(`Manifest planSource mismatch`, 'ERR_PLAN_SOURCE')
        }
        if (Array.isArray(plan.scenes)) {
          if (!Array.isArray(manifest.scenes) || manifest.scenes.length !== plan.scenes.length) {
            throw new PngValidationError(`Manifest scene count mismatch`, 'ERR_SCENE_COUNT')
          }
          for (let sIdx = 0; sIdx < plan.scenes.length; sIdx += 1) {
            const expectedScene = plan.scenes[sIdx]
            const actualScene = manifest.scenes[sIdx]
            if (!actualScene || actualScene.id !== expectedScene.id) {
              throw new PngValidationError(
                `Manifest scene [${sIdx}] ID mismatch: expected ${expectedScene.id}`,
                'ERR_SCENE_ID',
              )
            }
            if (actualScene.status === 'passed') {
              const expectedShots = (expectedScene.steps || []).filter((st) => st.do === 'shot')
              const actualShots = actualScene.screenshots || []
              if (actualShots.length !== expectedShots.length) {
                throw new PngValidationError(
                  `Manifest scene [${expectedScene.id}] shot count mismatch: expected ${expectedShots.length}, got ${actualShots.length}`,
                  'ERR_SHOT_COUNT',
                )
              }
            }
          }
        }
      }

      if (expectedNames.length === 0 && manifest.scenes && Array.isArray(manifest.scenes)) {
        for (const scene of manifest.scenes) {
          for (const shot of scene.screenshots || []) {
            expectedNames.push(shot.filename)
          }
        }
      }
      if (manifest.status === 'passed' && expectedNames.length === 0) {
        throw new PngValidationError(
          'Manifest claims passed status but contains 0 screenshots',
          'ERR_EMPTY_SCREENSHOTS',
        )
      }
    } catch (e) {
      if (e instanceof PngValidationError) throw e
      throw new PngValidationError(`Invalid manifest.json: ${e.message}`, 'ERR_MANIFEST')
    }
  } else if (expectedNames.length === 0) {
    expectedNames = FIXED_VIEWS.map((view) => view.filename)
  }
  const entries = readdirSync(resolvedDir)
  const allowedEntries = new Set([...expectedNames, 'manifest.json'])
  const unexpected = entries.filter((entry) => !allowedEntries.has(entry))
  if (unexpected.length > 0) {
    throw new PngValidationError(
      `Unexpected files in the preview directory: ${unexpected
        .map((name) =>
          String(name).replace(
            /[^\x20-\x7e]/g,
            (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
          ),
        )
        .join(', ')}`,
      'ERR_EXTRA_FILE',
    )
  }

  const results = []
  let totalBytes = 0
  for (const filename of expectedNames) {
    const filePath = join(resolvedDir, filename)
    if (!existsSync(filePath)) {
      throw new PngValidationError(
        `Required view screenshot missing: ${filename}`,
        'ERR_MISSING_FILE',
      )
    }
    const info = validateSinglePng(filePath, filename)
    totalBytes += info.size
    results.push(info)
  }

  if (totalBytes > MAX_TOTAL_SIZE) {
    throw new PngValidationError(
      `Total preview bundle size ${totalBytes} exceeds the budget ${MAX_TOTAL_SIZE}`,
      'ERR_TOTAL_SIZE',
    )
  }

  return { valid: true, totalBytes, views: results, manifest }
}

function parseArgs(argv) {
  const options = { dir: '', json: false, planFile: '' }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dir' && argv[index + 1]) {
      options.dir = argv[index + 1]
      index += 1
    } else if (argv[index] === '--plan' && argv[index + 1]) {
      options.planFile = argv[index + 1]
      index += 1
    } else if (argv[index] === '--json') {
      options.json = true
    }
  }
  return options
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2))
  if (!options.dir) {
    console.error('Usage: node validate-preview-png.mjs --dir <directory> [--json]')
    process.exit(1)
  }

  try {
    let plan = null
    if (options.planFile && existsSync(options.planFile)) {
      plan = JSON.parse(readFileSync(options.planFile, 'utf-8'))
    }
    const result = validateDirectory(options.dir, { plan })
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(
        `Validated ${result.views.length} screenshots (${result.totalBytes} bytes total).`,
      )
    }
  } catch (err) {
    if (options.json) {
      console.log(
        JSON.stringify(
          { valid: false, error: err.message, code: err.code ?? 'ERR_UNKNOWN' },
          null,
          2,
        ),
      )
    } else {
      console.error(`Validation failed: ${err.message}`)
    }
    process.exit(1)
  }
}
