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

const IMAGE_SIGNATURES: ByteSignature[] = [
  { parts: [{ sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }], mime: 'image/png', ext: '.png' },
  { parts: [{ sig: [0xff, 0xd8, 0xff] }], mime: 'image/jpeg', ext: '.jpg' },
  { parts: [{ sig: [0x47, 0x49, 0x46, 0x38] }], mime: 'image/gif', ext: '.gif' },
  { parts: [{ sig: [0x42, 0x4d] }], mime: 'image/bmp', ext: '.bmp' },
  {
    // WebP: "RIFF"...."WEBP"
    parts: [
      { sig: [0x52, 0x49, 0x46, 0x46] },
      { sig: [0x57, 0x45, 0x42, 0x50], offset: 8 },
    ],
    mime: 'image/webp',
    ext: '.webp',
  },
]

function matchesSignature(bytes: Uint8Array, signature: ByteSignature): boolean {
  return signature.parts.every((part) => startsWith(bytes, part.sig, part.offset ?? 0))
}

/**
 * Sniff a renderable image MIME type from the leading bytes
 * (PNG/JPEG/GIF/WebP/BMP/SVG), or `null` when the bytes are not a recognised
 * image.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  for (const signature of IMAGE_SIGNATURES) {
    if (matchesSignature(bytes, signature)) return signature.mime
  }
  // SVG: leading "<svg" or "<?xml" followed somewhere by "<svg" — keep it simple
  // by checking the first non-whitespace bytes against "<svg" or "<?xml".
  if (looksLikeSvg(bytes)) {
    return 'image/svg+xml'
  }
  return null
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
  for (const signature of IMAGE_SIGNATURES) {
    if (matchesSignature(bytes, signature)) return signature.ext
  }
  // PDF: "%PDF"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return '.pdf'
  // ZIP: "PK\x03\x04" (also covers ZIP-based formats)
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return '.zip'
  // GZIP
  if (startsWith(bytes, [0x1f, 0x8b])) return '.gz'
  if (looksLikeSvg(bytes)) return '.svg'
  return '.bin'
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
// Display placeholder
// ---------------------------------------------------------------------------

/**
 * Produce the grid display placeholder for a binary cell:
 * `[BLOB - N bytes]`, or `[BLOB - N bytes*]` when the cell has a staged edit.
 */
export function blobPlaceholder(byteLength: number, modified = false): string {
  return `[BLOB - ${byteLength} bytes${modified ? '*' : ''}]`
}
