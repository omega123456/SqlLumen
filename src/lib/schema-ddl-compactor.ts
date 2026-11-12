import type { TableInfo, ColumnMeta, ForeignKeyInfo, IndexInfo } from '../types/schema'

// ---------------------------------------------------------------------------
// Schema DDL Compaction
// ---------------------------------------------------------------------------

/** Token threshold above which a warning is emitted. */
const TOKEN_WARNING_THRESHOLD = 8000

/** Approximate characters per token for estimation. */
const CHARS_PER_TOKEN = 4

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export interface SchemaCompactionResult {
  ddl: string
  estimatedTokens: number
  warning: boolean
}

/**
 * Quote a MySQL identifier with backticks, escaping any embedded backticks.
 *
 * e.g. `my`db` → `` `my``db` ``
 */
export function quoteIdentifier(name: string): string {
  const escaped = name.replace(/`/g, '``')
  return `\`${escaped}\``
}

/**
 * Compact schema metadata into minimal single-line CREATE TABLE statements
 * suitable for inclusion in an AI system prompt.
 *
 * Each table is database-qualified: `` CREATE TABLE `db`.`table` (...); ``
 *
 * Does NOT import from schema-metadata-cache — accepts data as parameters.
 *
 * @param tables      - Tables grouped by database name (key = database name)
 * @param columns     - Columns keyed by `"database.tableName"` (same format as {@link SchemaCache.columns})
 * @param foreignKeys - Foreign keys keyed by `"database.tableName"`
 * @param indexes     - Indexes keyed by `"database.tableName"`
 * @returns Compact DDL string, estimated token count, and warning flag
 */
export function compactSchemaDdl(
  tables: Record<string, TableInfo[]>,
  columns: Record<string, ColumnMeta[]>,
  foreignKeys: Record<string, ForeignKeyInfo[]> = {},
  indexes: Record<string, IndexInfo[]> = {}
): SchemaCompactionResult {
  if (Object.keys(tables).length === 0) {
    return { ddl: '', estimatedTokens: 0, warning: false }
  }

  const statements: string[] = []

  for (const [dbName, dbTables] of Object.entries(tables)) {
    for (const table of dbTables) {
      const columnKey = `${dbName}.${table.name}`
      const tableColumns = columns[columnKey] ?? []
      const tableIndexes = indexes[columnKey] ?? []
      const tableForeignKeys = foreignKeys[columnKey] ?? []

      const quotedDb = quoteIdentifier(dbName)
      const quotedTable = quoteIdentifier(table.name)

      const parts: string[] = []

      // Column definitions
      for (const column of tableColumns) {
        parts.push(`${quoteIdentifier(column.name)} ${column.dataType}`)
      }

      // Non-PRIMARY indexes
      for (const index of tableIndexes) {
        if (index.name === 'PRIMARY') continue
        const prefix = index.isUnique ? 'UNIQUE INDEX' : 'INDEX'
        const indexColumns = index.columns
          .map((columnName) => quoteIdentifier(columnName))
          .join(', ')
        parts.push(`${prefix} ${quoteIdentifier(index.name)} (${indexColumns})`)
      }

      // Foreign key constraints
      for (const foreignKey of tableForeignKeys) {
        const refDb = quoteIdentifier(foreignKey.referencedDatabase)
        const refTable = quoteIdentifier(foreignKey.referencedTable)
        const refColumn = quoteIdentifier(foreignKey.referencedColumn)
        parts.push(
          `CONSTRAINT ${quoteIdentifier(foreignKey.name)} FOREIGN KEY (${quoteIdentifier(foreignKey.columnName)}) REFERENCES ${refDb}.${refTable}(${refColumn}) ON DELETE ${foreignKey.onDelete} ON UPDATE ${foreignKey.onUpdate}`
        )
      }

      statements.push(`CREATE TABLE ${quotedDb}.${quotedTable} (${parts.join(', ')});`)
    }
  }

  const ddl = statements.join('\n')
  const estimatedTokens = estimateTokenCount(ddl)
  const warning = estimatedTokens > TOKEN_WARNING_THRESHOLD

  return { ddl, estimatedTokens, warning }
}
