import { create } from 'zustand'
import type { PageRequest } from './data-view/data-view-types'
import { pageActions } from './table-data-store/page-actions'
import { residencyActions } from './table-data-store/residency-actions'
import { viewActions } from './table-data-store/view-actions'
import { registerTableDataRoute } from './table-data-store/table-data-route'
import type { TableDataSource, TableDataTabState } from './table-data-store/table-data-tab-state'
export {
  tableSurfaceRef,
  hasNextTablePage,
  TABLE_PAGE_RESULT_INDEX,
} from './table-data-store/table-data-tab-state'
export type {
  TableDataMeta,
  TableDataPage,
  TableDataSource,
  TableDataTabState,
} from './table-data-store/table-data-tab-state'

export interface ColumnJumpRequest {
  columnName: string
  nonce: number
}

export interface TableDataStore {
  tabs: Record<string, TableDataTabState>
  columnJumpRequests: Record<string, ColumnJumpRequest>
  highlightedColumnByTab: Record<string, string | null>

  initTab: (tabId: string, table: TableDataSource) => void
  cleanupTab: (tabId: string) => void
  loadTableData: (tabId: string) => Promise<void>
  fetchPage: (tabId: string, request: PageRequest) => Promise<void>
  cancelLoad: (tabId: string) => Promise<void>
  refreshData: (tabId: string) => Promise<void>
  setPageSize: (tabId: string, newPageSize: number) => Promise<void>
  refreshEditTarget: (tabId: string) => void
  markTableDataSurfaceActive: (tabId: string) => Promise<void>
  markTableDataSurfaceInactive: (tabId: string) => void
  evictInactiveTableDataRows: (tabId: string) => void
  restoreEvictedTableDataRows: (tabId: string) => Promise<void>

  requestColumnJump: (tabId: string, columnName: string) => void
  consumeColumnJump: (tabId: string) => void
  clearColumnHighlight: (tabId: string) => void
  closeExportDialog: (tabId: string) => void
}

export const useTableDataStore = create<TableDataStore>()(() => ({
  tabs: {},
  columnJumpRequests: {},
  highlightedColumnByTab: {},
  ...pageActions(),
  ...residencyActions(),
  ...viewActions(),
}))

registerTableDataRoute()
