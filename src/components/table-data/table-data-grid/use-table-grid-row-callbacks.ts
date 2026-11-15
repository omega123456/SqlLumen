import { useCallback } from 'react'
import { useTableDataStore, isEditingRowKey, isSameRowKey } from '../../../stores/table-data-store'
import type { CellClickGuardArgs } from '../../../types/shared-data-view'
import { rowClassNameOf } from '../../shared/data-view/row-class-names'
import {
  getRowKey,
  isPointerOrUnknownSource,
  rowIdentityKey,
  type RowKey,
  type TableDataRow,
  type TableEditState,
} from './table-data-grid-model'

interface RowPresentationInputs {
  primaryKeyColumns: string[]
  editState: TableEditState
  selectedRowKey: RowKey | null
}

export function useTableRowPresentation({
  primaryKeyColumns,
  editState,
  selectedRowKey,
}: RowPresentationInputs) {
  const rowKeyGetter = useCallback(
    (row: TableDataRow) => rowIdentityKey(row, primaryKeyColumns),
    [primaryKeyColumns]
  )
  const getRowClass = useCallback(
    (row: TableDataRow) => {
      const rowKey = getRowKey(row, primaryKeyColumns)
      return rowClassNameOf({
        isEditing: isEditingRowKey(editState, rowKey),
        isNewRow: editState?.isNewRow === true,
        isSelected: isSameRowKey(rowKey, selectedRowKey),
      })
    },
    [editState, primaryKeyColumns, selectedRowKey]
  )
  return { rowKeyGetter, getRowClass }
}

export function useClearHighlightOnPointerSelection(tabId: string) {
  const clearColumnHighlight = useTableDataStore((state) => state.clearColumnHighlight)
  return useCallback(
    (args: CellClickGuardArgs) => {
      if (isPointerOrUnknownSource(args.source)) clearColumnHighlight(tabId)
    },
    [clearColumnHighlight, tabId]
  )
}
