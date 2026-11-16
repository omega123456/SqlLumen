import type { languages, editor, Position } from 'monaco-editor'
import type { ICompletionItem } from 'monaco-sql-languages'
import { buildAliasMapFromText } from '../alias-resolver'
import type { AliasMap } from '../alias-resolver'
import type { DerivedTable, DerivedTableMap } from '../derived-table-resolver'
import { isSameTextIgnoringCase } from '../../../lib/value-checks'
import {
  hasDottedPrefixBeforeWord,
  isCallStatementContext,
  isInTableReferenceClause,
} from './caret-context'
import { SORT_PREFIX_NEUTRAL, columnItem, routineItem, tableItem } from './completion-items'
import type { RoutineType } from './completion-items'
import type { CaretText, SchemaCache } from './completion-types'
import { databaseSearchOrder, findTableByLowerName } from './table-references'

type AliasTarget = NonNullable<ReturnType<AliasMap['get']>>

const DOT_PREFIX_PATTERN = /(?:([\w`"']+)\.)?([\w`"']+)\.\s*$/
const IDENTIFIER_QUOTE_CHARACTERS = /[`"']/g

export interface DotNotationRequest {
  model: editor.IReadOnlyModel
  position: Position
  cache: SchemaCache
  aliasMap: AliasMap
  derivedTables: DerivedTableMap
  resolutionDatabase: string | null
  caret: CaretText
  quoteIdentifiers: boolean
}

interface DotTarget {
  qualifiedDatabase: string | null
  tablePart: string
  prefixLower: string
}

export function resolveDotCompletions(
  request: DotNotationRequest,
  completionContext: languages.CompletionContext
): ICompletionItem[] | null {
  const isDotContext =
    completionContext.triggerCharacter === '.' ||
    hasDottedPrefixBeforeWord(request.model, request.position)
  if (!isDotContext) return null
  const dotResult = handleDotNotation(request)
  if (dotResult !== null) return dotResult
  if (isInTableReferenceClause(request.caret.statementPrefix)) return []
  return null
}

function matchDotPrefix(model: editor.IReadOnlyModel, position: Position): RegExpMatchArray | null {
  const lineContent = model.getLineContent(position.lineNumber)
  const textBefore = lineContent.substring(0, position.column - 1)
  const dotMatch = textBefore.match(DOT_PREFIX_PATTERN)
  if (dotMatch) return dotMatch
  const wordInfo = model.getWordUntilPosition(position)
  const textBeforeWord = lineContent.substring(0, wordInfo.startColumn - 1)
  return textBeforeWord.match(DOT_PREFIX_PATTERN)
}

function stripIdentifierQuotes(identifier: string): string {
  return identifier.replace(IDENTIFIER_QUOTE_CHARACTERS, '')
}

function parseDotTarget(dotMatch: RegExpMatchArray): DotTarget {
  const tablePart = stripIdentifierQuotes(dotMatch[2])
  return {
    qualifiedDatabase: dotMatch[1] ? stripIdentifierQuotes(dotMatch[1]) : null,
    tablePart: tablePart,
    prefixLower: tablePart.toLowerCase(),
  }
}

function columnCompletionItems(
  cache: SchemaCache,
  tableKey: string,
  quoteIdentifiers: boolean
): ICompletionItem[] {
  const columns = cache.columns[tableKey] ?? []
  return columns.map((column) => columnItem(column.name, SORT_PREFIX_NEUTRAL, quoteIdentifiers))
}

function derivedTableColumnItems(
  request: DotNotationRequest,
  derivedTable: DerivedTable
): ICompletionItem[] {
  const columnNames = new Set(derivedTable.columnNames)
  for (const table of derivedTable.wildcardTables) {
    const columns = request.cache.columns[`${table.database}.${table.table}`] ?? []
    for (const column of columns) columnNames.add(column.name)
  }
  return [...columnNames].map((columnName) =>
    columnItem(columnName, SORT_PREFIX_NEUTRAL, request.quoteIdentifiers)
  )
}

function resolveAliasTarget(
  request: DotNotationRequest,
  prefixLower: string
): AliasTarget | undefined {
  const entityAlias = request.aliasMap.get(prefixLower)
  if (entityAlias) return entityAlias
  const textAliasMap = buildAliasMapFromText(
    request.caret.statementText,
    request.resolutionDatabase
  )
  return textAliasMap.get(prefixLower)
}

function routinesOfType(
  cache: SchemaCache,
  database: string,
  routineType: RoutineType
): Array<{ name: string }> {
  const routines = cache.routines[database] ?? []
  return routines.filter((routine) => routine.routineType === routineType)
}

function routineItemsOfType(
  request: DotNotationRequest,
  database: string,
  routineType: RoutineType
): ICompletionItem[] {
  return routinesOfType(request.cache, database, routineType).map((routine) =>
    routineItem({
      name: routine.name,
      type: routineType,
      sortPrefix: SORT_PREFIX_NEUTRAL,
      quoteIdentifiers: request.quoteIdentifiers,
    })
  )
}

function databaseDotCompletions(request: DotNotationRequest, database: string): ICompletionItem[] {
  const { cache, quoteIdentifiers } = request
  const statementPrefix = request.caret.statementPrefix
  if (isCallStatementContext(statementPrefix)) {
    return routineItemsOfType(request, database, 'PROCEDURE')
  }
  const tables = cache.tables[database] ?? []
  const items = tables.map((table) => tableItem(table.name, SORT_PREFIX_NEUTRAL, quoteIdentifiers))
  if (isInTableReferenceClause(statementPrefix)) return items
  return [...items, ...routineItemsOfType(request, database, 'FUNCTION')]
}

function tableDotCompletions(
  request: DotNotationRequest,
  target: DotTarget
): ICompletionItem[] | null {
  const { cache, quoteIdentifiers } = request
  if (target.qualifiedDatabase) {
    const tableKey = `${target.qualifiedDatabase}.${target.tablePart}`
    const items = columnCompletionItems(cache, tableKey, quoteIdentifiers)
    return items.length > 0 ? items : null
  }
  for (const database of databaseSearchOrder(cache.databases, request.resolutionDatabase)) {
    const matchedTable = findTableByLowerName(cache, database, target.prefixLower)
    if (matchedTable) {
      return columnCompletionItems(cache, `${database}.${matchedTable.name}`, quoteIdentifiers)
    }
  }
  return null
}

function aliasColumnItems(
  request: DotNotationRequest,
  prefixLower: string
): ICompletionItem[] | null {
  if (isInTableReferenceClause(request.caret.statementPrefix)) return null
  const derivedTable = request.derivedTables.get(prefixLower)
  if (derivedTable) return derivedTableColumnItems(request, derivedTable)
  const aliasTarget = resolveAliasTarget(request, prefixLower)
  if (!aliasTarget) return null
  const tableKey = `${aliasTarget.database}.${aliasTarget.table}`
  return columnCompletionItems(request.cache, tableKey, request.quoteIdentifiers)
}

function handleDotNotation(request: DotNotationRequest): ICompletionItem[] | null {
  const { cache } = request
  if (cache.status !== 'ready') return null
  const dotMatch = matchDotPrefix(request.model, request.position)
  if (!dotMatch) return null
  const target = parseDotTarget(dotMatch)

  const aliasColumns = aliasColumnItems(request, target.prefixLower)
  if (aliasColumns) return aliasColumns

  const matchedDatabase = cache.databases.find((database) =>
    isSameTextIgnoringCase(database, target.prefixLower)
  )
  if (matchedDatabase) return databaseDotCompletions(request, matchedDatabase)
  if (isInTableReferenceClause(request.caret.statementPrefix)) return null
  return tableDotCompletions(request, target)
}
