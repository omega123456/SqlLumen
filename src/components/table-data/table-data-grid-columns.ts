import type { GridColumnDescriptor } from '../../types/shared-data-view'
import type { TableDataColumnMeta } from '../../types/schema'

export function buildColumnDescriptors(
  columns: TableDataColumnMeta[],
  isReadOnly: boolean,
  hasPk: boolean
): GridColumnDescriptor[] {
  return columns.map((col) => ({
    key: col.name,
    displayName: col.name,
    dataType: col.dataType,
    editable: !isReadOnly && hasPk && !col.isBinary,
    isBinary: col.isBinary,
    isNullable: col.isNullable,
    isPrimaryKey: col.isPrimaryKey,
    isUniqueKey: col.isUniqueKey,
    enumValues: col.enumValues,
    tableColumnMeta: col,
  }))
}
