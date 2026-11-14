import { positiveDimensions, readU16BE } from './image-dimensions'
import type { ImageDimensions } from './image-dimensions'

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

type JpegScanStep =
  { kind: 'continue'; nextOffset: number } | { kind: 'done'; dimensions: ImageDimensions | null }

function readJpegFrameDimensions(bytes: Uint8Array, offset: number): ImageDimensions | null {
  const height = readU16BE(bytes, offset + JPEG_FRAME_HEIGHT_OFFSET)
  const width = readU16BE(bytes, offset + JPEG_FRAME_WIDTH_OFFSET)
  return positiveDimensions(width, height)
}

function scanJpegMarkerAt(bytes: Uint8Array, offset: number): JpegScanStep {
  if (bytes[offset] !== JPEG_MARKER_PREFIX) return { kind: 'continue', nextOffset: offset + 1 }
  const marker = bytes[offset + 1]
  if (marker === JPEG_MARKER_PREFIX) return { kind: 'continue', nextOffset: offset + 1 }
  if (isStandaloneJpegMarker(marker)) {
    return { kind: 'continue', nextOffset: offset + JPEG_MARKER_LENGTH }
  }
  const segmentLength = readU16BE(bytes, offset + JPEG_MARKER_LENGTH)
  const isValidSegment = segmentLength !== null && segmentLength >= JPEG_MINIMUM_SEGMENT_LENGTH
  if (!isValidSegment) {
    return { kind: 'done', dimensions: null }
  }
  if (isJpegStartOfFrame(marker)) {
    return { kind: 'done', dimensions: readJpegFrameDimensions(bytes, offset) }
  }
  return { kind: 'continue', nextOffset: offset + JPEG_MARKER_LENGTH + segmentLength }
}

function canScanJpegMarker(bytes: Uint8Array, offset: number, scans: number): boolean {
  return offset + 1 < bytes.length && scans < JPEG_MARKER_SCAN_LIMIT
}

export function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = JPEG_START_OF_IMAGE_LENGTH
  let scans = 0
  while (canScanJpegMarker(bytes, offset, scans)) {
    scans++
    const step = scanJpegMarkerAt(bytes, offset)
    if (step.kind === 'done') return step.dimensions
    offset = step.nextOffset
  }
  return null
}
