import type { ForeignKeyColumnInfo, PrimaryKeyInfo, TableDataColumnMeta } from '../../types/schema'
import type { TableRequest } from '../../lib/ipc/requests'
import { getDefaultRowLimit, isTableDataInBottomPanel, useQueryStore } from '../query-store'
import { useWorkspaceStore } from '../workspace-store'
import { DEFAULT_DATA_VIEW_STATE } from '../data-view/data-view-defaults'
import type { DataViewPatch, DataViewState, DataViewSurfaceRef } from '../data-view/data-view-types'

export const TABLE_PAGE_RESULT_INDEX = 0

export const FIRST_TABLE_PAGE = 1

export interface TableDataSource extends TableRequest {
  isView: boolean
}

export interface TableDataPage {
  currentPage: number
  pageSize: number
  fetchedRowCount: number
  isLoading: boolean
  isCancelling: boolean
  error: string | null
  executionTimeMs: number
}

export interface TableDataMeta {
  columns: TableDataColumnMeta[]
  primaryKey: PrimaryKeyInfo | null
  foreignKeys: ForeignKeyColumnInfo[]
}

export interface TableDataTabState {
  table: TableDataSource
  page: TableDataPage
  meta: TableDataMeta
  view: DataViewState
}

export interface TableDataTabPatch {
  page?: Partial<TableDataPage>
  meta?: Partial<TableDataMeta>
  view?: DataViewPatch
}

export function tableSurfaceRef(tabId: string): DataViewSurfaceRef {
  return { route: 'table', tabId: tabId, resultIndex: TABLE_PAGE_RESULT_INDEX }
}

export function getTableDataSurfaceKey(tabId: string): string {
  return `table-data:${tabId}`
}

export function createDefaultTabState(table: TableDataSource): TableDataTabState {
  return {
    table: table,
    page: {
      currentPage: FIRST_TABLE_PAGE,
      pageSize: getDefaultRowLimit(),
      fetchedRowCount: 0,
      isLoading: false,
      isCancelling: false,
      error: null,
      executionTimeMs: 0,
    },
    meta: { columns: [], primaryKey: null, foreignKeys: [] },
    view: {
      ...DEFAULT_DATA_VIEW_STATE,
      slot: { ...DEFAULT_DATA_VIEW_STATE.slot, connectionId: table.connectionId },
    },
  }
}

export function hasNextTablePage(page: TableDataPage): boolean {
  return page.fetchedRowCount >= page.pageSize
}

function isShownInParentBottomPanel(tabId: string, parentQueryTabId: string): boolean {
  const parentQueryTab = useQueryStore.getState().tabs[parentQueryTabId]
  return isTableDataInBottomPanel(parentQueryTab, tabId)
}

export function isTableDataTabVisibleInWorkspace(tabId: string): boolean {
  const workspaceState = useWorkspaceStore.getState()

  for (const [connectionId, tabs] of Object.entries(workspaceState.tabsByConnection)) {
    const targetTab = tabs.find((tab) => tab.id === tabId)
    if (!targetTab) continue
    if (workspaceState.visibleConnectionSessionId !== connectionId) return false

    const activeTabId = workspaceState.activeTabByConnection[connectionId]
    if (activeTabId === tabId) return true
    if (targetTab.type !== 'table-data') return false
    if (!targetTab.parentQueryTabId) return false
    if (activeTabId !== targetTab.parentQueryTabId) return false
    return isShownInParentBottomPanel(tabId, targetTab.parentQueryTabId)
  }

  return false
}
