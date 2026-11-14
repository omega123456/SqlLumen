import { useCallback, useMemo } from 'react'
import { useTableDataStore, isSameRowKey } from '../../../stores/table-data-store'
import type { EditorCallbacksContextType } from '../../shared/editor-callbacks-context'
import type { CellClickGuardArgs, GridColumnDescriptor } from '../../../types/shared-data-view'
import type { GridCellPosition } from '../../shared/glide/glide-grid-types'
import {
  SELECTED_ROW_CLASS,
  editingRowClasses,
  getRowKey,
  isPointerOrUnknownSource,
  rowIdentityKey,
  type RowKey,
  type TableDataRow,
  type TableEditState,
} from './table-data-grid-model'

interface RowCallbackInputs {
  tabId: string
  primaryKeyColumns: string[]
  editState: TableEditState
  selectedRowKey: RowKey | null
  descriptorColumns: GridColumnDescriptor[]
  rowData: TableDataRow[]
}

function useRowPresentation({
  tabId,
  primaryKeyColumns,
  editState,
  selectedRowKey,
}: RowCallbackInputs) {
  const rowKeyGetter = useCallback(
    (row: TableDataRow) => rowIdentityKey(row, primaryKeyColumns),
    [primaryKeyColumns]
  )
  const getRowClass = useCallback(
    (row: TableDataRow) => {
      const rowKey = getRowKey(row, primaryKeyColumns)
      const classes = editingRowClasses(editState, rowKey)
      if (isSameRowKey(rowKey, selectedRowKey)) classes.push(SELECTED_ROW_CLASS)
      return classes.length > 0 ? classes.join(' ') : undefined
    },
    [editState, primaryKeyColumns, selectedRowKey]
  )
  const isModifiedCell = useCallback(
    (row: TableDataRow, columnKey: string) => {
      const currentEditState = useTableDataStore.getState().tabs[tabId]?.editState
      if (!currentEditState) return false
      const rowKey = getRowKey(row, primaryKeyColumns)
      if (!isSameRowKey(rowKey, currentEditState.rowKey)) return false
      return currentEditState.modifiedColumns.has(columnKey)
    },
    [tabId, primaryKeyColumns]
  )
  return { rowKeyGetter, getRowClass, isModifiedCell }
}

function useSelectionCallbacks({
  tabId,
  primaryKeyColumns,
  descriptorColumns,
  rowData,
}: RowCallbackInputs) {
  const setSelectedRow = useTableDataStore((state) => state.setSelectedRow)
  const setSelectedCell = useTableDataStore((state) => state.setSelectedCell)
  const clearColumnHighlight = useTableDataStore((state) => state.clearColumnHighlight)
  const onCellSelectionChange = (args: CellClickGuardArgs) => {
    if (isPointerOrUnknownSource(args.source)) clearColumnHighlight(tabId)
  }
  const onSelectedCellChange = (position: GridCellPosition) => {
    const column = descriptorColumns[position.idx]
    const row = rowData[position.rowIdx]
    if (!column) return
    if (!row) return
    setSelectedRow(tabId, getRowKey(row, primaryKeyColumns))
    setSelectedCell(tabId, { columnKey: column.key, value: row[column.key] })
  }
  return { onCellSelectionChange, onSelectedCellChange }
}

const SKIP_SYNC_WHILE_TYPING = () => {}

function useEditorCallbacksContext(tabId: string): EditorCallbacksContextType {
  const storeUpdateCellValue = useTableDataStore((state) => state.updateCellValue)
  return useMemo(
    () => ({
      tabId: tabId,
      updateCellValue: storeUpdateCellValue,
      syncCellValue: SKIP_SYNC_WHILE_TYPING,
    }),
    [tabId, storeUpdateCellValue]
  )
}

export function useTableGridRowCallbacks(inputs: RowCallbackInputs) {
  return {
    ...useRowPresentation(inputs),
    ...useSelectionCallbacks(inputs),
    editorCallbacksContext: useEditorCallbacksContext(inputs.tabId),
  }
}
