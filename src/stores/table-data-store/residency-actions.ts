import { clearResultWindowPages } from '../../lib/result-window-cache'
import { frontendCacheLifecycle } from '../../lib/frontend-cache-lifecycle'
import {
  canEvictInactiveView,
  evictedViewPatch,
  isRestorableEvictedView,
  restoreEvictedRows,
  shouldScheduleEviction,
} from '../data-view/residency'
import { cancelTableDataLifecycleTimer, patchTableTab, tableTabOf } from './table-data-access'
import {
  TABLE_PAGE_RESULT_INDEX,
  getTableDataSurfaceKey,
  tableSurfaceRef,
} from './table-data-tab-state'
import { useTableDataStore } from '../table-data-store'

export async function markTableDataSurfaceActive(tabId: string): Promise<void> {
  const tab = tableTabOf(tabId)
  if (!tab) return

  cancelTableDataLifecycleTimer(tabId)
  patchTableTab(tabId, {
    view: {
      residency: { rows: { ...tab.view.residency.rows, isActive: true, inactiveSince: null } },
    },
  })

  if (isRestorableEvictedView(tab.view)) {
    await useTableDataStore.getState().restoreEvictedTableDataRows(tabId)
  }
}

export function markTableDataSurfaceInactive(tabId: string): void {
  const tab = tableTabOf(tabId)
  if (!tab) return

  patchTableTab(tabId, {
    view: {
      residency: {
        rows: { ...tab.view.residency.rows, isActive: false, inactiveSince: Date.now() },
      },
    },
  })

  if (!shouldScheduleEviction(tab.view)) return

  frontendCacheLifecycle.scheduleInactive(getTableDataSurfaceKey(tabId), () => {
    useTableDataStore.getState().evictInactiveTableDataRows(tabId)
  })
}

export function evictInactiveTableDataRows(tabId: string): void {
  cancelTableDataLifecycleTimer(tabId)
  const tab = tableTabOf(tabId)
  if (!tab) return
  if (!canEvictInactiveView(tab.view)) return

  clearResultWindowPages(tabId, TABLE_PAGE_RESULT_INDEX)
  patchTableTab(tabId, { view: evictedViewPatch(tab.view, Date.now()) })
}

export async function restoreEvictedTableDataRows(tabId: string): Promise<void> {
  await restoreEvictedRows(tableSurfaceRef(tabId))
}

export function residencyActions() {
  return {
    markTableDataSurfaceActive,
    markTableDataSurfaceInactive,
    evictInactiveTableDataRows,
    restoreEvictedTableDataRows,
  }
}
