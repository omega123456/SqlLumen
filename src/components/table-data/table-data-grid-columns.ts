import type { GridColumnDescriptor } from '../../types/shared-data-view'
import type { ForeignKeyColumnInfo, TableDataColumnMeta } from '../../types/schema'
import { getTemporalColumnType } from '../../lib/date-utils'
import { isJsonSqlType } from '../../lib/grid-column-style'
import { isEnumColumn, isSetColumn } from './enum-field-utils'

function resolveEditorType(
  column: TableDataColumnMeta,
  foreignKey: ForeignKeyColumnInfo | undefined
): GridColumnDescriptor['editorType'] {
  if (column.isBinary) return 'none'
  if (isJsonSqlType(column.dataType)) return 'json'
  if (getTemporalColumnType(column.dataType)) return 'datetime'
  if (isEnumColumn(column)) return 'enum'
  if (isSetColumn(column)) return 'set'
  if (foreignKey) return 'fk'
  return 'text'
}

export function buildColumnDescriptors(
  columns: TableDataColumnMeta[],
  isReadOnly: boolean,
  hasPrimaryKey: boolean,
  foreignKeys: ForeignKeyColumnInfo[] = []
): GridColumnDescriptor[] {
  return columns.map((column) => {
    const foreignKey = foreignKeys.find((candidate) => candidate.columnName === column.name)
    const editorType = resolveEditorType(column, foreignKey)
    return {
      key: column.name,
      displayName: column.name,
      dataType: column.dataType,
      editable: !isReadOnly && hasPrimaryKey && !column.isBinary,
      isBinary: column.isBinary,
      isNullable: column.isNullable,
      isPrimaryKey: column.isPrimaryKey,
      isUniqueKey: column.isUniqueKey,
      enumValues: column.enumValues,
      setValues: column.setValues,
      tableColumnMeta: column,
      editorType: editorType,
      // Binary columns keep `editorType: 'none'`/`editable: false`; the marker
      // lets the grid host open the shared BLOB viewer on double-click.
      ...(column.isBinary && {
        blobViewer: true,
        blobViewerEditable: !isReadOnly && hasPrimaryKey,
      }),
      ...(foreignKey && { foreignKey: foreignKey }),
    }
  })
}
