import { buildTableColLookup, colKey } from './col-key-utils'
import { buildForeignKeyLookup } from './foreign-key-utils'
import type { ColumnMeta, ForeignKeyColumnInfo, TableDataColumnMeta } from '../types/schema'

interface ResolveQueryResultColumnsArgs {
  resultColumns: ColumnMeta[]
  editMode: string | null
  editableColumnMap: Map<number, boolean>
  editTableColumns: TableDataColumnMeta[]
  editForeignKeys: ForeignKeyColumnInfo[]
  editColumnBindings: Map<number, string>
}

export interface ResolvedQueryResultColumn {
  key: string
  displayName: string
  dataType: string
  boundName: string
  editable: boolean
  tableColumnMeta: TableDataColumnMeta | undefined
  effectiveTableMeta: TableDataColumnMeta
  foreignKey: ForeignKeyColumnInfo | undefined
}

function buildFallbackTableColumnMeta(boundName: string, dataType: string): TableDataColumnMeta {
  return {
    name: boundName,
    dataType,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isBooleanAlias: false,
    isAutoIncrement: false,
  }
}

export function resolveQueryResultColumns({
  resultColumns,
  editMode,
  editableColumnMap,
  editTableColumns,
  editForeignKeys,
  editColumnBindings,
}: ResolveQueryResultColumnsArgs): ResolvedQueryResultColumn[] {
  const tableColLookup = buildTableColLookup(editTableColumns)
  const foreignKeyLookup = buildForeignKeyLookup(editForeignKeys)

  return resultColumns.map((resultColumn, index) => {
    const boundName = editColumnBindings.get(index) ?? resultColumn.name
    const lookupTableMeta = tableColLookup.get(boundName.toLowerCase())
    const editable =
      editMode !== null && editableColumnMap.size > 0
        ? (editableColumnMap.get(index) ?? false)
        : false

    return {
      key: colKey(index),
      displayName: resultColumn.name,
      dataType: resultColumn.dataType,
      boundName,
      editable,
      tableColumnMeta: lookupTableMeta,
      effectiveTableMeta:
        lookupTableMeta ?? buildFallbackTableColumnMeta(boundName, resultColumn.dataType),
      foreignKey: editColumnBindings.has(index)
        ? foreignKeyLookup.get(boundName.toLowerCase())
        : undefined,
    }
  })
}
