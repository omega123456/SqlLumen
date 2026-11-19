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
import { activeResultIndexOf } from './query-tab-selectors'
import {
  patchQueryResult,
  patchQueryResultResidency,
  patchQueryTab,
  setQueryResultsExpired,
} from './query-tab-reducers'
import { DEFAULT_TAB_STATE } from './query-state-defaults'
import type { ResultPatch, SingleResultState, TabQueryState, QueryState } from './query-state-types'
import type { LocatedResult } from './result-view-spec'
import type { DataViewSurfaceRef } from '../data-view/data-view-types'
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

export function resultOf(ref: DataViewSurfaceRef): SingleResultState | undefined {
  return resultAt(ref.tabId, ref.resultIndex)
}

export function patchSurface(ref: DataViewSurfaceRef, partial: ResultPatch) {
  patchResultByIndex(ref.tabId, ref.resultIndex, partial)
}

export function patchTab(tabId: string, partial: Partial<TabQueryState>) {
  setQueryState((state) =>
    patchQueryTab(state, { tabId: tabId, partial: partial, fallbackTab: DEFAULT_TAB_STATE })
  )
}

export function patchResultByIndex(tabId: string, resultIndex: number, partial: ResultPatch) {
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
  return activeResultIndexOf(getQueryState().tabs[tabId])
}

export function slotFor(tabId: string, resultIndex: number): ResultSlotRef | null {
  const tab = getQueryState().tabs[tabId]
  const result = tab?.results[resultIndex]
  if (!tab) return null
  if (!result?.view.slot.queryId) return null
  return {
    connectionId: getResultSurface(tabId, resultIndex)?.slot.connectionId || tab.connectionId,
    tabId: tabId,
    resultIndex: resultIndex,
    queryId: result.view.slot.queryId,
  }
}

export function rowAt(
  { tabId, resultIndex, result }: LocatedResult,
  position: number
): CachedRow | null {
  const draftRow = result.view.edit.draftRow
  const isDraftRowPosition = position === result.view.slot.viewRowCount
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
    patchResultByIndex(tabId, resultIndex, { view: { window: patch } })
    if (failure && patch.failedRange) {
      const [start, end] = patch.failedRange
      showErrorToast(`Couldn't load rows ${formatRowRange(start + 1, end)}`, failure.message)
    }
  })

  setWindowExpiredHandler((tabId) => {
    if (getQueryState().tabs[tabId]) markTabResultsExpired(tabId)
  })
}
