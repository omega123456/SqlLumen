import type { ExportableDatabase } from '../../lib/sql-dump-commands'

export type TableSelection = Record<string, Set<string>>

export interface InitialTableSelectionRequest {
  databases: ExportableDatabase[]
  initialDatabase?: string
  initialTable?: string
}

export function buildInitialTableSelection({
  databases,
  initialDatabase,
  initialTable,
}: InitialTableSelectionRequest): TableSelection {
  if (!initialDatabase) return {}
  const database = databases.find((candidate) => candidate.name === initialDatabase)
  if (!database) return {}
  if (initialTable) return { [initialDatabase]: new Set([initialTable]) }
  return { [initialDatabase]: new Set(database.tables.map((table) => table.name)) }
}

export function toggleTableSelection(
  selection: TableSelection,
  dbName: string,
  tableName: string
): TableSelection {
  const copy = { ...selection }
  const tableNames = new Set(copy[dbName] ?? [])
  const wasSelected = tableNames.has(tableName)
  if (wasSelected) tableNames.delete(tableName)
  if (!wasSelected) tableNames.add(tableName)
  delete copy[dbName]
  if (tableNames.size > 0) copy[dbName] = tableNames
  return copy
}

export function toggleDatabaseSelection(
  selection: TableSelection,
  database: ExportableDatabase
): TableSelection {
  const copy = { ...selection }
  const allTableNames = database.tables.map((table) => table.name)
  const isFullySelected = copy[database.name]?.size === allTableNames.length
  delete copy[database.name]
  if (!isFullySelected) copy[database.name] = new Set(allTableNames)
  return copy
}
