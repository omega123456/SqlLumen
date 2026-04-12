import type { TableInfo, ColumnMeta, ForeignKeyInfo, IndexInfo } from '../types/schema'

// ---------------------------------------------------------------------------
// Schema DDL Compaction
// ---------------------------------------------------------------------------

/** Token threshold above which a warning is emitted. */
const TOKEN_WARNING_THRESHOLD = 8000

/** Approximate characters per token for estimation. */
const CHARS_PER_TOKEN = 4

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
      const colKey = `${dbName}.${table.name}`
      const cols = columns[colKey] ?? []
      const tableIndexes = indexes[colKey] ?? []
      const tableFks = foreignKeys[colKey] ?? []

      const quotedDb = quoteIdentifier(dbName)
      const quotedTable = quoteIdentifier(table.name)

      const parts: string[] = []

      // Column definitions
      for (const col of cols) {
        parts.push(`${quoteIdentifier(col.name)} ${col.dataType}`)
      }

      // Non-PRIMARY indexes
      for (const idx of tableIndexes) {
        if (idx.name === 'PRIMARY') continue
        const prefix = idx.isUnique ? 'UNIQUE INDEX' : 'INDEX'
        const idxCols = idx.columns.map((c) => quoteIdentifier(c)).join(', ')
        parts.push(`${prefix} ${quoteIdentifier(idx.name)} (${idxCols})`)
      }

      // Foreign key constraints
      for (const fk of tableFks) {
        const refDb = quoteIdentifier(fk.referencedDatabase)
        const refTable = quoteIdentifier(fk.referencedTable)
        const refCol = quoteIdentifier(fk.referencedColumn)
        parts.push(
          `CONSTRAINT ${quoteIdentifier(fk.name)} FOREIGN KEY (${quoteIdentifier(fk.columnName)}) REFERENCES ${refDb}.${refTable}(${refCol}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`
        )
      }

      statements.push(`CREATE TABLE ${quotedDb}.${quotedTable} (${parts.join(', ')});`)
    }
  }

  const ddl = statements.join('\n')
  const estimatedTokens = Math.ceil(ddl.length / CHARS_PER_TOKEN)
  const warning = estimatedTokens > TOKEN_WARNING_THRESHOLD

  return { ddl, estimatedTokens, warning }
}
