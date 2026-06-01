import { describe, expect, it } from 'vitest'

import {
  base64ByteLength,
  base64ToBytes,
  blobPlaceholder,
  formatBytes,
  blobTypeLabel,
  bytesEnvelope,
  bytesToBase64,
  decodeUtf8BestEffort,
  detectBlobExtension,
  emptyEnvelope,
  formatHexDump,
  isBinaryDataType,
  isBlobEnvelope,
  nullEnvelope,
  parsePastedBytes,
  readImageDimensions,
  sniffImageMime,
} from '../../lib/blob-utils'

describe('isBinaryDataType', () => {
  it('returns true for all six binary type names (any case)', () => {
    expect(isBinaryDataType('BLOB')).toBe(true)
    expect(isBinaryDataType('tinyblob')).toBe(true)
    expect(isBinaryDataType('MediumBlob')).toBe(true)
    expect(isBinaryDataType('LONGBLOB')).toBe(true)
    expect(isBinaryDataType('Binary')).toBe(true)
    expect(isBinaryDataType('varbinary')).toBe(true)
  })

  it('matches the base type even with length modifiers', () => {
    expect(isBinaryDataType('VARBINARY(255)')).toBe(true)
    expect(isBinaryDataType('binary(16)')).toBe(true)
    expect(isBinaryDataType('  BLOB ')).toBe(true)
  })

  it('returns false for non-binary types and empty input', () => {
    expect(isBinaryDataType('varchar')).toBe(false)
    expect(isBinaryDataType('int')).toBe(false)
    expect(isBinaryDataType('text')).toBe(false)
    expect(isBinaryDataType('')).toBe(false)
  })
})

describe('base64 ↔ bytes', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255, 128, 64])
    const b64 = bytesToBase64(bytes)
    expect(base64ToBytes(b64)).toEqual(bytes)
  })

  it('handles empty bytes', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('')
    expect(base64ToBytes('')).toEqual(new Uint8Array([]))
  })
})

describe('parsePastedBytes', () => {
  it('parses base64 input', () => {
    const b64 = bytesToBase64(new Uint8Array([1, 2, 3, 4]))
    const result = parsePastedBytes(b64)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bytes).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('parses whitespace-tolerant hex input', () => {
    const result = parsePastedBytes('89 50 4E\n47')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bytes).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  })

  it('rejects empty input', () => {
    const result = parsePastedBytes('   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/no data/i)
  })

  it('rejects odd-length hex', () => {
    const result = parsePastedBytes('abc')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/odd/i)
  })

  it('rejects malformed input that is neither base64 nor hex', () => {
    const result = parsePastedBytes('not valid !!! @@@')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/neither/i)
  })
})

describe('formatHexDump', () => {
  it('formats a single full 16-byte row with offset and ASCII', () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ])
    const rows = formatHexDump(bytes)
    expect(rows).toHaveLength(1)
    expect(rows[0].offset).toBe('00000000')
    expect(rows[0].hexBytes).toHaveLength(16)
    expect(rows[0].hexBytes[1]).toBe('50')
    expect(rows[0].ascii).toBe('.PNG........IHDR')
  })

  it('handles a partial final row without padding entries', () => {
    const bytes = new Uint8Array([0x41, 0x42, 0x43])
    const rows = formatHexDump(bytes)
    expect(rows).toHaveLength(1)
    expect(rows[0].hexBytes).toEqual(['41', '42', '43'])
    expect(rows[0].ascii).toBe('ABC')
  })

  it('emits multiple rows with incrementing offsets', () => {
    const bytes = new Uint8Array(20)
    const rows = formatHexDump(bytes)
    expect(rows).toHaveLength(2)
    expect(rows[0].offset).toBe('00000000')
    expect(rows[1].offset).toBe('00000010')
    expect(rows[1].hexBytes).toHaveLength(4)
  })

  it('returns no rows for empty bytes', () => {
    expect(formatHexDump(new Uint8Array([]))).toEqual([])
  })
})

describe('decodeUtf8BestEffort', () => {
  it('decodes valid UTF-8', () => {
    const bytes = new TextEncoder().encode('héllo')
    expect(decodeUtf8BestEffort(bytes)).toBe('héllo')
  })

  it('replaces invalid byte sequences with the replacement character', () => {
    const bytes = new Uint8Array([0x41, 0xff, 0xfe, 0x42])
    const decoded = decodeUtf8BestEffort(bytes)
    expect(decoded).toContain('A')
    expect(decoded).toContain('B')
    expect(decoded).toContain('�')
  })
})

describe('sniffImageMime', () => {
  it('detects PNG', () => {
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png'
    )
  })

  it('detects JPEG', () => {
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
  })

  it('detects GIF', () => {
    expect(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif')
  })

  it('detects BMP', () => {
    expect(sniffImageMime(new Uint8Array([0x42, 0x4d, 0x00, 0x00]))).toBe('image/bmp')
  })

  it('detects WebP', () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ])
    expect(sniffImageMime(bytes)).toBe('image/webp')
  })

  it('detects SVG', () => {
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(sniffImageMime(bytes)).toBe('image/svg+xml')
  })

  it('returns null for non-image bytes', () => {
    expect(sniffImageMime(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull()
    expect(sniffImageMime(new Uint8Array([]))).toBeNull()
  })
})

describe('detectBlobExtension', () => {
  it('detects PNG', () => {
    expect(
      detectBlobExtension(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ).toBe('.png')
  })

  it('detects JPEG', () => {
    expect(detectBlobExtension(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('.jpg')
  })

  it('detects GIF', () => {
    expect(detectBlobExtension(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe('.gif')
  })

  it('detects PDF', () => {
    expect(detectBlobExtension(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe('.pdf')
  })

  it('detects ZIP', () => {
    expect(detectBlobExtension(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe('.zip')
  })

  it('detects GZIP and BMP and WebP and SVG', () => {
    expect(detectBlobExtension(new Uint8Array([0x1f, 0x8b]))).toBe('.gz')
    expect(detectBlobExtension(new Uint8Array([0x42, 0x4d]))).toBe('.bmp')
    expect(
      detectBlobExtension(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
      )
    ).toBe('.webp')
    expect(detectBlobExtension(new TextEncoder().encode('<svg></svg>'))).toBe('.svg')
  })

  it('defaults to .bin for unknown content', () => {
    expect(detectBlobExtension(new Uint8Array([0x00, 0x11, 0x22, 0x33]))).toBe('.bin')
    expect(detectBlobExtension(new Uint8Array([]))).toBe('.bin')
  })
})

describe('readImageDimensions', () => {
  it('reads PNG dimensions from the IHDR chunk', () => {
    const bytes = new Uint8Array(24)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
    // width 800 = 0x0320, height 600 = 0x0258 (big-endian U32).
    bytes.set([0x00, 0x00, 0x03, 0x20], 16)
    bytes.set([0x00, 0x00, 0x02, 0x58], 20)
    expect(readImageDimensions(bytes)).toEqual({ width: 800, height: 600 })
  })

  it('reads JPEG dimensions by scanning to the SOF0 marker', () => {
    const bytes = new Uint8Array([
      0xff,
      0xd8, // SOI
      0xff,
      0xe0,
      0x00,
      0x04,
      0x00,
      0x00, // APP0 (length 4, 2 payload bytes)
      0xff,
      0xc0,
      0x00,
      0x11, // SOF0 marker + length 17
      0x08, // precision
      0x01,
      0x90, // height 400
      0x02,
      0x80, // width 640
    ])
    expect(readImageDimensions(bytes)).toEqual({ width: 640, height: 400 })
  })

  it('reads GIF dimensions from the logical screen descriptor', () => {
    const bytes = new Uint8Array([
      0x47,
      0x49,
      0x46,
      0x38,
      0x39,
      0x61, // "GIF89a"
      0x20,
      0x00, // width 32 (LE)
      0x10,
      0x00, // height 16 (LE)
    ])
    expect(readImageDimensions(bytes)).toEqual({ width: 32, height: 16 })
  })

  it('reads BMP dimensions from the DIB header (absolute height)', () => {
    const bytes = new Uint8Array(26)
    bytes.set([0x42, 0x4d], 0)
    // width 100 = 0x64, height -50 (top-down) -> reported as 50.
    bytes.set([0x64, 0x00, 0x00, 0x00], 18)
    bytes.set([0xce, 0xff, 0xff, 0xff], 22)
    expect(readImageDimensions(bytes)).toEqual({ width: 100, height: 50 })
  })

  it('reads WebP (VP8) dimensions', () => {
    const bytes = new Uint8Array(32)
    bytes.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
    bytes.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
    bytes.set([0x56, 0x50, 0x38, 0x20], 12) // "VP8 "
    // width 256 = 0x0100, height 128 = 0x0080 (14-bit LE at 26/28).
    bytes.set([0x00, 0x01], 26)
    bytes.set([0x80, 0x00], 28)
    expect(readImageDimensions(bytes)).toEqual({ width: 256, height: 128 })
  })

  it('reads WebP (VP8X) dimensions', () => {
    const bytes = new Uint8Array(30)
    bytes.set([0x52, 0x49, 0x46, 0x46], 0)
    bytes.set([0x57, 0x45, 0x42, 0x50], 8)
    bytes.set([0x56, 0x50, 0x38, 0x58], 12) // "VP8X"
    // (width-1) and (height-1) as U24LE at 24/27. width 100, height 50.
    bytes.set([0x63, 0x00, 0x00], 24)
    bytes.set([0x31, 0x00, 0x00], 27)
    expect(readImageDimensions(bytes)).toEqual({ width: 100, height: 50 })
  })

  it('reads WebP (VP8L) dimensions', () => {
    const bytes = new Uint8Array(25)
    bytes.set([0x52, 0x49, 0x46, 0x46], 0)
    bytes.set([0x57, 0x45, 0x42, 0x50], 8)
    bytes.set([0x56, 0x50, 0x38, 0x4c], 12) // "VP8L"
    bytes[20] = 0x2f
    // width 321, height 123 -> store (width-1)/(height-1) in packed LE form.
    const packed = 320 | (122 << 14)
    bytes[21] = packed & 0xff
    bytes[22] = (packed >>> 8) & 0xff
    bytes[23] = (packed >>> 16) & 0xff
    bytes[24] = (packed >>> 24) & 0xff
    expect(readImageDimensions(bytes)).toEqual({ width: 321, height: 123 })
  })

  it('returns null for non-image bytes', () => {
    expect(readImageDimensions(new Uint8Array([0x00, 0x11, 0x22, 0x33]))).toBeNull()
    expect(readImageDimensions(new Uint8Array([]))).toBeNull()
  })

  it('returns null for truncated PNG and JPEG headers', () => {
    expect(
      readImageDimensions(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ).toBeNull()
    expect(readImageDimensions(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull()
  })
})

describe('blobTypeLabel', () => {
  it('labels each recognised format', () => {
    expect(blobTypeLabel(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'PNG image'
    )
    expect(blobTypeLabel(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('JPEG image')
    expect(blobTypeLabel(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe('GIF image')
    expect(blobTypeLabel(new Uint8Array([0x42, 0x4d]))).toBe('BMP image')
    expect(
      blobTypeLabel(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
      )
    ).toBe('WebP image')
    expect(blobTypeLabel(new TextEncoder().encode('<svg></svg>'))).toBe('SVG image')
    expect(blobTypeLabel(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe('PDF document')
    expect(blobTypeLabel(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe('ZIP archive')
    expect(blobTypeLabel(new Uint8Array([0x1f, 0x8b]))).toBe('Gzip archive')
  })

  it('defaults to "Binary" for unknown content', () => {
    expect(blobTypeLabel(new Uint8Array([0x00, 0x11, 0x22, 0x33]))).toBe('Binary')
    expect(blobTypeLabel(new Uint8Array([]))).toBe('Binary')
  })
})

describe('blob-envelope builders and detector', () => {
  it('bytesEnvelope produces the exact shape', () => {
    expect(bytesEnvelope('QUJD')).toEqual({
      __sqllumen_blob__: true,
      kind: 'bytes',
      base64: 'QUJD',
    })
  })

  it('nullEnvelope produces the exact shape', () => {
    expect(nullEnvelope()).toEqual({ __sqllumen_blob__: true, kind: 'null' })
  })

  it('emptyEnvelope produces the exact shape', () => {
    expect(emptyEnvelope()).toEqual({ __sqllumen_blob__: true, kind: 'empty' })
  })

  it('isBlobEnvelope recognises valid envelopes', () => {
    expect(isBlobEnvelope(bytesEnvelope('QUJD'))).toBe(true)
    expect(isBlobEnvelope(nullEnvelope())).toBe(true)
    expect(isBlobEnvelope(emptyEnvelope())).toBe(true)
  })

  it('isBlobEnvelope rejects invalid values', () => {
    expect(isBlobEnvelope(null)).toBe(false)
    expect(isBlobEnvelope(undefined)).toBe(false)
    expect(isBlobEnvelope('string')).toBe(false)
    expect(isBlobEnvelope(42)).toBe(false)
    expect(isBlobEnvelope({})).toBe(false)
    expect(isBlobEnvelope({ __sqllumen_blob__: true, kind: 'other' })).toBe(false)
    expect(isBlobEnvelope({ __sqllumen_blob__: false, kind: 'bytes', base64: 'x' })).toBe(false)
    // bytes kind requires a string base64
    expect(isBlobEnvelope({ __sqllumen_blob__: true, kind: 'bytes' })).toBe(false)
    // null/empty must not carry a base64
    expect(isBlobEnvelope({ __sqllumen_blob__: true, kind: 'null', base64: 'x' })).toBe(false)
  })
})

describe('blobPlaceholder', () => {
  it('renders without the modified flag', () => {
    expect(blobPlaceholder(24)).toBe('[BLOB - 24 B]')
    expect(blobPlaceholder(0)).toBe('[BLOB - 0 B]')
    expect(blobPlaceholder(4096)).toBe('[BLOB - 4 KB]')
  })

  it('renders with the modified flag', () => {
    expect(blobPlaceholder(24, true)).toBe('[BLOB - 24 B*]')
    expect(blobPlaceholder(0, true)).toBe('[BLOB - 0 B*]')
  })
})

describe('formatBytes', () => {
  it('keeps sub-kilobyte values as exact byte counts', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('scales into KB / MB / GB / TB with up to one decimal', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(4096)).toBe('4 KB')
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB')
    expect(formatBytes(1024 ** 3)).toBe('1 GB')
    expect(formatBytes(1024 ** 4)).toBe('1 TB')
    expect(formatBytes(5 * 1024 ** 4)).toBe('5 TB')
  })

  it('renders negative / non-finite inputs as 0 B', () => {
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B')
  })
})

describe('base64ByteLength', () => {
  it('computes decoded byte length without allocating', () => {
    expect(base64ByteLength('')).toBe(0)
    expect(base64ByteLength('aGk=')).toBe(2) // "hi"
    expect(base64ByteLength('SGVsbG8=')).toBe(5) // "Hello"
    expect(base64ByteLength('Zm9vYmFy')).toBe(6) // "foobar"
  })

  it('matches the real decoded length round-trip', () => {
    const base64 = bytesToBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7]))
    expect(base64ByteLength(base64)).toBe(base64ToBytes(base64).byteLength)
  })
})
