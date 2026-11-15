import type { RowEditState } from '../../types/schema'
import { resolveStagedRowIndex, withCellWritten, withColumnModified } from './row-edit-transitions'
import type { DraftRowSeed, TableCellValueSync } from './row-edit-transitions'
import {
  findRowIndexByKey,
  getRowKeyFromData,
  renameEditStateRowKey,
  renameSelectedRowKey,
  rowKeyAfterCellChange,
} from './row-keys'
import type { RowKeyRename } from './row-keys'
import { buildCurrentValuesFromRow } from './row-payloads'
import { getInitialValueForNewRow, isSeededFromColumnDefault } from '../../lib/new-row-values'
import { patchTab } from './table-data-access'
import { useTableDataStore } from '../table-data-store'

function appendDraftRow(tabId: string, { tab, rowValues, modifiedColumns }: DraftRowSeed) {
  const tempId = 'new-' + Date.now()
  const newRows = [...tab.rows, rowValues]

  patchTab(tabId, { rows: newRows, selectedRowKey: { __tempId: tempId } })

  useTableDataStore
    .getState()
    .startEditing(tabId, { __tempId: tempId }, buildCurrentValuesFromRow(tab.columns, rowValues))

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

export function startEditing(
  tabId: string,
  rowKey: Record<string, unknown>,
  currentValues: Record<string, unknown>
): void {
  const editState: RowEditState = {
    rowKey: rowKey,
    originalValues: JSON.parse(JSON.stringify(currentValues)),
    currentValues: { ...currentValues },
    modifiedColumns: new Set<string>(),
    isNewRow: false,
  }
  patchTab(tabId, { editState: editState, saveError: null })
}

export function updateCellValue(tabId: string, column: string, value: unknown): void {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab?.editState) return

  const isModified = JSON.stringify(tab.editState.originalValues[column]) !== JSON.stringify(value)
  const newModified = withColumnModified(tab.editState.modifiedColumns, column, isModified)

  patchTab(tabId, {
    editState: {
      ...tab.editState,
      currentValues: { ...tab.editState.currentValues, [column]: value },
      modifiedColumns: newModified,
    },
    saveError: null,
  })
}

export function syncCellValue(
  tabId: string,
  { rowData, column, value, rowKeyOverride }: TableCellValueSync
): void {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab) return
  if (!rowData) return

  const columnIndex = tab.columns.findIndex((candidate) => candidate.name === column)
  if (columnIndex < 0) return

  const primaryKeyColumns = tab.primaryKey?.keyColumns ?? []
  const rowKey = rowKeyOverride ?? getRowKeyFromData(rowData, primaryKeyColumns)
  const rowIndex = resolveStagedRowIndex(tab, rowKey, rowData)
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
}

export function insertNewRow(tabId: string): void {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab) return

  const newRow = tab.columns.map((column) => getInitialValueForNewRow(column))
  const seededColumns = new Set<string>()
  for (const column of tab.columns) {
    if (isSeededFromColumnDefault(column)) {
      seededColumns.add(column.name)
    }
  }

  appendDraftRow(tabId, { tab: tab, rowValues: newRow, modifiedColumns: seededColumns })
}

export function cloneSelectedRow(tabId: string): void {
  const tab = useTableDataStore.getState().tabs[tabId]
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

  appendDraftRow(tabId, { tab: tab, rowValues: clonedRow, modifiedColumns: modifiedColumns })
}

export function cellEditActions() {
  return {
    startEditing,
    updateCellValue,
    syncCellValue,
    insertNewRow,
    cloneSelectedRow,
  }
}
