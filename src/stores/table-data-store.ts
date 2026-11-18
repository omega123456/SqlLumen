import { create } from 'zustand'
import type { TableDataTabState, FilterCondition, SelectedCellInfo } from '../types/schema'
import type { TableRequest } from '../lib/ipc/requests'
import type { TableCellValueSync } from './table-data-store/row-edit-transitions'
import { pageActions } from './table-data-store/page-actions'
import { residencyActions } from './table-data-store/residency-actions'
import { cellEditActions } from './table-data-store/cell-edit-actions'
import { rowCloneActions } from './table-data-store/row-clone'
import { rowSaveActions } from './table-data-store/row-save'
import { rowDeletionActions } from './table-data-store/row-deletion'
import { viewActions } from './table-data-store/view-actions'
import { navigationGuardActions } from './table-data-store/navigation-guard'
export {
  isSameRowKey,
  findRowIndexByKey,
  getRowKeyFromData,
  isEditingRowKey,
  cloneSourceRowKey,
} from './table-data-store/row-keys'
export {
  coerceValueForColumn,
  buildInsertPayload,
  buildUpdatePayload,
} from './table-data-store/row-payloads'

export type { BuildUpdatePayloadResult } from './table-data-store/row-payloads'
export { applyInsertedRow, applyUpdatedRow } from './table-data-store/row-edit-transitions'
export type { TableCellValueSync } from './table-data-store/row-edit-transitions'

export interface TableDataStore {
  tabs: Record<string, TableDataTabState>
  columnJumpRequests: Record<string, { columnKey: string; nonce: number }>
  highlightedColumnByTab: Record<string, string | null>

  initTab: (tabId: string, table: TableRequest) => void
  cleanupTab: (tabId: string) => void
  loadTableData: (tabId: string) => Promise<void>
  fetchPage: (tabId: string, page: number) => Promise<void>
  cancelLoad: (tabId: string) => Promise<void>
  sortByColumn: (tabId: string, column: string, direction: 'asc' | 'desc' | null) => Promise<void>
  applyFilters: (tabId: string, conditions: FilterCondition[]) => Promise<void>
  refreshData: (tabId: string) => Promise<void>
  markTableDataSurfaceActive: (tabId: string) => Promise<void>
  markTableDataSurfaceInactive: (tabId: string) => void
  evictInactiveTableDataRows: (tabId: string) => void
  restoreEvictedTableDataRows: (tabId: string) => Promise<void>

  startEditing: (
    tabId: string,
    rowKey: Record<string, unknown>,
    currentValues: Record<string, unknown>
  ) => void
  updateCellValue: (tabId: string, column: string, value: unknown) => void
  syncCellValue: (tabId: string, sync: TableCellValueSync) => void
  clearEditStateIfUnmodified: (tabId: string, rowKey: Record<string, unknown>) => void
  saveCurrentRow: (tabId: string) => Promise<boolean>
  discardCurrentRow: (tabId: string) => void
  insertNewRow: (tabId: string) => void
  cloneSelectedRow: (tabId: string) => Promise<void>
  deleteRow: (tabId: string, rowKey: Record<string, unknown>) => Promise<void>
  deleteRows: (tabId: string, rowKeys: Record<string, unknown>[]) => Promise<number>

  setViewMode: (tabId: string, mode: 'grid' | 'form') => void
  setSelectedRow: (tabId: string, rowKey: Record<string, unknown> | null) => void
  setCheckedRowKeys: (tabId: string, rowKeys: Record<string, unknown>[]) => void
  setSelectedCell: (tabId: string, cell: SelectedCellInfo | null) => void
  requestColumnJump: (tabId: string, columnKey: string) => void
  consumeColumnJump: (tabId: string) => void
  clearColumnHighlight: (tabId: string) => void
  setColumnWidth: (tabId: string, column: string, width: number) => void
  setPageSize: (tabId: string, newPageSize: number) => Promise<void>
  openExportDialog: (tabId: string) => void
  closeExportDialog: (tabId: string) => void

  setScrollCell: (tabId: string, scrollRow: number, scrollColumn: number) => void

  requestNavigationAction: (tabId: string, action: () => void) => void
  confirmNavigationSave: (tabId: string) => Promise<void>
  confirmNavigationDiscard: (tabId: string) => void
  cancelNavigation: (tabId: string) => void

  commitEditingRowIfNeeded: (
    tabId: string,
    newRowKey: Record<string, unknown> | null
  ) => Promise<void>
}

export const useTableDataStore = create<TableDataStore>()(() => ({
  tabs: {},
  columnJumpRequests: {},
  highlightedColumnByTab: {},
  ...pageActions(),
  ...residencyActions(),
  ...cellEditActions(),
  ...rowCloneActions(),
  ...rowSaveActions(),
  ...rowDeletionActions(),
  ...viewActions(),
  ...navigationGuardActions(),
}))
