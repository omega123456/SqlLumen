import { create } from 'zustand'
import type {
  TableDataColumnMeta,
  TableDataTabState,
  AgGridFilterModel,
  RowEditState,
} from '../types/schema'
import {
  fetchTableData as fetchTableDataCmd,
  updateTableRow as updateTableRowCmd,
  insertTableRow as insertTableRowCmd,
  deleteTableRow as deleteTableRowCmd,
} from '../lib/table-data-commands'
import { getTemporalColumnType, getTodayMysqlString } from '../lib/date-utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  return normalized === 'BOOL' || normalized === 'BOOLEAN'
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
      if (typeof value === 'boolean' && booleanAliasIndexes.has(index)) {
        changed = true
        return value ? 1 : 0
      }

      return value
    })

    return changed ? normalizedRow : row
  })
}

function getRowKeyFromData(
  rowData: Record<string, unknown>,
  pkColumns: string[]
): Record<string, unknown> {
  if ('__tempId' in rowData) {
    return { __tempId: rowData.__tempId }
  }

  const key: Record<string, unknown> = {}
  for (const col of pkColumns) {
    key[col] = rowData[col]
  }
  return key
}

// Exported for testing
export { isSameRowKey, findRowIndexByKey, normalizeTableDataRows }

// ---------------------------------------------------------------------------
// saveCurrentRow helpers (pure functions)
// ---------------------------------------------------------------------------

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
      values[col.name] = editState.currentValues[col.name]
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

/** Build the payload for an UPDATE operation. */
function buildUpdatePayload(
  editState: RowEditState,
  pkColumns: string[]
): {
  originalPkValues: Record<string, unknown>
  updatedValues: Record<string, unknown>
} {
  const updatedValues: Record<string, unknown> = {}
  for (const col of editState.modifiedColumns) {
    updatedValues[col] = editState.currentValues[col]
  }

  const originalPkValues: Record<string, unknown> = {}
  for (const pkCol of pkColumns) {
    originalPkValues[pkCol] = editState.originalValues[pkCol]
  }

  return { originalPkValues, updatedValues }
}

/** Replace the temp row (last row) with the inserted row data. */
function applyInsertedRow(
  rows: unknown[][],
  columns: TableDataColumnMeta[],
  insertedData: [string, unknown][]
): unknown[][] {
  const returnedMap = Object.fromEntries(insertedData)
  const newRow = normalizeTableDataRows(columns, [
    columns.map((col) => returnedMap[col.name] ?? null),
  ])[0]
  const newRows = [...rows]
  newRows[newRows.length - 1] = newRow
  return newRows
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
      updatedRow[colIdx] = value
    }
  }
  newRows[rowIdx] = updatedRow
  return newRows
}

// Exported for testing
export { buildInsertPayload, buildUpdatePayload, applyInsertedRow, applyUpdatedRow }

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
    totalRows: 0,
    currentPage: 1,
    totalPages: 0,
    pageSize: 1000,
    primaryKey: null,
    executionTimeMs: 0,
    connectionId,
    database,
    table,
    editState: null,
    viewMode: 'grid',
    selectedRowKey: null,
    filterModel: {},
    sort: null,
    isLoading: false,
    error: null,
    saveError: null,
    isExportDialogOpen: false,
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
  sortByColumn: (tabId: string, column: string, direction: 'asc' | 'desc' | null) => Promise<void>
  applyFilters: (tabId: string, filterModel: AgGridFilterModel) => Promise<void>
  refreshData: (tabId: string) => Promise<void>

  startEditing: (
    tabId: string,
    rowKey: Record<string, unknown>,
    currentValues: Record<string, unknown>
  ) => void
  updateCellValue: (tabId: string, column: string, value: unknown) => void
  syncCellValue: (
    tabId: string,
    rowData: Record<string, unknown> | undefined,
    column: string,
    value: unknown
  ) => void
  clearEditStateIfUnmodified: (tabId: string, rowKey: Record<string, unknown>) => void
  saveCurrentRow: (tabId: string) => Promise<void>
  discardCurrentRow: (tabId: string) => void
  insertNewRow: (tabId: string) => void
  deleteRow: (
    tabId: string,
    rowKey: Record<string, unknown>,
    rowValues: Record<string, unknown>
  ) => Promise<void>

  setViewMode: (tabId: string, mode: 'grid' | 'form') => void
  setSelectedRow: (tabId: string, rowKey: Record<string, unknown> | null) => void
  setPageSize: (tabId: string, newPageSize: number) => Promise<void>
  openExportDialog: (tabId: string) => void
  closeExportDialog: (tabId: string) => void

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
      })

      await get().fetchPage(tabId, 1)
    },

    // ------ fetchPage ------

    fetchPage: async (tabId, page) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      patchTab(tabId, { isLoading: true, error: null })

      try {
        const result = await fetchTableDataCmd({
          connectionId: tab.connectionId,
          database: tab.database,
          table: tab.table,
          page,
          pageSize: tab.pageSize,
          sortColumn: tab.sort?.column,
          sortDirection: tab.sort?.direction,
          filterModel: Object.keys(tab.filterModel).length > 0 ? tab.filterModel : undefined,
        })

        // Guard: tab may have been cleaned up during the async call
        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          columns: result.columns,
          rows: normalizeTableDataRows(result.columns, result.rows),
          totalRows: result.totalRows,
          currentPage: result.currentPage,
          totalPages: result.totalPages,
          pageSize: result.pageSize,
          primaryKey: result.primaryKey,
          executionTimeMs: result.executionTimeMs,
          isLoading: false,
        })
      } catch (err) {
        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          error: err instanceof Error ? err.message : String(err),
          isLoading: false,
        })
      }
    },

    // ------ sortByColumn ------

    sortByColumn: async (tabId, column, direction) => {
      if (direction === null) {
        patchTab(tabId, { sort: null })
      } else {
        patchTab(tabId, { sort: { column, direction } })
      }
      await get().fetchPage(tabId, 1)
    },

    // ------ applyFilters ------

    applyFilters: async (tabId, filterModel) => {
      patchTab(tabId, { filterModel })
      await get().fetchPage(tabId, 1)
    },

    // ------ refreshData ------

    refreshData: async (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return
      await get().fetchPage(tabId, tab.currentPage)
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

    // ------ syncCellValue ------

    syncCellValue: (tabId, rowData, column, value) => {
      const tab = get().tabs[tabId]
      if (!tab || !rowData) return

      const colIdx = tab.columns.findIndex((c) => c.name === column)
      if (colIdx < 0) return

      const rowKey = getRowKeyFromData(rowData, tab.primaryKey?.keyColumns ?? [])
      const rowIdx = findRowIndexByKey(tab.rows, tab.columns, rowKey)
      if (rowIdx < 0) return

      const nextRows = [...tab.rows]
      const nextRow = [...nextRows[rowIdx]]
      nextRow[colIdx] = value
      nextRows[rowIdx] = nextRow

      patchTab(tabId, { rows: nextRows })
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

    saveCurrentRow: async (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab?.editState) return

      // Nothing modified — just clear editState
      if (tab.editState.modifiedColumns.size === 0) {
        patchTab(tabId, { editState: null, saveError: null })
        return
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

          if (!get().tabs[tabId]) return

          const newRows = applyInsertedRow(tab.rows, columns, returnedData)

          patchTab(tabId, {
            rows: newRows,
            totalRows: tab.totalRows + 1,
            editState: null,
            saveError: null,
          })
        } catch (err) {
          if (!get().tabs[tabId]) return

          patchTab(tabId, {
            saveError: err instanceof Error ? err.message : String(err),
          })
        }
      } else {
        // ── UPDATE path ──
        try {
          if (!primaryKey) throw new Error('No primary key info available')

          const { originalPkValues, updatedValues } = buildUpdatePayload(
            editState,
            primaryKey.keyColumns
          )

          await updateTableRowCmd({
            connectionId: tab.connectionId,
            database: tab.database,
            table: tab.table,
            primaryKeyColumns: primaryKey.keyColumns,
            originalPkValues,
            updatedValues,
          })

          if (!get().tabs[tabId]) return

          const newRows = applyUpdatedRow(tab.rows, columns, editState)
          patchTab(tabId, {
            rows: newRows,
            editState: null,
            saveError: null,
          })
        } catch (err) {
          if (!get().tabs[tabId]) return

          patchTab(tabId, {
            saveError: err instanceof Error ? err.message : String(err),
          })
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
        patchTab(tabId, {
          rows: newRows,
          editState: null,
          saveError: null,
        })
      } else {
        // Restore original values in the row, then clear editState
        const rowIdx = findRowIndexByKey(tab.rows, tab.columns, tab.editState.rowKey)
        if (rowIdx !== -1) {
          const newRows = [...tab.rows]
          const restoredRow = [...newRows[rowIdx]]
          for (const [colName, value] of Object.entries(tab.editState.originalValues)) {
            const colIdx = tab.columns.findIndex((c) => c.name === colName)
            if (colIdx !== -1) {
              restoredRow[colIdx] = value
            }
          }
          newRows[rowIdx] = restoredRow
          patchTab(tabId, {
            rows: newRows,
            editState: null,
            saveError: null,
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

      const tempId = 'new-' + Date.now()

      // Create a new row seeded from column defaults where available.
      const newRow = tab.columns.map((column) => getInitialValueForNewRow(column))
      const newRows = [...tab.rows, newRow]

      // Build currentValues map from the seeded row values.
      const currentValues: Record<string, unknown> = {}
      const seededColumns = new Set<string>()
      for (let index = 0; index < tab.columns.length; index += 1) {
        currentValues[tab.columns[index].name] = newRow[index]
        if (tab.columns[index].columnDefault != null && !tab.columns[index].isAutoIncrement) {
          seededColumns.add(tab.columns[index].name)
        }
      }

      // Update rows first
      patchTab(tabId, { rows: newRows, selectedRowKey: { __tempId: tempId } })

      // Start editing with __tempId as the key
      get().startEditing(tabId, { __tempId: tempId }, currentValues)

      // Mark the editState as a new row
      const updatedTab = get().tabs[tabId]
      if (updatedTab?.editState) {
        patchTab(tabId, {
          editState: {
            ...updatedTab.editState,
            isNewRow: true,
            tempId,
            modifiedColumns: seededColumns,
          },
        })
      }
    },

    // ------ deleteRow ------

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    deleteRow: async (tabId, rowKey, _rowValues) => {
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

      try {
        await deleteTableRowCmd({
          connectionId: tab.connectionId,
          database: tab.database,
          table: tab.table,
          pkColumns: tab.primaryKey.keyColumns,
          pkValues: rowKey,
        })

        if (!get().tabs[tabId]) return

        const rowIdx = findRowIndexByKey(tab.rows, tab.columns, rowKey)
        if (rowIdx !== -1) {
          const newRows = [...tab.rows]
          newRows.splice(rowIdx, 1)
          patchTab(tabId, {
            rows: newRows,
            totalRows: tab.totalRows - 1,
            editState: null,
            saveError: null,
          })
        }
      } catch (err) {
        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },

    // ------ setViewMode ------

    setViewMode: (tabId, mode) => {
      patchTab(tabId, { viewMode: mode })
    },

    // ------ setSelectedRow ------

    setSelectedRow: (tabId, rowKey) => {
      patchTab(tabId, { selectedRowKey: rowKey })
    },

    // ------ setPageSize ------

    setPageSize: async (tabId, newPageSize) => {
      patchTab(tabId, { pageSize: newPageSize })
      await get().fetchPage(tabId, 1)
    },

    // ------ export dialog ------

    openExportDialog: (tabId) => {
      patchTab(tabId, { isExportDialogOpen: true })
    },

    closeExportDialog: (tabId) => {
      patchTab(tabId, { isExportDialogOpen: false })
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

      await get().saveCurrentRow(tabId)

      const afterSave = get().tabs[tabId]
      if (afterSave && !afterSave.saveError) {
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
