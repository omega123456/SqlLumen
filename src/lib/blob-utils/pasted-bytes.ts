import { base64ToBytes } from '../blob-utils'

export type ParsePastedBytesResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string }

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

const HEX_DIGITS_RE = /^[0-9a-fA-F]+$/

const HEX_PREFIX_RE = /^0x/i

const HEX_PREFIX_LENGTH = '0x'.length

const HEX_RADIX = 16

const HEX_DIGITS_PER_BYTE = 2

export const BASE64_CHARS_PER_QUANTUM = 4

export const BYTES_PER_BASE64_QUANTUM = 3

export const BASE64_PADDING_SUFFIXES = ['==', '=']

function hasOddDigitCount(hexDigits: string): boolean {
  return hexDigits.length % HEX_DIGITS_PER_BYTE !== 0
}

export function hexDigitsToBytes(hexDigits: string): Uint8Array {
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

export function parsePastedBytes(text: string): ParsePastedBytesResult {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return { ok: false, error: 'No data to parse.' }
  }

  const stripped = trimmed.replace(/\s+/g, '')

  if (HEX_DIGITS_RE.test(stripped)) {
    if (hasOddDigitCount(stripped)) {
      return { ok: false, error: 'Hex input has an odd number of digits.' }
    }
    return { ok: true, bytes: hexDigitsToBytes(stripped) }
  }

  const isBase64Text = BASE64_RE.test(stripped) && isWholeBase64Quanta(stripped)
  if (isBase64Text) {
    try {
      return { ok: true, bytes: base64ToBytes(stripped) }
    } catch {
      return { ok: false, error: 'Input is not valid base64.' }
    }
  }

  return { ok: false, error: 'Input is neither valid base64 nor hex.' }
}

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

export interface HexDumpRow {
  offset: string
  hexBytes: string[]
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
