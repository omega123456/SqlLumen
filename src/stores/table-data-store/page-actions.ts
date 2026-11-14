import type { FilterCondition } from '../../types/schema'
import { fetchTableData as fetchTableDataCmd } from '../../lib/table-data-commands'
import { getTableForeignKeys } from '../../lib/schema-commands'
import { cancelQuery as cancelQueryCmd } from '../../lib/query-commands'
import { showErrorToast, showSuccessToast } from '../toast-store'
import { mapSingleColumnForeignKeys } from '../../lib/foreign-key-utils'
import { logFrontend } from '../../lib/app-log-commands'
import type { TableRequest } from '../../lib/ipc/requests'
import { describeQueryFailure, toErrorMessage } from '../../lib/error-message'
import { putTableDataTab, removeTableDataTab } from './table-data-reducers'
import { cancelTableDataLifecycleTimer, patchTab } from './table-data-access'
import {
  RESET_SCROLL_CELL,
  buildFetchTableDataRequest,
  createDefaultTabState,
  evictTableDataWithWarning,
  isTableDataTabVisibleInWorkspace,
  residencyAfterFetch,
} from './table-data-tab-state'
import { useTableDataStore } from '../table-data-store'

export function initTab(tabId: string, table: TableRequest): void {
  useTableDataStore.setState((state) =>
    putTableDataTab(state, { tabId: tabId, tab: createDefaultTabState(table) })
  )
}

export function cleanupTab(tabId: string): void {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (tab) {
    cancelTableDataLifecycleTimer(tabId)
    evictTableDataWithWarning(tab.connectionId, tabId)
  }

  useTableDataStore.setState((state) => removeTableDataTab(state, tabId))
}

export async function loadTableData(tabId: string): Promise<void> {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab) return

  patchTab(tabId, {
    currentPage: 1,
    editState: null,
    saveError: null,
    error: null,
    foreignKeys: [],
    ...RESET_SCROLL_CELL,
  })

  getTableForeignKeys(tab.connectionId, tab.database, tab.table)
    .then((foreignKeyInfos) => {
      if (!useTableDataStore.getState().tabs[tabId]) return

      patchTab(tabId, { foreignKeys: mapSingleColumnForeignKeys(foreignKeyInfos) })
    })
    .catch((error: unknown) => {
      const errorMessage = toErrorMessage(error)
      logFrontend('warn', 'FK metadata fetch failed: ' + errorMessage)
    })

  await useTableDataStore.getState().fetchPage(tabId, 1)
}

export async function fetchPage(tabId: string, page: number): Promise<void> {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab) return

  const isDifferentPage = tab.currentPage !== page
  patchTab(tabId, {
    isLoading: true,
    isCancelling: false,
    error: null,
    ...(isDifferentPage ? RESET_SCROLL_CELL : {}),
  })

  try {
    const result = await fetchTableDataCmd(buildFetchTableDataRequest(tab, tabId, page))
    const latestTab = useTableDataStore.getState().tabs[tabId]
    if (!latestTab) return
    const isStillVisible = isTableDataTabVisibleInWorkspace(tabId)

    patchTab(tabId, {
      columns: result.columns,
      rows: result.rows,
      currentPage: result.currentPage,
      pageSize: result.pageSize,
      primaryKey: result.primaryKey,
      executionTimeMs: result.executionTimeMs,
      rowsEvictedAt: null,
      selectedRowKey: null,
      checkedRowKeys: [],
      isLoading: false,
      isCancelling: false,
      rowResidency: residencyAfterFetch(isStillVisible, latestTab.rowResidency),
    })

    if (!isStillVisible) {
      useTableDataStore.getState().markTableDataSurfaceInactive(tabId)
    }
  } catch (error) {
    if (!useTableDataStore.getState().tabs[tabId]) return

    const wasCancelled = useTableDataStore.getState().tabs[tabId]?.isCancelling ?? false
    patchTab(tabId, {
      error: describeQueryFailure(wasCancelled, error),
      isLoading: false,
      isCancelling: false,
    })
  }
}

export async function cancelLoad(tabId: string): Promise<void> {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab) return
  if (!tab.isLoading) return
  if (tab.isCancelling) return

  patchTab(tabId, { isCancelling: true })

  try {
    const cancelled = await cancelQueryCmd(tab.connectionId, tabId)
    if (!useTableDataStore.getState().tabs[tabId]) return

    if (cancelled) {
      showSuccessToast('Query cancelled')
      return
    }
    patchTab(tabId, { isCancelling: false })
  } catch (error) {
    if (!useTableDataStore.getState().tabs[tabId]) return
    patchTab(tabId, { isCancelling: false })
    showErrorToast('Cancel failed', toErrorMessage(error))
  }
}

export async function sortByColumn(
  tabId: string,
  column: string,
  direction: 'asc' | 'desc' | null
): Promise<void> {
  const sort = direction === null ? null : { column, direction }
  patchTab(tabId, { sort: sort, scrollRow: 0 })
  await useTableDataStore.getState().fetchPage(tabId, 1)
}

export async function applyFilters(tabId: string, conditions: FilterCondition[]): Promise<void> {
  patchTab(tabId, { filterModel: conditions, ...RESET_SCROLL_CELL })
  await useTableDataStore.getState().fetchPage(tabId, 1)
}

export async function refreshData(tabId: string): Promise<void> {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab) return
  await useTableDataStore.getState().fetchPage(tabId, tab.currentPage)
}

export async function setPageSize(tabId: string, newPageSize: number): Promise<void> {
  patchTab(tabId, { pageSize: newPageSize, ...RESET_SCROLL_CELL })
  await useTableDataStore.getState().fetchPage(tabId, 1)
}

export function pageActions() {
  return {
    initTab,
    cleanupTab,
    loadTableData,
    fetchPage,
    cancelLoad,
    sortByColumn,
    applyFilters,
    refreshData,
    setPageSize,
  }
}
