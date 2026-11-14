import {
  restoreTableDataCache as restoreTableDataCacheCmd,
  normalizeTinyIntRows,
} from '../../lib/table-data-commands'
import { logFrontend } from '../../lib/app-log-commands'
import { frontendCacheLifecycle } from '../../lib/frontend-cache-lifecycle'
import { toErrorMessage } from '../../lib/error-message'
import { createResidentRowState, shouldScheduleTableDataEviction } from './table-data-residency'
import { evictTableDataRows } from './table-data-reducers'
import {
  cancelTableDataLifecycleTimer,
  markTableDataResident,
  patchTab,
  patchTabResidency,
} from './table-data-access'
import { getTableDataSurfaceKey } from './table-data-tab-state'
import { useTableDataStore } from '../table-data-store'

export async function markTableDataSurfaceActive(tabId: string): Promise<void> {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab) return

  cancelTableDataLifecycleTimer(tabId)
  patchTabResidency(tabId, {
    isActive: true,
    inactiveSince: null,
  })

  const isEvicted = tab.rowResidency?.status === 'evicted'
  if (isEvicted) {
    await useTableDataStore.getState().restoreEvictedTableDataRows(tabId)
  }
}

export function markTableDataSurfaceInactive(tabId: string): void {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab) return

  patchTabResidency(tabId, {
    isActive: false,
    inactiveSince: Date.now(),
  })

  if (!shouldScheduleTableDataEviction(tab)) return

  frontendCacheLifecycle.scheduleInactive(getTableDataSurfaceKey(tabId), () => {
    useTableDataStore.getState().evictInactiveTableDataRows(tabId)
  })
}

export function evictInactiveTableDataRows(tabId: string): void {
  cancelTableDataLifecycleTimer(tabId)
  useTableDataStore.setState((state) =>
    evictTableDataRows(state, { tabId: tabId, evictedAt: Date.now() })
  )
}

export async function restoreEvictedTableDataRows(tabId: string): Promise<void> {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab) return

  const residency = tab.rowResidency ?? createResidentRowState(false)
  if (residency.status !== 'evicted') {
    return
  }

  patchTab(tabId, {
    isLoading: true,
    error: null,
  })
  patchTabResidency(tabId, { status: 'restoring', isActive: true, inactiveSince: null })

  try {
    const restored = await restoreTableDataCacheCmd({
      connectionId: tab.connectionId,
      tabId: tabId,
      database: tab.database,
      table: tab.table,
    })

    if (!useTableDataStore.getState().tabs[tabId]) return

    const restoredData = restored.status === 'available' ? restored.data : null
    if (!restoredData) {
      patchTab(tabId, {
        isLoading: false,
        error: 'Cached table data is no longer available. Reload the table data to continue.',
      })
      patchTabResidency(tabId, { status: 'evicted' })
      return
    }

    markTableDataResident(
      tabId,
      {
        columns: restoredData.columns,
        rows: normalizeTinyIntRows(restoredData.columns, restoredData.rows),
        currentPage: restoredData.currentPage,
        pageSize: restoredData.pageSize,
        primaryKey: restoredData.primaryKey,
        executionTimeMs: restoredData.executionTimeMs,
        isLoading: false,
        error: null,
        saveError: null,
      },
      { preserveActiveState: true }
    )
  } catch (error) {
    const errorMessage = toErrorMessage(error)
    logFrontend(
      'warn',
      `[table-data-store] restoreEvictedTableDataRows failed for ${tabId}: ${errorMessage}`
    )

    if (!useTableDataStore.getState().tabs[tabId]) return

    patchTab(tabId, {
      isLoading: false,
      error: 'Cached table data could not be restored. Reload the table data to continue.',
    })
    patchTabResidency(tabId, { status: 'evicted' })
  }
}

export function residencyActions() {
  return {
    markTableDataSurfaceActive,
    markTableDataSurfaceInactive,
    evictInactiveTableDataRows,
    restoreEvictedTableDataRows,
  }
}
