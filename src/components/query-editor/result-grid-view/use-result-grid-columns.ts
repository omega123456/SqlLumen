import { useMemo } from 'react'
import { resolveQueryResultColumns } from '../../../lib/query-result-column-utils'
import type { ColumnMeta, ForeignKeyColumnInfo, TableDataColumnMeta } from '../../../types/schema'
import type { AutoSizeConfig, GridColumnDescriptor } from '../../../types/shared-data-view'
import { computeResultColumnWidth, toResultGridColumn } from './result-grid-model'

export interface ResultGridColumnInputs {
  columns: ColumnMeta[]
  editMode: string | null
  editableColumnMap: Map<number, boolean>
  editTableColumns: TableDataColumnMeta[]
  editForeignKeys: ForeignKeyColumnInfo[]
  editColumnBindings: Map<number, string>
}

export function useResultGridColumns(inputs: ResultGridColumnInputs) {
  const {
    columns,
    editMode,
    editableColumnMap,
    editTableColumns,
    editForeignKeys,
    editColumnBindings,
  } = inputs

  const resolvedColumns = useMemo(
    () =>
      resolveQueryResultColumns({
        resultColumns: columns,
        editMode: editMode,
        editableColumnMap: editableColumnMap,
        editTableColumns: editTableColumns,
        editForeignKeys: editForeignKeys,
        editColumnBindings: editColumnBindings,
      }),
    [columns, editMode, editableColumnMap, editTableColumns, editForeignKeys, editColumnBindings]
  )

  const gridColumns: GridColumnDescriptor[] = useMemo(() => {
    const context = { isEditing: editMode !== null, editColumnBindings: editColumnBindings }
    return resolvedColumns.map((column, columnIndex) =>
      toResultGridColumn(column, columnIndex, context)
    )
  }, [editColumnBindings, editMode, resolvedColumns])

  const autoSizeConfig: AutoSizeConfig = useMemo(() => {
    const sizingInputs = {
      resolvedColumns: resolvedColumns,
      editableColumnMap: editableColumnMap,
      editMode: editMode,
      editColumnBindings: editColumnBindings,
    }
    return {
      enabled: true,
      computeWidth: (column, gridRows) => computeResultColumnWidth(sizingInputs, column, gridRows),
    }
  }, [editColumnBindings, editMode, editableColumnMap, resolvedColumns])

  return { gridColumns, autoSizeConfig }
}
