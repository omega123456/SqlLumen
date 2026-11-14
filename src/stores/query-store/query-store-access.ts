import type { FrontendRowResidencyState } from '../../types/schema'
import { type ResultSlotRef } from '../../lib/query-commands'
import {
  getLoadedRow,
  getResultSurface,
  setWindowExpiredHandler,
  setWindowStatusHandler,
  type CachedRow,
} from '../../lib/result-window-cache'
import { formatRowRange } from '../../lib/format-row-count'
import { showErrorToast } from '../toast-store'
import { frontendCacheLifecycle } from '../../lib/frontend-cache-lifecycle'
import { hasResults } from './result-lists'
import {
  patchQueryResult,
  patchQueryResultResidency,
  patchQueryTab,
  setQueryResultsExpired,
} from './query-tab-reducers'
import { DEFAULT_TAB_STATE } from './query-state-defaults'
import type { SingleResultState, TabQueryState, QueryState } from './query-state-types'
import type { LocatedResult } from './result-view-spec'
import { useQueryStore } from '../query-store'

type QueryStateUpdate = Partial<QueryState> | ((state: QueryState) => Partial<QueryState>)

export function getQueryState(): QueryState {
  return useQueryStore.getState()
}

export function setQueryState(update: QueryStateUpdate): void {
  useQueryStore.setState(update)
}

export function getResultSurfaceKey(tabId: string, resultIndex: number): string {
  return `query-result:${tabId}:${resultIndex}`
}

export function resultAt(tabId: string, resultIndex: number): SingleResultState | undefined {
  return getQueryState().tabs[tabId]?.results[resultIndex]
}

export function patchTab(tabId: string, partial: Partial<TabQueryState>) {
  setQueryState((state) =>
    patchQueryTab(state, { tabId: tabId, partial: partial, fallbackTab: DEFAULT_TAB_STATE })
  )
}

export function patchResultByIndex(
  tabId: string,
  resultIndex: number,
  partial: Partial<SingleResultState>
) {
  const resultPatch = { tabId: tabId, resultIndex: resultIndex, partial: partial }
  setQueryState((state) => patchQueryResult(state, resultPatch))
}

export function cancelResultLifecycleTimer(tabId: string, resultIndex: number) {
  frontendCacheLifecycle.cancel(getResultSurfaceKey(tabId, resultIndex))
}

export function cancelAllResultLifecycleTimers(tabId: string, resultCount: number) {
  for (let index = 0; index < resultCount; index++) {
    cancelResultLifecycleTimer(tabId, index)
  }
}

export function patchResultResidency(
  tabId: string,
  resultIndex: number,
  partial: Partial<FrontendRowResidencyState>
) {
  const residencyPatch = { tabId: tabId, resultIndex: resultIndex, partial: partial }
  setQueryState((state) => patchQueryResultResidency(state, residencyPatch))
}

export function getActiveIndex(tabId: string): number {
  const tab = getQueryState().tabs[tabId]
  if (!hasResults(tab)) return 0
  return Math.min(tab.activeResultIndex, tab.results.length - 1)
}

export function slotFor(tabId: string, resultIndex: number): ResultSlotRef | null {
  const tab = getQueryState().tabs[tabId]
  const result = tab?.results[resultIndex]
  if (!tab) return null
  if (!result?.queryId) return null
  return {
    connectionId: getResultSurface(tabId, resultIndex)?.slot.connectionId || tab.connectionId,
    tabId: tabId,
    resultIndex: resultIndex,
    queryId: result.queryId,
  }
}

export function rowAt(
  { tabId, resultIndex, result }: LocatedResult,
  position: number
): CachedRow | null {
  const draftRow = result.draftRow
  const isDraftRowPosition = position === result.viewRowCount
  if (draftRow && isDraftRowPosition) {
    return { row: draftRow, baseIndex: -1 }
  }
  return getLoadedRow(tabId, resultIndex, position) ?? null
}

export function beginExecution(tabId: string) {
  patchTab(tabId, {
    tabStatus: 'running',
    executionStartedAt: Date.now(),
    isCancelling: false,
    wasCancelled: false,
  })
}

export function clearExpiredFlags(tabId: string) {
  setQueryState((state) => setQueryResultsExpired(state, { tabId: tabId, isExpired: false }))
}

export function markTabResultsExpired(tabId: string) {
  setQueryState((state) => setQueryResultsExpired(state, { tabId: tabId, isExpired: true }))
}

export function finalizeExecution(tabId: string) {
  patchTab(tabId, {
    executionStartedAt: null,
    isCancelling: false,
    wasCancelled: false,
  })
}

export function registerResultWindowHandlers() {
  setWindowStatusHandler(({ tabId, resultIndex, patch, failure }) => {
    const result = resultAt(tabId, resultIndex)
    if (!result) return
    patchResultByIndex(tabId, resultIndex, patch)
    if (failure && patch.failedWindowRange) {
      const [start, end] = patch.failedWindowRange
      showErrorToast(`Couldn't load rows ${formatRowRange(start + 1, end)}`, failure.message)
    }
  })

  setWindowExpiredHandler((tabId) => {
    if (getQueryState().tabs[tabId]) markTabResultsExpired(tabId)
  })
}
