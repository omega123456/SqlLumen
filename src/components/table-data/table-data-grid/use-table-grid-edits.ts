import { useCallback } from 'react'
import { useTableDataStore, isSameRowKey } from '../../../stores/table-data-store'
import type { CellClipboardEditArgs } from '../../../types/shared-data-view'
import { getRowKey, type RowKey, type TableDataRow } from './table-data-grid-model'
import { resolveTargetColumn, type TableGridGuardInputs } from './use-table-grid-guards'

function editingRowKeyOf(row: TableDataRow, primaryKeyColumns: string[]): RowKey {
  return (row.__editingRowKey as RowKey | undefined) ?? getRowKey(row, primaryKeyColumns)
}

function useRowsChange({ tabId, primaryKeyColumns }: TableGridGuardInputs) {
  const clearEditStateIfUnmodified = useTableDataStore((state) => state.clearEditStateIfUnmodified)

  const syncCommittedEditorValue = useCallback(
    (row: TableDataRow, changedColumnKey: string) => {
      const currentEditState = useTableDataStore.getState().tabs[tabId]?.editState
      if (!currentEditState) return
      const rowKey = editingRowKeyOf(row, primaryKeyColumns)
      if (!isSameRowKey(rowKey, currentEditState.rowKey)) return
      useTableDataStore.getState().syncCellValue(tabId, {
        rowData: { ...row, __editingRowKey: rowKey },
        column: changedColumnKey,
        value: row[changedColumnKey],
        rowKeyOverride: rowKey,
      })
    },
    [primaryKeyColumns, tabId]
  )

  return useCallback(
    (newRows: TableDataRow[], data: { indexes: number[]; column?: { key: string } }) => {
      const changedColumnKey = data.column?.key
      const changedRows = data.indexes.map((index) => newRows[index]).filter(Boolean)
      if (changedColumnKey) {
        changedRows.forEach((row) => syncCommittedEditorValue(row, changedColumnKey))
      }
      changedRows.forEach((row) =>
        clearEditStateIfUnmodified(tabId, getRowKey(row, primaryKeyColumns))
      )
    },
    [primaryKeyColumns, tabId, clearEditStateIfUnmodified, syncCommittedEditorValue]
  )
}

function clipboardValue(args: CellClipboardEditArgs): string | null {
  if (args.action === 'cut') return null
  return args.text ?? null
}

function useCellClipboardEdit(inputs: TableGridGuardInputs) {
  const { tabId, primaryKeyColumns, descriptorColumns, commit } = inputs
  const { validateAndCommitCurrentEdit, ensureRowEditingStarted } = commit
  const setSelectedRow = useTableDataStore((state) => state.setSelectedRow)
  const storeUpdateCellValue = useTableDataStore((state) => state.updateCellValue)
  return useCallback(
    async (args: CellClipboardEditArgs): Promise<boolean> => {
      const target = resolveTargetColumn(descriptorColumns, args.columnKey)
      if (!target?.editable) return false
      const targetRowKey = getRowKey(args.rowData, primaryKeyColumns)
      const guardResult = await validateAndCommitCurrentEdit({
        targetRowKey: targetRowKey,
        fallbackRowIndex: args.rowIdx,
        targetColumnIndex: target.targetColIdx,
        enableEditorOnRestore: true,
      })
      if (!guardResult.passed) return false
      setSelectedRow(tabId, targetRowKey)
      ensureRowEditingStarted(targetRowKey, args.rowData)
      const nextValue = clipboardValue(args)
      storeUpdateCellValue(tabId, args.columnKey, nextValue)
      useTableDataStore.getState().syncCellValue(tabId, {
        rowData: args.rowData,
        column: args.columnKey,
        value: nextValue,
        rowKeyOverride: targetRowKey,
      })
      return true
    },
    [
      descriptorColumns,
      primaryKeyColumns,
      validateAndCommitCurrentEdit,
      setSelectedRow,
      tabId,
      ensureRowEditingStarted,
      storeUpdateCellValue,
    ]
  )
}

function useCellValueChange({ tabId, rowDataRef }: TableGridGuardInputs) {
  const storeUpdateCellValue = useTableDataStore((state) => state.updateCellValue)
  return useCallback(
    (rowIndex: number, columnKey: string, nextValue: unknown) => {
      const row = rowDataRef.current[rowIndex]
      if (!row) return
      storeUpdateCellValue(tabId, columnKey, nextValue)
    },
    [storeUpdateCellValue, tabId, rowDataRef]
  )
}

export function useTableGridEdits(inputs: TableGridGuardInputs) {
  return {
    onRowsChange: useRowsChange(inputs),
    onCellClipboardEdit: useCellClipboardEdit(inputs),
    onCellValueChange: useCellValueChange(inputs),
  }
}
