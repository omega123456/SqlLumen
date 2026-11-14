import type { TableDataTabState, FrontendRowResidencyState } from '../../types/schema'
import {
  fetchTableData as fetchTableDataCmd,
  evictTableData as evictTableDataCmd,
  syncTableDataCacheAfterDelete as syncTableDataCacheAfterDeleteCmd,
  syncTableDataCacheAfterInsert as syncTableDataCacheAfterInsertCmd,
  syncTableDataCacheAfterUpdate as syncTableDataCacheAfterUpdateCmd,
} from '../../lib/table-data-commands'
import { getDefaultRowLimit, isTableDataInBottomPanel, useQueryStore } from '../query-store'
import { useWorkspaceStore } from '../workspace-store'
import { logFrontend } from '../../lib/app-log-commands'
import type { TableRequest } from '../../lib/ipc/requests'
import { toErrorMessage } from '../../lib/error-message'
import { createResidentRowState } from './table-data-residency'

export const RESET_SCROLL_CELL = { scrollRow: 0 as const, scrollCol: 0 as const }

export function evictTableDataWithWarning(
  connectionId: string,
  tabId: string,
  failureContext?: string
): void {
  evictTableDataCmd({
    connectionId,
    tabId,
  }).catch((error: unknown) => {
    const errorMessage = toErrorMessage(error)
    const contextSuffix = failureContext ? ` ${failureContext}` : ''
    logFrontend(
      'warn',
      `Table data cache eviction failed${contextSuffix} for tab ${tabId}: ${errorMessage}`
    )
  })
}

export function isTableDataTabVisibleInWorkspace(tabId: string): boolean {
  const workspaceState = useWorkspaceStore.getState()

  for (const [connectionId, tabs] of Object.entries(workspaceState.tabsByConnection)) {
    const targetTab = tabs.find((tab) => tab.id === tabId)
    if (!targetTab) {
      continue
    }

    if (workspaceState.visibleConnectionSessionId !== connectionId) {
      return false
    }

    const activeTabId = workspaceState.activeTabByConnection[connectionId]
    if (activeTabId === tabId) {
      return true
    }

    if (targetTab.type !== 'table-data') {
      return false
    }

    if (!targetTab.parentQueryTabId) {
      return false
    }

    if (activeTabId !== targetTab.parentQueryTabId) {
      return false
    }

    const parentQueryTab = useQueryStore.getState().tabs[targetTab.parentQueryTabId]
    return isTableDataInBottomPanel(parentQueryTab, tabId)
  }

  return false
}

export function getTableDataSurfaceKey(tabId: string): string {
  return `table-data:${tabId}`
}

export function createDefaultTabState({
  connectionId,
  database,
  table,
}: TableRequest): TableDataTabState {
  return {
    columns: [],
    rows: [],
    currentPage: 1,
    pageSize: getDefaultRowLimit(),
    primaryKey: null,
    executionTimeMs: 0,
    rowResidency: createResidentRowState(false),
    rowsEvictedAt: null,
    connectionId: connectionId,
    database: database,
    table: table,
    editState: null,
    viewMode: 'grid',
    selectedRowKey: null,
    columnWidths: {},
    selectedCell: null,
    filterModel: [],
    sort: null,
    foreignKeys: [],
    isLoading: false,
    isCancelling: false,
    error: null,
    saveError: null,
    isExportDialogOpen: false,
    ...RESET_SCROLL_CELL,
    pendingNavigationAction: null,
  }
}

export const SYNC_TABLE_DATA_CACHE_COMMANDS = {
  insert: syncTableDataCacheAfterInsertCmd,
  update: syncTableDataCacheAfterUpdateCmd,
  delete: syncTableDataCacheAfterDeleteCmd,
}

export function buildFetchTableDataRequest(
  tab: TableDataTabState,
  tabId: string,
  page: number
): Parameters<typeof fetchTableDataCmd>[0] {
  const hasFilters = tab.filterModel.length > 0
  return {
    connectionId: tab.connectionId,
    tabId: tabId,
    database: tab.database,
    table: tab.table,
    page: page,
    pageSize: tab.pageSize,
    sortColumn: tab.sort?.column,
    sortDirection: tab.sort?.direction,
    filterModel: hasFilters ? tab.filterModel : undefined,
  }
}

export function residencyAfterFetch(
  isStillVisible: boolean,
  previous: FrontendRowResidencyState | undefined
): FrontendRowResidencyState {
  if (isStillVisible) {
    return { status: 'resident', isActive: true, inactiveSince: null }
  }
  return {
    status: 'resident',
    isActive: false,
    inactiveSince: previous?.inactiveSince ?? Date.now(),
  }
}
