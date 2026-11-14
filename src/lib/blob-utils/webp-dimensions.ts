import {
  LITTLE_ENDIAN,
  UINT32_BYTE_LENGTH,
  byteView,
  hasPositiveArea,
  readU16LE,
  readU24LE,
} from './image-dimensions'
import type { ImageDimensions } from './image-dimensions'

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
  if (rawWidth === null) return null
  if (rawHeight === null) return null
  const width = rawWidth & FOURTEEN_BIT_MASK
  const height = rawHeight & FOURTEEN_BIT_MASK
  if (!hasPositiveArea(width, height)) return null
  return { width, height }
}

function readWebpLosslessDimensions(bytes: Uint8Array): ImageDimensions | null {
  const isTruncated = bytes.length < WEBP_LOSSLESS_SIZE_END
  if (isTruncated) return null
  if (bytes[WEBP_LOSSLESS_SIGNATURE_OFFSET] !== WEBP_LOSSLESS_SIGNATURE) return null
  const packedSize = byteView(bytes).getUint32(WEBP_LOSSLESS_SIZE_OFFSET, LITTLE_ENDIAN)
  const width = (packedSize & FOURTEEN_BIT_MASK) + 1
  const height = ((packedSize >>> WEBP_LOSSLESS_HEIGHT_SHIFT) & FOURTEEN_BIT_MASK) + 1
  return { width, height }
}

function readWebpExtendedDimensions(bytes: Uint8Array): ImageDimensions | null {
  const width = readU24LE(bytes, WEBP_EXTENDED_WIDTH_OFFSET)
  const height = readU24LE(bytes, WEBP_EXTENDED_HEIGHT_OFFSET)
  if (width === null) return null
  if (height === null) return null
  return { width: width + 1, height: height + 1 }
}

const WEBP_DIMENSION_READERS: Record<string, (bytes: Uint8Array) => ImageDimensions | null> = {
  [WEBP_LOSSY_FOURCC]: readWebpLossyDimensions,
  [WEBP_LOSSLESS_FOURCC]: readWebpLosslessDimensions,
  [WEBP_EXTENDED_FOURCC]: readWebpExtendedDimensions,
}

export function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < WEBP_FOURCC_END) return null
  const fourCc = String.fromCharCode(...bytes.subarray(WEBP_FOURCC_OFFSET, WEBP_FOURCC_END))
  const readDimensions = WEBP_DIMENSION_READERS[fourCc]
  if (!readDimensions) return null
  return readDimensions(bytes)
}
