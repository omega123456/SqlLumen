import { create } from 'zustand'
import type {
  TableDataColumnMeta,
  TableDataTabState,
  FilterCondition,
  RowEditState,
  SelectedCellInfo,
  FrontendRowResidencyState,
} from '../types/schema'
import {
  fetchTableData as fetchTableDataCmd,
  evictTableData as evictTableDataCmd,
  restoreTableDataCache as restoreTableDataCacheCmd,
  syncTableDataCacheAfterDelete as syncTableDataCacheAfterDeleteCmd,
  syncTableDataCacheAfterInsert as syncTableDataCacheAfterInsertCmd,
  syncTableDataCacheAfterUpdate as syncTableDataCacheAfterUpdateCmd,
  updateTableRow as updateTableRowCmd,
  insertTableRow as insertTableRowCmd,
  deleteTableRow as deleteTableRowCmd,
  normalizeTinyIntRows,
} from '../lib/table-data-commands'
import { getTableForeignKeys } from '../lib/schema-commands'
import { cancelQuery as cancelQueryCmd } from '../lib/query-commands'
import { getTemporalValidationResult } from '../lib/table-data-save-utils'
import { getTemporalColumnType, getTodayMysqlString } from '../lib/date-utils'
import type { TemporalColumnType } from '../lib/date-utils'
import { hasModifiedColumns, hasPendingRowChanges } from '../lib/row-edit-state'
import { showErrorToast, showSuccessToast } from './toast-store'
import { mapSingleColumnForeignKeys } from '../lib/foreign-key-utils'
import { getDefaultRowLimit, isTableDataInBottomPanel, useQueryStore } from './query-store'
import { useWorkspaceStore } from './workspace-store'

import { logFrontend } from '../lib/app-log-commands'
import { frontendCacheLifecycle } from '../lib/frontend-cache-lifecycle'
import {
  blobPlaceholder,
  convertBinaryPrimaryKeyValuesToEnvelopes,
  isBlobEnvelope,
} from '../lib/blob-utils'
import type { BlobEnvelope } from '../types/schema'
import { describeQueryFailure, toErrorMessage } from '../lib/error-message'
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESET_SCROLL_CELL = { scrollRow: 0 as const, scrollCol: 0 as const }
const BASE64_BYTES_PER_GROUP = 3
const BASE64_CHARS_PER_GROUP = 4
const BASE64_DOUBLE_PADDING = '=='
const BASE64_SINGLE_PADDING = '='
const CURRENT_TIMESTAMP_DEFAULT = /^current_timestamp(?:\(\d+\))?$/i
const CURRENT_VALUE_DEFAULT_BY_TEMPORAL_TYPE: Partial<
  Record<NonNullable<TemporalColumnType>, RegExp>
> = {
  DATE: /^current_date(?:\(\))?$/i,
  TIME: /^current_time(?:\(\))?$/i,
}

function base64PaddingLength(base64: string): number {
  if (base64.endsWith(BASE64_DOUBLE_PADDING)) return BASE64_DOUBLE_PADDING.length
  if (base64.endsWith(BASE64_SINGLE_PADDING)) return BASE64_SINGLE_PADDING.length
  return 0
}

/** Compare two row keys for equality using JSON-based comparison. */
function isSameRowKey(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null
): boolean {
  const isEitherKeyMissing = left === null || right === null
  if (isEitherKeyMissing) return left === right
  const aKeys = Object.keys(left).sort()
  const bKeys = Object.keys(right).sort()
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(
    (key, index) => key === bKeys[index] && JSON.stringify(left[key]) === JSON.stringify(right[key])
  )
}

function isSameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Find a row index by primary key values.
 * The rows are positional arrays; columns tells us which index maps to which name.
 */
function findRowIndexByKey(
  rows: unknown[][],
  columns: TableDataColumnMeta[],
  rowKey: Record<string, unknown>
): number {
  // Cannot match by __tempId using column data
  if ('__tempId' in rowKey) return -1

  return rows.findIndex((row) => {
    for (const [keyColumn, keyValue] of Object.entries(rowKey)) {
      const columnIndex = columns.findIndex((column) => column.name === keyColumn)
      if (columnIndex === -1) return false
      if (!isSameJsonValue(row[columnIndex], keyValue)) return false
    }
    return true
  })
}

function getRowKeyFromData(
  rowData: Record<string, unknown>,
  primaryKeyColumns: string[],
  options: { includeRowIndexFallback?: boolean } = {}
): Record<string, unknown> {
  if ('__tempId' in rowData) {
    return { __tempId: rowData.__tempId }
  }

  const editingRowKey = rowData.__editingRowKey
  const hasEditingRowKey = Boolean(editingRowKey) && typeof editingRowKey === 'object'
  if (hasEditingRowKey) {
    return editingRowKey as Record<string, unknown>
  }

  const key: Record<string, unknown> = {}
  for (const column of primaryKeyColumns) {
    key[column] = rowData[column]
  }
  const shouldFallBackToRowIndex =
    options.includeRowIndexFallback === true &&
    primaryKeyColumns.length === 0 &&
    rowData.__rowIndex != null
  if (shouldFallBackToRowIndex) {
    key.__rowIndex = rowData.__rowIndex
  }
  return key
}

export function isEditingRowKey(
  editState: RowEditState | null | undefined,
  rowKey: Record<string, unknown> | null
): editState is RowEditState {
  if (!editState) return false
  return isSameRowKey(editState.rowKey, rowKey)
}

export { isSameRowKey, findRowIndexByKey, getRowKeyFromData }

function buildCurrentValuesFromRow(
  columns: TableDataColumnMeta[],
  rowValues: unknown[]
): Record<string, unknown> {
  const currentValues: Record<string, unknown> = {}
  for (let index = 0; index < columns.length; index += 1) {
    currentValues[columns[index].name] = rowValues[index]
  }
  return currentValues
}

function appendDraftRow(
  tab: TableDataTabState,
  patchTab: (tabId: string, partial: Partial<TableDataTabState>) => void,
  startEditing: (
    tabId: string,
    rowKey: Record<string, unknown>,
    currentValues: Record<string, unknown>
  ) => void,
  tabId: string,
  rowValues: unknown[],
  modifiedColumns: Set<string>
): void {
  const tempId = 'new-' + Date.now()
  const newRows = [...tab.rows, rowValues]

  patchTab(tabId, { rows: newRows, selectedRowKey: { __tempId: tempId } })

  startEditing(tabId, { __tempId: tempId }, buildCurrentValuesFromRow(tab.columns, rowValues))

  const updatedTab = useTableDataStore.getState().tabs[tabId]
  if (!updatedTab?.editState) return

  patchTab(tabId, {
    editState: {
      ...updatedTab.editState,
      isNewRow: true,
      tempId: tempId,
      modifiedColumns: modifiedColumns,
    },
  })
}

function evictTableDataWithWarning(
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

function isTableDataTabVisibleInWorkspace(tabId: string): boolean {
  const workspaceState = useWorkspaceStore.getState()

  for (const [connectionId, tabs] of Object.entries(workspaceState.tabsByConnection)) {
    const targetTab = tabs.find((tab) => tab.id === tabId)
    if (!targetTab) {
      continue
    }

    // A table-data tab (standalone or scoped) is only globally visible when its
    // connection session is the visible connection. A selected tab inside a
    // hidden (background) connection is inactive for row residency.
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

function createResidentRowState(isActive = false): FrontendRowResidencyState {
  return {
    status: 'resident',
    isActive: isActive,
    inactiveSince: null,
  }
}

function getTableDataSurfaceKey(tabId: string): string {
  return `table-data:${tabId}`
}

function isDirtyTableDataTab(tab: TableDataTabState): boolean {
  return hasPendingRowChanges(tab.editState)
}

function tabRowResidency(tab: TableDataTabState): FrontendRowResidencyState {
  return tab.rowResidency ?? createResidentRowState(false)
}

function isEvictableTableDataTab(tab: TableDataTabState): boolean {
  const isResident = tabRowResidency(tab).status === 'resident'
  if (!isResident) return false
  return !isDirtyTableDataTab(tab)
}

function shouldScheduleTableDataEviction(tab: TableDataTabState): boolean {
  return isEvictableTableDataTab(tab) && tab.rows.length > 0
}

function canEvictInactiveTableDataTab(tab: TableDataTabState): boolean {
  return !tabRowResidency(tab).isActive && isEvictableTableDataTab(tab)
}

// ---------------------------------------------------------------------------
// saveCurrentRow helpers (pure functions)
// ---------------------------------------------------------------------------

/**
 * Coerce a cell value to the correct JS type for a given column data type.
 * BIT columns edited via the grid arrive as strings (e.g. "128") because
 * the cell editor always stores strings. MySQL needs a numeric bind for BIT
 * columns — a string bind triggers an incorrect binary-string conversion.
 */
function coerceValueForColumn(value: unknown, dataType: string): unknown {
  // A staged blob envelope must reach the backend value-binder untouched so the
  // `__sqllumen_blob__` marker is preserved (any coercion would stringify it).
  if (isBlobEnvelope(value)) {
    return value
  }
  if (typeof value !== 'string') return value
  if (!isBitDataType(dataType)) return value
  const parsed = parseInt(value, 10)
  return isSafeNonNegativeInteger(parsed) ? parsed : value
}

function isBitDataType(dataType: string): boolean {
  return dataType.toUpperCase() === 'BIT'
}

function isSafeNonNegativeInteger(parsed: number): boolean {
  return !Number.isNaN(parsed) && parsed >= 0 && parsed <= Number.MAX_SAFE_INTEGER
}

/** Build the values map for an INSERT operation. */
function buildInsertPayload(
  columns: TableDataColumnMeta[],
  editState: RowEditState
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const { modifiedColumns, currentValues } = editState
  for (const column of columns) {
    const currentValue = currentValues[column.name]
    if (!modifiedColumns.has(column.name)) continue
    if (currentValue === undefined) continue
    values[column.name] = coerceValueForColumn(currentValue, column.dataType)
  }
  return values
}

function normalizeColumnDefaultValue(columnDefault: string): unknown {
  const trimmedDefault = columnDefault.trim()

  if (/^null$/i.test(trimmedDefault)) {
    return null
  }

  const quotedMatch = trimmedDefault.match(/^'(.*)'$/s)
  if (quotedMatch) {
    return quotedMatch[1].replace(/''/g, "'")
  }

  return trimmedDefault
}

function getInitialValueForNewRow(column: TableDataColumnMeta): unknown {
  if (column.isAutoIncrement) {
    return null
  }

  if (column.columnDefault == null) {
    return null
  }

  const temporalType = getTemporalColumnType(column.dataType)
  if (!temporalType) return normalizeColumnDefaultValue(column.columnDefault)
  if (isCurrentTemporalDefault(column.columnDefault, temporalType)) {
    return getTodayMysqlString(temporalType)
  }
  return normalizeColumnDefaultValue(column.columnDefault)
}

function isCurrentTemporalDefault(
  columnDefault: string,
  temporalType: NonNullable<TemporalColumnType>
): boolean {
  if (CURRENT_TIMESTAMP_DEFAULT.test(columnDefault)) return true
  const currentValueDefault = CURRENT_VALUE_DEFAULT_BY_TEMPORAL_TYPE[temporalType]
  return currentValueDefault?.test(columnDefault) === true
}

export type BuildUpdatePayloadResult =
  | {
      ok: true
      originalPkValues: Record<string, unknown>
      updatedValues: Record<string, unknown>
    }
  | { ok: false; error: string }

/**
 * Build the payload for an UPDATE operation.
 *
 * Binary primary-key values in `originalPkValues` are converted from their hex
 * display string to a blob envelope so the backend binds real bytes in the
 * WHERE clause. As a pure helper this cannot toast: malformed hex is surfaced
 * as an error result for `saveCurrentRow` to handle.
 */
function buildUpdatePayload(
  editState: RowEditState,
  primaryKeyColumns: string[],
  columns: TableDataColumnMeta[]
): BuildUpdatePayloadResult {
  const columnsByName = new Map(columns.map((column) => [column.name, column]))

  const updatedValues: Record<string, unknown> = {}
  for (const column of editState.modifiedColumns) {
    const columnMeta = columnsByName.get(column)
    const rawValue = editState.currentValues[column]
    updatedValues[column] = columnMeta
      ? coerceValueForColumn(rawValue, columnMeta.dataType)
      : rawValue
  }

  const originalPrimaryKeyValues: Record<string, unknown> = {}
  for (const primaryKeyColumn of primaryKeyColumns) {
    originalPrimaryKeyValues[primaryKeyColumn] = editState.originalValues[primaryKeyColumn]
  }

  const converted = convertBinaryPrimaryKeyValuesToEnvelopes(
    primaryKeyColumns,
    columns,
    originalPrimaryKeyValues
  )
  if (!converted.ok) {
    return { ok: false, error: converted.error }
  }

  return { ok: true, originalPkValues: converted.values, updatedValues: updatedValues }
}

/**
 * Convert a saved blob-envelope cell value into its clean in-memory display
 * form: `bytes` → `[BLOB - N bytes]`, `empty` → `[BLOB - 0 bytes]`, `null` →
 * null. Non-envelope values pass through unchanged.
 */
function reconcileSavedBlobValue(value: unknown): unknown {
  if (!isBlobEnvelope(value)) return value
  const envelope = value as BlobEnvelope
  if (envelope.kind === 'null') return null
  if (envelope.kind === 'empty') return blobPlaceholder(0)
  let byteLength = 0
  if (typeof envelope.base64 === 'string') {
    const base64 = envelope.base64
    const padding = base64PaddingLength(base64)
    const decodedLength = Math.floor(
      (base64.length * BASE64_BYTES_PER_GROUP) / BASE64_CHARS_PER_GROUP
    )
    byteLength = Math.max(0, decodedLength - padding)
  }
  return blobPlaceholder(byteLength)
}

/** Replace the temp row (last row) with the inserted row data. */
function applyInsertedRow(
  rows: unknown[][],
  columns: TableDataColumnMeta[],
  insertedData: [string, unknown][]
): unknown[][] {
  const returnedMap = Object.fromEntries(insertedData)
  const newRow = normalizeTinyIntRows(columns, [
    columns.map((column) => reconcileSavedBlobValue(returnedMap[column.name] ?? null)),
  ])[0]
  const newRows = [...rows]
  newRows[newRows.length - 1] = newRow
  return newRows
}

function buildPersistedRowKeyFromInsertedData(
  insertedData: [string, unknown][],
  primaryKeyColumns: string[]
): Record<string, unknown> | null {
  if (primaryKeyColumns.length === 0) return null

  const returnedMap = Object.fromEntries(insertedData)
  const nextRowKey: Record<string, unknown> = {}
  for (const keyColumn of primaryKeyColumns) {
    if (!(keyColumn in returnedMap)) {
      return null
    }
    nextRowKey[keyColumn] = returnedMap[keyColumn]
  }

  return nextRowKey
}

/** Update the matching row with edited values. Returns the original rows if no match. */
function applyUpdatedRow(
  rows: unknown[][],
  columns: TableDataColumnMeta[],
  editState: RowEditState
): unknown[][] {
  const rowIndex = findRowIndexByKey(rows, columns, editState.rowKey)
  if (rowIndex === -1) return rows

  const newRows = [...rows]
  const updatedRow = [...newRows[rowIndex]]
  for (const [columnName, value] of Object.entries(editState.currentValues)) {
    const columnIndex = columns.findIndex((column) => column.name === columnName)
    if (columnIndex !== -1) {
      updatedRow[columnIndex] = reconcileSavedBlobValue(value)
    }
  }
  newRows[rowIndex] = updatedRow
  return newRows
}

// Exported for testing
export {
  coerceValueForColumn,
  buildInsertPayload,
  buildUpdatePayload,
  applyInsertedRow,
  applyUpdatedRow,
}

// ---------------------------------------------------------------------------
// Default state factory
// ---------------------------------------------------------------------------

function createDefaultTabState(
  connectionId: string,
  database: string,
  table: string
): TableDataTabState {
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

function isSeededFromColumnDefault(column: TableDataColumnMeta): boolean {
  return column.columnDefault != null && !column.isAutoIncrement
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface TableDataStore {
  tabs: Record<string, TableDataTabState>
  columnJumpRequests: Record<string, { columnKey: string; nonce: number }>
  highlightedColumnByTab: Record<string, string | null>

  initTab: (tabId: string, connectionId: string, database: string, table: string) => void
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
  /**
   * Stage a blob-envelope as a pending edit on the given row/column. Starts row
   * editing if needed (building the baseline from `rowData`), records the
   * envelope as the cell's modified value, and reflects it in the in-memory row
   * so the grid renders the `[BLOB - N bytes*]` placeholder.
   */
  stageBlobEnvelope: (
    tabId: string,
    rowData: Record<string, unknown>,
    column: string,
    envelope: BlobEnvelope
  ) => void
  syncCellValue: (
    tabId: string,
    rowData: Record<string, unknown> | undefined,
    column: string,
    value: unknown,
    rowKeyOverride?: Record<string, unknown>
  ) => void
  clearEditStateIfUnmodified: (tabId: string, rowKey: Record<string, unknown>) => void
  saveCurrentRow: (tabId: string) => Promise<boolean>
  discardCurrentRow: (tabId: string) => void
  insertNewRow: (tabId: string) => void
  cloneSelectedRow: (tabId: string) => void
  deleteRow: (tabId: string, rowKey: Record<string, unknown>) => Promise<void>
  /**
   * Delete multiple rows by their row keys. Persisted rows are removed from the
   * database via IPC (one call per row); unsaved draft rows are dropped locally.
   * Stops and records an error on the first failed delete, leaving already
   * deleted rows removed.
   */
  deleteRows: (tabId: string, rowKeys: Record<string, unknown>[]) => Promise<number>

  setViewMode: (tabId: string, mode: 'grid' | 'form') => void
  setSelectedRow: (tabId: string, rowKey: Record<string, unknown> | null) => void
  /** Replace the set of checkbox-checked row keys for bulk operations. */
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

function withoutColumnHighlight(
  state: TableDataStore,
  tabId: string
): TableDataStore | Pick<TableDataStore, 'highlightedColumnByTab'> {
  const highlightedColumn = state.highlightedColumnByTab[tabId]
  if (highlightedColumn == null) return state
  return { highlightedColumnByTab: { ...state.highlightedColumnByTab, [tabId]: null } }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type RowKey = Record<string, unknown>

const SYNC_TABLE_DATA_CACHE_COMMANDS = {
  insert: syncTableDataCacheAfterInsertCmd,
  update: syncTableDataCacheAfterUpdateCmd,
  delete: syncTableDataCacheAfterDeleteCmd,
}

function buildFetchTableDataRequest(
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

function residencyAfterFetch(
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

function withColumnModified(
  modifiedColumns: Set<string>,
  column: string,
  isModified: boolean
): Set<string> {
  const nextModifiedColumns = new Set(modifiedColumns)
  if (!isModified) {
    nextModifiedColumns.delete(column)
    return nextModifiedColumns
  }
  nextModifiedColumns.add(column)
  return nextModifiedColumns
}

function isDraftRowKey(rowKey: RowKey): boolean {
  return '__tempId' in rowKey
}

function rowDataBaseline(
  columns: TableDataColumnMeta[],
  rowData: Record<string, unknown>
): Record<string, unknown> {
  const baseline: Record<string, unknown> = {}
  for (const column of columns) {
    baseline[column.name] = rowData[column.name]
  }
  return baseline
}

function isRowIndexWithin(rowIndexHint: unknown, rowCount: number): rowIndexHint is number {
  return typeof rowIndexHint === 'number' && rowIndexHint >= 0 && rowIndexHint < rowCount
}

function resolveStagedRowIndex(
  tab: Pick<TableDataTabState, 'rows' | 'columns'>,
  rowKey: RowKey,
  rowData: Record<string, unknown>
): number {
  const rowIndex = findRowIndexByKey(tab.rows, tab.columns, rowKey)
  if (rowIndex >= 0) return rowIndex
  if (!isDraftRowKey(rowKey)) return rowIndex
  const rowIndexHint = rowData.__rowIndex
  return isRowIndexWithin(rowIndexHint, tab.rows.length) ? rowIndexHint : tab.rows.length - 1
}

interface CellWrite {
  rowIndex: number
  columnIndex: number
  value: unknown
}

function withCellWritten(rows: unknown[][], write: CellWrite): unknown[][] {
  const nextRows = [...rows]
  const nextRow = [...nextRows[write.rowIndex]]
  nextRow[write.columnIndex] = write.value
  nextRows[write.rowIndex] = nextRow
  return nextRows
}

function rowKeyAfterCellChange(
  primaryKeyColumns: string[],
  rowKey: RowKey,
  change: { column: string; value: unknown }
): RowKey {
  if (!primaryKeyColumns.includes(change.column)) return rowKey
  if (isDraftRowKey(rowKey)) return rowKey
  return { ...rowKey, [change.column]: change.value }
}

interface RowKeyRename {
  previous: RowKey
  next: RowKey
}

function renameEditStateRowKey(
  editState: RowEditState | null,
  rename: RowKeyRename
): RowEditState | null {
  if (editState === null) return editState
  if (!isSameRowKey(editState.rowKey, rename.previous)) return editState
  return { ...editState, rowKey: rename.next }
}

function renameSelectedRowKey(selectedRowKey: RowKey | null, rename: RowKeyRename): RowKey | null {
  if (!selectedRowKey) return selectedRowKey
  if (!isSameRowKey(selectedRowKey, rename.previous)) return selectedRowKey
  return rename.next
}

function isSelectedDraftRow(tab: TableDataTabState, editState: RowEditState): boolean {
  const selectedRowKey = tab.selectedRowKey
  if (selectedRowKey === null) return false
  if (!isDraftRowKey(selectedRowKey)) return false
  return editState.tempId === selectedRowKey.__tempId
}

function withOriginalValuesRestored(
  row: unknown[],
  columns: TableDataColumnMeta[],
  originalValues: Record<string, unknown>
): unknown[] {
  const restoredRow = [...row]
  for (const [columnName, value] of Object.entries(originalValues)) {
    const columnIndex = columns.findIndex((column) => column.name === columnName)
    if (columnIndex !== -1) {
      restoredRow[columnIndex] = value
    }
  }
  return restoredRow
}

function restoredSelectedRowKey(tab: TableDataTabState, editState: RowEditState): RowKey | null {
  const isEditedRowSelected =
    tab.selectedRowKey !== null && isSameRowKey(tab.selectedRowKey, editState.rowKey)
  if (!isEditedRowSelected) {
    return tab.selectedRowKey
  }
  return Object.fromEntries(
    Object.keys(editState.rowKey).map((key) => [key, editState.originalValues[key]])
  )
}

export const useTableDataStore = create<TableDataStore>()((set, get) => {
  /** Merge a partial update into a single tab's state. */
  const patchTab = (tabId: string, partial: Partial<TableDataTabState>) => {
    set((state) => {
      const existing = state.tabs[tabId]
      if (!existing) return state
      return {
        tabs: {
          ...state.tabs,
          [tabId]: { ...existing, ...partial },
        },
      }
    })
  }

  const patchTabResidency = (tabId: string, partial: Partial<FrontendRowResidencyState>) => {
    set((state) => {
      const existing = state.tabs[tabId]
      if (!existing) return state

      return {
        tabs: {
          ...state.tabs,
          [tabId]: {
            ...existing,
            rowResidency: {
              ...(existing.rowResidency ?? createResidentRowState(false)),
              ...partial,
            },
          },
        },
      }
    })
  }

  const cancelTableDataLifecycleTimer = (tabId: string) => {
    frontendCacheLifecycle.cancel(getTableDataSurfaceKey(tabId))
  }

  const markTableDataResident = (
    tabId: string,
    partial: Partial<TableDataTabState> = {},
    options?: { preserveActiveState?: boolean }
  ) => {
    const current = get().tabs[tabId]
    const currentResidency = current?.rowResidency ?? createResidentRowState(false)
    const preserveActiveState = options?.preserveActiveState === true
    const keepsInactiveSince = preserveActiveState && !currentResidency.isActive
    patchTab(tabId, {
      ...partial,
      rowsEvictedAt: null,
      rowResidency: {
        status: 'resident',
        isActive: preserveActiveState ? currentResidency.isActive : false,
        inactiveSince: keepsInactiveSince ? currentResidency.inactiveSince : null,
      },
    })
  }

  const syncPatchedTableDataCache = async (
    mode: 'insert' | 'update' | 'delete',
    tabId: string,
    rows: unknown[][]
  ) => {
    const latestTab = get().tabs[tabId]
    if (!latestTab) return

    const syncParams = {
      connectionId: latestTab.connectionId,
      tabId: tabId,
      database: latestTab.database,
      table: latestTab.table,
      columns: latestTab.columns,
      rows: rows,
      currentPage: latestTab.currentPage,
      pageSize: latestTab.pageSize,
      primaryKey: latestTab.primaryKey,
      executionTimeMs: latestTab.executionTimeMs,
    }

    try {
      const syncResult = await SYNC_TABLE_DATA_CACHE_COMMANDS[mode](syncParams)

      if (syncResult.status !== 'synced') {
        logFrontend(
          'warn',
          `[table-data-store] sync_table_data_cache_after_${mode} returned ${syncResult.status} for ${tabId}`
        )
        evictTableDataWithWarning(
          latestTab.connectionId,
          tabId,
          `after sync_table_data_cache_after_${mode} returned ${syncResult.status}`
        )
      }
    } catch (error) {
      const errorMessage = toErrorMessage(error)
      logFrontend(
        'warn',
        `[table-data-store] sync_table_data_cache_after_${mode} failed for ${tabId}: ${errorMessage}`
      )
      evictTableDataWithWarning(
        latestTab.connectionId,
        tabId,
        `after sync_table_data_cache_after_${mode} failed`
      )
    }
  }

  function recordSaveError(tabId: string, error: unknown): false {
    if (get().tabs[tabId]) {
      patchTab(tabId, { saveError: toErrorMessage(error) })
    }
    return false
  }

  function recordTabError(tabId: string, error: unknown): void {
    if (!get().tabs[tabId]) return
    patchTab(tabId, { error: toErrorMessage(error) })
  }

  async function insertDraftRowUnsafe(
    tabId: string,
    tab: TableDataTabState,
    editState: RowEditState
  ): Promise<boolean> {
    const { columns, primaryKey } = tab
    if (!primaryKey) throw new Error('No primary key info available')

    const returnedData = await insertTableRowCmd({
      connectionId: tab.connectionId,
      database: tab.database,
      table: tab.table,
      values: buildInsertPayload(columns, editState),
      pkInfo: primaryKey,
    })
    if (!get().tabs[tabId]) return true

    const newRows = applyInsertedRow(tab.rows, columns, returnedData)
    const persistedRowKey = buildPersistedRowKeyFromInsertedData(
      returnedData,
      primaryKey.keyColumns
    )
    await syncPatchedTableDataCache('insert', tabId, newRows)
    markTableDataResident(
      tabId,
      {
        rows: newRows,
        editState: null,
        saveError: null,
        selectedRowKey: persistedRowKey,
      },
      { preserveActiveState: true }
    )
    return true
  }

  async function insertDraftRow(
    tabId: string,
    tab: TableDataTabState,
    editState: RowEditState
  ): Promise<boolean> {
    try {
      return await insertDraftRowUnsafe(tabId, tab, editState)
    } catch (error) {
      return recordSaveError(tabId, error)
    }
  }

  async function updateEditedRowUnsafe(
    tabId: string,
    tab: TableDataTabState,
    editState: RowEditState
  ): Promise<boolean> {
    const { columns, primaryKey } = tab
    if (!primaryKey) throw new Error('No primary key info available')

    const payload = buildUpdatePayload(editState, primaryKey.keyColumns, columns)
    if (!payload.ok) {
      showErrorToast('Could not save row', payload.error)
      patchTab(tabId, { saveError: payload.error })
      return false
    }

    await updateTableRowCmd({
      connectionId: tab.connectionId,
      database: tab.database,
      table: tab.table,
      primaryKeyColumns: primaryKey.keyColumns,
      originalPkValues: payload.originalPkValues,
      updatedValues: payload.updatedValues,
    })
    if (!get().tabs[tabId]) return true

    const newRows = applyUpdatedRow(tab.rows, columns, editState)
    await syncPatchedTableDataCache('update', tabId, newRows)
    markTableDataResident(
      tabId,
      {
        rows: newRows,
        editState: null,
        saveError: null,
      },
      { preserveActiveState: true }
    )
    return true
  }

  async function updateEditedRow(
    tabId: string,
    tab: TableDataTabState,
    editState: RowEditState
  ): Promise<boolean> {
    try {
      return await updateEditedRowUnsafe(tabId, tab, editState)
    } catch (error) {
      return recordSaveError(tabId, error)
    }
  }

  function discardDraftRow(tabId: string, tab: TableDataTabState, editState: RowEditState): void {
    const newRows = [...tab.rows]
    newRows.pop()
    patchTab(tabId, {
      rows: newRows,
      editState: null,
      saveError: null,
      selectedRowKey: isSelectedDraftRow(tab, editState) ? null : tab.selectedRowKey,
    })
  }

  function restoreEditedRow(tabId: string, tab: TableDataTabState, editState: RowEditState): void {
    const rowIndex = findRowIndexByKey(tab.rows, tab.columns, editState.rowKey)
    if (rowIndex === -1) {
      patchTab(tabId, { editState: null, saveError: null })
      return
    }
    const newRows = [...tab.rows]
    newRows[rowIndex] = withOriginalValuesRestored(
      newRows[rowIndex],
      tab.columns,
      editState.originalValues
    )
    patchTab(tabId, {
      rows: newRows,
      editState: null,
      saveError: null,
      selectedRowKey: restoredSelectedRowKey(tab, editState),
    })
  }

  function removeDraftRow(tabId: string, tab: TableDataTabState, tempId: unknown): void {
    const isEditingRemovedDraft = tab.editState?.tempId === tempId
    const newRows = [...tab.rows]
    newRows.pop()
    patchTab(tabId, {
      rows: newRows,
      editState: isEditingRemovedDraft ? null : tab.editState,
      saveError: null,
    })
  }

  function primaryKeyValuesForDelete(
    tabId: string,
    tab: TableDataTabState,
    rowKey: RowKey
  ): Parameters<typeof deleteTableRowCmd>[0] | null {
    if (!tab.primaryKey) return null
    // Binary PK values bind as bytes; the caller keeps the hex rowKey for the local lookup (C5).
    const converted = convertBinaryPrimaryKeyValuesToEnvelopes(
      tab.primaryKey.keyColumns,
      tab.columns,
      rowKey
    )
    if (!converted.ok) {
      showErrorToast('Could not delete row', converted.error)
      patchTab(tabId, { error: converted.error })
      return null
    }
    return {
      connectionId: tab.connectionId,
      database: tab.database,
      table: tab.table,
      pkColumns: tab.primaryKey.keyColumns,
      pkValues: converted.values,
    }
  }

  async function removePersistedRowLocally(
    tabId: string,
    sourceTab: TableDataTabState,
    rowKey: RowKey
  ): Promise<void> {
    const rowIndex = findRowIndexByKey(sourceTab.rows, sourceTab.columns, rowKey)
    if (rowIndex === -1) return
    const newRows = [...sourceTab.rows]
    newRows.splice(rowIndex, 1)
    await syncPatchedTableDataCache('delete', tabId, newRows)
    markTableDataResident(
      tabId,
      { rows: newRows, editState: null, saveError: null },
      { preserveActiveState: true }
    )
  }

  async function deletePersistedRowInBulk(tabId: string, rowKey: RowKey): Promise<boolean> {
    const tab = get().tabs[tabId]
    if (!tab) return false
    const primaryKeyValues = primaryKeyValuesForDelete(tabId, tab, rowKey)
    if (!primaryKeyValues) return false
    try {
      await deleteTableRowCmd(primaryKeyValues)
      const latest = get().tabs[tabId]
      if (!latest) return false
      await removePersistedRowLocally(tabId, latest, rowKey)
      return true
    } catch (error) {
      recordTabError(tabId, error)
      return false
    }
  }

  return {
    tabs: {},
    columnJumpRequests: {},
    highlightedColumnByTab: {},

    // ------ initTab ------

    initTab: (tabId, connectionId, database, table) => {
      set((state) => ({
        tabs: {
          ...state.tabs,
          [tabId]: createDefaultTabState(connectionId, database, table),
        },
      }))
    },

    // ------ cleanupTab ------

    cleanupTab: (tabId) => {
      const tab = get().tabs[tabId]
      if (tab) {
        cancelTableDataLifecycleTimer(tabId)
        evictTableDataWithWarning(tab.connectionId, tabId)
      }

      set((state) => {
        const newTabs = { ...state.tabs }
        const columnJumpRequests = { ...state.columnJumpRequests }
        const highlightedColumnByTab = { ...state.highlightedColumnByTab }
        delete newTabs[tabId]
        delete columnJumpRequests[tabId]
        delete highlightedColumnByTab[tabId]
        return {
          tabs: newTabs,
          columnJumpRequests: columnJumpRequests,
          highlightedColumnByTab: highlightedColumnByTab,
        }
      })
    },

    // ------ loadTableData ------

    loadTableData: async (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      patchTab(tabId, {
        currentPage: 1,
        editState: null,
        saveError: null,
        error: null,
        foreignKeys: [],
        ...RESET_SCROLL_CELL,
      })

      // Fire FK metadata fetch in parallel (fire-and-forget)
      getTableForeignKeys(tab.connectionId, tab.database, tab.table)
        .then((foreignKeyInfos) => {
          // Guard: tab may have been cleaned up during the async call
          if (!get().tabs[tabId]) return

          patchTab(tabId, { foreignKeys: mapSingleColumnForeignKeys(foreignKeyInfos) })
        })
        .catch((error: unknown) => {
          const errorMessage = toErrorMessage(error)
          logFrontend('warn', 'FK metadata fetch failed: ' + errorMessage)
          // Leave foreignKeys as [] — do NOT set error on the tab
        })

      await get().fetchPage(tabId, 1)
    },

    // ------ fetchPage ------

    fetchPage: async (tabId, page) => {
      const tab = get().tabs[tabId]
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
        const latestTab = get().tabs[tabId]
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
          get().markTableDataSurfaceInactive(tabId)
        }
      } catch (error) {
        if (!get().tabs[tabId]) return

        // When the user cancelled the in-flight query, the backend KILL surfaces
        // as a generic query error — report it as a cancellation instead.
        const wasCancelled = get().tabs[tabId]?.isCancelling ?? false
        patchTab(tabId, {
          error: describeQueryFailure(wasCancelled, error),
          isLoading: false,
          isCancelling: false,
        })
      }
    },

    // ------ cancelLoad ------

    cancelLoad: async (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return
      if (!tab.isLoading) return
      if (tab.isCancelling) return

      patchTab(tabId, { isCancelling: true })

      try {
        const cancelled = await cancelQueryCmd(tab.connectionId, tabId)
        if (!get().tabs[tabId]) return

        if (cancelled) {
          // The in-flight fetchPage catch clause resets isCancelling/isLoading.
          showSuccessToast('Query cancelled')
          return
        }
        patchTab(tabId, { isCancelling: false })
      } catch (error) {
        if (!get().tabs[tabId]) return
        patchTab(tabId, { isCancelling: false })
        showErrorToast('Cancel failed', toErrorMessage(error))
      }
    },

    // ------ sortByColumn ------

    sortByColumn: async (tabId, column, direction) => {
      const sort = direction === null ? null : { column, direction }
      patchTab(tabId, { sort: sort, scrollRow: 0 })
      await get().fetchPage(tabId, 1)
    },

    // ------ applyFilters ------

    applyFilters: async (tabId, conditions) => {
      patchTab(tabId, { filterModel: conditions, ...RESET_SCROLL_CELL })
      await get().fetchPage(tabId, 1)
    },

    // ------ refreshData ------

    refreshData: async (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return
      await get().fetchPage(tabId, tab.currentPage)
    },

    markTableDataSurfaceActive: async (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      cancelTableDataLifecycleTimer(tabId)
      patchTabResidency(tabId, {
        isActive: true,
        inactiveSince: null,
      })

      const isEvicted = tab.rowResidency?.status === 'evicted'
      if (isEvicted) {
        await get().restoreEvictedTableDataRows(tabId)
      }
    },

    markTableDataSurfaceInactive: (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      patchTabResidency(tabId, {
        isActive: false,
        inactiveSince: Date.now(),
      })

      if (!shouldScheduleTableDataEviction(tab)) return

      frontendCacheLifecycle.scheduleInactive(getTableDataSurfaceKey(tabId), () => {
        get().evictInactiveTableDataRows(tabId)
      })
    },

    evictInactiveTableDataRows: (tabId) => {
      cancelTableDataLifecycleTimer(tabId)
      set((state) => {
        const tab = state.tabs[tabId]
        if (!tab) return state

        if (!canEvictInactiveTableDataTab(tab)) return state

        return {
          tabs: {
            ...state.tabs,
            [tabId]: {
              ...tab,
              rows: [],
              rowsEvictedAt: Date.now(),
              selectedRowKey: null,
              checkedRowKeys: [],
              selectedCell: null,
              editState: null,
              saveError: null,
              rowResidency: {
                ...tabRowResidency(tab),
                status: 'evicted',
              },
            },
          },
        }
      })
    },

    restoreEvictedTableDataRows: async (tabId) => {
      const tab = get().tabs[tabId]
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

        if (!get().tabs[tabId]) return

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

        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          isLoading: false,
          error: 'Cached table data could not be restored. Reload the table data to continue.',
        })
        patchTabResidency(tabId, { status: 'evicted' })
      }
    },

    // ------ startEditing ------

    startEditing: (tabId, rowKey, currentValues) => {
      const editState: RowEditState = {
        rowKey: rowKey,
        originalValues: JSON.parse(JSON.stringify(currentValues)),
        currentValues: { ...currentValues },
        modifiedColumns: new Set<string>(),
        isNewRow: false,
      }
      patchTab(tabId, { editState: editState, saveError: null })
    },

    // ------ updateCellValue ------

    updateCellValue: (tabId, column, value) => {
      const tab = get().tabs[tabId]
      if (!tab?.editState) return

      const isModified =
        JSON.stringify(tab.editState.originalValues[column]) !== JSON.stringify(value)
      const newModified = withColumnModified(tab.editState.modifiedColumns, column, isModified)

      patchTab(tabId, {
        editState: {
          ...tab.editState,
          currentValues: { ...tab.editState.currentValues, [column]: value },
          modifiedColumns: newModified,
        },
        saveError: null,
      })
    },

    // ------ stageBlobEnvelope ------

    stageBlobEnvelope: (tabId, rowData, column, envelope) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      const columnIndex = tab.columns.findIndex((candidate) => candidate.name === column)
      if (columnIndex < 0) return

      const rowKey = getRowKeyFromData(rowData, tab.primaryKey?.keyColumns ?? [])
      if (!isEditingRowKey(tab.editState, rowKey)) {
        get().startEditing(tabId, rowKey, rowDataBaseline(tab.columns, rowData))
      }
      get().updateCellValue(tabId, column, envelope)

      const latestTab = get().tabs[tabId]
      if (!latestTab) return
      const rowIndex = resolveStagedRowIndex(latestTab, rowKey, rowData)
      if (rowIndex < 0) return
      patchTab(tabId, {
        rows: withCellWritten(latestTab.rows, {
          rowIndex: rowIndex,
          columnIndex: columnIndex,
          value: envelope,
        }),
      })
    },

    // ------ syncCellValue ------

    syncCellValue: (tabId, rowData, column, value, rowKeyOverride) => {
      const tab = get().tabs[tabId]
      if (!tab) return
      if (!rowData) return

      const columnIndex = tab.columns.findIndex((candidate) => candidate.name === column)
      if (columnIndex < 0) return

      const primaryKeyColumns = tab.primaryKey?.keyColumns ?? []
      const rowKey = rowKeyOverride ?? getRowKeyFromData(rowData, primaryKeyColumns)
      const rowIndex = findRowIndexByKey(tab.rows, tab.columns, rowKey)
      if (rowIndex < 0) return

      const rename: RowKeyRename = {
        previous: rowKey,
        next: rowKeyAfterCellChange(primaryKeyColumns, rowKey, { column: column, value: value }),
      }
      patchTab(tabId, {
        rows: withCellWritten(tab.rows, {
          rowIndex: rowIndex,
          columnIndex: columnIndex,
          value: value,
        }),
        editState: renameEditStateRowKey(tab.editState, rename),
        selectedRowKey: renameSelectedRowKey(tab.selectedRowKey, rename),
      })
    },

    // ------ clearEditStateIfUnmodified ------

    clearEditStateIfUnmodified: (tabId, rowKey) => {
      const tab = get().tabs[tabId]
      if (!tab?.editState) return
      if (!isSameRowKey(tab.editState.rowKey, rowKey)) return
      if (tab.editState.isNewRow) return
      if (hasModifiedColumns(tab.editState)) return

      patchTab(tabId, { editState: null, saveError: null })
    },

    // ------ saveCurrentRow ------

    saveCurrentRow: async (tabId): Promise<boolean> => {
      const tab = get().tabs[tabId]
      if (!tab?.editState) return true

      if (!hasModifiedColumns(tab.editState)) {
        patchTab(tabId, { editState: null, saveError: null })
        return true
      }

      if (tab.editState.isNewRow) {
        return insertDraftRow(tabId, tab, tab.editState)
      }
      return updateEditedRow(tabId, tab, tab.editState)
    },

    // ------ discardCurrentRow ------

    discardCurrentRow: (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab?.editState) return

      if (tab.editState.isNewRow) {
        discardDraftRow(tabId, tab, tab.editState)
        return
      }
      restoreEditedRow(tabId, tab, tab.editState)
    },

    // ------ insertNewRow ------

    insertNewRow: (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      const newRow = tab.columns.map((column) => getInitialValueForNewRow(column))
      const seededColumns = new Set<string>()
      for (const column of tab.columns) {
        if (isSeededFromColumnDefault(column)) {
          seededColumns.add(column.name)
        }
      }

      appendDraftRow(tab, patchTab, get().startEditing, tabId, newRow, seededColumns)
    },

    cloneSelectedRow: (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab?.selectedRowKey) return
      if (!tab.primaryKey) return
      if (tab.editState?.isNewRow) return
      if ('__tempId' in tab.selectedRowKey) return

      const rowIndex = findRowIndexByKey(tab.rows, tab.columns, tab.selectedRowKey)
      if (rowIndex === -1) return

      const sourceRow = tab.rows[rowIndex]
      const clonedRow = tab.columns.map((column, index) => {
        if (tab.primaryKey?.keyColumns.includes(column.name)) {
          return null
        }
        return sourceRow[index] ?? null
      })

      const modifiedColumns = new Set(
        tab.columns.filter((column) => !column.isPrimaryKey).map((column) => column.name)
      )

      appendDraftRow(tab, patchTab, get().startEditing, tabId, clonedRow, modifiedColumns)
    },

    // ------ deleteRow ------

    deleteRow: async (tabId, rowKey) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      if (isDraftRowKey(rowKey)) {
        removeDraftRow(tabId, tab, rowKey.__tempId)
        return
      }

      const primaryKeyValues = primaryKeyValuesForDelete(tabId, tab, rowKey)
      if (!primaryKeyValues) return

      try {
        await deleteTableRowCmd(primaryKeyValues)
        if (!get().tabs[tabId]) return
        await removePersistedRowLocally(tabId, tab, rowKey)
      } catch (error) {
        recordTabError(tabId, error)
      }
    },

    // ------ deleteRows (bulk) ------

    deleteRows: async (tabId, rowKeys) => {
      if (rowKeys.length === 0) return 0

      let deletedCount = 0
      const draftKeys = rowKeys.filter(isDraftRowKey)
      const persistedKeys = rowKeys.filter((key) => !isDraftRowKey(key))

      for (const key of draftKeys) {
        const tab = get().tabs[tabId]
        if (!tab) return deletedCount
        removeDraftRow(tabId, tab, key.__tempId)
        deletedCount += 1
      }

      if (!get().tabs[tabId]?.primaryKey) return deletedCount

      for (const rowKey of persistedKeys) {
        const deleted = await deletePersistedRowInBulk(tabId, rowKey)
        if (!deleted) break
        deletedCount += 1
      }

      return deletedCount
    },

    // ------ setViewMode ------

    setViewMode: (tabId, mode) => {
      patchTab(tabId, { viewMode: mode })
    },

    // ------ setSelectedRow ------

    setSelectedRow: (tabId, rowKey) => {
      patchTab(tabId, { selectedRowKey: rowKey })
    },

    // ------ setCheckedRowKeys ------

    setCheckedRowKeys: (tabId, rowKeys) => {
      patchTab(tabId, { checkedRowKeys: rowKeys })
    },

    // ------ setSelectedCell ------

    setSelectedCell: (tabId, cell) => {
      patchTab(tabId, { selectedCell: cell })
    },

    requestColumnJump: (tabId, columnKey) => {
      set((state) => ({
        columnJumpRequests: {
          ...state.columnJumpRequests,
          [tabId]: {
            columnKey: columnKey,
            nonce: (state.columnJumpRequests[tabId]?.nonce ?? 0) + 1,
          },
        },
      }))
    },

    consumeColumnJump: (tabId) => {
      set((state) => {
        const request = state.columnJumpRequests[tabId]
        if (!request) return state
        const columnJumpRequests = { ...state.columnJumpRequests }
        delete columnJumpRequests[tabId]
        return {
          columnJumpRequests: columnJumpRequests,
          highlightedColumnByTab: {
            ...state.highlightedColumnByTab,
            [tabId]: request.columnKey,
          },
        }
      })
    },

    clearColumnHighlight: (tabId) => {
      set((state) => withoutColumnHighlight(state, tabId))
    },

    // ------ setColumnWidth ------

    setColumnWidth: (tabId, column, width) => {
      const tab = get().tabs[tabId]
      if (!tab) return
      if (!Number.isFinite(width)) return
      patchTab(tabId, { columnWidths: { ...(tab.columnWidths ?? {}), [column]: width } })
    },

    // ------ setPageSize ------

    setPageSize: async (tabId, newPageSize) => {
      patchTab(tabId, { pageSize: newPageSize, ...RESET_SCROLL_CELL })
      await get().fetchPage(tabId, 1)
    },

    // ------ export dialog ------

    openExportDialog: (tabId) => {
      patchTab(tabId, { isExportDialogOpen: true })
    },

    closeExportDialog: (tabId) => {
      patchTab(tabId, { isExportDialogOpen: false })
    },

    // ------ setScrollCell ------

    setScrollCell: (tabId, scrollRow, scrollColumn) => {
      patchTab(tabId, { scrollRow: scrollRow, scrollCol: scrollColumn })
    },

    // ------ requestNavigationAction ------

    requestNavigationAction: (tabId, action) => {
      const tab = get().tabs[tabId]
      if (!hasModifiedColumns(tab?.editState)) {
        action()
        return
      }
      patchTab(tabId, { pendingNavigationAction: action })
    },

    // ------ confirmNavigationSave ------

    confirmNavigationSave: async (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      if (tab.editState) {
        const validationError = getTemporalValidationResult(tab.editState, tab.columns)
        if (validationError) {
          showErrorToast(
            'Invalid date value',
            `${validationError.columnName}: ${validationError.error}`
          )
          return
        }
      }

      await get().saveCurrentRow(tabId)

      const afterSave = get().tabs[tabId]
      const isSavedCleanly = afterSave !== undefined && !afterSave.saveError
      if (isSavedCleanly) {
        if (!afterSave.editState) {
          showSuccessToast('Row saved', 'Changes saved successfully.')
        }
        const action = afterSave.pendingNavigationAction
        patchTab(tabId, { pendingNavigationAction: null })
        action?.()
      }
      // If save failed, pendingNavigationAction stays set (dialog remains open)
    },

    // ------ confirmNavigationDiscard ------

    confirmNavigationDiscard: (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      const action = tab.pendingNavigationAction
      get().discardCurrentRow(tabId)
      patchTab(tabId, { pendingNavigationAction: null })
      action?.()
    },

    // ------ cancelNavigation ------

    cancelNavigation: (tabId) => {
      patchTab(tabId, { pendingNavigationAction: null })
    },

    // ------ commitEditingRowIfNeeded ------

    commitEditingRowIfNeeded: async (tabId, newRowKey) => {
      const tab = get().tabs[tabId]
      if (!tab?.editState) return
      if (!hasModifiedColumns(tab.editState)) return

      const isStillOnEditedRow =
        Boolean(newRowKey) && isSameRowKey(tab.editState.rowKey, newRowKey ?? null)
      if (isStillOnEditedRow) return

      // Different row — try to save. If save fails, saveError is set and
      // editState remains on the original row (UI snaps selection back).
      await get().saveCurrentRow(tabId)
    },
  }
})
