import { type ResultSlotRef } from './query-commands'
import { HALF_DIVISOR } from './units'
import type { ResultWindow } from '../types/schema'
import { toErrorMessage } from './error-message'
import { isIndexInBounds } from './value-checks'
import { isSurfaceForQuery, requestVisibleRange } from './result-window-cache/window-page-fetch'
import {
  clearPendingTimer,
  freshSurface,
  hasWindowStatus,
  nextPageUseStamp,
  normalizeRows,
  notify,
  reportStatus,
  reseededSurface,
  resultSurfaceKey,
  storeWindow,
  surfaces,
} from './result-window-cache/window-registry'
import type {
  CachedRow,
  RowPatchApply,
  RowPatchListener,
  SeedResultWindowParams,
  Surface,
  WindowRangeListener,
} from './result-window-cache/window-registry'
export {
  resultSurfaceKey,
  setWindowStatusHandler,
  setWindowExpiredHandler,
} from './result-window-cache/window-registry'

export type {
  WindowNotifyInfo,
  WindowRangeListener,
  RowPatchApply,
  RowPatchListener,
  ViewRange,
  CachedRow,
  ReadProgress,
  ReadOptions,
  WindowStatusPatch,
  WindowStatusUpdate,
  WindowStatusHandler,
  WindowExpiredHandler,
  SeedResultWindowParams,
} from './result-window-cache/window-registry'
export { requestVisibleRange, retryFailedWindow } from './result-window-cache/window-page-fetch'
export { readViewRange } from './result-window-cache/view-range-reads'
export type { ViewRangeRead } from './result-window-cache/view-range-reads'

export const RESULT_PAGE_SIZE = 500

export const RESULT_MAX_PAGES = 10

export const RESULT_MAX_CHUNK_ROWS = 2000

export const RESULT_PREFETCH_ROWS = RESULT_PAGE_SIZE / HALF_DIVISOR

export const RESULT_LOADING_STATUS_DELAY_MS = 1000

export const MAX_CONCURRENT_PAGE_FETCHES = 4

export const VIEW_STALE_PREFIX = 'view_stale:'

export const VIEW_SUPERSEDED_PREFIX = 'view_superseded:'

export const RESULTS_EXPIRED_TOKEN = 'results_expired'

export function isViewStaleError(error: unknown): boolean {
  return toErrorMessage(error).startsWith(VIEW_STALE_PREFIX)
}

export function isResultsExpiredError(error: unknown): boolean {
  return toErrorMessage(error).includes(RESULTS_EXPIRED_TOKEN)
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function parseSupersededVersion(error: unknown): number | null {
  const message = toErrorMessage(error)
  if (!message.startsWith(VIEW_SUPERSEDED_PREFIX)) return null
  const match = /current=(\d+)/.exec(message)
  return match ? Number(match[1]) : null
}

export function seedResultWindow(params: SeedResultWindowParams): void {
  const key = resultSurfaceKey(params.tabId, params.resultIndex)
  const previous = surfaces.get(key)
  if (previous) clearPendingTimer(previous)
  const surface = previous ? reseededSurface(params, previous) : freshSurface(params)
  storeWindow(surface, params.window)
  surfaces.set(key, surface)
  if (hasWindowStatus(previous)) {
    reportStatus(surface, { pendingRange: null, failedRange: null })
  }
  notify(surface, [0, surface.viewRowCount], { reseeded: true })
  if (surface.lastRequested)
    requestVisibleRange(params.tabId, params.resultIndex, surface.lastRequested)
}

export function applyResultView(
  tabId: string,
  resultIndex: number,
  view: { viewVersion: number; viewRowCount: number; window?: ResultWindow }
): void {
  const surface = surfaces.get(resultSurfaceKey(tabId, resultIndex))
  if (!surface) return
  seedResultWindow({
    ...surface.slot,
    columns: surface.columns,
    viewVersion: view.viewVersion,
    viewRowCount: view.viewRowCount,
    window: view.window ?? { offset: 0, rows: [], baseIndices: [] },
  })
}

export function getResultSurface(
  tabId: string,
  resultIndex: number
): { slot: ResultSlotRef; viewVersion: number; viewRowCount: number } | undefined {
  const surface = surfaces.get(resultSurfaceKey(tabId, resultIndex))
  if (!surface) return undefined
  return {
    slot: surface.slot,
    viewVersion: surface.viewVersion,
    viewRowCount: surface.viewRowCount,
  }
}

export function getLoadedRow(
  tabId: string,
  resultIndex: number,
  position: number
): CachedRow | undefined {
  const surface = surfaces.get(resultSurfaceKey(tabId, resultIndex))
  if (!surface) return undefined
  if (!isIndexInBounds(position, surface.viewRowCount)) return undefined
  const page = surface.pages.get(Math.floor(position / RESULT_PAGE_SIZE))
  if (!page) return undefined
  const offset = position % RESULT_PAGE_SIZE
  const row = page.rows[offset]
  if (row === undefined) return undefined
  page.lastUsed = nextPageUseStamp()
  return { row: row, baseIndex: page.baseIndices[offset] }
}

function surfaceForSubscription(key: string, tabId: string, resultIndex: number): Surface {
  let surface = surfaces.get(key)
  if (!surface) {
    surface = {
      slot: { connectionId: '', tabId: tabId, resultIndex: resultIndex, queryId: '' },
      columns: [],
      viewVersion: 0,
      viewRowCount: 0,
      pages: new Map(),
      inflight: new Set(),
      generation: 0,
      lastRequested: null,
      failedRange: null,
      pendingRange: null,
      pendingTimer: null,
      listeners: new Set(),
      rowPatchListeners: new Set(),
    }
    surfaces.set(key, surface)
  }
  return surface
}

export function subscribeToResultWindow(
  tabId: string,
  resultIndex: number,
  listener: WindowRangeListener
): () => void {
  const key = resultSurfaceKey(tabId, resultIndex)
  surfaceForSubscription(key, tabId, resultIndex).listeners.add(listener)
  return () => {
    surfaces.get(key)?.listeners.delete(listener)
  }
}

export function subscribeToRowPatches(
  tabId: string,
  resultIndex: number,
  listener: RowPatchListener
): () => void {
  const key = resultSurfaceKey(tabId, resultIndex)
  surfaceForSubscription(key, tabId, resultIndex).rowPatchListeners.add(listener)
  return () => {
    surfaces.get(key)?.rowPatchListeners.delete(listener)
  }
}

export interface SavedRowValues {
  tabId: string
  resultIndex: number
  queryId: string
  baseIndex: number
  updates: Readonly<Record<number, unknown>>
}

export function applySavedRowValues({
  tabId,
  resultIndex,
  queryId,
  baseIndex,
  updates,
}: SavedRowValues): void {
  const surface = surfaces.get(resultSurfaceKey(tabId, resultIndex))
  if (!isSurfaceForQuery(surface, queryId)) return
  const apply: RowPatchApply = (row) => {
    const next = row.slice()
    for (const [column, value] of Object.entries(updates)) next[Number(column)] = value
    return normalizeRows(surface.columns, [next])[0]
  }
  for (const [pageIndex, page] of surface.pages) {
    const offset = page.baseIndices.indexOf(baseIndex)
    if (offset < 0) continue
    page.rows = page.rows.slice()
    page.rows[offset] = apply(page.rows[offset])
    const position = pageIndex * RESULT_PAGE_SIZE + offset
    notify(surface, [position, position + 1])
    break
  }
  for (const listener of surface.rowPatchListeners) listener(baseIndex, apply)
}

export function clearResultWindowPages(tabId: string, resultIndex: number): void {
  const surface = surfaces.get(resultSurfaceKey(tabId, resultIndex))
  if (!surface) return
  surface.generation += 1
  surface.pages.clear()
  surface.inflight.clear()
  clearPendingTimer(surface)
  surface.pendingRange = null
}

export function dropTabResultWindows(tabId: string): void {
  for (const [key, surface] of surfaces) {
    const isOtherTabSurface = surface.slot.tabId !== tabId
    if (isOtherTabSurface) continue
    clearPendingTimer(surface)
    surface.generation += 1
    surfaces.delete(key)
  }
}

export function clearAllResultWindows(): void {
  for (const surface of surfaces.values()) clearPendingTimer(surface)
  surfaces.clear()
}
