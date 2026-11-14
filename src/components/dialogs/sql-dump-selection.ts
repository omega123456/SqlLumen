import type { DumpTableEntry, ExportableDatabase } from '../../lib/sql-dump-commands'

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

export type DumpTablesResult =
  | { ok: true; databases: string[]; tables: Record<string, DumpTableEntry[]> }
  | { ok: false; message: string }

function missingMetadataMessage(objectName: string, databaseName: string): string {
  return `Cannot export: metadata not found for "${objectName}" in database "${databaseName}"`
}

type DumpEntriesResult = { ok: true; entries: DumpTableEntry[] } | { ok: false; message: string }

function dumpEntriesFor(
  database: ExportableDatabase | undefined,
  databaseName: string,
  objectNames: Set<string>
): DumpEntriesResult {
  const entries: DumpTableEntry[] = []
  for (const objectName of objectNames) {
    const metadata = database?.tables.find((table) => table.name === objectName)
    if (!metadata) return { ok: false, message: missingMetadataMessage(objectName, databaseName) }
    entries.push({ name: metadata.name, objectType: metadata.objectType })
  }
  return { ok: true, entries: entries }
}

export function buildDumpTables(
  selection: TableSelection,
  databases: ExportableDatabase[]
): DumpTablesResult {
  const tables: Record<string, DumpTableEntry[]> = {}
  const databaseNames: string[] = []
  for (const [databaseName, objectNames] of Object.entries(selection)) {
    if (objectNames.size === 0) continue
    const database = databases.find((candidate) => candidate.name === databaseName)
    const result = dumpEntriesFor(database, databaseName, objectNames)
    if (!result.ok) return result
    databaseNames.push(databaseName)
    tables[databaseName] = result.entries
  }
  return { ok: true, databases: databaseNames, tables: tables }
}

export function selectedObjectCount(selection: TableSelection): number {
  return Object.values(selection).reduce((sum, objectNames) => sum + objectNames.size, 0)
}
