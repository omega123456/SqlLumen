import type { ForeignKeyColumnInfo, TableDataColumnMeta } from '../../types/schema'

export function makeTableColumnMeta(
  overrides: Partial<TableDataColumnMeta> = {}
): TableDataColumnMeta {
  return {
    name: 'name',
    dataType: 'varchar',
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isBooleanAlias: false,
    isAutoIncrement: false,
    ...overrides,
  }
}

export function makeForeignKeyColumn(
  overrides: Partial<ForeignKeyColumnInfo> = {}
): ForeignKeyColumnInfo {
  return {
    columnName: 'owner_id',
    referencedDatabase: 'app',
    referencedTable: 'users',
    referencedColumn: 'id',
    constraintName: 'fk_owner',
    ...overrides,
  }
}
