import { isSameTextIgnoringCase } from '../../../lib/value-checks'
import type { SchemaCache } from '../schema-metadata-cache'
import type {
  SqlColumnQualifier,
  SqlNamePart,
  SqlQualifiedColumn,
  SqlStatementIdentifiers,
  SqlTableReference,
  SqlTextRange,
} from '../../../workers/sql-identifier-types'

const DATABASES_MISSING_FROM_SCHEMA_CACHE: ReadonlySet<string> = new Set([
  'information_schema',
  'performance_schema',
  'sys',
  'mysql',
])

export interface SchemaCheckContext {
  cache: SchemaCache
  defaultDatabase: string | null
}

export interface SchemaProblem {
  message: string
  range: SqlTextRange
}

interface ResolvedTable {
  database: string
  table: string
}

type NamedEntriesByDatabase = Record<string, { name: string }[]>

function tableKey(database: string, table: string): string {
  return `${database}.${table}`
}

function normalizedTableKey(database: string, table: string): string {
  return tableKey(database, table).toLowerCase()
}

class SchemaCatalog {
  private readonly databaseNames = new Map<string, string>()
  private readonly tables = new Map<string, ResolvedTable>()

  constructor(private readonly cache: SchemaCache) {
    for (const database of cache.databases) {
      this.databaseNames.set(database.toLowerCase(), database)
    }
    this.indexTables(cache.tables)
    this.indexTables(cache.views)
  }

  hasDatabase(database: string): boolean {
    return this.databaseNames.has(database.toLowerCase())
  }

  findTable(database: string, table: string): ResolvedTable | null {
    return this.tables.get(normalizedTableKey(database, table)) ?? null
  }

  columnNamesOf(table: ResolvedTable): ReadonlySet<string> | null {
    const columns = this.cache.columns[tableKey(table.database, table.table)]
    if (!columns) return null
    return new Set(columns.map((column) => column.name.toLowerCase()))
  }

  private indexTables(entriesByDatabase: NamedEntriesByDatabase): void {
    for (const [database, entries] of Object.entries(entriesByDatabase)) {
      for (const entry of entries) {
        const resolvedTable = { database: database, table: entry.name }
        this.tables.set(normalizedTableKey(database, entry.name), resolvedTable)
      }
    }
  }
}

const catalogsByCache = new WeakMap<SchemaCache, SchemaCatalog>()

function catalogOf(cache: SchemaCache): SchemaCatalog {
  const existingCatalog = catalogsByCache.get(cache)
  if (existingCatalog) return existingCatalog
  const catalog = new SchemaCatalog(cache)
  catalogsByCache.set(cache, catalog)
  return catalog
}

interface StatementScope {
  statement: SqlStatementIdentifiers
  catalog: SchemaCatalog
  currentDatabase: string | null
  createdTables: ReadonlySet<string>
}

function isDerivedName(statement: SqlStatementIdentifiers, name: string): boolean {
  return statement.derivedNames.some((derivedName) => isSameTextIgnoringCase(derivedName, name))
}

function isDerivedReference(
  reference: SqlTableReference,
  statement: SqlStatementIdentifiers
): boolean {
  return reference.database === null && isDerivedName(statement, reference.table.name)
}

function hasAlias(reference: SqlTableReference, alias: string): boolean {
  return reference.alias !== null && isSameTextIgnoringCase(reference.alias, alias)
}

function databaseOf(reference: SqlTableReference, scope: StatementScope): string | null {
  return reference.database?.name ?? scope.currentDatabase
}

function isUnreportableDatabase(database: string): boolean {
  return DATABASES_MISSING_FROM_SCHEMA_CACHE.has(database.toLowerCase())
}

function unknownDatabaseProblem(
  database: SqlNamePart | null,
  catalog: SchemaCatalog
): SchemaProblem | null {
  if (!database) return null
  if (catalog.hasDatabase(database.name)) return null
  if (isUnreportableDatabase(database.name)) return null
  return { message: `Unknown database \`${database.name}\``, range: database.range }
}

function tableProblem(reference: SqlTableReference, scope: StatementScope): SchemaProblem | null {
  if (isDerivedReference(reference, scope.statement)) return null
  const databaseProblem = unknownDatabaseProblem(reference.database, scope.catalog)
  if (databaseProblem) return databaseProblem
  const database = databaseOf(reference, scope)
  if (!database) return null
  const isKnownDatabase = scope.catalog.hasDatabase(database)
  if (!isKnownDatabase) return null
  if (scope.catalog.findTable(database, reference.table.name)) return null
  if (scope.createdTables.has(reference.table.name.toLowerCase())) return null
  return {
    message: `Unknown table \`${database}.${reference.table.name}\``,
    range: reference.table.range,
  }
}

function referenceForQualifier(
  qualifier: SqlColumnQualifier,
  statement: SqlStatementIdentifiers
): SqlTableReference | null {
  const aliasedReference = statement.tables.find((reference) =>
    hasAlias(reference, qualifier.table)
  )
  if (aliasedReference) return aliasedReference
  if (isDerivedName(statement, qualifier.table)) return null
  const namedReference = statement.tables.find((reference) =>
    isSameTextIgnoringCase(reference.table.name, qualifier.table)
  )
  return namedReference ?? null
}

function resolveQualifier(
  qualifier: SqlColumnQualifier,
  scope: StatementScope
): ResolvedTable | null {
  if (qualifier.database) return scope.catalog.findTable(qualifier.database, qualifier.table)
  const reference = referenceForQualifier(qualifier, scope.statement)
  if (!reference) return null
  if (isDerivedReference(reference, scope.statement)) return null
  const database = databaseOf(reference, scope)
  if (!database) return null
  return scope.catalog.findTable(database, reference.table.name)
}

function columnProblem(column: SqlQualifiedColumn, scope: StatementScope): SchemaProblem | null {
  const table = resolveQualifier(column.qualifier, scope)
  if (!table) return null
  const columnNames = scope.catalog.columnNamesOf(table)
  if (!columnNames) return null
  if (columnNames.has(column.column.name.toLowerCase())) return null
  return {
    message: `Unknown column \`${column.column.name}\` in \`${table.table}\``,
    range: column.column.range,
  }
}

function isProblem(problem: SchemaProblem | null): problem is SchemaProblem {
  return problem !== null
}

function statementProblems(scope: StatementScope): SchemaProblem[] {
  const tableProblems = scope.statement.tables.map((reference) => tableProblem(reference, scope))
  const columnProblems = scope.statement.qualifiedColumns.map((column) =>
    columnProblem(column, scope)
  )
  return [...tableProblems, ...columnProblems].filter(isProblem)
}

function createdTablesOf(statements: SqlStatementIdentifiers[]): ReadonlySet<string> {
  const createdTables = statements.flatMap((statement) => statement.createdTables)
  return new Set(createdTables.map((table) => table.toLowerCase()))
}

export function findSchemaProblems(
  statements: SqlStatementIdentifiers[],
  context: SchemaCheckContext
): SchemaProblem[] {
  const catalog = catalogOf(context.cache)
  const createdTables = createdTablesOf(statements)
  const problems: SchemaProblem[] = []
  let currentDatabase = context.defaultDatabase
  for (const statement of statements) {
    currentDatabase = statement.usedDatabase ?? currentDatabase
    problems.push(...statementProblems({ statement, catalog, currentDatabase, createdTables }))
  }
  return problems
}
