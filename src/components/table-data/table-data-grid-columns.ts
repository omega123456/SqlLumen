import type { GridColumnDescriptor } from '../../types/shared-data-view'
import type { ForeignKeyColumnInfo, TableDataColumnMeta } from '../../types/schema'
import { getTemporalColumnType } from '../../lib/date-utils'
import { isEnumColumn } from './enum-field-utils'

export function buildColumnDescriptors(
  columns: TableDataColumnMeta[],
  isReadOnly: boolean,
  hasPk: boolean,
  foreignKeys: ForeignKeyColumnInfo[] = []
): GridColumnDescriptor[] {
  return columns.map((col) => {
    const fk = foreignKeys.find((fk) => fk.columnName === col.name)
    const editorType = col.isBinary
      ? 'none'
      : getTemporalColumnType(col.dataType)
        ? 'datetime'
        : isEnumColumn(col)
          ? 'enum'
          : fk
            ? 'fk'
            : 'text'
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
      editorType,
      ...(fk && { foreignKey: fk }),
    }
  })
}
