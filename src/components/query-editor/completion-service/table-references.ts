import type { EntityContext } from 'monaco-sql-languages'
import { EntityContextType } from 'monaco-sql-languages'
import { stripQuotes } from '../alias-resolver'
import { isSameTextIgnoringCase } from '../../../lib/value-checks'
import type { SchemaCache, TableRef } from './completion-types'

const STATEMENT_TABLE_PATTERN = /\b(?:FROM|JOIN|UPDATE|INTO)\s+([\w`"']+(?:\s*\.\s*[\w`"']+)?)/gi

export function databaseSearchOrder(
  databases: readonly string[],
  preferredDatabase: string | null
): readonly string[] {
  if (!preferredDatabase) return databases
  return [preferredDatabase, ...databases.filter((database) => database !== preferredDatabase)]
}

export function findTableByLowerName(
  cache: SchemaCache,
  database: string,
  tableNameLower: string
): { name: string } | undefined {
  const tables = cache.tables[database] ?? []
  return tables.find((table) => isSameTextIgnoringCase(table.name, tableNameLower))
}

function isCaretStatementTable(entity: EntityContext): boolean {
  return (
    entity.entityContextType === EntityContextType.TABLE &&
    entity.belongStmt?.isContainCaret === true
  )
}

export interface CaretStatementTablesRequest {
  entities: EntityContext[] | null
  statementText: string
  resolutionDatabase: string | null
}

export function findTablesInCaretStatement({
  entities,
  statementText,
  resolutionDatabase,
}: CaretStatementTablesRequest): TableRef[] {
  const tableRefs: TableRef[] = []

  for (const entity of entities ?? []) {
    if (!isCaretStatementTable(entity)) continue
    if (!entity.text) continue
    const tableRef = parseTableRefText(entity.text)
    if (!tableRef) continue
    tableRefs.push(tableRef)
  }

  if (tableRefs.length > 0) return tableRefs

  return findTablesInStatementText(statementText, resolutionDatabase)
}

function parseTableRefText(text: string): TableRef | null {
  if (text.includes('.')) {
    const parts = text.split('.')
    const database = stripQuotes(parts[0].trim())
    const table = stripQuotes(parts[parts.length - 1].trim())
    if (!database) return null
    if (!table) return null
    return { database, table }
  }

  const table = stripQuotes(text.trim())
  if (!table) return null
  return { database: null, table: table }
}

function findTablesInStatementText(
  statementText: string,
  resolutionDatabase: string | null
): TableRef[] {
  const tableRefs: TableRef[] = []
  const seen = new Set<string>()
  const pattern = new RegExp(STATEMENT_TABLE_PATTERN)

  let match: RegExpExecArray | null
  while ((match = pattern.exec(statementText)) !== null) {
    const tableRef = parseTableRefText(match[1])
    if (!tableRef) continue

    const dedupeKey =
      `${tableRef.database ?? resolutionDatabase ?? ''}.${tableRef.table}`.toLowerCase()
    if (seen.has(dedupeKey)) continue

    seen.add(dedupeKey)
    tableRefs.push(tableRef)
  }

  return tableRefs
}
