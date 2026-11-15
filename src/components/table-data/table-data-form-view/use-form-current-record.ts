import { useMemo } from 'react'
import { isEditingRowKey } from '../../../stores/table-data-store'
import type { RowEditState as SharedRowEditState } from '../../../types/shared-data-view'
import {
  buildCurrentRowData,
  findSelectedLocalIndex,
  getRowKeyFromArray,
  type FormTabView,
} from './form-view-model'
import { buildColumnDescriptors } from '../table-data-grid-columns'

function useFormGridColumns(view: FormTabView, isEditable: boolean) {
  const { columns, foreignKeys, primaryKey } = view
  const hasPrimaryKey = primaryKey !== null
  return useMemo(
    () =>
      buildColumnDescriptors({
        columns: columns,
        isReadOnly: !isEditable,
        hasPrimaryKey: hasPrimaryKey,
        foreignKeys: foreignKeys,
      }),
    [columns, foreignKeys, hasPrimaryKey, isEditable]
  )
}

function useCurrentRowKey(view: FormTabView, currentRow: unknown[] | null) {
  const { editState, columns, primaryKeyColumns } = view
  return useMemo(() => {
    if (editState?.isNewRow) return editState.rowKey
    if (!currentRow) return null
    if (primaryKeyColumns.length === 0) return null
    return getRowKeyFromArray(currentRow, columns, primaryKeyColumns)
  }, [editState, currentRow, columns, primaryKeyColumns])
}

export function useFormCurrentRecord(view: FormTabView, isEditable: boolean) {
  const { selectedRowKey, rows, columns, primaryKeyColumns, editState } = view
  const localIndex = useMemo(
    () =>
      findSelectedLocalIndex({
        selectedRowKey: selectedRowKey,
        rows: rows,
        columns: columns,
        primaryKeyColumns: primaryKeyColumns,
      }),
    [selectedRowKey, rows, columns, primaryKeyColumns]
  )
  const currentRow = rows.length > 0 ? rows[localIndex] : null
  const currentRowKey = useCurrentRowKey(view, currentRow)
  const isEditingCurrentRow = currentRowKey ? isEditingRowKey(editState, currentRowKey) : false
  const currentRowData = useMemo(() => {
    if (!currentRow) return null
    const activeEditState = isEditingCurrentRow ? editState : null
    return buildCurrentRowData(currentRow, columns, activeEditState)
  }, [currentRow, columns, editState, isEditingCurrentRow])
  const sharedEditState: SharedRowEditState | null = useMemo(() => {
    if (!editState) return null
    if (!isEditingCurrentRow) return null
    return {
      rowKey: JSON.stringify(editState.rowKey),
      currentValues: editState.currentValues,
      originalValues: editState.originalValues,
    }
  }, [editState, isEditingCurrentRow])
  return {
    localIndex: localIndex,
    currentRow: currentRow,
    currentRowKey: currentRowKey,
    currentRowData: currentRowData,
    sharedEditState: sharedEditState,
    gridColumns: useFormGridColumns(view, isEditable),
  }
}

export type FormCurrentRecord = ReturnType<typeof useFormCurrentRecord>
