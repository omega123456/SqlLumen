import type { BlobEnvelope, TableDataColumnMeta } from '../types/schema'
import { isObjectRecord } from './value-checks'
import {
  BASE64_CHARS_PER_QUANTUM,
  BASE64_PADDING_SUFFIXES,
  BYTES_PER_BASE64_QUANTUM,
  parseHexPrefixedBytes,
} from './blob-utils/pasted-bytes'
export type { ImageDimensions } from './blob-utils/image-dimensions'
export {
  decodeUtf8BestEffort,
  sniffImageMime,
  detectBlobExtension,
  blobTypeLabel,
  readImageDimensions,
} from './blob-utils/blob-type-detection'
export { parsePastedBytes, parseHexPrefixedBytes, formatHexDump } from './blob-utils/pasted-bytes'
export type { ParsePastedBytesResult, HexDumpRow } from './blob-utils/pasted-bytes'

const BINARY_DATA_TYPES = new Set([
  'blob',
  'tinyblob',
  'mediumblob',
  'longblob',
  'binary',
  'varbinary',
])

export function isBinaryDataType(dataType: string): boolean {
  if (!dataType) return false
  const base = dataType.trim().toLowerCase().split('(')[0].trim()
  return BINARY_DATA_TYPES.has(base)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function bytesEnvelope(base64: string): BlobEnvelope {
  return { __sqllumen_blob__: true, kind: 'bytes', base64: base64 }
}

export function nullEnvelope(): BlobEnvelope {
  return { __sqllumen_blob__: true, kind: 'null' }
}

const BLOB_ENVELOPE_KINDS: ReadonlySet<unknown> = new Set(['bytes', 'null', 'empty'])

const BLOB_PLACEHOLDER_PREFIX = '[BLOB'

export function emptyEnvelope(): BlobEnvelope {
  return { __sqllumen_blob__: true, kind: 'empty' }
}

export function isBlobEnvelope(value: unknown): value is BlobEnvelope {
  if (!isObjectRecord(value)) return false
  if (value.__sqllumen_blob__ !== true) return false
  if (!BLOB_ENVELOPE_KINDS.has(value.kind)) return false
  if (value.kind === 'bytes') {
    return typeof value.base64 === 'string'
  }
  return value.base64 === undefined
}

export function envelopeForBytes(bytes: Uint8Array): BlobEnvelope {
  if (bytes.length === 0) return emptyEnvelope()
  return bytesEnvelope(bytesToBase64(bytes))
}

export function envelopeForBase64(base64: string): BlobEnvelope {
  if (base64.length === 0) return emptyEnvelope()
  return bytesEnvelope(base64)
}

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const

const BYTES_PER_KILOBYTE = 1024

const ONE_DECIMAL_PLACE_SCALE = 10

function canScaleToLargerUnit(value: number, unitIndex: number): boolean {
  const isLargestUnit = unitIndex === BYTE_UNITS.length - 1
  return value >= BYTES_PER_KILOBYTE && !isLargestUnit
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '0 B'
  if (bytes < 0) return '0 B'
  if (bytes < BYTES_PER_KILOBYTE) return `${bytes} B`
  let value = bytes / BYTES_PER_KILOBYTE
  let unitIndex = 0
  while (canScaleToLargerUnit(value, unitIndex)) {
    value /= BYTES_PER_KILOBYTE
    unitIndex++
  }
  const rounded = Math.round(value * ONE_DECIMAL_PLACE_SCALE) / ONE_DECIMAL_PLACE_SCALE
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${text} ${BYTE_UNITS[unitIndex]}`
}

export function base64ByteLength(base64: string): number {
  if (base64.length === 0) return 0
  const paddingSuffix = BASE64_PADDING_SUFFIXES.find((suffix) => base64.endsWith(suffix))
  const padding = paddingSuffix?.length ?? 0
  const quantumBytes = (base64.length * BYTES_PER_BASE64_QUANTUM) / BASE64_CHARS_PER_QUANTUM
  return Math.max(0, Math.floor(quantumBytes) - padding)
}

export function blobPlaceholder(byteLength: number, modified = false): string {
  return `[BLOB - ${formatBytes(byteLength)}${modified ? '*' : ''}]`
}

export function isBlobPlaceholderText(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(BLOB_PLACEHOLDER_PREFIX)
}

export type ConvertBinaryPkValuesResult =
  { ok: true; values: Record<string, unknown> } | { ok: false; error: string }

export function convertBinaryPrimaryKeyValuesToEnvelopes(
  primaryKeyColumns: string[],
  columns: TableDataColumnMeta[],
  primaryKeyValues: Record<string, unknown>
): ConvertBinaryPkValuesResult {
  const binaryColumns = new Set(
    columns.filter((column) => column.isBinary).map((column) => column.name)
  )
  const result: Record<string, unknown> = { ...primaryKeyValues }

  for (const primaryKeyColumn of primaryKeyColumns) {
    if (!binaryColumns.has(primaryKeyColumn)) continue
    const value = primaryKeyValues[primaryKeyColumn]
    if (typeof value !== 'string') continue

    const parsed = parseHexPrefixedBytes(value)
    if (!parsed.ok) {
      return {
        ok: false,
        error: `Invalid binary primary key "${primaryKeyColumn}": ${parsed.error}`,
      }
    }
    result[primaryKeyColumn] = envelopeForBytes(parsed.bytes)
  }

  return { ok: true, values: result }
}

export type BuildEnvelopedPkPairsResult =
  { ok: true; pairs: [string, unknown][] } | { ok: false; error: string }

export function buildEnvelopedPrimaryKeyPairs(
  primaryKeyColumns: string[],
  columns: TableDataColumnMeta[],
  rowData: Record<string, unknown>
): BuildEnvelopedPkPairsResult {
  const rawPrimaryKeyValues: Record<string, unknown> = {}
  for (const primaryKeyColumn of primaryKeyColumns) {
    rawPrimaryKeyValues[primaryKeyColumn] = rowData[primaryKeyColumn]
  }

  const converted = convertBinaryPrimaryKeyValuesToEnvelopes(
    primaryKeyColumns,
    columns,
    rawPrimaryKeyValues
  )
  if (!converted.ok) {
    return { ok: false, error: converted.error }
  }

  return {
    ok: true,
    pairs: primaryKeyColumns.map(
      (primaryKeyColumn) =>
        [primaryKeyColumn, converted.values[primaryKeyColumn]] as [string, unknown]
    ),
  }
}
