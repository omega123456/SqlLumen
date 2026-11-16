import type { EntityContext } from 'monaco-sql-languages'
import type { ColumnEntityContext, CommonEntityContext } from 'dt-sql-parser'
import { EntityContextType } from 'dt-sql-parser'
import { stripQuotes } from '../../lib/sql-identifier-quotes'
import { entitiesInCaretStatement, parseTableRef } from './alias-resolver'
import type { AliasResolution } from './alias-resolver'

// dt-sql-parser's TableDeclareType.EXPRESSION; the enum is not exported from the package root
const TABLE_DECLARED_BY_EXPRESSION = 1
const WILDCARD = '*'
const QUALIFIER_SEPARATOR = '.'
const QUALIFIED_WILDCARD_SUFFIX = `${QUALIFIER_SEPARATOR}${WILDCARD}`
const PLAIN_IDENTIFIER_PATTERN = /^(?:`[^`]+`|[\w$]+)$/

export interface DerivedTable {
  columnNames: readonly string[]
  wildcardTables: readonly AliasResolution[]
}

export type DerivedTableMap = Map<string, DerivedTable>

function isDerivedTableEntity(entity: EntityContext): boolean {
  const isTable = entity.entityContextType === EntityContextType.TABLE
  return isTable && 'declareType' in entity && entity.declareType === TABLE_DECLARED_BY_EXPRESSION
}

function isQueryResult(entity: EntityContext): entity is CommonEntityContext {
  return entity.entityContextType === EntityContextType.QUERY_RESULT
}

function isWildcardColumn(column: ColumnEntityContext): boolean {
  return column.text === WILDCARD || column.text.endsWith(QUALIFIED_WILDCARD_SUFFIX)
}

function outputColumnName(column: ColumnEntityContext): string | null {
  if (column._alias) return stripQuotes(column._alias.text)
  const unqualifiedName = column.text.split(QUALIFIER_SEPARATOR).pop() ?? ''
  if (!PLAIN_IDENTIFIER_PATTERN.test(unqualifiedName)) return null
  return stripQuotes(unqualifiedName)
}

function sourceTables(
  queryResult: CommonEntityContext,
  activeDatabase: string | null
): AliasResolution[] {
  const tables: AliasResolution[] = []
  for (const related of queryResult.relatedEntities ?? []) {
    if (related.entityContextType !== EntityContextType.TABLE) continue
    const tableRef = parseTableRef(related.text, activeDatabase)
    if (tableRef) tables.push(tableRef)
  }
  return tables
}

function toDerivedTable(
  queryResult: CommonEntityContext,
  activeDatabase: string | null
): DerivedTable {
  const columns = queryResult.columns ?? []
  const columnNames: string[] = []
  for (const column of columns) {
    const columnName = outputColumnName(column)
    if (columnName) columnNames.push(columnName)
  }
  const selectsWildcard = columns.some(isWildcardColumn)
  return {
    columnNames: columnNames,
    wildcardTables: selectsWildcard ? sourceTables(queryResult, activeDatabase) : [],
  }
}

function derivedTableNames(entity: EntityContext): string[] {
  const names: string[] = []
  if (entity._alias) names.push(stripQuotes(entity._alias.text).toLowerCase())
  if (PLAIN_IDENTIFIER_PATTERN.test(entity.text)) names.push(stripQuotes(entity.text).toLowerCase())
  return names
}

export function buildDerivedTableMap(
  entities: EntityContext[] | null,
  activeDatabase: string | null
): DerivedTableMap {
  const map: DerivedTableMap = new Map()
  const derivedEntities = (entities ?? []).filter(isDerivedTableEntity)

  for (const entity of entitiesInCaretStatement(derivedEntities)) {
    const queryResult = entity.relatedEntities?.find(isQueryResult)
    if (!queryResult) continue

    const derivedTable = toDerivedTable(queryResult, activeDatabase)
    for (const name of derivedTableNames(entity)) {
      map.set(name, derivedTable)
    }
  }

  return map
}
