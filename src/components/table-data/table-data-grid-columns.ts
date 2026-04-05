import type { GridColumnDescriptor } from '../../types/shared-data-view'
import type { ForeignKeyColumnInfo, TableDataColumnMeta } from '../../types/schema'

export function buildColumnDescriptors(
  columns: TableDataColumnMeta[],
  isReadOnly: boolean,
  hasPk: boolean,
  foreignKeys: ForeignKeyColumnInfo[] = []
): GridColumnDescriptor[] {
  return columns.map((col) => {
    const fk = foreignKeys.find((fk) => fk.columnName === col.name)
    return {
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
      ...(fk && { foreignKey: fk }),
    }
  })
}
