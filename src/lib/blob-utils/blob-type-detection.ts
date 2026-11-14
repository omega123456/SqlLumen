import { readBmpDimensions, readGifDimensions, readPngDimensions } from './image-dimensions'
import type { ImageDimensions } from './image-dimensions'
import { readJpegDimensions } from './jpeg-dimensions'
import { hexDigitsToBytes } from './pasted-bytes'
import { readWebpDimensions } from './webp-dimensions'

export function decodeUtf8BestEffort(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  for (let index = 0; index < signature.length; index++) {
    if (bytes[offset + index] !== signature[index]) return false
  }
  return true
}

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

export function classifyImage(bytes: Uint8Array): ClassifiedBlobType | null {
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

export function sniffImageMime(bytes: Uint8Array): string | null {
  return classifyImage(bytes)?.mime ?? null
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  const prefix = decodeUtf8BestEffort(bytes.subarray(0, SVG_SNIFF_PREFIX_BYTES))
    .trimStart()
    .toLowerCase()
  return prefix.startsWith('<svg') || (prefix.startsWith('<?xml') && prefix.includes('<svg'))
}

export function detectBlobExtension(bytes: Uint8Array): string {
  const image = classifyImage(bytes)
  if (image?.ext) return image.ext
  if (startsWith(bytes, PDF_SIGNATURE)) return '.pdf'
  if (startsWith(bytes, ZIP_SIGNATURE)) return '.zip'
  if (startsWith(bytes, GZIP_SIGNATURE)) return '.gz'
  return '.bin'
}

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

export function blobTypeLabel(bytes: Uint8Array): string {
  const ext = detectBlobExtension(bytes)
  return EXTENSION_LABELS[ext] ?? 'Binary'
}

export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  const image = classifyImage(bytes)
  if (!image?.dimensions) return null
  return image.dimensions(bytes)
}
