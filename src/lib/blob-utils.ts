/**
 * Pure, framework-free helpers for BLOB (binary column) handling.
 *
 * No React, no Tauri IPC, no Zustand — every function here is a pure transform
 * over bytes/strings so the dialog, stores, and grid hosts can share tested
 * encoding logic. The blob-envelope shape produced here must stay in lockstep
 * with the Rust value-binder (`__sqllumen_blob__` marker).
 */

import type { BlobEnvelope, TableDataColumnMeta } from '../types/schema'

// ---------------------------------------------------------------------------
// Binary data-type detection (mirrors backend `is_binary_data_type`)
// ---------------------------------------------------------------------------

const BINARY_DATA_TYPES = new Set([
  'blob',
  'tinyblob',
  'mediumblob',
  'longblob',
  'binary',
  'varbinary',
])

/**
 * Returns true when `dataType` names a binary column type
 * (BLOB/TINYBLOB/MEDIUMBLOB/LONGBLOB/BINARY/VARBINARY), case-insensitively.
 *
 * The base type name is matched even when the declaration carries a length or
 * other modifier (e.g. `VARBINARY(255)`, `binary(16)`).
 */
export function isBinaryDataType(dataType: string): boolean {
  if (!dataType) return false
  const base = dataType.trim().toLowerCase().split('(')[0].trim()
  return BINARY_DATA_TYPES.has(base)
}

// ---------------------------------------------------------------------------
// base64 ↔ Uint8Array
// ---------------------------------------------------------------------------

/** Encode bytes to a standard base64 string. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

/** Decode a standard base64 string to bytes. Throws on malformed input. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

// ---------------------------------------------------------------------------
// Paste parsing (base64 OR whitespace-tolerant hex, auto-detected)
// ---------------------------------------------------------------------------

export type ParsePastedBytesResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string }

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/
const HEX_DIGITS_RE = /^[0-9a-fA-F]+$/
const HEX_PREFIX_RE = /^0x/i
const HEX_PREFIX_LENGTH = '0x'.length
const HEX_RADIX = 16
const HEX_DIGITS_PER_BYTE = 2
const BASE64_CHARS_PER_QUANTUM = 4
const BYTES_PER_BASE64_QUANTUM = 3
const BASE64_PADDING_SUFFIXES = ['==', '=']

function hasOddDigitCount(hexDigits: string): boolean {
  return hexDigits.length % HEX_DIGITS_PER_BYTE !== 0
}

function hexDigitsToBytes(hexDigits: string): Uint8Array {
  const bytes = new Uint8Array(hexDigits.length / HEX_DIGITS_PER_BYTE)
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
    const digitStart = byteIndex * HEX_DIGITS_PER_BYTE
    bytes[byteIndex] = parseInt(
      hexDigits.substring(digitStart, digitStart + HEX_DIGITS_PER_BYTE),
      HEX_RADIX
    )
  }
  return bytes
}

function isWholeBase64Quanta(base64: string): boolean {
  return base64.length % BASE64_CHARS_PER_QUANTUM === 0
}

/**
 * Parse pasted text as either base64 or whitespace-tolerant hex into bytes.
 *
 * Detection: text consisting solely of hex digits and whitespace (with an even
 * number of hex digits) is treated as hex; otherwise base64 is attempted.
 */
export function parsePastedBytes(text: string): ParsePastedBytesResult {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return { ok: false, error: 'No data to parse.' }
  }

  // Strip whitespace once; both hex and base64 detection operate on it.
  const stripped = trimmed.replace(/\s+/g, '')

  // Hex: only hex digits and whitespace.
  if (HEX_DIGITS_RE.test(stripped)) {
    if (hasOddDigitCount(stripped)) {
      return { ok: false, error: 'Hex input has an odd number of digits.' }
    }
    return { ok: true, bytes: hexDigitsToBytes(stripped) }
  }

  if (BASE64_RE.test(stripped) && isWholeBase64Quanta(stripped)) {
    try {
      return { ok: true, bytes: base64ToBytes(stripped) }
    } catch {
      return { ok: false, error: 'Input is not valid base64.' }
    }
  }

  return { ok: false, error: 'Input is neither valid base64 nor hex.' }
}

// ---------------------------------------------------------------------------
// Hex-prefixed parsing (binary PK display values: `0x` + hex, any case)
// ---------------------------------------------------------------------------

/**
 * Parse a hex string with an optional `0x`/`0X` prefix (case-insensitive) into
 * bytes. Binary primary-key cells arrive from the backend as `"0x" + HEX`, so
 * this is the lossless inverse used to reconstruct the WHERE-clause bytes.
 *
 * Returns a clear error result (never throws) for odd-length or non-hex input,
 * so callers can abort rather than bind a corrupted/NULL value.
 */
export function parseHexPrefixedBytes(hex: string): ParsePastedBytesResult {
  const body = HEX_PREFIX_RE.test(hex) ? hex.slice(HEX_PREFIX_LENGTH) : hex
  if (body.length === 0) {
    return { ok: true, bytes: new Uint8Array(0) }
  }
  if (!HEX_DIGITS_RE.test(body)) {
    return { ok: false, error: 'Hex input contains non-hex characters.' }
  }
  if (hasOddDigitCount(body)) {
    return { ok: false, error: 'Hex input has an odd number of digits.' }
  }
  return { ok: true, bytes: hexDigitsToBytes(body) }
}

// ---------------------------------------------------------------------------
// Hex dump
// ---------------------------------------------------------------------------

/** A single rendered row of a hex dump. */
export interface HexDumpRow {
  /** 8-digit hex byte offset of the first byte in this row. */
  offset: string
  /** Up to 16 two-char hex byte strings; padded with '' for partial rows. */
  hexBytes: string[]
  /** ASCII rendering (printable bytes as-is, non-printables as '.'). */
  ascii: string
}

const HEX_ROW_WIDTH = 16
const HEX_OFFSET_DIGITS = 8
const FIRST_PRINTABLE_ASCII = 0x20
const LAST_PRINTABLE_ASCII = 0x7e
const NON_PRINTABLE_PLACEHOLDER = '.'

function isPrintableAscii(byte: number): boolean {
  return byte >= FIRST_PRINTABLE_ASCII && byte <= LAST_PRINTABLE_ASCII
}

function toHexDigits(value: number, digitCount: number): string {
  return value.toString(HEX_RADIX).padStart(digitCount, '0')
}

/**
 * Format bytes as classic hex-dump rows: 16 bytes/row, an 8-digit offset, the
 * hex bytes (the consumer renders the 8+8 grouping gap), and an ASCII sidebar.
 *
 * Partial final rows keep their real byte count in `hexBytes` (no padding
 * entries are added); the ASCII string reflects only the actual bytes.
 */
export function formatHexDump(bytes: Uint8Array): HexDumpRow[] {
  const rows: HexDumpRow[] = []
  for (let rowStart = 0; rowStart < bytes.length; rowStart += HEX_ROW_WIDTH) {
    const hexBytes: string[] = []
    let ascii = ''
    const rowEnd = Math.min(rowStart + HEX_ROW_WIDTH, bytes.length)
    for (let index = rowStart; index < rowEnd; index++) {
      const byte = bytes[index]
      hexBytes.push(toHexDigits(byte, HEX_DIGITS_PER_BYTE))
      ascii += isPrintableAscii(byte) ? String.fromCharCode(byte) : NON_PRINTABLE_PLACEHOLDER
    }
    rows.push({
      offset: toHexDigits(rowStart, HEX_OFFSET_DIGITS),
      hexBytes: hexBytes,
      ascii: ascii,
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// UTF-8 best-effort decode
// ---------------------------------------------------------------------------

/**
 * Decode bytes as UTF-8, replacing invalid sequences with the Unicode
 * replacement character (lossy, never throws).
 */
export function decodeUtf8BestEffort(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

// ---------------------------------------------------------------------------
// Image MIME sniffing
// ---------------------------------------------------------------------------

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  for (let index = 0; index < signature.length; index++) {
    if (bytes[offset + index] !== signature[index]) return false
  }
  return true
}

/**
 * Shared image magic-byte signatures, probed in order, mapping each to both an
 * image MIME type and a file extension. Consumed by `sniffImageMime` and
 * `detectBlobExtension` so the probes are defined once.
 *
 * An entry with `parts` matches when every `(sig, offset)` part matches (used by
 * WebP's `RIFF`…`WEBP` pair).
 */
interface ByteSignature {
  parts: { sig: number[]; offset?: number }[]
  mime: string
  ext: string
}

interface ClassifiedBlobType {
  mime: string | null
  ext: string | null
  dimensions: ((bytes: Uint8Array) => ImageDimensions | null) | null
}

function signatureFromHex(hexDigits: string): number[] {
  return Array.from(hexDigitsToBytes(hexDigits))
}

const WEBP_FORMAT_TAG_OFFSET = 8

const IMAGE_SIGNATURES: ByteSignature[] = [
  {
    parts: [{ sig: signatureFromHex('89504e470d0a1a0a') }],
    mime: 'image/png',
    ext: '.png',
  },
  { parts: [{ sig: signatureFromHex('ffd8ff') }], mime: 'image/jpeg', ext: '.jpg' },
  { parts: [{ sig: signatureFromHex('47494638') }], mime: 'image/gif', ext: '.gif' },
  { parts: [{ sig: signatureFromHex('424d') }], mime: 'image/bmp', ext: '.bmp' },
  {
    parts: [
      { sig: signatureFromHex('52494646') },
      { sig: signatureFromHex('57454250'), offset: WEBP_FORMAT_TAG_OFFSET },
    ],
    mime: 'image/webp',
    ext: '.webp',
  },
]

const PDF_SIGNATURE = signatureFromHex('25504446')
const ZIP_SIGNATURE = signatureFromHex('504b0304')
const GZIP_SIGNATURE = signatureFromHex('1f8b')
const SVG_SNIFF_PREFIX_BYTES = 256

function matchesSignature(bytes: Uint8Array, signature: ByteSignature): boolean {
  return signature.parts.every((part) => startsWith(bytes, part.sig, part.offset ?? 0))
}

function classifyImage(bytes: Uint8Array): ClassifiedBlobType | null {
  for (const signature of IMAGE_SIGNATURES) {
    if (!matchesSignature(bytes, signature)) continue
    if (signature.mime === 'image/png') {
      return { mime: signature.mime, ext: signature.ext, dimensions: readPngDimensions }
    }
    if (signature.mime === 'image/jpeg') {
      return { mime: signature.mime, ext: signature.ext, dimensions: readJpegDimensions }
    }
    if (signature.mime === 'image/gif') {
      return { mime: signature.mime, ext: signature.ext, dimensions: readGifDimensions }
    }
    if (signature.mime === 'image/bmp') {
      return { mime: signature.mime, ext: signature.ext, dimensions: readBmpDimensions }
    }
    if (signature.mime === 'image/webp') {
      return { mime: signature.mime, ext: signature.ext, dimensions: readWebpDimensions }
    }
  }
  if (looksLikeSvg(bytes)) {
    return { mime: 'image/svg+xml', ext: '.svg', dimensions: null }
  }
  return null
}

/**
 * Sniff a renderable image MIME type from the leading bytes
 * (PNG/JPEG/GIF/WebP/BMP/SVG), or `null` when the bytes are not a recognised
 * image.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  return classifyImage(bytes)?.mime ?? null
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  // Inspect only a small prefix for textual XML/SVG markers.
  const prefix = decodeUtf8BestEffort(bytes.subarray(0, SVG_SNIFF_PREFIX_BYTES))
    .trimStart()
    .toLowerCase()
  return prefix.startsWith('<svg') || (prefix.startsWith('<?xml') && prefix.includes('<svg'))
}

// ---------------------------------------------------------------------------
// Magic-byte → file extension
// ---------------------------------------------------------------------------

/**
 * Detect a file extension from the leading magic bytes, defaulting to `.bin`
 * for unrecognised content. Used only to seed save-dialog filenames.
 */
export function detectBlobExtension(bytes: Uint8Array): string {
  const image = classifyImage(bytes)
  if (image?.ext) return image.ext
  if (startsWith(bytes, PDF_SIGNATURE)) return '.pdf'
  if (startsWith(bytes, ZIP_SIGNATURE)) return '.zip'
  if (startsWith(bytes, GZIP_SIGNATURE)) return '.gz'
  return '.bin'
}

// ---------------------------------------------------------------------------
// Image pixel dimensions (header-only, synchronous, never throws)
// ---------------------------------------------------------------------------

/** Pixel dimensions parsed from a raster-image header. */
export interface ImageDimensions {
  width: number
  height: number
}

const UINT16_BYTE_LENGTH = 2
const UINT24_BYTE_LENGTH = 3
const UINT32_BYTE_LENGTH = 4
const UINT16_VALUE_COUNT = 0x10000
const LITTLE_ENDIAN = true
const BIG_ENDIAN = false

function fitsInBytes(bytes: Uint8Array, offset: number, byteLength: number): boolean {
  return offset + byteLength <= bytes.length
}

function byteView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function readU16BE(bytes: Uint8Array, offset: number): number | null {
  if (!fitsInBytes(bytes, offset, UINT16_BYTE_LENGTH)) return null
  return byteView(bytes).getUint16(offset, BIG_ENDIAN)
}

function readU32BE(bytes: Uint8Array, offset: number): number | null {
  if (!fitsInBytes(bytes, offset, UINT32_BYTE_LENGTH)) return null
  return byteView(bytes).getUint32(offset, BIG_ENDIAN)
}

function readI32LE(bytes: Uint8Array, offset: number): number | null {
  if (!fitsInBytes(bytes, offset, UINT32_BYTE_LENGTH)) return null
  return byteView(bytes).getInt32(offset, LITTLE_ENDIAN)
}

function readU16LE(bytes: Uint8Array, offset: number): number | null {
  if (!fitsInBytes(bytes, offset, UINT16_BYTE_LENGTH)) return null
  return byteView(bytes).getUint16(offset, LITTLE_ENDIAN)
}

function readU24LE(bytes: Uint8Array, offset: number): number | null {
  if (!fitsInBytes(bytes, offset, UINT24_BYTE_LENGTH)) return null
  const lowWord = byteView(bytes).getUint16(offset, LITTLE_ENDIAN)
  const highByte = bytes[offset + UINT16_BYTE_LENGTH]
  return lowWord + highByte * UINT16_VALUE_COUNT
}

function hasPositiveArea(width: number, height: number): boolean {
  return width !== 0 && height !== 0
}

const PNG_WIDTH_OFFSET = 16
const PNG_HEIGHT_OFFSET = 20

function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  const width = readU32BE(bytes, PNG_WIDTH_OFFSET)
  const height = readU32BE(bytes, PNG_HEIGHT_OFFSET)
  if (width === null || height === null) return null
  if (!hasPositiveArea(width, height)) return null
  return { width, height }
}

const JPEG_MARKER_SCAN_LIMIT = 4096
const JPEG_START_OF_IMAGE_LENGTH = 2
const JPEG_MARKER_LENGTH = 2
const JPEG_MINIMUM_SEGMENT_LENGTH = 2
const JPEG_MARKER_PREFIX = 0xff
const JPEG_START_OF_IMAGE = 0xd8
const JPEG_END_OF_IMAGE = 0xd9
const JPEG_FIRST_RESTART = 0xd0
const JPEG_LAST_RESTART = 0xd7
const JPEG_TEMPORARY = 0x01
const JPEG_FIRST_START_OF_FRAME = 0xc0
const JPEG_LAST_START_OF_FRAME = 0xcf
const JPEG_DEFINE_HUFFMAN_TABLE = 0xc4
const JPEG_EXTENSION = 0xc8
const JPEG_DEFINE_ARITHMETIC_CODING = 0xcc
const JPEG_NON_FRAME_MARKERS_IN_FRAME_RANGE = new Set([
  JPEG_DEFINE_HUFFMAN_TABLE,
  JPEG_EXTENSION,
  JPEG_DEFINE_ARITHMETIC_CODING,
])
const JPEG_FRAME_HEIGHT_OFFSET = 5
const JPEG_FRAME_WIDTH_OFFSET = 7

function isStandaloneJpegMarker(marker: number): boolean {
  const isRestartMarker = marker >= JPEG_FIRST_RESTART && marker <= JPEG_LAST_RESTART
  return (
    marker === JPEG_START_OF_IMAGE ||
    marker === JPEG_END_OF_IMAGE ||
    isRestartMarker ||
    marker === JPEG_TEMPORARY
  )
}

function isJpegStartOfFrame(marker: number): boolean {
  const isInFrameRange = marker >= JPEG_FIRST_START_OF_FRAME && marker <= JPEG_LAST_START_OF_FRAME
  return isInFrameRange && !JPEG_NON_FRAME_MARKERS_IN_FRAME_RANGE.has(marker)
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = JPEG_START_OF_IMAGE_LENGTH
  let scans = 0
  while (offset + 1 < bytes.length && scans < JPEG_MARKER_SCAN_LIMIT) {
    scans++
    if (bytes[offset] !== JPEG_MARKER_PREFIX) {
      offset++
      continue
    }
    const marker = bytes[offset + 1]
    if (marker === JPEG_MARKER_PREFIX) {
      offset++
      continue
    }
    if (isStandaloneJpegMarker(marker)) {
      offset += JPEG_MARKER_LENGTH
      continue
    }
    const segmentLength = readU16BE(bytes, offset + JPEG_MARKER_LENGTH)
    if (segmentLength === null || segmentLength < JPEG_MINIMUM_SEGMENT_LENGTH) return null
    if (isJpegStartOfFrame(marker)) {
      const height = readU16BE(bytes, offset + JPEG_FRAME_HEIGHT_OFFSET)
      const width = readU16BE(bytes, offset + JPEG_FRAME_WIDTH_OFFSET)
      if (width === null || height === null) return null
      if (!hasPositiveArea(width, height)) return null
      return { width, height }
    }
    offset += JPEG_MARKER_LENGTH + segmentLength
  }
  return null
}

const GIF_WIDTH_OFFSET = 6
const GIF_HEIGHT_OFFSET = 8

function readGifDimensions(bytes: Uint8Array): ImageDimensions | null {
  const width = readU16LE(bytes, GIF_WIDTH_OFFSET)
  const height = readU16LE(bytes, GIF_HEIGHT_OFFSET)
  if (width === null || height === null) return null
  if (!hasPositiveArea(width, height)) return null
  return { width, height }
}

const BMP_WIDTH_OFFSET = 18
const BMP_HEIGHT_OFFSET = 22

function readBmpDimensions(bytes: Uint8Array): ImageDimensions | null {
  const width = readI32LE(bytes, BMP_WIDTH_OFFSET)
  const height = readI32LE(bytes, BMP_HEIGHT_OFFSET)
  if (width === null || height === null) return null
  if (!hasPositiveArea(width, height)) return null
  return { width: Math.abs(width), height: Math.abs(height) }
}

const WEBP_FOURCC_OFFSET = 12
const WEBP_FOURCC_LENGTH = 4
const WEBP_FOURCC_END = WEBP_FOURCC_OFFSET + WEBP_FOURCC_LENGTH
const WEBP_LOSSY_FOURCC = 'VP8 '
const WEBP_LOSSLESS_FOURCC = 'VP8L'
const WEBP_EXTENDED_FOURCC = 'VP8X'
const WEBP_LOSSY_WIDTH_OFFSET = 26
const WEBP_LOSSY_HEIGHT_OFFSET = 28
const WEBP_LOSSLESS_SIGNATURE_OFFSET = 20
const WEBP_LOSSLESS_SIGNATURE = 0x2f
const WEBP_LOSSLESS_SIZE_OFFSET = 21
const WEBP_LOSSLESS_SIZE_END = WEBP_LOSSLESS_SIZE_OFFSET + UINT32_BYTE_LENGTH
const WEBP_LOSSLESS_HEIGHT_SHIFT = 14
const WEBP_EXTENDED_WIDTH_OFFSET = 24
const WEBP_EXTENDED_HEIGHT_OFFSET = 27
const FOURTEEN_BIT_MASK = 0x3fff

function readWebpLossyDimensions(bytes: Uint8Array): ImageDimensions | null {
  const rawWidth = readU16LE(bytes, WEBP_LOSSY_WIDTH_OFFSET)
  const rawHeight = readU16LE(bytes, WEBP_LOSSY_HEIGHT_OFFSET)
  if (rawWidth === null || rawHeight === null) return null
  const width = rawWidth & FOURTEEN_BIT_MASK
  const height = rawHeight & FOURTEEN_BIT_MASK
  if (!hasPositiveArea(width, height)) return null
  return { width, height }
}

function readWebpLosslessDimensions(bytes: Uint8Array): ImageDimensions | null {
  const isTruncated = bytes.length < WEBP_LOSSLESS_SIZE_END
  if (isTruncated || bytes[WEBP_LOSSLESS_SIGNATURE_OFFSET] !== WEBP_LOSSLESS_SIGNATURE) return null
  const packedSize = byteView(bytes).getUint32(WEBP_LOSSLESS_SIZE_OFFSET, LITTLE_ENDIAN)
  const width = (packedSize & FOURTEEN_BIT_MASK) + 1
  const height = ((packedSize >>> WEBP_LOSSLESS_HEIGHT_SHIFT) & FOURTEEN_BIT_MASK) + 1
  return { width, height }
}

function readWebpExtendedDimensions(bytes: Uint8Array): ImageDimensions | null {
  const width = readU24LE(bytes, WEBP_EXTENDED_WIDTH_OFFSET)
  const height = readU24LE(bytes, WEBP_EXTENDED_HEIGHT_OFFSET)
  if (width === null || height === null) return null
  return { width: width + 1, height: height + 1 }
}

const WEBP_DIMENSION_READERS: Record<string, (bytes: Uint8Array) => ImageDimensions | null> = {
  [WEBP_LOSSY_FOURCC]: readWebpLossyDimensions,
  [WEBP_LOSSLESS_FOURCC]: readWebpLosslessDimensions,
  [WEBP_EXTENDED_FOURCC]: readWebpExtendedDimensions,
}

function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < WEBP_FOURCC_END) return null
  const fourCc = String.fromCharCode(...bytes.subarray(WEBP_FOURCC_OFFSET, WEBP_FOURCC_END))
  const readDimensions = WEBP_DIMENSION_READERS[fourCc]
  if (!readDimensions) return null
  return readDimensions(bytes)
}

/**
 * Read pixel dimensions from the header of a common raster image
 * (PNG, JPEG, GIF, BMP, WebP), returning `{ width, height }` or `null` when the
 * bytes are not a supported/parseable image or the header is truncated.
 *
 * Pure and synchronous: it inspects only the minimal header prefix, bounds any
 * marker scan (JPEG), and never throws on malformed/short input.
 */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  const image = classifyImage(bytes)
  if (!image?.dimensions) return null
  return image.dimensions(bytes)
}

// ---------------------------------------------------------------------------
// Friendly type label
// ---------------------------------------------------------------------------

const EXTENSION_LABELS: Record<string, string> = {
  '.png': 'PNG image',
  '.jpg': 'JPEG image',
  '.gif': 'GIF image',
  '.bmp': 'BMP image',
  '.webp': 'WebP image',
  '.svg': 'SVG image',
  '.pdf': 'PDF document',
  '.zip': 'ZIP archive',
  '.gz': 'Gzip archive',
}

/**
 * Produce a short, friendly human-readable type label from the leading magic
 * bytes (e.g. "PNG image", "PDF document", "ZIP archive"), defaulting to
 * "Binary" for unrecognised content. Reuses `detectBlobExtension`'s sniffing.
 */
export function blobTypeLabel(bytes: Uint8Array): string {
  const ext = detectBlobExtension(bytes)
  return EXTENSION_LABELS[ext] ?? 'Binary'
}

// ---------------------------------------------------------------------------
// Blob-envelope builders + detector
// ---------------------------------------------------------------------------

/** Build a `bytes` envelope wrapping the given base64 payload. */
export function bytesEnvelope(base64: string): BlobEnvelope {
  return { __sqllumen_blob__: true, kind: 'bytes', base64: base64 }
}

/** Build a `null` envelope (stages SQL NULL). */
export function nullEnvelope(): BlobEnvelope {
  return { __sqllumen_blob__: true, kind: 'null' }
}

/** Build an `empty` envelope (stages a zero-length binary value). */
export function emptyEnvelope(): BlobEnvelope {
  return { __sqllumen_blob__: true, kind: 'empty' }
}

/** Type guard: is `value` a well-formed blob envelope? */
export function isBlobEnvelope(value: unknown): value is BlobEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const object = value as Record<string, unknown>
  if (object.__sqllumen_blob__ !== true) return false
  if (object.kind !== 'bytes' && object.kind !== 'null' && object.kind !== 'empty') return false
  if (object.kind === 'bytes') {
    return typeof object.base64 === 'string'
  }
  return object.base64 === undefined
}

// ---------------------------------------------------------------------------
// Human-friendly byte sizes
// ---------------------------------------------------------------------------

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const
const BYTES_PER_KILOBYTE = 1024
const ONE_DECIMAL_PLACE_SCALE = 10

/**
 * Format a byte count with a human-friendly unit (B, KB, MB, GB, TB).
 *
 * Sub-kilobyte values keep their exact byte count (`512 B`); larger values are
 * shown with up to one decimal place, trimming a trailing `.0`
 * (e.g. `4096 → "4 KB"`, `1536 → "1.5 KB"`). Negative/non-finite inputs render
 * as `0 B`. The Rust `format_bytes` helper mirrors this exactly so the table
 * grid (backend-rendered) and query grid (frontend-rendered) stay identical.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < BYTES_PER_KILOBYTE) return `${bytes} B`
  let value = bytes / BYTES_PER_KILOBYTE
  let unitIndex = 0
  while (value >= BYTES_PER_KILOBYTE && unitIndex < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_KILOBYTE
    unitIndex++
  }
  const rounded = Math.round(value * ONE_DECIMAL_PLACE_SCALE) / ONE_DECIMAL_PLACE_SCALE
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${text} ${BYTE_UNITS[unitIndex]}`
}

/**
 * Compute the decoded byte length of a standard base64 string by arithmetic,
 * without allocating the decoded bytes. Returns 0 for the empty string.
 */
export function base64ByteLength(base64: string): number {
  if (base64.length === 0) return 0
  const paddingSuffix = BASE64_PADDING_SUFFIXES.find((suffix) => base64.endsWith(suffix))
  const padding = paddingSuffix?.length ?? 0
  const quantumBytes = (base64.length * BYTES_PER_BASE64_QUANTUM) / BASE64_CHARS_PER_QUANTUM
  return Math.max(0, Math.floor(quantumBytes) - padding)
}

// ---------------------------------------------------------------------------
// Display placeholder
// ---------------------------------------------------------------------------

/**
 * Produce the grid display placeholder for a binary cell:
 * `[BLOB - <size>]`, or `[BLOB - <size>*]` when the cell has a staged edit,
 * where `<size>` is a human-friendly byte size (e.g. `1.5 KB`).
 */
export function blobPlaceholder(byteLength: number, modified = false): string {
  return `[BLOB - ${formatBytes(byteLength)}${modified ? '*' : ''}]`
}

// ---------------------------------------------------------------------------
// Binary primary-key → blob-envelope transform (gated on column metadata)
// ---------------------------------------------------------------------------

export type ConvertBinaryPkValuesResult =
  { ok: true; values: Record<string, unknown> } | { ok: false; error: string }

/**
 * Return a fresh copy of `pkValues` in which each value belonging to a binary
 * primary-key column and expressed as a hex string is replaced by a blob
 * envelope (zero bytes → `empty`, otherwise `bytes`).
 *
 * Conversion is gated strictly on `TableDataColumnMeta.isBinary` (KD3), never on
 * value shape, so a textual PK that merely looks like `"0x12"` is left alone.
 * Values that are already envelopes, are `null`, or are non-strings pass through
 * unchanged. Malformed hex for a binary PK yields an error result so the caller
 * can abort rather than bind a corrupted/NULL value (C6); the input is never
 * mutated.
 */
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
    // Already-enveloped (object), null, and non-string values pass through;
    // only hex display strings on binary columns are converted.
    if (typeof value !== 'string') continue

    const parsed = parseHexPrefixedBytes(value)
    if (!parsed.ok) {
      return {
        ok: false,
        error: `Invalid binary primary key "${primaryKeyColumn}": ${parsed.error}`,
      }
    }
    result[primaryKeyColumn] =
      parsed.bytes.length === 0 ? emptyEnvelope() : bytesEnvelope(bytesToBase64(parsed.bytes))
  }

  return { ok: true, values: result }
}

export type BuildEnvelopedPkPairsResult =
  { ok: true; pairs: [string, unknown][] } | { ok: false; error: string }

/**
 * Resolve the ordered PK column→value pairs for a BLOB lazy-fetch from a row's
 * data, converting binary primary keys to blob envelopes along the way.
 *
 * Picks each `pkColumn` from `rowData`, runs the shared binary-PK envelope
 * conversion (gated on column metadata), and returns the pairs in `pkColumns`
 * order. Malformed binary-PK hex surfaces as an error result so the caller can
 * abort rather than fetch against a corrupted key; inputs are never mutated.
 */
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
