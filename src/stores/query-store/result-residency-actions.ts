import { querySurfaceRef } from './query-surface'
import { clearResultWindowPages } from '../../lib/result-window-cache'
import { useTableDataStore } from '../table-data-store'
import { frontendCacheLifecycle } from '../../lib/frontend-cache-lifecycle'
import {
  canEvictInactiveView,
  isRestorableEvictedView,
  restoreEvictedRows,
  shouldScheduleEviction,
} from '../data-view/residency'
import { hasUnsavedModifications } from '../data-view/data-view-selectors'
import { evictQueryResultRows } from './query-tab-reducers'
import { launchDeferredAnalysisIfNeeded } from './edit-analysis'
import type { ActiveBottomPanelItem, TabQueryState, TabStatus } from './query-state-types'
import {
  cancelResultLifecycleTimer,
  getActiveIndex,
  getResultSurfaceKey,
  patchResultByIndex,
  patchResultResidency,
  patchTab,
  resultAt,
  getQueryState,
  setQueryState,
} from './query-store-access'
import { isQueryTabVisibleInWorkspace } from './query-tab-selectors'

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
  patchResultByIndex(tabId, nextIndex, { view: { checked: { ranges: [] } } })
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

  if (isRestorableEvictedView(result.view)) {
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

  if (!shouldScheduleEviction(result.view)) return

  frontendCacheLifecycle.scheduleInactive(getResultSurfaceKey(tabId, targetIndex), () => {
    getQueryState().evictInactiveResultRows(tabId, targetIndex)
  })
}

export function evictInactiveResultRows(tabId: string, resultIndex: number) {
  cancelResultLifecycleTimer(tabId, resultIndex)
  const result = resultAt(tabId, resultIndex)
  if (!result) return
  if (!canEvictInactiveView(result.view)) return

  clearResultWindowPages(tabId, resultIndex)
  const eviction = { tabId: tabId, resultIndex: resultIndex, evictedAt: Date.now() }
  setQueryState((state) => evictQueryResultRows(state, eviction))
}

export async function restoreEvictedResultRows(tabId: string, resultIndex?: number) {
  const tab = getQueryState().tabs[tabId]
  if (!tab) return

  const targetIndex = resultIndex ?? getActiveIndex(tabId)
  const result = tab.results[targetIndex]
  if (!isRestorableEvictedView(result?.view)) return

  const previousTabStatus = tab.tabStatus
  patchTab(tabId, { tabStatus: 'restoring' })
  try {
    await restoreEvictedRows(querySurfaceRef(tabId, targetIndex))
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
  if (hasUnsavedModifications(currentResult?.view)) {
    getQueryState().requestNavigationAction(querySurfaceRef(tabId, tab.activeResultIndex), () => {
      const previousIndex = getQueryState().tabs[tabId]?.activeResultIndex ?? tab.activeResultIndex
      switchActiveResult(tabId, previousIndex, index)
    })
    return
  }

  if (currentResult?.view.edit.state) {
    patchResultByIndex(tabId, tab.activeResultIndex, {
      view: { edit: { state: null, rowIndex: null, saveError: null } },
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
