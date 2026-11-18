import { isBinaryDataType } from '../../../lib/blob-utils'
import { getTemporalColumnType } from '../../../lib/date-utils'
import { isJsonSqlType } from '../../../lib/grid-column-style'
import { isGeneratedColumn } from '../../../lib/column-capabilities'
import type { ForeignKeyColumnInfo, TableDataColumnMeta } from '../../../types/schema'
import type { GridColumnDescriptor } from '../../../types/shared-data-view'
import { isEnumColumn, isSetColumn } from '../enum-field-utils'

export type GridEditorType = NonNullable<GridColumnDescriptor['editorType']>

export function resolveGridEditorType(
  tableColumn: TableDataColumnMeta | undefined,
  foreignKey: ForeignKeyColumnInfo | undefined
): GridEditorType {
  if (!tableColumn) return 'none'
  if (tableColumn.isBinary) return 'none'
  if (isJsonSqlType(tableColumn.dataType)) return 'json'
  if (getTemporalColumnType(tableColumn.dataType)) return 'datetime'
  if (isEnumColumn(tableColumn)) return 'enum'
  if (isSetColumn(tableColumn)) return 'set'
  if (foreignKey) return 'fk'
  return 'text'
}

export interface GridColumnDescriptorInput {
  key: string
  displayName: string
  dataType: string
  tableColumn: TableDataColumnMeta | undefined
  foreignKey: ForeignKeyColumnInfo | undefined
  editable: boolean
  blobViewerEditable: boolean
  width?: number
}

const UNBOUND_COLUMN_FIELDS = {
  isNullable: true,
  isPrimaryKey: false,
  isUniqueKey: false,
  enumValues: undefined,
  setValues: undefined,
}

function tableColumnFields(tableColumn: TableDataColumnMeta | undefined) {
  if (!tableColumn) return UNBOUND_COLUMN_FIELDS
  return {
    isNullable: tableColumn.isNullable,
    isPrimaryKey: tableColumn.isPrimaryKey,
    isUniqueKey: tableColumn.isUniqueKey,
    enumValues: tableColumn.enumValues,
    setValues: tableColumn.setValues,
  }
}

function isBinaryColumn(input: GridColumnDescriptorInput): boolean {
  if (input.tableColumn) return input.tableColumn.isBinary
  return isBinaryDataType(input.dataType)
}

export function buildGridColumnDescriptor(input: GridColumnDescriptorInput): GridColumnDescriptor {
  const { tableColumn, foreignKey } = input
  const isBinary = isBinaryColumn(input)
  const isGenerated = isGeneratedColumn(tableColumn)
  const canEditBlob = isBinary && input.blobViewerEditable && !isGenerated
  return {
    key: input.key,
    displayName: input.displayName,
    dataType: input.dataType,
    editable: input.editable,
    isBinary: isBinary,
    ...tableColumnFields(tableColumn),
    tableColumnMeta: tableColumn,
    foreignKey: foreignKey,
    editorType: resolveGridEditorType(tableColumn, foreignKey),
    blobViewer: isBinary,
    blobViewerEditable: canEditBlob,
    width: input.width,
  }
}

export function editableColumnKeysOf(columns: GridColumnDescriptor[]): Set<string> {
  const keys = new Set<string>()
  for (const column of columns) {
    if (column.editable) keys.add(column.key)
  }
  return keys
}
