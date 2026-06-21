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
} from '../lib/table-data-commands'
import { getTableForeignKeys } from '../lib/schema-commands'
import { cancelQuery as cancelQueryCmd } from '../lib/query-commands'
import { getTemporalValidationResult } from '../lib/table-data-save-utils'
import { getTemporalColumnType, getTodayMysqlString } from '../lib/date-utils'
import { showErrorToast, showSuccessToast } from './toast-store'
import { mapSingleColumnForeignKeys } from '../lib/foreign-key-utils'
import { getDefaultRowLimit, useQueryStore } from './query-store'
import { useWorkspaceStore } from './workspace-store'

import { logFrontend } from '../lib/app-log-commands'
import { frontendCacheLifecycle } from '../lib/frontend-cache-lifecycle'
import {
  blobPlaceholder,
  convertBinaryPkValuesToEnvelopes,
  isBlobEnvelope,
} from '../lib/blob-utils'
import type { BlobEnvelope } from '../types/schema'
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESET_SCROLL_CELL = { scrollRow: 0 as const, scrollCol: 0 as const }

/** Compare two row keys for equality using JSON-based comparison. */
function isSameRowKey(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null
): boolean {
  if (a === null || b === null) return a === b
  const aKeys = Object.keys(a).sort()
  const bKeys = Object.keys(b).sort()
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((k, i) => k === bKeys[i] && JSON.stringify(a[k]) === JSON.stringify(b[k]))
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
    for (const [keyCol, keyVal] of Object.entries(rowKey)) {
      const colIdx = columns.findIndex((c) => c.name === keyCol)
      if (colIdx === -1) return false
      if (JSON.stringify(row[colIdx]) !== JSON.stringify(keyVal)) return false
    }
    return true
  })
}

function isTinyIntBooleanAlias(dataType: string): boolean {
  const normalized = dataType.trim().toUpperCase()
  return (
    normalized === 'BOOL' ||
    normalized === 'BOOLEAN' ||
    normalized === 'TINYINT' ||
    normalized === 'TINYINT(1)'
  )
}

function normalizeTinyIntDisplayValue(value: unknown): unknown {
  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }

  if (typeof value === 'string' && value.length === 1) {
    const code = value.charCodeAt(0)
    if (code === 0 || code === 1) {
      return code
    }
  }

  return value
}

function normalizeTableDataRows(columns: TableDataColumnMeta[], rows: unknown[][]): unknown[][] {
  if (columns.length === 0 || rows.length === 0) {
    return rows
  }

  const booleanAliasIndexes = columns.reduce<Set<number>>((indexes, column, index) => {
    if (column.isBooleanAlias || isTinyIntBooleanAlias(column.dataType)) {
      indexes.add(index)
    }
    return indexes
  }, new Set())

  if (booleanAliasIndexes.size === 0) {
    return rows
  }

  return rows.map((row) => {
    let changed = false

    const normalizedRow = row.map((value, index) => {
      if (booleanAliasIndexes.has(index)) {
        const normalizedValue = normalizeTinyIntDisplayValue(value)
        if (normalizedValue !== value) {
          changed = true
        }
        return normalizedValue
      }

      return value
    })

    return changed ? normalizedRow : row
  })
}

function getRowKeyFromData(
  rowData: Record<string, unknown>,
  pkColumns: string[],
  options: { includeRowIndexFallback?: boolean } = {}
): Record<string, unknown> {
  if ('__tempId' in rowData) {
    return { __tempId: rowData.__tempId }
  }

  if (
    '__editingRowKey' in rowData &&
    rowData.__editingRowKey &&
    typeof rowData.__editingRowKey === 'object'
  ) {
    return rowData.__editingRowKey as Record<string, unknown>
  }

  const key: Record<string, unknown> = {}
  for (const col of pkColumns) {
    key[col] = rowData[col]
  }
  if (
    options.includeRowIndexFallback === true &&
    Object.keys(key).length === 0 &&
    rowData.__rowIndex != null
  ) {
    key.__rowIndex = rowData.__rowIndex
  }
  return key
}

// Exported for testing
export { isSameRowKey, findRowIndexByKey, normalizeTableDataRows, getRowKeyFromData }

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
      tempId,
      modifiedColumns,
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
    const errorMessage = error instanceof Error ? error.message : String(error)
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

    if (workspaceState.activeTabByConnection[connectionId] === tabId) {
      return true
    }

    if (targetTab.type !== 'table-data' || !targetTab.parentQueryTabId) {
      return false
    }

    if (workspaceState.activeTabByConnection[connectionId] !== targetTab.parentQueryTabId) {
      return false
    }

    const parentQueryTab = useQueryStore.getState().tabs[targetTab.parentQueryTabId]
    return (
      parentQueryTab?.activeBottomPanelItem.type === 'table-data' &&
      parentQueryTab.activeBottomPanelItem.tabId === tabId
    )
  }

  return false
}

function createResidentRowState(isActive = false): FrontendRowResidencyState {
  return {
    status: 'resident',
    isActive,
    inactiveSince: null,
  }
}

function getTableDataSurfaceKey(tabId: string): string {
  return `table-data:${tabId}`
}

function isDirtyTableDataTab(tab: TableDataTabState): boolean {
  return Boolean(
    tab.editState && (tab.editState.modifiedColumns.size > 0 || tab.editState.isNewRow === true)
  )
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
  if (typeof value === 'string' && dataType.toUpperCase() === 'BIT') {
    const parsed = parseInt(value, 10)
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= Number.MAX_SAFE_INTEGER) {
      return parsed
    }
    // Out-of-range or non-numeric: keep as string (MySQL handles string->BIT for large values)
  }
  return value
}

/** Build the values map for an INSERT operation. */
function buildInsertPayload(
  columns: TableDataColumnMeta[],
  editState: RowEditState
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const col of columns) {
    if (!editState.modifiedColumns.has(col.name)) {
      continue
    }
    if (editState.currentValues[col.name] !== undefined) {
      values[col.name] = coerceValueForColumn(editState.currentValues[col.name], col.dataType)
    }
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
  if (temporalType) {
    if (/^current_timestamp(?:\(\d+\))?$/i.test(column.columnDefault)) {
      return getTodayMysqlString(temporalType)
    }
    if (/^current_date(?:\(\))?$/i.test(column.columnDefault) && temporalType === 'DATE') {
      return getTodayMysqlString('DATE')
    }
    if (/^current_time(?:\(\))?$/i.test(column.columnDefault) && temporalType === 'TIME') {
      return getTodayMysqlString('TIME')
    }
  }

  return normalizeColumnDefaultValue(column.columnDefault)
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
  pkColumns: string[],
  columns: TableDataColumnMeta[]
): BuildUpdatePayloadResult {
  const columnsByName = new Map(columns.map((c) => [c.name, c]))

  const updatedValues: Record<string, unknown> = {}
  for (const col of editState.modifiedColumns) {
    const colMeta = columnsByName.get(col)
    const rawValue = editState.currentValues[col]
    updatedValues[col] = colMeta ? coerceValueForColumn(rawValue, colMeta.dataType) : rawValue
  }

  const originalPkValues: Record<string, unknown> = {}
  for (const pkCol of pkColumns) {
    originalPkValues[pkCol] = editState.originalValues[pkCol]
  }

  const converted = convertBinaryPkValuesToEnvelopes(pkColumns, columns, originalPkValues)
  if (!converted.ok) {
    return { ok: false, error: converted.error }
  }

  return { ok: true, originalPkValues: converted.values, updatedValues }
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
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
    byteLength = Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
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
  const newRow = normalizeTableDataRows(columns, [
    columns.map((col) => reconcileSavedBlobValue(returnedMap[col.name] ?? null)),
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
  const rowIdx = findRowIndexByKey(rows, columns, editState.rowKey)
  if (rowIdx === -1) return rows

  const newRows = [...rows]
  const updatedRow = [...newRows[rowIdx]]
  for (const [colName, value] of Object.entries(editState.currentValues)) {
    const colIdx = columns.findIndex((c) => c.name === colName)
    if (colIdx !== -1) {
      updatedRow[colIdx] = reconcileSavedBlobValue(value)
    }
  }
  newRows[rowIdx] = updatedRow
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
    connectionId,
    database,
    table,
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

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface TableDataStore {
  tabs: Record<string, TableDataTabState>

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
  setColumnWidth: (tabId: string, column: string, width: number) => void
  setPageSize: (tabId: string, newPageSize: number) => Promise<void>
  openExportDialog: (tabId: string) => void
  closeExportDialog: (tabId: string) => void

  setScrollCell: (tabId: string, scrollRow: number, scrollCol: number) => void

  requestNavigationAction: (tabId: string, action: () => void) => void
  confirmNavigationSave: (tabId: string) => Promise<void>
  confirmNavigationDiscard: (tabId: string) => void
  cancelNavigation: (tabId: string) => void

  commitEditingRowIfNeeded: (
    tabId: string,
    newRowKey: Record<string, unknown> | null
  ) => Promise<void>
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

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
    patchTab(tabId, {
      ...partial,
      rowsEvictedAt: null,
      rowResidency: {
        status: 'resident',
        isActive: options?.preserveActiveState ? currentResidency.isActive : false,
        inactiveSince:
          options?.preserveActiveState && !currentResidency.isActive
            ? currentResidency.inactiveSince
            : null,
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
      tabId,
      database: latestTab.database,
      table: latestTab.table,
      columns: latestTab.columns,
      rows,
      currentPage: latestTab.currentPage,
      pageSize: latestTab.pageSize,
      primaryKey: latestTab.primaryKey,
      executionTimeMs: latestTab.executionTimeMs,
    }

    try {
      const syncResult =
        mode === 'insert'
          ? await syncTableDataCacheAfterInsertCmd(syncParams)
          : mode === 'update'
            ? await syncTableDataCacheAfterUpdateCmd(syncParams)
            : await syncTableDataCacheAfterDeleteCmd(syncParams)

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
      const errorMessage = error instanceof Error ? error.message : String(error)
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

  return {
    tabs: {},

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
        delete newTabs[tabId]
        return { tabs: newTabs }
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
        .then((fkInfos) => {
          // Guard: tab may have been cleaned up during the async call
          if (!get().tabs[tabId]) return

          patchTab(tabId, { foreignKeys: mapSingleColumnForeignKeys(fkInfos) })
        })
        .catch((error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : String(error)
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
        const result = await fetchTableDataCmd({
          connectionId: tab.connectionId,
          tabId,
          database: tab.database,
          table: tab.table,
          page,
          pageSize: tab.pageSize,
          sortColumn: tab.sort?.column,
          sortDirection: tab.sort?.direction,
          filterModel: tab.filterModel.length > 0 ? tab.filterModel : undefined,
        })

        // Guard: tab may have been cleaned up during the async call
        if (!get().tabs[tabId]) return

        const latestTab = get().tabs[tabId]
        if (!latestTab) return
        const latestResidency = latestTab.rowResidency ?? createResidentRowState(false)
        const isStillVisible = isTableDataTabVisibleInWorkspace(tabId)

        patchTab(tabId, {
          columns: result.columns,
          rows: normalizeTableDataRows(result.columns, result.rows),
          currentPage: result.currentPage,
          pageSize: result.pageSize,
          primaryKey: result.primaryKey,
          executionTimeMs: result.executionTimeMs,
          rowsEvictedAt: null,
          selectedRowKey: null,
          checkedRowKeys: [],
          isLoading: false,
          isCancelling: false,
          rowResidency: {
            status: 'resident',
            isActive: isStillVisible,
            inactiveSince: isStillVisible ? null : (latestResidency.inactiveSince ?? Date.now()),
          },
        })

        if (!isStillVisible) {
          get().markTableDataSurfaceInactive(tabId)
        }
      } catch (err) {
        if (!get().tabs[tabId]) return

        // When the user cancelled the in-flight query, the backend KILL surfaces
        // as a generic query error — report it as a cancellation instead.
        const wasCancelled = get().tabs[tabId]?.isCancelling ?? false
        patchTab(tabId, {
          error: wasCancelled
            ? 'Query cancelled by user'
            : err instanceof Error
              ? err.message
              : String(err),
          isLoading: false,
          isCancelling: false,
        })
      }
    },

    // ------ cancelLoad ------

    cancelLoad: async (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return
      // Nothing running, or a cancel is already in flight.
      if (!tab.isLoading || tab.isCancelling) return

      patchTab(tabId, { isCancelling: true })

      try {
        const cancelled = await cancelQueryCmd(tab.connectionId, tabId)
        if (!get().tabs[tabId]) return

        if (cancelled) {
          showSuccessToast('Query cancelled')
          // The in-flight fetchPage catch clause resets isCancelling/isLoading.
        } else {
          // No running query was found (it likely already finished).
          patchTab(tabId, { isCancelling: false })
        }
      } catch (err) {
        if (!get().tabs[tabId]) return
        patchTab(tabId, { isCancelling: false })
        showErrorToast('Cancel failed', err instanceof Error ? err.message : String(err))
      }
    },

    // ------ sortByColumn ------

    sortByColumn: async (tabId, column, direction) => {
      if (direction === null) {
        patchTab(tabId, { sort: null, scrollRow: 0 })
      } else {
        patchTab(tabId, { sort: { column, direction }, scrollRow: 0 })
      }
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

      if (tab.rowResidency?.status === 'evicted') {
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

      const residency = tab.rowResidency ?? createResidentRowState(false)
      if (residency.status !== 'resident' || tab.rows.length === 0 || isDirtyTableDataTab(tab)) {
        return
      }

      frontendCacheLifecycle.scheduleInactive(getTableDataSurfaceKey(tabId), () => {
        get().evictInactiveTableDataRows(tabId)
      })
    },

    evictInactiveTableDataRows: (tabId) => {
      cancelTableDataLifecycleTimer(tabId)
      set((state) => {
        const tab = state.tabs[tabId]
        if (!tab) return state

        const residency = tab.rowResidency ?? createResidentRowState(false)
        if (residency.isActive || residency.status !== 'resident' || isDirtyTableDataTab(tab)) {
          return state
        }

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
                ...residency,
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
          tabId,
          database: tab.database,
          table: tab.table,
        })

        if (!get().tabs[tabId]) return

        if (restored.status !== 'available' || !restored.data) {
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
            columns: restored.data.columns,
            rows: normalizeTableDataRows(restored.data.columns, restored.data.rows),
            currentPage: restored.data.currentPage,
            pageSize: restored.data.pageSize,
            primaryKey: restored.data.primaryKey,
            executionTimeMs: restored.data.executionTimeMs,
            isLoading: false,
            error: null,
            saveError: null,
          },
          { preserveActiveState: true }
        )
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
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
        rowKey,
        originalValues: JSON.parse(JSON.stringify(currentValues)),
        currentValues: { ...currentValues },
        modifiedColumns: new Set<string>(),
        isNewRow: false,
      }
      patchTab(tabId, { editState, saveError: null })
    },

    // ------ updateCellValue ------

    updateCellValue: (tabId, column, value) => {
      const tab = get().tabs[tabId]
      if (!tab?.editState) return

      const newModified = new Set(tab.editState.modifiedColumns)
      if (JSON.stringify(tab.editState.originalValues[column]) === JSON.stringify(value)) {
        newModified.delete(column)
      } else {
        newModified.add(column)
      }

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

      const colIdx = tab.columns.findIndex((c) => c.name === column)
      if (colIdx < 0) return

      const pkColumns = tab.primaryKey?.keyColumns ?? []
      const rowKey = getRowKeyFromData(rowData, pkColumns)

      // Ensure row editing has started for this row, seeding the baseline values
      // from the current row data so unrelated columns are not marked dirty.
      const currentEditState = get().tabs[tabId]?.editState ?? null
      if (!currentEditState || !isSameRowKey(currentEditState.rowKey, rowKey)) {
        const baseline: Record<string, unknown> = {}
        for (const col of tab.columns) {
          baseline[col.name] = rowData[col.name]
        }
        get().startEditing(tabId, rowKey, baseline)
      }

      // Record the envelope as the cell's pending value (marks the row dirty).
      get().updateCellValue(tabId, column, envelope)

      // Reflect the envelope in the in-memory row so the grid renders the
      // `[BLOB - N bytes*]` placeholder for the staged cell.
      const latestTab = get().tabs[tabId]
      if (!latestTab) return
      let rowIdx = findRowIndexByKey(latestTab.rows, latestTab.columns, rowKey)
      // Draft rows are keyed by `__tempId` (no PK match) — locate them via the
      // positional `__rowIndex` the grid carries, falling back to the last row.
      if (rowIdx < 0 && '__tempId' in rowKey) {
        const rowIndexHint = rowData.__rowIndex
        rowIdx =
          typeof rowIndexHint === 'number' &&
          rowIndexHint >= 0 &&
          rowIndexHint < latestTab.rows.length
            ? rowIndexHint
            : latestTab.rows.length - 1
      }
      if (rowIdx < 0) return

      const nextRows = [...latestTab.rows]
      const nextRow = [...nextRows[rowIdx]]
      nextRow[colIdx] = envelope
      nextRows[rowIdx] = nextRow
      patchTab(tabId, { rows: nextRows })
    },

    // ------ syncCellValue ------

    syncCellValue: (tabId, rowData, column, value, rowKeyOverride) => {
      const tab = get().tabs[tabId]
      if (!tab || !rowData) return

      const colIdx = tab.columns.findIndex((c) => c.name === column)
      if (colIdx < 0) return

      const rowKey = rowKeyOverride ?? getRowKeyFromData(rowData, tab.primaryKey?.keyColumns ?? [])
      const rowIdx = findRowIndexByKey(tab.rows, tab.columns, rowKey)
      if (rowIdx < 0) return

      const nextRows = [...tab.rows]
      const nextRow = [...nextRows[rowIdx]]
      nextRow[colIdx] = value
      nextRows[rowIdx] = nextRow

      const isPrimaryKeyColumn = tab.primaryKey?.keyColumns.includes(column) ?? false
      const nextRowKey =
        isPrimaryKeyColumn && !('__tempId' in rowKey) ? { ...rowKey, [column]: value } : rowKey

      const nextEditState =
        tab.editState && isSameRowKey(tab.editState.rowKey, rowKey)
          ? { ...tab.editState, rowKey: nextRowKey }
          : tab.editState

      const nextSelectedRowKey =
        tab.selectedRowKey && isSameRowKey(tab.selectedRowKey, rowKey)
          ? nextRowKey
          : tab.selectedRowKey

      patchTab(tabId, {
        rows: nextRows,
        editState: nextEditState,
        selectedRowKey: nextSelectedRowKey,
      })
    },

    // ------ clearEditStateIfUnmodified ------

    clearEditStateIfUnmodified: (tabId, rowKey) => {
      const tab = get().tabs[tabId]
      if (!tab?.editState) return
      if (!isSameRowKey(tab.editState.rowKey, rowKey)) return
      if (tab.editState.isNewRow) return
      if (tab.editState.modifiedColumns.size > 0) return

      patchTab(tabId, { editState: null, saveError: null })
    },

    // ------ saveCurrentRow ------

    saveCurrentRow: async (tabId): Promise<boolean> => {
      const tab = get().tabs[tabId]
      if (!tab?.editState) return true

      // Nothing modified — just clear editState
      if (tab.editState.modifiedColumns.size === 0) {
        patchTab(tabId, { editState: null, saveError: null })
        return true
      }

      const { editState, columns, primaryKey } = tab

      if (editState.isNewRow) {
        // ── INSERT path ──
        try {
          if (!primaryKey) throw new Error('No primary key info available')

          const values = buildInsertPayload(columns, editState)

          const returnedData = await insertTableRowCmd({
            connectionId: tab.connectionId,
            database: tab.database,
            table: tab.table,
            values,
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
        } catch (err) {
          if (!get().tabs[tabId]) return false

          patchTab(tabId, {
            saveError: err instanceof Error ? err.message : String(err),
          })
          return false
        }
      } else {
        // ── UPDATE path ──
        try {
          if (!primaryKey) throw new Error('No primary key info available')

          const payload = buildUpdatePayload(editState, primaryKey.keyColumns, columns)
          if (!payload.ok) {
            showErrorToast('Could not save row', payload.error)
            patchTab(tabId, { saveError: payload.error })
            return false
          }
          const { originalPkValues, updatedValues } = payload

          await updateTableRowCmd({
            connectionId: tab.connectionId,
            database: tab.database,
            table: tab.table,
            primaryKeyColumns: primaryKey.keyColumns,
            originalPkValues,
            updatedValues,
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
        } catch (err) {
          if (!get().tabs[tabId]) return false

          patchTab(tabId, {
            saveError: err instanceof Error ? err.message : String(err),
          })
          return false
        }
      }
    },

    // ------ discardCurrentRow ------

    discardCurrentRow: (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab?.editState) return

      if (tab.editState.isNewRow) {
        // Remove the temp row (always appended at the end)
        const newRows = [...tab.rows]
        newRows.pop()
        const selectedWasDraft =
          tab.selectedRowKey !== null &&
          '__tempId' in tab.selectedRowKey &&
          tab.editState.tempId === tab.selectedRowKey.__tempId
        patchTab(tabId, {
          rows: newRows,
          editState: null,
          saveError: null,
          selectedRowKey: selectedWasDraft ? null : tab.selectedRowKey,
        })
      } else {
        // Restore original values in the row, then clear editState
        const editState = tab.editState
        const rowIdx = findRowIndexByKey(tab.rows, tab.columns, editState.rowKey)
        if (rowIdx !== -1) {
          const newRows = [...tab.rows]
          const restoredRow = [...newRows[rowIdx]]
          for (const [colName, value] of Object.entries(editState.originalValues)) {
            const colIdx = tab.columns.findIndex((c) => c.name === colName)
            if (colIdx !== -1) {
              restoredRow[colIdx] = value
            }
          }
          newRows[rowIdx] = restoredRow

          const restoredSelectedRowKey =
            tab.selectedRowKey && isSameRowKey(tab.selectedRowKey, editState.rowKey)
              ? Object.fromEntries(
                  Object.keys(editState.rowKey).map((key) => [key, editState.originalValues[key]])
                )
              : tab.selectedRowKey

          patchTab(tabId, {
            rows: newRows,
            editState: null,
            saveError: null,
            selectedRowKey: restoredSelectedRowKey,
          })
        } else {
          patchTab(tabId, { editState: null, saveError: null })
        }
      }
    },

    // ------ insertNewRow ------

    insertNewRow: (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      const newRow = tab.columns.map((column) => getInitialValueForNewRow(column))
      const seededColumns = new Set<string>()
      for (let index = 0; index < tab.columns.length; index += 1) {
        if (tab.columns[index].columnDefault != null && !tab.columns[index].isAutoIncrement) {
          seededColumns.add(tab.columns[index].name)
        }
      }

      appendDraftRow(tab, patchTab, get().startEditing, tabId, newRow, seededColumns)
    },

    cloneSelectedRow: (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab?.selectedRowKey || !tab.primaryKey || tab.editState?.isNewRow) return
      if ('__tempId' in tab.selectedRowKey) return

      const rowIdx = findRowIndexByKey(tab.rows, tab.columns, tab.selectedRowKey)
      if (rowIdx === -1) return

      const sourceRow = tab.rows[rowIdx]
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

      // Unsaved new row — just remove from rows without IPC
      if ('__tempId' in rowKey) {
        const newRows = [...tab.rows]
        newRows.pop() // temp rows are always at the end
        patchTab(tabId, {
          rows: newRows,
          editState: tab.editState?.tempId === rowKey.__tempId ? null : tab.editState,
          saveError: null,
        })
        return
      }

      // Existing row — call IPC
      if (!tab.primaryKey) return

      // Send a transformed copy so binary PK values bind as bytes; keep the
      // original hex `rowKey` for the post-delete findRowIndexByKey lookup (C5).
      const converted = convertBinaryPkValuesToEnvelopes(
        tab.primaryKey.keyColumns,
        tab.columns,
        rowKey
      )
      if (!converted.ok) {
        showErrorToast('Could not delete row', converted.error)
        patchTab(tabId, { error: converted.error })
        return
      }

      try {
        await deleteTableRowCmd({
          connectionId: tab.connectionId,
          database: tab.database,
          table: tab.table,
          pkColumns: tab.primaryKey.keyColumns,
          pkValues: converted.values,
        })

        if (!get().tabs[tabId]) return

        const rowIdx = findRowIndexByKey(tab.rows, tab.columns, rowKey)
        if (rowIdx !== -1) {
          const newRows = [...tab.rows]
          newRows.splice(rowIdx, 1)
          await syncPatchedTableDataCache('delete', tabId, newRows)
          markTableDataResident(
            tabId,
            {
              rows: newRows,
              editState: null,
              saveError: null,
            },
            { preserveActiveState: true }
          )
        }
      } catch (err) {
        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },

    // ------ deleteRows (bulk) ------

    deleteRows: async (tabId, rowKeys) => {
      if (rowKeys.length === 0) return 0

      let deletedCount = 0

      // Separate unsaved draft rows (handled locally) from persisted rows.
      const draftKeys = rowKeys.filter((key) => '__tempId' in key)
      const persistedKeys = rowKeys.filter((key) => !('__tempId' in key))

      // Drop unsaved draft rows locally (temp rows always live at the end).
      for (const key of draftKeys) {
        const tab = get().tabs[tabId]
        if (!tab) return deletedCount
        const newRows = [...tab.rows]
        newRows.pop()
        patchTab(tabId, {
          rows: newRows,
          editState: tab.editState?.tempId === key.__tempId ? null : tab.editState,
          saveError: null,
        })
        deletedCount += 1
      }

      const tabAfterDrafts = get().tabs[tabId]
      if (!tabAfterDrafts || !tabAfterDrafts.primaryKey) return deletedCount

      for (const rowKey of persistedKeys) {
        const tab = get().tabs[tabId]
        if (!tab || !tab.primaryKey) break

        // Send a transformed copy; keep the original hex `rowKey` for the
        // post-delete findRowIndexByKey lookup (C5).
        const converted = convertBinaryPkValuesToEnvelopes(
          tab.primaryKey.keyColumns,
          tab.columns,
          rowKey
        )
        if (!converted.ok) {
          showErrorToast('Could not delete row', converted.error)
          patchTab(tabId, { error: converted.error })
          break
        }

        try {
          await deleteTableRowCmd({
            connectionId: tab.connectionId,
            database: tab.database,
            table: tab.table,
            pkColumns: tab.primaryKey.keyColumns,
            pkValues: converted.values,
          })

          const latest = get().tabs[tabId]
          if (!latest) return deletedCount

          const rowIdx = findRowIndexByKey(latest.rows, latest.columns, rowKey)
          if (rowIdx !== -1) {
            const newRows = [...latest.rows]
            newRows.splice(rowIdx, 1)
            await syncPatchedTableDataCache('delete', tabId, newRows)
            markTableDataResident(
              tabId,
              { rows: newRows, editState: null, saveError: null },
              { preserveActiveState: true }
            )
          }
          deletedCount += 1
        } catch (err) {
          if (!get().tabs[tabId]) return deletedCount
          patchTab(tabId, {
            error: err instanceof Error ? err.message : String(err),
          })
          break
        }
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

    // ------ setColumnWidth ------

    setColumnWidth: (tabId, column, width) => {
      const tab = get().tabs[tabId]
      if (!tab || !Number.isFinite(width)) return
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

    setScrollCell: (tabId, scrollRow, scrollCol) => {
      patchTab(tabId, { scrollRow, scrollCol })
    },

    // ------ requestNavigationAction ------

    requestNavigationAction: (tabId, action) => {
      const tab = get().tabs[tabId]
      if (!tab?.editState || tab.editState.modifiedColumns.size === 0) {
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
      if (afterSave && !afterSave.saveError) {
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
      if (!tab?.editState || tab.editState.modifiedColumns.size === 0) return

      // Still on the same row — nothing to commit
      if (newRowKey && isSameRowKey(tab.editState.rowKey, newRowKey)) return

      // Different row — try to save. If save fails, saveError is set and
      // editState remains on the original row (UI snaps selection back).
      await get().saveCurrentRow(tabId)
    },
  }
})
