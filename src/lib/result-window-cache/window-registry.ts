import { type ResultSlotRef } from '../query-commands'
import { normalizeTinyIntRows } from '../table-data-commands'
import type { ColumnMeta, ResultWindow } from '../../types/schema'
import type { DataViewRouteKind, DataViewSurfaceRef } from '../../stores/data-view/data-view-types'
import {
  MAX_CONCURRENT_PAGE_FETCHES,
  RESULT_MAX_PAGES,
  RESULT_PAGE_SIZE,
} from '../result-window-cache'

export interface WindowNotifyInfo {
  reseeded: boolean
}

export type WindowRangeListener = (range: ViewRange, info?: WindowNotifyInfo) => void

export type RowPatchApply = (row: unknown[]) => unknown[]

export type RowPatchListener = (baseIndex: number, apply: RowPatchApply) => void

export type ViewRange = readonly [start: number, end: number]

export interface CachedRow {
  row: unknown[]
  baseIndex: number
}

export interface ReadProgress {
  done: number
  total: number
}

export interface ReadOptions {
  signal?: AbortSignal
  onProgress?: (progress: ReadProgress) => void
}

export interface WindowStatusPatch {
  pendingRange?: ViewRange | null
  failedRange?: ViewRange | null
}

export interface WindowStatusUpdate {
  surface: DataViewSurfaceRef
  patch: WindowStatusPatch
  failure?: { message: string }
}

export type WindowStatusHandler = (update: WindowStatusUpdate) => void

export type WindowExpiredHandler = (surface: DataViewSurfaceRef) => void

export interface SeedResultWindowParams {
  route: DataViewRouteKind
  connectionId: string
  tabId: string
  resultIndex: number
  queryId: string
  viewVersion: number
  viewRowCount: number
  columns: ColumnMeta[]
  window: ResultWindow
}

interface Page {
  rows: unknown[][]
  baseIndices: number[]
  lastUsed: number
}

export interface Surface {
  route: DataViewRouteKind
  slot: ResultSlotRef
  columns: ColumnMeta[]
  viewVersion: number
  viewRowCount: number
  pages: Map<number, Page>
  inflight: Set<number>
  generation: number
  lastRequested: ViewRange | null
  failedRange: ViewRange | null
  pendingRange: ViewRange | null
  pendingTimer: ReturnType<typeof setTimeout> | null
  listeners: Set<WindowRangeListener>
  rowPatchListeners: Set<RowPatchListener>
}

export const surfaces = new Map<string, Surface>()

let useCounter = 0

export function nextPageUseStamp(): number {
  useCounter += 1
  return useCounter
}

let statusHandler: WindowStatusHandler | null = null

export let expiredHandler: WindowExpiredHandler | null = null

export function resultSurfaceKey(tabId: string, resultIndex: number): string {
  return `${tabId}:${resultIndex}`
}

export function setWindowStatusHandler(handler: WindowStatusHandler | null): void {
  statusHandler = handler
}

export function setWindowExpiredHandler(handler: WindowExpiredHandler | null): void {
  expiredHandler = handler
}

export function normalizeRows(columns: ColumnMeta[], rows: unknown[][]): unknown[][] {
  return normalizeTinyIntRows(columns, rows)
}

export function notify(surface: Surface, range: ViewRange, info?: WindowNotifyInfo): void {
  for (const listener of surface.listeners) {
    notifyListener(listener, range, info)
  }
}

function notifyListener(
  listener: WindowRangeListener,
  range: ViewRange,
  info: WindowNotifyInfo | undefined
): void {
  if (info) {
    listener(range, info)
    return
  }
  listener(range)
}

export function reportStatus(
  surface: Surface,
  patch: WindowStatusPatch,
  failure?: { message: string }
): void {
  statusHandler?.({
    surface: surfaceRefOf(surface),
    patch: patch,
    failure: failure,
  })
}

export function surfaceRefOf(surface: Surface): DataViewSurfaceRef {
  return {
    route: surface.route,
    tabId: surface.slot.tabId,
    resultIndex: surface.slot.resultIndex,
  }
}

export function pageRange(surface: Surface, pageIndex: number): ViewRange {
  const start = pageIndex * RESULT_PAGE_SIZE
  return [start, Math.min(surface.viewRowCount, start + RESULT_PAGE_SIZE)]
}

export function storeWindow(surface: Surface, window: ResultWindow): void {
  const rows = normalizeRows(surface.columns, window.rows)
  for (let rowIndex = 0; rowIndex < rows.length;) {
    const position = window.offset + rowIndex
    const pageIndex = Math.floor(position / RESULT_PAGE_SIZE)
    const pageStart = pageIndex * RESULT_PAGE_SIZE
    const take = Math.min(rows.length - rowIndex, pageStart + RESULT_PAGE_SIZE - position)
    if (position === pageStart) {
      surface.pages.set(pageIndex, {
        rows: rows.slice(rowIndex, rowIndex + take),
        baseIndices: window.baseIndices.slice(rowIndex, rowIndex + take),
        lastUsed: nextPageUseStamp(),
      })
    }
    rowIndex += take
  }
}

function isWithinPageBudget(surface: Surface): boolean {
  return surface.pages.size <= RESULT_MAX_PAGES
}

export function hasInflightPages(surface: Surface): boolean {
  return surface.inflight.size > 0
}

export function isAtPageFetchLimit(surface: Surface): boolean {
  return surface.inflight.size >= MAX_CONCURRENT_PAGE_FETCHES
}

export function evictPages(surface: Surface): void {
  if (isWithinPageBudget(surface)) return
  const protectedPages = new Set<number>()
  if (surface.lastRequested) {
    const [start, end] = surface.lastRequested
    const firstPage = Math.floor(start / RESULT_PAGE_SIZE)
    const lastPage = Math.floor(Math.max(start, end - 1) / RESULT_PAGE_SIZE)
    for (let page = firstPage; page <= lastPage; page++) {
      protectedPages.add(page)
    }
  }
  const candidates = [...surface.pages.entries()]
    .filter(([index]) => !protectedPages.has(index))
    .sort((left, right) => left[1].lastUsed - right[1].lastUsed)
  for (const [index] of candidates) {
    if (isWithinPageBudget(surface)) break
    surface.pages.delete(index)
  }
}

export function clearPendingTimer(surface: Surface): void {
  if (surface.pendingTimer) {
    clearTimeout(surface.pendingTimer)
    surface.pendingTimer = null
  }
}

export function settlePending(surface: Surface): void {
  if (hasInflightPages(surface)) return
  clearPendingTimer(surface)
  if (surface.pendingRange) {
    surface.pendingRange = null
    reportStatus(surface, { pendingRange: null })
  }
}

export function freshSurface(params: SeedResultWindowParams): Surface {
  return {
    route: params.route,
    slot: {
      connectionId: params.connectionId,
      tabId: params.tabId,
      resultIndex: params.resultIndex,
      queryId: params.queryId,
    },
    columns: params.columns,
    viewVersion: params.viewVersion,
    viewRowCount: params.viewRowCount,
    pages: new Map(),
    inflight: new Set(),
    generation: 1,
    lastRequested: null,
    failedRange: null,
    pendingRange: null,
    pendingTimer: null,
    listeners: new Set(),
    rowPatchListeners: new Set(),
  }
}

export function reseededSurface(params: SeedResultWindowParams, previous: Surface): Surface {
  const isSameQuery = previous.slot.queryId === params.queryId
  return {
    ...freshSurface(params),
    generation: previous.generation + 1,
    lastRequested: isSameQuery ? previous.lastRequested : null,
    listeners: previous.listeners,
    rowPatchListeners: previous.rowPatchListeners,
  }
}

export function hasWindowStatus(surface: Surface | undefined): boolean {
  if (!surface) return false
  return Boolean(surface.pendingRange || surface.failedRange)
}

export function isRegisteredSurface(surface: Surface): boolean {
  return surfaces.get(keyOf(surface)) === surface
}

export function isSurfaceCurrent(surface: Surface, generation: number): boolean {
  return surface.generation === generation && isRegisteredSurface(surface)
}

export function keyOf(surface: Surface): string {
  return resultSurfaceKey(surface.slot.tabId, surface.slot.resultIndex)
}
