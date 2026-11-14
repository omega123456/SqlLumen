export interface ImageDimensions {
  width: number
  height: number
}

const UINT16_BYTE_LENGTH = 2

const UINT24_BYTE_LENGTH = 3

export const UINT32_BYTE_LENGTH = 4

const UINT16_VALUE_COUNT = 0x10000

export const LITTLE_ENDIAN = true

const BIG_ENDIAN = false

function fitsInBytes(bytes: Uint8Array, offset: number, byteLength: number): boolean {
  return offset + byteLength <= bytes.length
}

export function byteView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

export function readU16BE(bytes: Uint8Array, offset: number): number | null {
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

export function readU16LE(bytes: Uint8Array, offset: number): number | null {
  if (!fitsInBytes(bytes, offset, UINT16_BYTE_LENGTH)) return null
  return byteView(bytes).getUint16(offset, LITTLE_ENDIAN)
}

export function readU24LE(bytes: Uint8Array, offset: number): number | null {
  if (!fitsInBytes(bytes, offset, UINT24_BYTE_LENGTH)) return null
  const lowWord = byteView(bytes).getUint16(offset, LITTLE_ENDIAN)
  const highByte = bytes[offset + UINT16_BYTE_LENGTH]
  return lowWord + highByte * UINT16_VALUE_COUNT
}

export function hasPositiveArea(width: number, height: number): boolean {
  return width !== 0 && height !== 0
}

export function positiveDimensions(
  width: number | null,
  height: number | null
): ImageDimensions | null {
  if (width === null) return null
  if (height === null) return null
  if (!hasPositiveArea(width, height)) return null
  return { width, height }
}

const PNG_WIDTH_OFFSET = 16

const PNG_HEIGHT_OFFSET = 20

export function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  const width = readU32BE(bytes, PNG_WIDTH_OFFSET)
  const height = readU32BE(bytes, PNG_HEIGHT_OFFSET)
  return positiveDimensions(width, height)
}

const GIF_WIDTH_OFFSET = 6

const GIF_HEIGHT_OFFSET = 8

export function readGifDimensions(bytes: Uint8Array): ImageDimensions | null {
  const width = readU16LE(bytes, GIF_WIDTH_OFFSET)
  const height = readU16LE(bytes, GIF_HEIGHT_OFFSET)
  return positiveDimensions(width, height)
}

const BMP_WIDTH_OFFSET = 18

const BMP_HEIGHT_OFFSET = 22

export function readBmpDimensions(bytes: Uint8Array): ImageDimensions | null {
  const width = readI32LE(bytes, BMP_WIDTH_OFFSET)
  const height = readI32LE(bytes, BMP_HEIGHT_OFFSET)
  const dimensions = positiveDimensions(width, height)
  if (!dimensions) return null
  return { width: Math.abs(dimensions.width), height: Math.abs(dimensions.height) }
}
