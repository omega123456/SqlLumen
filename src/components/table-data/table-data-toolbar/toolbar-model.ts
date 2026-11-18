import {
  useTableDataStore,
  cloneSourceRowKey,
  isSameRowKey,
  findRowIndexByKey as findStoreRowIndexByKey,
} from '../../../stores/table-data-store'
import { FALLBACK_ROW_LIMIT } from '../../../stores/query-store'
import type {
  FilterCondition,
  RowEditState,
  SelectedCellInfo,
  TableDataColumnMeta,
  TableDataTabState,
} from '../../../types/schema'

export type RowKey = Record<string, unknown>

const EMPTY_ROW_KEYS: RowKey[] = []
const EMPTY_COLUMNS: TableDataColumnMeta[] = []
const EMPTY_ROWS: unknown[][] = []
const EMPTY_FILTERS: FilterCondition[] = []

export interface ToolbarTabView {
  connectionId: string
  table: string
  executionTimeMs: number
  isLoading: boolean
  isCancelling: boolean
  isRestoring: boolean
  primaryKey: TableDataTabState['primaryKey']
  editState: RowEditState | null
  viewMode: TableDataTabState['viewMode']
  currentPage: number
  pageSize: number
  selectedRowKey: RowKey | null
  checkedRowKeys: RowKey[]
  columns: TableDataColumnMeta[]
  rows: unknown[][]
  filterModel: FilterCondition[]
  selectedCell: SelectedCellInfo | null
}

const EMPTY_TOOLBAR_TAB_VIEW: ToolbarTabView = {
  connectionId: '',
  table: '',
  executionTimeMs: 0,
  isLoading: false,
  isCancelling: false,
  isRestoring: false,
  primaryKey: null,
  editState: null,
  viewMode: 'grid',
  currentPage: 1,
  pageSize: FALLBACK_ROW_LIMIT,
  selectedRowKey: null,
  checkedRowKeys: EMPTY_ROW_KEYS,
  columns: EMPTY_COLUMNS,
  rows: EMPTY_ROWS,
  filterModel: EMPTY_FILTERS,
  selectedCell: null,
}

export function toolbarTabView(tabState: TableDataTabState | undefined): ToolbarTabView {
  if (!tabState) return EMPTY_TOOLBAR_TAB_VIEW
  return {
    connectionId: tabState.connectionId,
    table: tabState.table,
    executionTimeMs: tabState.executionTimeMs,
    isLoading: tabState.isLoading,
    isCancelling: tabState.isCancelling ?? false,
    isRestoring: tabState.rowResidency?.status === 'restoring',
    primaryKey: tabState.primaryKey,
    editState: tabState.editState,
    viewMode: tabState.viewMode,
    currentPage: tabState.currentPage,
    pageSize: tabState.pageSize,
    selectedRowKey: tabState.selectedRowKey,
    checkedRowKeys: tabState.checkedRowKeys ?? EMPTY_ROW_KEYS,
    columns: tabState.columns,
    rows: tabState.rows,
    filterModel: tabState.filterModel,
    selectedCell: tabState.selectedCell,
  }
}

function isNewRowKey(rowKey: RowKey | null): boolean {
  return rowKey !== null && '__tempId' in rowKey
}

export function hasDeletableSelection(view: ToolbarTabView): boolean {
  if (view.selectedRowKey === null) return false
  return !isNewRowKey(view.selectedRowKey)
}

export function canCloneSelection(view: ToolbarTabView): boolean {
  const isEditingDraftRow = view.editState?.isNewRow === true
  if (isEditingDraftRow) return false
  const sourceRowKey = cloneSourceRowKey(view)
  if (sourceRowKey === null) return false
  return !isNewRowKey(sourceRowKey)
}

export function canMutateTableRows(view: ToolbarTabView, isConnectionReadOnly: boolean): boolean {
  if (isConnectionReadOnly) return false
  return view.primaryKey !== null
}

export interface RowIndexLookup {
  rows: unknown[][]
  columns: TableDataColumnMeta[]
  editTempId: unknown
}

export function rowIndexForKey(rowKey: RowKey, lookup: RowIndexLookup): number {
  if (typeof rowKey.__rowIndex === 'number') return rowKey.__rowIndex
  const isEditedDraft = '__tempId' in rowKey && rowKey.__tempId === lookup.editTempId
  if (isEditedDraft) return lookup.rows.length - 1
  return findStoreRowIndexByKey(lookup.rows, lookup.columns, rowKey)
}

export function pluralRows(count: number): string {
  return `${count} row${count === 1 ? '' : 's'}`
}

export function isTabSettledWithoutError(tabId: string): boolean {
  const tabState = useTableDataStore.getState().tabs[tabId]
  return Boolean(tabState) && !tabState.error
}

export function isNoKeyBadgeVisible(isView: boolean, view: ToolbarTabView): boolean {
  if (isView) return false
  if (view.primaryKey !== null) return false
  return !view.isLoading && view.columns.length > 0
}

export interface CheckedRowDeletion {
  rowKeysToDelete: RowKey[]
  discardedDraftCount: number
  discardsEditingRow: boolean
}

export function planCheckedRowDeletion(
  checkedRowKeys: RowKey[],
  editState: RowEditState | null
): CheckedRowDeletion {
  const isEditingCheckedRow =
    editState !== null && checkedRowKeys.some((key) => isSameRowKey(editState.rowKey, key))
  if (!isEditingCheckedRow) {
    return { rowKeysToDelete: checkedRowKeys, discardedDraftCount: 0, discardsEditingRow: false }
  }
  if (!editState.isNewRow) {
    return { rowKeysToDelete: checkedRowKeys, discardedDraftCount: 0, discardsEditingRow: true }
  }
  return {
    rowKeysToDelete: checkedRowKeys.filter((key) => !isSameRowKey(editState.rowKey, key)),
    discardedDraftCount: 1,
    discardsEditingRow: true,
  }
}
