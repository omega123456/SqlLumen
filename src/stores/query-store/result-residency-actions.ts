import { querySurfaceRef } from './query-surface'
import {
  fetchResultWindow as fetchResultWindowCmd,
  touchResults as touchResultsCmd,
} from '../../lib/query-commands'
import { clearResultWindowPages, seedResultWindow } from '../../lib/result-window-cache'
import { useTableDataStore } from '../table-data-store'
import { logFrontend } from '../../lib/app-log-commands'
import { frontendCacheLifecycle } from '../../lib/frontend-cache-lifecycle'
import { toErrorMessage } from '../../lib/error-message'
import { canEvictInactiveResult, shouldScheduleResultEviction } from './result-residency'
import { evictQueryResultRows } from './query-tab-reducers'
import { launchDeferredAnalysisIfNeeded } from './edit-analysis'
import { VIEW_REFRESH_WINDOW_ROWS } from './query-state-defaults'
import type {
  ActiveBottomPanelItem,
  SingleResultState,
  TabQueryState,
  TabStatus,
} from './query-state-types'
import {
  cancelResultLifecycleTimer,
  getActiveIndex,
  getResultSurfaceKey,
  markTabResultsExpired,
  patchResultByIndex,
  patchResultResidency,
  patchTab,
  resultAt,
  slotFor,
  getQueryState,
  setQueryState,
} from './query-store-access'
import {
  hasUnsavedModifications,
  isQueryTabVisibleInWorkspace,
  isRestorableEvictedResult,
  residentRowResidency,
  restoreWindowStart,
} from './query-tab-selectors'

interface EvictedResultRestore {
  connectionId: string
  tabId: string
  resultIndex: number
  result: SingleResultState
}

async function reloadEvictedResultWindow(restore: EvictedResultRestore): Promise<void> {
  const { connectionId, tabId, resultIndex, result } = restore
  const touchResponse = await touchResultsCmd(connectionId, tabId)
  if (!getQueryState().tabs[tabId]) return

  if (touchResponse.status !== 'available') {
    markTabResultsExpired(tabId)
    patchResultResidency(tabId, resultIndex, { status: 'evicted' })
    return
  }

  const slot = slotFor(tabId, resultIndex)
  if (!slot) {
    markTabResultsExpired(tabId)
    return
  }
  const window = await fetchResultWindowCmd({
    ...slot,
    viewVersion: result.viewVersion,
    offset: restoreWindowStart(result),
    limit: VIEW_REFRESH_WINDOW_ROWS,
  })

  if (!getQueryState().tabs[tabId]) return
  const latestResult = resultAt(tabId, resultIndex) ?? result
  if (latestResult.queryId !== slot.queryId) return

  seedResultWindow({
    ...slot,
    viewVersion: window.viewVersion,
    viewRowCount: window.viewRowCount,
    columns: latestResult.columns,
    window: window,
  })
  patchResultByIndex(tabId, resultIndex, {
    viewVersion: window.viewVersion,
    viewRowCount: window.viewRowCount,
    isExpired: false,
    rowsEvictedAt: null,
    rowResidency: residentRowResidency(latestResult),
  })
}

function handleEvictedResultRestoreFailure(tabId: string, resultIndex: number, error: unknown) {
  const errorMessage = toErrorMessage(error)
  if (getQueryState().tabs[tabId]) {
    patchResultResidency(tabId, resultIndex, { status: 'evicted' })
  }
  if (errorMessage.includes('results_expired')) {
    markTabResultsExpired(tabId)
    return
  }
  logFrontend(
    'warn',
    `[query-store] restoreEvictedResultRows failed for ${tabId}/${resultIndex}: ${errorMessage}`
  )
}

function restoreTabStatusAfterRestore(tabId: string, previousTabStatus: TabStatus) {
  if (!getQueryState().tabs[tabId]) return
  patchTab(tabId, {
    tabStatus: previousTabStatus === 'restoring' ? 'success' : previousTabStatus,
  })
}

function isResultPanelShown(tabId: string): boolean {
  return getQueryState().tabs[tabId]?.activeBottomPanelItem.type === 'result'
}

function switchActiveResult(tabId: string, previousIndex: number, nextIndex: number) {
  const isResultSurfaceVisible = isQueryTabVisibleInWorkspace(tabId) && isResultPanelShown(tabId)
  if (isResultSurfaceVisible) {
    getQueryState().markResultSurfaceInactive(tabId, previousIndex)
  }
  patchTab(tabId, { activeResultIndex: nextIndex })
  patchResultByIndex(tabId, nextIndex, { checkedRanges: [] })
  if (isResultSurfaceVisible) {
    void getQueryState().markResultSurfaceActive(tabId, nextIndex)
  }
  launchDeferredAnalysisIfNeeded(tabId, nextIndex)
}

function markBottomPanelItemInactive(tabId: string, tab: TabQueryState) {
  const previousItem = tab.activeBottomPanelItem
  if (previousItem.type === 'result') {
    getQueryState().markResultSurfaceInactive(tabId, tab.activeResultIndex)
    return
  }
  useTableDataStore.getState().markTableDataSurfaceInactive(previousItem.tabId)
}

export async function markResultSurfaceActive(tabId: string, resultIndex?: number) {
  const tab = getQueryState().tabs[tabId]
  if (!tab) return

  const targetIndex = resultIndex ?? getActiveIndex(tabId)
  const result = tab.results[targetIndex]
  if (!result) return

  cancelResultLifecycleTimer(tabId, targetIndex)
  patchResultResidency(tabId, targetIndex, {
    isActive: true,
    inactiveSince: null,
  })

  if (isRestorableEvictedResult(result)) {
    await getQueryState().restoreEvictedResultRows(tabId, targetIndex)
  }
}

export function markResultSurfaceInactive(tabId: string, resultIndex?: number) {
  const tab = getQueryState().tabs[tabId]
  if (!tab) return

  const targetIndex = resultIndex ?? getActiveIndex(tabId)
  const result = tab.results[targetIndex]
  if (!result) return

  patchResultResidency(tabId, targetIndex, {
    isActive: false,
    inactiveSince: Date.now(),
  })

  if (!shouldScheduleResultEviction(result)) return

  frontendCacheLifecycle.scheduleInactive(getResultSurfaceKey(tabId, targetIndex), () => {
    getQueryState().evictInactiveResultRows(tabId, targetIndex)
  })
}

export function evictInactiveResultRows(tabId: string, resultIndex: number) {
  cancelResultLifecycleTimer(tabId, resultIndex)
  const result = resultAt(tabId, resultIndex)
  if (!result) return
  if (!canEvictInactiveResult(result)) return

  clearResultWindowPages(tabId, resultIndex)
  const eviction = { tabId: tabId, resultIndex: resultIndex, evictedAt: Date.now() }
  setQueryState((state) => evictQueryResultRows(state, eviction))
}

export async function restoreEvictedResultRows(tabId: string, resultIndex?: number) {
  const tab = getQueryState().tabs[tabId]
  if (!tab) return

  const targetIndex = resultIndex ?? getActiveIndex(tabId)
  const result = tab.results[targetIndex]
  if (!isRestorableEvictedResult(result)) return

  const hasRestoreSource = Boolean(tab.connectionId) && Boolean(result.queryId)
  if (!hasRestoreSource) {
    markTabResultsExpired(tabId)
    return
  }

  const previousTabStatus = tab.tabStatus
  patchTab(tabId, { tabStatus: 'restoring' })
  patchResultResidency(tabId, targetIndex, { status: 'restoring' })

  try {
    await reloadEvictedResultWindow({
      connectionId: tab.connectionId,
      tabId: tabId,
      resultIndex: targetIndex,
      result: result,
    })
  } catch (error) {
    handleEvictedResultRestoreFailure(tabId, targetIndex, error)
  } finally {
    restoreTabStatusAfterRestore(tabId, previousTabStatus)
  }
}

export function setActiveResultIndex(tabId: string, index: number) {
  const tab = getQueryState().tabs[tabId]
  if (!tab) return

  const isValidIndex = index >= 0 && index < tab.results.length
  if (!isValidIndex) return

  const currentResult = tab.results[tab.activeResultIndex]
  if (hasUnsavedModifications(currentResult)) {
    getQueryState().requestNavigationAction(querySurfaceRef(tabId, tab.activeResultIndex), () => {
      const previousIndex = getQueryState().tabs[tabId]?.activeResultIndex ?? tab.activeResultIndex
      switchActiveResult(tabId, previousIndex, index)
    })
    return
  }

  if (currentResult?.editState) {
    patchResultByIndex(tabId, tab.activeResultIndex, {
      editState: null,
      editingRowIndex: null,
      saveError: null,
    })
  }
  switchActiveResult(tabId, tab.activeResultIndex, index)
}

export function setActiveBottomPanelItem(tabId: string, item: ActiveBottomPanelItem) {
  const tabBeforePatch = getQueryState().tabs[tabId]
  if (!tabBeforePatch) {
    patchTab(tabId, { activeBottomPanelItem: item })
    return
  }

  const isVisible = isQueryTabVisibleInWorkspace(tabId)
  if (isVisible) {
    markBottomPanelItemInactive(tabId, tabBeforePatch)
  }

  patchTab(tabId, { activeBottomPanelItem: item })

  if (item.type === 'result') {
    if (isVisible) {
      void getQueryState().markResultSurfaceActive(
        tabId,
        getQueryState().tabs[tabId]?.activeResultIndex
      )
    }
    return
  }

  if (isVisible) {
    void useTableDataStore.getState().markTableDataSurfaceActive(item.tabId)
  }
}

export function resultResidencyActions() {
  return {
    markResultSurfaceActive,
    markResultSurfaceInactive,
    evictInactiveResultRows,
    restoreEvictedResultRows,
    setActiveResultIndex,
    setActiveBottomPanelItem,
  }
}
