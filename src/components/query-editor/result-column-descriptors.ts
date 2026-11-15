import { useMemo } from 'react'
import {
  resolveQueryResultColumns,
  type ResolvedQueryResultColumn,
} from '../../lib/query-result-column-utils'
import type { ColumnMeta, ForeignKeyColumnInfo, TableDataColumnMeta } from '../../types/schema'
import type { GridColumnDescriptor } from '../../types/shared-data-view'
import { buildGridColumnDescriptor } from '../shared/data-view/grid-column-descriptor'

export interface ResultColumnContext {
  isEditing: boolean
  editColumnBindings: Map<number, string>
  columnWidths?: Record<string, number>
}

export function toResultColumnDescriptor(
  column: ResolvedQueryResultColumn,
  columnIndex: number,
  context: ResultColumnContext
): GridColumnDescriptor {
  const isBoundForEdit = context.isEditing && context.editColumnBindings.has(columnIndex)
  return buildGridColumnDescriptor({
    key: column.key,
    displayName: column.displayName,
    dataType: column.dataType,
    tableColumn: column.tableColumnMeta,
    foreignKey: column.foreignKey,
    editable: column.editable,
    blobViewerEditable: isBoundForEdit,
    width: context.columnWidths?.[column.key],
  })
}

export interface ResultColumnDescriptorInputs {
  columns: ColumnMeta[]
  editMode: string | null
  editableColumnMap: Map<number, boolean>
  editTableColumns: TableDataColumnMeta[]
  editForeignKeys: ForeignKeyColumnInfo[]
  editColumnBindings: Map<number, string>
  columnWidths?: Record<string, number>
}

export function useResultColumnDescriptors(inputs: ResultColumnDescriptorInputs) {
  const {
    columns,
    editMode,
    editableColumnMap,
    editTableColumns,
    editForeignKeys,
    editColumnBindings,
    columnWidths,
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

  const descriptors: GridColumnDescriptor[] = useMemo(() => {
    const context = {
      isEditing: editMode !== null,
      editColumnBindings: editColumnBindings,
      columnWidths: columnWidths,
    }
    return resolvedColumns.map((column, columnIndex) =>
      toResultColumnDescriptor(column, columnIndex, context)
    )
  }, [columnWidths, editColumnBindings, editMode, resolvedColumns])

  return { resolvedColumns, descriptors }
}
