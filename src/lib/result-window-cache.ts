/**
 * Non-reactive per-result page cache for windowed query results.
 *
 * The Rust result cache owns every row, the row order (sort), row membership
 * (filter, deletes) and row identity (base indices). The webview only holds a
 * bounded set of 500-row **pages** of the current view per result surface
 * (tab + result index), keyed by query id and view version:
 *
 * - seeded from the first window of every execute / view response;
 * - filled on demand from the grid's visible range, with half a page of
 *   prefetch on each side, de-duplicated in-flight requests and a cap on
 *   concurrent fetches;
 * - at most 10 pages per surface, evicted least-recently-used;
 * - responses whose query id or view version is stale are dropped, never painted.
 *
 * It never writes to zustand: subscribers (the grid) are told which ranges
 * loaded (and when a surface was re-seeded, so a mounted grid re-requests its
 * visible range), and window-level status (the pending range for the 1 s
 * "Loading rows" status, the failed range for the Retry band, expiry) goes to
 * handlers the query store registers. A saved row edit is broadcast by base
 * index to row-patch subscribers (the form view), whether or not its page is
 * loaded.
 *
 * Off-window actions (copy, the text view, the form view, deletes) use
 * `readViewRange`, which fetches in 2,000-row chunks and does not populate the
 * LRU.
 */

import { fetchResultWindow, type ResultSlotRef } from './query-commands'
import { normalizeTinyIntRows } from './table-data-commands'
import { logFrontend } from './app-log-commands'
import type { ColumnMeta, ResultWindow } from '../types/schema'

/** Extra information passed to range listeners. */
export interface WindowNotifyInfo {
  /**
   * True when the surface was (re-)seeded from an execute or view response:
   * every page was dropped, and a mounted grid should re-request its visible
   * range (it may not report a visible-region change on its own).
   */
  reseeded: boolean
}

export type WindowRangeListener = (range: ViewRange, info?: WindowNotifyInfo) => void

/** Applies a saved row edit to a row of the surface (normalized like loaded rows). */
export type RowPatchApply = (row: unknown[]) => unknown[]

export type RowPatchListener = (baseIndex: number, apply: RowPatchApply) => void

/** Rows per page. */
export const RESULT_PAGE_SIZE = 500
/** Maximum pages kept per result surface (about 5,000 rows). */
export const RESULT_MAX_PAGES = 10
/** Maximum rows per window or by-index request (enforced in Rust too). */
export const RESULT_MAX_CHUNK_ROWS = 2000
/** Rows prefetched on each side of the visible region. */
export const RESULT_PREFETCH_ROWS = RESULT_PAGE_SIZE / 2
/** Delay before a still-pending window is reported as "Loading rows …". */
export const RESULT_LOADING_STATUS_DELAY_MS = 1000
/** Maximum page fetches in flight per surface. */
const MAX_CONCURRENT_PAGE_FETCHES = 4

/** Error prefix Rust uses for a window request against an old view version. */
export const VIEW_STALE_PREFIX = 'view_stale:'
/** Error prefix Rust uses for a refused compare-and-swap view write. */
export const VIEW_SUPERSEDED_PREFIX = 'view_superseded:'
/** Error prefix Rust uses when a tab's cached results expired. */
export const RESULTS_EXPIRED_TOKEN = 'results_expired'

/** A half-open view-position range `[start, end)`. */
export type ViewRange = readonly [start: number, end: number]

/** A loaded row plus its stable base index. */
export interface CachedRow {
  row: unknown[]
  baseIndex: number
}

/** Progress of a chunked off-window read. */
export interface ReadProgress {
  done: number
  total: number
}

export interface ReadOptions {
  signal?: AbortSignal
  onProgress?: (progress: ReadProgress) => void
}

/** Window-level status the store mirrors into result metadata. */
export interface WindowStatusPatch {
  pendingWindowRange?: ViewRange | null
  failedWindowRange?: ViewRange | null
}

export type WindowStatusHandler = (
  tabId: string,
  resultIndex: number,
  patch: WindowStatusPatch,
  failure?: { message: string }
) => void

export type WindowExpiredHandler = (tabId: string) => void

/** Parameters for seeding (or re-seeding) a result surface. */
export interface SeedResultWindowParams {
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

interface Surface {
  slot: ResultSlotRef
  columns: ColumnMeta[]
  viewVersion: number
  viewRowCount: number
  pages: Map<number, Page>
  inflight: Set<number>
  /** Bumped whenever the surface is re-seeded; in-flight responses compare it. */
  generation: number
  lastRequested: ViewRange | null
  failedRange: ViewRange | null
  pendingRange: ViewRange | null
  pendingTimer: ReturnType<typeof setTimeout> | null
  listeners: Set<WindowRangeListener>
  rowPatchListeners: Set<RowPatchListener>
}

const surfaces = new Map<string, Surface>()
let useCounter = 0
let statusHandler: WindowStatusHandler | null = null
let expiredHandler: WindowExpiredHandler | null = null

/** Stable key for a result surface. */
export function resultSurfaceKey(tabId: string, resultIndex: number): string {
  return `${tabId}:${resultIndex}`
}

/** Register the handler that mirrors window status into the query store. */
export function setWindowStatusHandler(handler: WindowStatusHandler | null): void {
  statusHandler = handler
}

/** Register the handler that routes `results_expired` to the "Results expired" block. */
export function setWindowExpiredHandler(handler: WindowExpiredHandler | null): void {
  expiredHandler = handler
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** True for a `view_stale:` window refusal (discarded silently). */
export function isViewStaleError(error: unknown): boolean {
  return errorMessage(error).startsWith(VIEW_STALE_PREFIX)
}

/** True for an expired-results error (routed to the "Results expired" block). */
export function isResultsExpiredError(error: unknown): boolean {
  return errorMessage(error).includes(RESULTS_EXPIRED_TOKEN)
}

/** True for an `AbortError` raised by a cancelled read. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Parse the `current=<n>` version from a `view_superseded:` refusal, or null. */
export function parseSupersededVersion(error: unknown): number | null {
  const message = errorMessage(error)
  if (!message.startsWith(VIEW_SUPERSEDED_PREFIX)) return null
  const match = /current=(\d+)/.exec(message)
  return match ? Number(match[1]) : null
}

function normalizeRows(columns: ColumnMeta[], rows: unknown[][]): unknown[][] {
  return normalizeTinyIntRows(columns, rows)
}

function notify(surface: Surface, range: ViewRange, info?: WindowNotifyInfo): void {
  for (const listener of surface.listeners) {
    if (info) listener(range, info)
    else listener(range)
  }
}

function reportStatus(
  surface: Surface,
  patch: WindowStatusPatch,
  failure?: { message: string }
): void {
  statusHandler?.(surface.slot.tabId, surface.slot.resultIndex, patch, failure)
}

function pageRange(surface: Surface, pageIndex: number): ViewRange {
  const start = pageIndex * RESULT_PAGE_SIZE
  return [start, Math.min(surface.viewRowCount, start + RESULT_PAGE_SIZE)]
}

/** Split a window (which may span several pages) into whole or partial pages. */
function storeWindow(surface: Surface, window: ResultWindow): void {
  const rows = normalizeRows(surface.columns, window.rows)
  for (let i = 0; i < rows.length;) {
    const position = window.offset + i
    const pageIndex = Math.floor(position / RESULT_PAGE_SIZE)
    const pageStart = pageIndex * RESULT_PAGE_SIZE
    const take = Math.min(rows.length - i, pageStart + RESULT_PAGE_SIZE - position)
    if (position === pageStart) {
      surface.pages.set(pageIndex, {
        rows: rows.slice(i, i + take),
        baseIndices: window.baseIndices.slice(i, i + take),
        lastUsed: ++useCounter,
      })
    }
    i += take
  }
}

function evictPages(surface: Surface): void {
  if (surface.pages.size <= RESULT_MAX_PAGES) return
  const protectedPages = new Set<number>()
  if (surface.lastRequested) {
    const [start, end] = surface.lastRequested
    for (
      let page = Math.floor(start / RESULT_PAGE_SIZE);
      page <= Math.floor(Math.max(start, end - 1) / RESULT_PAGE_SIZE);
      page++
    ) {
      protectedPages.add(page)
    }
  }
  const candidates = [...surface.pages.entries()]
    .filter(([index]) => !protectedPages.has(index))
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
  for (const [index] of candidates) {
    if (surface.pages.size <= RESULT_MAX_PAGES) break
    surface.pages.delete(index)
  }
}

function clearPendingTimer(surface: Surface): void {
  if (surface.pendingTimer) {
    clearTimeout(surface.pendingTimer)
    surface.pendingTimer = null
  }
}

function settlePending(surface: Surface): void {
  if (surface.inflight.size > 0) return
  clearPendingTimer(surface)
  if (surface.pendingRange) {
    surface.pendingRange = null
    reportStatus(surface, { pendingWindowRange: null })
  }
}

/**
 * Seed (or re-seed) a surface from an execute or view response. Clears every
 * page and in-flight request of the previous query / view.
 */
export function seedResultWindow(params: SeedResultWindowParams): void {
  const key = resultSurfaceKey(params.tabId, params.resultIndex)
  const previous = surfaces.get(key)
  if (previous) clearPendingTimer(previous)
  const surface: Surface = {
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
    generation: (previous?.generation ?? 0) + 1,
    lastRequested: previous?.slot.queryId === params.queryId ? previous.lastRequested : null,
    failedRange: null,
    pendingRange: null,
    pendingTimer: null,
    listeners: previous?.listeners ?? new Set(),
    rowPatchListeners: previous?.rowPatchListeners ?? new Set(),
  }
  storeWindow(surface, params.window)
  surfaces.set(key, surface)
  if (previous?.pendingRange || previous?.failedRange) {
    reportStatus(surface, { pendingWindowRange: null, failedWindowRange: null })
  }
  // A mounted grid re-requests its visible range on `reseeded`: after a re-run
  // that doesn't remount it, the query id changed (so `lastRequested` is gone)
  // but its visible region didn't, and it reports no region change.
  notify(surface, [0, surface.viewRowCount], { reseeded: true })
  if (surface.lastRequested)
    requestVisibleRange(params.tabId, params.resultIndex, surface.lastRequested)
}

/**
 * Paint a new view of the same query (after `set_result_view` or
 * `remove_result_rows`): drop every page and seed the new first window.
 */
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

/** Metadata of a seeded surface, or undefined. */
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

/** A loaded row at a view position (touches its page for LRU), or undefined. */
export function getLoadedRow(
  tabId: string,
  resultIndex: number,
  position: number
): CachedRow | undefined {
  const surface = surfaces.get(resultSurfaceKey(tabId, resultIndex))
  if (!surface || position < 0 || position >= surface.viewRowCount) return undefined
  const page = surface.pages.get(Math.floor(position / RESULT_PAGE_SIZE))
  if (!page) return undefined
  const offset = position % RESULT_PAGE_SIZE
  const row = page.rows[offset]
  if (row === undefined) return undefined
  page.lastUsed = ++useCounter
  return { row, baseIndex: page.baseIndices[offset] }
}

/** The surface for `key`, or a stub that keeps listeners until the first seed. */
function surfaceForSubscription(key: string, tabId: string, resultIndex: number): Surface {
  let surface = surfaces.get(key)
  if (!surface) {
    // Allow subscribing before the first seed: keep the listener on a stub.
    surface = {
      slot: { connectionId: '', tabId, resultIndex, queryId: '' },
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

/** Subscribe to newly loaded ranges of a surface. Returns an unsubscribe function. */
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

/**
 * Subscribe to saved row edits of a surface, by base index. Unlike range
 * listeners, these hear about rows outside the loaded pages too (the form view
 * holds such a row itself). Returns an unsubscribe function.
 */
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

async function fetchPage(surface: Surface, pageIndex: number): Promise<void> {
  const generation = surface.generation
  const viewVersion = surface.viewVersion
  const [start, end] = pageRange(surface, pageIndex)
  surface.inflight.add(pageIndex)
  if (!surface.pendingTimer && !surface.pendingRange) {
    surface.pendingTimer = setTimeout(() => {
      surface.pendingTimer = null
      if (surface.inflight.size === 0 || surfaces.get(keyOf(surface)) !== surface) return
      surface.pendingRange = surface.lastRequested ?? [start, end]
      reportStatus(surface, { pendingWindowRange: surface.pendingRange })
    }, RESULT_LOADING_STATUS_DELAY_MS)
  }
  // Only a successful, current response continues filling the visible range;
  // stale or failed responses must not re-issue the same request.
  let continueFilling = false
  try {
    const response = await fetchResultWindow(surface.slot, viewVersion, start, end - start)
    if (surface.generation !== generation || surfaces.get(keyOf(surface)) !== surface) return
    // A response for an old view is never painted.
    if (response.viewVersion !== surface.viewVersion) return
    storeWindow(surface, response)
    evictPages(surface)
    notify(surface, [response.offset, response.offset + response.rows.length])
    continueFilling = true
  } catch (error) {
    if (surface.generation !== generation || surfaces.get(keyOf(surface)) !== surface) return
    if (isViewStaleError(error)) {
      // A newer view is being painted; its own response re-seeds the surface.
      logFrontend(
        'debug',
        `[result-window-cache] discarding a stale window for ${keyOf(surface)} rows ${start}-${end}: ${errorMessage(error)}`
      )
      return
    }
    if (isResultsExpiredError(error)) {
      expiredHandler?.(surface.slot.tabId)
      return
    }
    const message = errorMessage(error)
    if (message.startsWith('Results were refreshed')) {
      logFrontend(
        'info',
        `[result-window-cache] discarding window for a replaced query: ${message}`
      )
      return
    }
    logFrontend(
      'warn',
      `[result-window-cache] window fetch failed for ${keyOf(surface)} rows ${start}-${end}: ${message}`
    )
    const failed: ViewRange = surface.lastRequested ?? [start, end]
    surface.failedRange = failed
    reportStatus(surface, { failedWindowRange: failed }, { message })
  } finally {
    // After a generation bump the in-flight set was cleared, and a newer fetch
    // of the same page may have re-added it: only the current fetch removes it.
    if (surface.generation === generation) surface.inflight.delete(pageIndex)
    if (surfaces.get(keyOf(surface)) === surface && surface.generation === generation) {
      settlePending(surface)
      if (continueFilling && surface.lastRequested) requestPages(surface, surface.lastRequested)
    }
  }
}

function keyOf(surface: Surface): string {
  return resultSurfaceKey(surface.slot.tabId, surface.slot.resultIndex)
}

function requestPages(surface: Surface, range: ViewRange): void {
  if (surface.viewRowCount === 0 || !surface.slot.queryId) return
  const lastPage = Math.ceil(surface.viewRowCount / RESULT_PAGE_SIZE) - 1
  const firstWanted = Math.max(0, Math.floor((range[0] - RESULT_PREFETCH_ROWS) / RESULT_PAGE_SIZE))
  const lastWanted = Math.min(
    lastPage,
    Math.floor((Math.max(range[0], range[1] - 1) + RESULT_PREFETCH_ROWS) / RESULT_PAGE_SIZE)
  )
  for (let pageIndex = firstWanted; pageIndex <= lastWanted; pageIndex++) {
    const page = surface.pages.get(pageIndex)
    if (page) {
      page.lastUsed = ++useCounter
      continue
    }
    if (surface.inflight.has(pageIndex)) continue
    if (surface.inflight.size >= MAX_CONCURRENT_PAGE_FETCHES) break
    void fetchPage(surface, pageIndex)
  }
}

/**
 * The grid's visible view-position range changed: load the pages it needs
 * (plus prefetch). Responses for an older view are dropped.
 */
export function requestVisibleRange(tabId: string, resultIndex: number, range: ViewRange): void {
  const surface = surfaces.get(resultSurfaceKey(tabId, resultIndex))
  if (!surface) return
  surface.lastRequested = [Math.max(0, range[0]), Math.max(range[0], range[1])]
  requestPages(surface, surface.lastRequested)
}

/** Retry the failed range (the Retry band). */
export function retryFailedWindow(tabId: string, resultIndex: number): void {
  const surface = surfaces.get(resultSurfaceKey(tabId, resultIndex))
  if (!surface) return
  const failed = surface.failedRange
  surface.failedRange = null
  reportStatus(surface, { failedWindowRange: null })
  const range = failed ?? surface.lastRequested
  if (range) requestVisibleRange(tabId, resultIndex, range)
}

/**
 * Show a saved row edit (same view version): `updates` maps column index to
 * the displayed value. Patches the loaded page holding `baseIndex`, if any, and
 * tells row-patch subscribers either way. Ignored when the surface no longer
 * shows `queryId` (a re-run replaced the result while the save was running).
 */
export function applySavedRowValues(
  tabId: string,
  resultIndex: number,
  queryId: string,
  baseIndex: number,
  updates: Readonly<Record<number, unknown>>
): void {
  const surface = surfaces.get(resultSurfaceKey(tabId, resultIndex))
  if (!surface || surface.slot.queryId !== queryId) return
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

/** Drop the loaded pages of a surface (inactive-tab eviction); metadata is kept. */
export function clearResultWindowPages(tabId: string, resultIndex: number): void {
  const surface = surfaces.get(resultSurfaceKey(tabId, resultIndex))
  if (!surface) return
  surface.generation += 1
  surface.pages.clear()
  surface.inflight.clear()
  clearPendingTimer(surface)
  surface.pendingRange = null
}

/** Forget every surface of a tab (tab closed or results replaced). */
export function dropTabResultWindows(tabId: string): void {
  for (const [key, surface] of surfaces) {
    if (surface.slot.tabId !== tabId) continue
    clearPendingTimer(surface)
    surface.generation += 1
    surfaces.delete(key)
  }
}

/** Forget every surface (all tabs). */
export function clearAllResultWindows(): void {
  for (const surface of surfaces.values()) clearPendingTimer(surface)
  surfaces.clear()
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Row fetch cancelled', 'AbortError')
}

function loadedRun(surface: Surface, start: number, end: number): CachedRow[] | null {
  const out: CachedRow[] = []
  for (let position = start; position < end; position++) {
    const page = surface.pages.get(Math.floor(position / RESULT_PAGE_SIZE))
    const offset = position % RESULT_PAGE_SIZE
    const row = page?.rows[offset]
    if (!page || row === undefined) return null
    out.push({ row, baseIndex: page.baseIndices[offset] })
  }
  return out
}

/**
 * Resolve every row of `range` in the current view, in view order. Loaded rows
 * are reused; missing rows are fetched in 2,000-row chunks. Does not populate
 * the LRU. Rejects with `view_stale:` when the view changes mid-read, and with
 * an `AbortError` when `signal` aborts.
 */
export async function readViewRange(
  tabId: string,
  resultIndex: number,
  range: ViewRange,
  options: ReadOptions = {}
): Promise<CachedRow[]> {
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
    const loaded = loadedRun(surface, chunkStart, chunkEnd)
    if (loaded) {
      out.push(...loaded)
    } else {
      const response = await fetchResultWindow(
        surface.slot,
        viewVersion,
        chunkStart,
        chunkEnd - chunkStart
      )
      throwIfAborted(options.signal)
      if (response.viewVersion !== viewVersion) {
        throw new Error(`${VIEW_STALE_PREFIX} the result view changed while rows were loading`)
      }
      const rows = normalizeRows(surface.columns, response.rows)
      rows.forEach((row, i) => out.push({ row, baseIndex: response.baseIndices[i] }))
    }
    options.onProgress?.({ done: out.length, total })
  }
  return out
}
