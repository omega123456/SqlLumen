import type { GridColumnDescriptor } from '../../types/shared-data-view'
import type { ForeignKeyColumnInfo, TableDataColumnMeta } from '../../types/schema'
import { buildForeignKeyLookup } from '../../lib/foreign-key-utils'
import { isInlineEditableColumn } from '../../lib/column-capabilities'
import { buildGridColumnDescriptor } from '../shared/data-view/grid-column-descriptor'

export interface ColumnDescriptorInputs {
  columns: TableDataColumnMeta[]
  isReadOnly: boolean
  hasPrimaryKey: boolean
  foreignKeys?: ForeignKeyColumnInfo[]
  columnWidths?: Record<string, number>
}

export function buildColumnDescriptors({
  columns,
  isReadOnly,
  hasPrimaryKey,
  foreignKeys = [],
  columnWidths = {},
}: ColumnDescriptorInputs): GridColumnDescriptor[] {
  const canEditRows = !isReadOnly && hasPrimaryKey
  const foreignKeyLookup = buildForeignKeyLookup(foreignKeys)
  return columns.map((column) =>
    buildGridColumnDescriptor({
      key: column.name,
      displayName: column.name,
      dataType: column.dataType,
      tableColumn: column,
      foreignKey: foreignKeyLookup.get(column.name.toLowerCase()),
      editable: canEditRows && isInlineEditableColumn(column),
      blobViewerEditable: canEditRows,
      width: columnWidths[column.name],
    })
  )
}
