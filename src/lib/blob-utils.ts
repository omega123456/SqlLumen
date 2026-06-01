/**
 * Pure, framework-free helpers for BLOB (binary column) handling.
 *
 * No React, no Tauri IPC, no Zustand — every function here is a pure transform
 * over bytes/strings so the dialog, stores, and grid hosts can share tested
 * encoding logic. The blob-envelope shape produced here must stay in lockstep
 * with the Rust value-binder (`__sqllumen_blob__` marker).
 */

import type { BlobEnvelope } from '../types/schema'

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
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

/** Decode a standard base64 string to bytes. Throws on malformed input. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// ---------------------------------------------------------------------------
// Paste parsing (base64 OR whitespace-tolerant hex, auto-detected)
// ---------------------------------------------------------------------------

export type ParsePastedBytesResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string }

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

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
  if (/^[0-9a-fA-F]+$/.test(stripped)) {
    if (stripped.length % 2 !== 0) {
      return { ok: false, error: 'Hex input has an odd number of digits.' }
    }
    const bytes = new Uint8Array(stripped.length / 2)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(stripped.substring(i * 2, i * 2 + 2), 16)
    }
    return { ok: true, bytes }
  }

  // Base64: validate charset, decode.
  if (BASE64_RE.test(stripped) && stripped.length % 4 === 0) {
    try {
      return { ok: true, bytes: base64ToBytes(stripped) }
    } catch {
      return { ok: false, error: 'Input is not valid base64.' }
    }
  }

  return { ok: false, error: 'Input is neither valid base64 nor hex.' }
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
    for (let i = rowStart; i < rowEnd; i++) {
      const byte = bytes[i]
      hexBytes.push(byte.toString(16).padStart(2, '0'))
      ascii += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.'
    }
    rows.push({
      offset: rowStart.toString(16).padStart(8, '0'),
      hexBytes,
      ascii,
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

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false
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

const IMAGE_SIGNATURES: ByteSignature[] = [
  {
    parts: [{ sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
    mime: 'image/png',
    ext: '.png',
  },
  { parts: [{ sig: [0xff, 0xd8, 0xff] }], mime: 'image/jpeg', ext: '.jpg' },
  { parts: [{ sig: [0x47, 0x49, 0x46, 0x38] }], mime: 'image/gif', ext: '.gif' },
  { parts: [{ sig: [0x42, 0x4d] }], mime: 'image/bmp', ext: '.bmp' },
  {
    // WebP: "RIFF"...."WEBP"
    parts: [{ sig: [0x52, 0x49, 0x46, 0x46] }, { sig: [0x57, 0x45, 0x42, 0x50], offset: 8 }],
    mime: 'image/webp',
    ext: '.webp',
  },
]

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
  const prefix = decodeUtf8BestEffort(bytes.subarray(0, 256)).trimStart().toLowerCase()
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
  // PDF: "%PDF"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return '.pdf'
  // ZIP: "PK\x03\x04" (also covers ZIP-based formats)
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return '.zip'
  // GZIP
  if (startsWith(bytes, [0x1f, 0x8b])) return '.gz'
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

/** Read a big-endian unsigned 16-bit integer at `offset`, or `null` if short. */
function readU16BE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 2 > bytes.length) return null
  return (bytes[offset] << 8) | bytes[offset + 1]
}

/** Read a big-endian unsigned 32-bit integer at `offset`, or `null` if short. */
function readU32BE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) return null
  return (
    (bytes[offset] * 0x1000000 +
      (bytes[offset + 1] << 16) +
      (bytes[offset + 2] << 8) +
      bytes[offset + 3]) >>>
    0
  )
}

/** Read a little-endian signed 32-bit integer at `offset`, or `null` if short. */
function readI32LE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) return null
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24) |
    0
  )
}

/** Read a little-endian unsigned 16-bit integer at `offset`, or `null` if short. */
function readU16LE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 2 > bytes.length) return null
  return bytes[offset] | (bytes[offset + 1] << 8)
}

/** Read a little-endian unsigned 24-bit integer at `offset`, or `null` if short. */
function readU24LE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 3 > bytes.length) return null
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  // PNG: 8-byte signature, then IHDR chunk: 4-byte length, "IHDR", width, height (both U32BE).
  const width = readU32BE(bytes, 16)
  const height = readU32BE(bytes, 20)
  if (width === null || height === null || width === 0 || height === 0) return null
  return { width, height }
}

const JPEG_MARKER_SCAN_LIMIT = 4096

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  // Walk JPEG segments starting after the SOI (0xFFD8) marker, looking for a
  // Start-Of-Frame marker (SOF0–SOF15, excluding DHT/JPG/DAC at C4/C8/CC).
  let offset = 2
  let scans = 0
  while (offset + 1 < bytes.length && scans < JPEG_MARKER_SCAN_LIMIT) {
    scans++
    if (bytes[offset] !== 0xff) {
      // Skip fill bytes / desync gracefully.
      offset++
      continue
    }
    const marker = bytes[offset + 1]
    // Skip standalone markers (padding 0xFF, RSTn, SOI/EOI/TEM) that carry no length.
    if (marker === 0xff) {
      offset++
      continue
    }
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0x01
    ) {
      offset += 2
      continue
    }
    const segmentLength = readU16BE(bytes, offset + 2)
    if (segmentLength === null || segmentLength < 2) return null
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      // SOF payload: precision (1 byte), height (U16BE), width (U16BE).
      const height = readU16BE(bytes, offset + 5)
      const width = readU16BE(bytes, offset + 7)
      if (width === null || height === null || width === 0 || height === 0) return null
      return { width, height }
    }
    offset += 2 + segmentLength
  }
  return null
}

function readGifDimensions(bytes: Uint8Array): ImageDimensions | null {
  // GIF logical screen descriptor: width (U16LE), height (U16LE) at offset 6.
  const width = readU16LE(bytes, 6)
  const height = readU16LE(bytes, 8)
  if (width === null || height === null || width === 0 || height === 0) return null
  return { width, height }
}

function readBmpDimensions(bytes: Uint8Array): ImageDimensions | null {
  // BMP DIB header begins at offset 14; width/height are signed I32LE at 18/22.
  const width = readI32LE(bytes, 18)
  const height = readI32LE(bytes, 22)
  if (width === null || height === null || width === 0 || height === 0) return null
  // Height may be negative (top-down bitmap); report the absolute magnitude.
  return { width: Math.abs(width), height: Math.abs(height) }
}

function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  // RIFF header occupies bytes 0..11; the WebP chunk FourCC starts at offset 12.
  if (bytes.length < 16) return null
  const fourCc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
  if (fourCc === 'VP8 ') {
    // Lossy: frame tag (3 bytes) + start code, then width/height as U14LE at 26/28.
    const w = readU16LE(bytes, 26)
    const h = readU16LE(bytes, 28)
    if (w === null || h === null) return null
    const width = w & 0x3fff
    const height = h & 0x3fff
    if (width === 0 || height === 0) return null
    return { width, height }
  }
  if (fourCc === 'VP8L') {
    // Lossless: signature 0x2f at offset 20, then 14-bit (width-1)/height-1 packed.
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null
    // The 4 bytes are little-endian; reconstruct as LE and unpack.
    const le = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
    const width = (le & 0x3fff) + 1
    const height = ((le >>> 14) & 0x3fff) + 1
    return { width, height }
  }
  if (fourCc === 'VP8X') {
    // Extended: 1 byte flags + 3 reserved at 20, then (width-1)/(height-1) as U24LE at 24/27.
    const w = readU24LE(bytes, 24)
    const h = readU24LE(bytes, 27)
    if (w === null || h === null) return null
    return { width: w + 1, height: h + 1 }
  }
  return null
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
  return { __sqllumen_blob__: true, kind: 'bytes', base64 }
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
  const obj = value as Record<string, unknown>
  if (obj.__sqllumen_blob__ !== true) return false
  if (obj.kind !== 'bytes' && obj.kind !== 'null' && obj.kind !== 'empty') return false
  if (obj.kind === 'bytes') {
    return typeof obj.base64 === 'string'
  }
  return obj.base64 === undefined
}

// ---------------------------------------------------------------------------
// Human-friendly byte sizes
// ---------------------------------------------------------------------------

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const

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
  if (bytes < 1024) return `${bytes} B`
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024
    unitIndex++
  }
  const rounded = Math.round(value * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${text} ${BYTE_UNITS[unitIndex]}`
}

/**
 * Compute the decoded byte length of a standard base64 string by arithmetic,
 * without allocating the decoded bytes. Returns 0 for the empty string.
 */
export function base64ByteLength(base64: string): number {
  if (base64.length === 0) return 0
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
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
