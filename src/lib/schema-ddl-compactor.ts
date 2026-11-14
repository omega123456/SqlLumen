import type { TableInfo, ColumnMeta, ForeignKeyInfo, IndexInfo } from '../types/schema'

const TOKEN_WARNING_THRESHOLD = 8000

const CHARS_PER_TOKEN = 4

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export interface SchemaCompactionResult {
  ddl: string
  estimatedTokens: number
  warning: boolean
}

export function quoteIdentifier(name: string): string {
  const escaped = name.replace(/`/g, '``')
  return `\`${escaped}\``
}

const PRIMARY_INDEX_NAME = 'PRIMARY'

interface TableMetadata {
  columns: ColumnMeta[]
  indexes: IndexInfo[]
  foreignKeys: ForeignKeyInfo[]
}

function columnDefinition(column: ColumnMeta): string {
  return `${quoteIdentifier(column.name)} ${column.dataType}`
}

function secondaryIndexDefinition(index: IndexInfo): string {
  const prefix = index.isUnique ? 'UNIQUE INDEX' : 'INDEX'
  const indexColumns = index.columns.map((columnName) => quoteIdentifier(columnName)).join(', ')
  return `${prefix} ${quoteIdentifier(index.name)} (${indexColumns})`
}

function foreignKeyDefinition(foreignKey: ForeignKeyInfo): string {
  const refDb = quoteIdentifier(foreignKey.referencedDatabase)
  const refTable = quoteIdentifier(foreignKey.referencedTable)
  const refColumn = quoteIdentifier(foreignKey.referencedColumn)
  return `CONSTRAINT ${quoteIdentifier(foreignKey.name)} FOREIGN KEY (${quoteIdentifier(foreignKey.columnName)}) REFERENCES ${refDb}.${refTable}(${refColumn}) ON DELETE ${foreignKey.onDelete} ON UPDATE ${foreignKey.onUpdate}`
}

function compactCreateTableStatement(
  dbName: string,
  tableName: string,
  metadata: TableMetadata
): string {
  const secondaryIndexes = metadata.indexes.filter((index) => index.name !== PRIMARY_INDEX_NAME)
  const parts = [
    ...metadata.columns.map(columnDefinition),
    ...secondaryIndexes.map(secondaryIndexDefinition),
    ...metadata.foreignKeys.map(foreignKeyDefinition),
  ]
  return `CREATE TABLE ${quoteIdentifier(dbName)}.${quoteIdentifier(tableName)} (${parts.join(', ')});`
}

export interface SchemaDdlInputs {
  tables: Record<string, TableInfo[]>
  columns: Record<string, ColumnMeta[]>
  foreignKeys?: Record<string, ForeignKeyInfo[]>
  indexes?: Record<string, IndexInfo[]>
}

export function compactSchemaDdl({
  tables,
  columns,
  foreignKeys = {},
  indexes = {},
}: SchemaDdlInputs): SchemaCompactionResult {
  if (Object.keys(tables).length === 0) {
    return { ddl: '', estimatedTokens: 0, warning: false }
  }

  const statements: string[] = []

  for (const [dbName, dbTables] of Object.entries(tables)) {
    for (const table of dbTables) {
      const columnKey = `${dbName}.${table.name}`
      const metadata: TableMetadata = {
        columns: columns[columnKey] ?? [],
        indexes: indexes[columnKey] ?? [],
        foreignKeys: foreignKeys[columnKey] ?? [],
      }
      statements.push(compactCreateTableStatement(dbName, table.name, metadata))
    }
  }

  const ddl = statements.join('\n')
  const estimatedTokens = estimateTokenCount(ddl)
  const warning = estimatedTokens > TOKEN_WARNING_THRESHOLD

  return { ddl, estimatedTokens, warning }
}
