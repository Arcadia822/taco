export interface PngHeader {
  width: number
  height: number
  bitDepth: number
  colorType: number
  compression: number
  filter: number
  interlace: number
}

export interface ValidatedView {
  filename: string
  size: number
  dimensions: string
  colorType: number
  valid: true
}

export interface DirectoryValidation {
  valid: true
  totalBytes: number
  views: ValidatedView[]
}

export declare class PngValidationError extends Error {
  readonly code: string
  constructor(message: string, code: string)
}

/** Header-only read: this validator never decodes pixels. */
export declare const parsePngIhdr: (buffer: Buffer) => PngHeader
export declare const assertCleanChunks: (buffer: Buffer) => void
export declare const validateSinglePng: (
  filePath: string,
  expectedFilename: string,
) => ValidatedView
export declare const validateDirectory: (dirPath: string) => DirectoryValidation
