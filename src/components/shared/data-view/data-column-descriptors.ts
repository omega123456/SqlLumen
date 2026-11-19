import { useMemo } from 'react'
import {
  resolveQueryResultColumns,
  type ResolvedQueryResultColumn,
} from '../../../lib/query-result-column-utils'
import type { ColumnMeta, TableDataColumnMeta } from '../../../types/schema'
import type { GridColumnDescriptor } from '../../../types/shared-data-view'
import type { DataViewEditTarget } from '../../../stores/data-view/data-view-types'
import { buildGridColumnDescriptor } from './grid-column-descriptor'

const NO_TABLE_COLUMNS: TableDataColumnMeta[] = []

export interface DataColumnContext {
  isEditing: boolean
  editColumnBindings: Map<number, string>
  columnWidths?: Record<string, number>
}

export function toDataColumnDescriptor(
  column: ResolvedQueryResultColumn,
  columnIndex: number,
  context: DataColumnContext
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

export function editTableColumnsOf(editTarget: DataViewEditTarget): TableDataColumnMeta[] {
  const tableName = editTarget.tableName
  if (!tableName) return NO_TABLE_COLUMNS
  return editTarget.tables[tableName]?.columns ?? NO_TABLE_COLUMNS
}

export interface DataColumnDescriptorInputs {
  columns: ColumnMeta[]
  editTarget: DataViewEditTarget
  columnWidths?: Record<string, number>
}

export function useDataColumnDescriptors({
  columns,
  editTarget,
  columnWidths,
}: DataColumnDescriptorInputs) {
  const resolvedColumns = useMemo(
    () =>
      resolveQueryResultColumns({
        resultColumns: columns,
        editMode: editTarget.tableName,
        editableColumnMap: editTarget.editableColumns,
        editTableColumns: editTableColumnsOf(editTarget),
        editForeignKeys: editTarget.foreignKeys,
        editColumnBindings: editTarget.bindings,
      }),
    [columns, editTarget]
  )

  const descriptors: GridColumnDescriptor[] = useMemo(() => {
    const context = {
      isEditing: editTarget.tableName !== null,
      editColumnBindings: editTarget.bindings,
      columnWidths: columnWidths,
    }
    return resolvedColumns.map((column, columnIndex) =>
      toDataColumnDescriptor(column, columnIndex, context)
    )
  }, [columnWidths, editTarget, resolvedColumns])

  return { resolvedColumns, descriptors }
}
