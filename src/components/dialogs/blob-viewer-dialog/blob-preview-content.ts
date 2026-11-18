import { decodeUtf8BestEffort, formatHexDump, type HexDumpRow } from '../../../lib/blob-utils'
import { HEX_PREVIEW_BYTE_LIMIT, TEXT_PREVIEW_BYTE_LIMIT, previewBytes } from './blob-working-value'

const TEXT_CHUNK_CHARACTERS = 4096
const NEWLINE = '\n'

export const TEXT_CHUNKS_PER_FRAME = 1
export const HEX_ROWS_PER_FRAME = 32

function textChunkEnd(text: string, chunkStart: number): number {
  const fullChunkEnd = chunkStart + TEXT_CHUNK_CHARACTERS
  if (fullChunkEnd >= text.length) return text.length
  const lastNewline = text.lastIndexOf(NEWLINE, fullChunkEnd - 1)
  const hasNewlineInChunk = lastNewline >= chunkStart
  if (!hasNewlineInChunk) return fullChunkEnd
  return lastNewline + 1
}

export function textPreviewChunks(bytes: Uint8Array): string[] {
  const text = decodeUtf8BestEffort(previewBytes(bytes, TEXT_PREVIEW_BYTE_LIMIT).bytes)
  const chunks: string[] = []
  let chunkStart = 0
  while (chunkStart < text.length) {
    const chunkEnd = textChunkEnd(text, chunkStart)
    chunks.push(text.slice(chunkStart, chunkEnd))
    chunkStart = chunkEnd
  }
  return chunks
}

export function hexPreviewRows(bytes: Uint8Array): HexDumpRow[] {
  return formatHexDump(previewBytes(bytes, HEX_PREVIEW_BYTE_LIMIT).bytes)
}
