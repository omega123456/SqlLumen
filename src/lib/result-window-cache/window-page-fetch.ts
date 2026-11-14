import { fetchResultWindow } from '../query-commands'
import { logFrontend } from '../app-log-commands'
import type { FetchResultWindowResult } from '../../types/schema'
import { toErrorMessage } from '../error-message'
import {
  RESULT_LOADING_STATUS_DELAY_MS,
  RESULT_PAGE_SIZE,
  RESULT_PREFETCH_ROWS,
  isResultsExpiredError,
  isViewStaleError,
} from '../result-window-cache'
import {
  evictPages,
  expiredHandler,
  hasInflightPages,
  isAtPageFetchLimit,
  isRegisteredSurface,
  isSurfaceCurrent,
  keyOf,
  nextPageUseStamp,
  notify,
  pageRange,
  reportStatus,
  resultSurfaceKey,
  settlePending,
  storeWindow,
  surfaces,
} from './window-registry'
import type { Surface, ViewRange } from './window-registry'

function schedulePendingStatus(surface: Surface, fetchedRange: ViewRange): void {
  if (surface.pendingTimer || surface.pendingRange) return
  surface.pendingTimer = setTimeout(() => {
    surface.pendingTimer = null
    const isStillLoading = hasInflightPages(surface) && isRegisteredSurface(surface)
    if (!isStillLoading) return
    surface.pendingRange = surface.lastRequested ?? fetchedRange
    reportStatus(surface, { pendingWindowRange: surface.pendingRange })
  }, RESULT_LOADING_STATUS_DELAY_MS)
}

function paintFetchedWindow(surface: Surface, response: FetchResultWindowResult): boolean {
  if (response.viewVersion !== surface.viewVersion) return false
  storeWindow(surface, response)
  evictPages(surface)
  notify(surface, [response.offset, response.offset + response.rows.length])
  return true
}

interface WindowFetchFailure {
  error: unknown
  range: ViewRange
}

function handleWindowFetchFailure(surface: Surface, failure: WindowFetchFailure): void {
  const [start, end] = failure.range
  if (isViewStaleError(failure.error)) {
    logFrontend(
      'debug',
      `[result-window-cache] discarding a stale window for ${keyOf(surface)} rows ${start}-${end}: ${toErrorMessage(failure.error)}`
    )
    return
  }
  if (isResultsExpiredError(failure.error)) {
    expiredHandler?.(surface.slot.tabId)
    return
  }
  const message = toErrorMessage(failure.error)
  if (message.startsWith('Results were refreshed')) {
    logFrontend('info', `[result-window-cache] discarding window for a replaced query: ${message}`)
    return
  }
  logFrontend(
    'warn',
    `[result-window-cache] window fetch failed for ${keyOf(surface)} rows ${start}-${end}: ${message}`
  )
  const failed: ViewRange = surface.lastRequested ?? failure.range
  surface.failedRange = failed
  reportStatus(surface, { failedWindowRange: failed }, { message })
}

interface PageFetchOutcome {
  generation: number
  pageIndex: number
  continueFilling: boolean
}

function finishPageFetch(surface: Surface, outcome: PageFetchOutcome): void {
  if (surface.generation === outcome.generation) surface.inflight.delete(outcome.pageIndex)
  if (!isSurfaceCurrent(surface, outcome.generation)) return
  settlePending(surface)
  if (outcome.continueFilling && surface.lastRequested) {
    requestPages(surface, surface.lastRequested)
  }
}

async function fetchPage(surface: Surface, pageIndex: number): Promise<void> {
  const generation = surface.generation
  const viewVersion = surface.viewVersion
  const range = pageRange(surface, pageIndex)
  const [start, end] = range
  surface.inflight.add(pageIndex)
  schedulePendingStatus(surface, range)
  let continueFilling = false
  try {
    const response = await fetchResultWindow({
      ...surface.slot,
      viewVersion: viewVersion,
      offset: start,
      limit: end - start,
    })
    if (!isSurfaceCurrent(surface, generation)) return
    continueFilling = paintFetchedWindow(surface, response)
  } catch (error) {
    if (!isSurfaceCurrent(surface, generation)) return
    handleWindowFetchFailure(surface, { error: error, range: range })
  } finally {
    finishPageFetch(surface, {
      generation: generation,
      pageIndex: pageIndex,
      continueFilling: continueFilling,
    })
  }
}

export function isSurfaceForQuery(
  surface: Surface | undefined,
  queryId: string
): surface is Surface {
  if (!surface) return false
  return surface.slot.queryId === queryId
}

function requestPages(surface: Surface, range: ViewRange): void {
  if (surface.viewRowCount === 0) return
  if (!surface.slot.queryId) return
  const lastPage = Math.ceil(surface.viewRowCount / RESULT_PAGE_SIZE) - 1
  const firstWanted = Math.max(0, Math.floor((range[0] - RESULT_PREFETCH_ROWS) / RESULT_PAGE_SIZE))
  const lastWanted = Math.min(
    lastPage,
    Math.floor((Math.max(range[0], range[1] - 1) + RESULT_PREFETCH_ROWS) / RESULT_PAGE_SIZE)
  )
  for (let pageIndex = firstWanted; pageIndex <= lastWanted; pageIndex++) {
    const page = surface.pages.get(pageIndex)
    if (page) {
      page.lastUsed = nextPageUseStamp()
      continue
    }
    if (surface.inflight.has(pageIndex)) continue
    if (isAtPageFetchLimit(surface)) break
    void fetchPage(surface, pageIndex)
  }
}

export function requestVisibleRange(tabId: string, resultIndex: number, range: ViewRange): void {
  const surface = surfaces.get(resultSurfaceKey(tabId, resultIndex))
  if (!surface) return
  surface.lastRequested = [Math.max(0, range[0]), Math.max(range[0], range[1])]
  requestPages(surface, surface.lastRequested)
}

export function retryFailedWindow(tabId: string, resultIndex: number): void {
  const surface = surfaces.get(resultSurfaceKey(tabId, resultIndex))
  if (!surface) return
  const failed = surface.failedRange
  surface.failedRange = null
  reportStatus(surface, { failedWindowRange: null })
  const range = failed ?? surface.lastRequested
  if (range) requestVisibleRange(tabId, resultIndex, range)
}
