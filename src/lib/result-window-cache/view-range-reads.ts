import { fetchResultWindow } from '../query-commands'
import { RESULT_MAX_CHUNK_ROWS, RESULT_PAGE_SIZE, VIEW_STALE_PREFIX } from '../result-window-cache'
import { normalizeRows, resultSurfaceKey, surfaces } from './window-registry'
import type { CachedRow, ReadOptions, Surface, ViewRange } from './window-registry'

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Row fetch cancelled', 'AbortError')
}

function loadedRun(surface: Surface, start: number, end: number): CachedRow[] | null {
  const out: CachedRow[] = []
  for (let position = start; position < end; position++) {
    const page = surface.pages.get(Math.floor(position / RESULT_PAGE_SIZE))
    const offset = position % RESULT_PAGE_SIZE
    const row = page?.rows[offset]
    if (!page) return null
    if (row === undefined) return null
    out.push({ row: row, baseIndex: page.baseIndices[offset] })
  }
  return out
}

interface ViewChunkRequest {
  viewVersion: number
  range: ViewRange
  signal: AbortSignal | undefined
}

async function fetchViewChunk(surface: Surface, request: ViewChunkRequest): Promise<CachedRow[]> {
  const [chunkStart, chunkEnd] = request.range
  const response = await fetchResultWindow({
    ...surface.slot,
    viewVersion: request.viewVersion,
    offset: chunkStart,
    limit: chunkEnd - chunkStart,
  })
  throwIfAborted(request.signal)
  if (response.viewVersion !== request.viewVersion) {
    throw new Error(`${VIEW_STALE_PREFIX} the result view changed while rows were loading`)
  }
  const rows = normalizeRows(surface.columns, response.rows)
  return rows.map((row, index) => ({ row: row, baseIndex: response.baseIndices[index] }))
}

export interface ViewRangeRead {
  tabId: string
  resultIndex: number
  range: ViewRange
  options?: ReadOptions
}

export async function readViewRange({
  tabId,
  resultIndex,
  range,
  options = {},
}: ViewRangeRead): Promise<CachedRow[]> {
  const surface = surfaces.get(resultSurfaceKey(tabId, resultIndex))
  if (!surface) throw new Error('Result rows are not available')
  const start = Math.max(0, range[0])
  const end = Math.min(surface.viewRowCount, range[1])
  const total = Math.max(0, end - start)
  const viewVersion = surface.viewVersion
  const out: CachedRow[] = []
  for (let chunkStart = start; chunkStart < end; chunkStart += RESULT_MAX_CHUNK_ROWS) {
    throwIfAborted(options.signal)
    const chunkEnd = Math.min(end, chunkStart + RESULT_MAX_CHUNK_ROWS)
    const chunkRange: ViewRange = [chunkStart, chunkEnd]
    const chunkRows =
      loadedRun(surface, chunkStart, chunkEnd) ??
      (await fetchViewChunk(surface, {
        viewVersion: viewVersion,
        range: chunkRange,
        signal: options.signal,
      }))
    out.push(...chunkRows)
    options.onProgress?.({ done: out.length, total: total })
  }
  return out
}
