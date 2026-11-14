import type { ICompletionItem, CompletionSnippet } from 'monaco-sql-languages'
import { SQL_KEYWORDS } from '../sql-keywords'
import {
  getParseFallbackMode,
  getScopedSchemaDatabases,
  isCallStatementContext,
  isSelectListContext,
} from './caret-context'
import {
  SORT_PREFIX_HIGH,
  SORT_PREFIX_LOW,
  SORT_PREFIX_NEUTRAL,
  dbItem,
  keywordItem,
  mapSnippetsToItems,
  tableItem,
} from './completion-items'
import {
  pushDatabases,
  pushFallbackKeywordsAndFunctions,
  pushScopedColumns,
  pushScopedRoutines,
  pushScopedTables,
} from './completion-item-push'
import type { ParseFallbackMode, SchemaCache } from './completion-types'

export interface ParseFallbackRequest {
  cache: SchemaCache
  statementPrefix: string
  selectedDatabase: string | null
  broadSuggestionDatabase: string | null
  snippets: CompletionSnippet[] | undefined
  quoteIdentifiers: boolean
}

interface ParseFallbackContext {
  cache: SchemaCache
  items: ICompletionItem[]
  seenLabels: Set<string>
  fallbackDatabases: readonly string[]
  inSelectListContext: boolean
  inCallStatementContext: boolean
  quoteIdentifiers: boolean
}

function fallbackKeywordSortPrefix(
  mode: ParseFallbackMode,
  inCallStatementContext: boolean
): string {
  if (inCallStatementContext) return SORT_PREFIX_LOW
  if (mode.type === 'databases') return SORT_PREFIX_LOW
  if (mode.type === 'databasesAndTables') return SORT_PREFIX_LOW
  return SORT_PREFIX_NEUTRAL
}

function pushParseFallbackKeywords(context: ParseFallbackContext, sortPrefix: string): void {
  if (!context.inCallStatementContext) {
    pushFallbackKeywordsAndFunctions(context.items, sortPrefix)
    return
  }
  for (const keyword of SQL_KEYWORDS) {
    context.items.push(keywordItem(keyword, sortPrefix))
  }
}

function pushHighRankedDatabases(context: ParseFallbackContext): void {
  for (const database of context.cache.databases) {
    context.items.push(dbItem(database, SORT_PREFIX_HIGH, context.quoteIdentifiers))
  }
}

function pushTablesOfDatabase(
  context: ParseFallbackContext,
  database: string,
  sortPrefix: string
): void {
  const tables = context.cache.tables[database] ?? []
  for (const table of tables) {
    context.items.push(tableItem(table.name, sortPrefix, context.quoteIdentifiers))
  }
}

function pushCallStatementFallbackRoutines(context: ParseFallbackContext): void {
  pushScopedRoutines({
    cache: context.cache,
    databases: context.fallbackDatabases,
    items: context.items,
    seenLabels: context.seenLabels,
    sortPrefix: SORT_PREFIX_HIGH,
    routineType: 'PROCEDURE',
    quoteIdentifiers: context.quoteIdentifiers,
  })
}

function pushAllFallbackSchemaItems(context: ParseFallbackContext): void {
  const { cache, items, seenLabels, fallbackDatabases, quoteIdentifiers } = context
  const databaseSortPrefix = context.inCallStatementContext ? SORT_PREFIX_HIGH : SORT_PREFIX_NEUTRAL
  pushDatabases({
    databases: cache.databases,
    items: items,
    seenLabels: seenLabels,
    sortPrefix: databaseSortPrefix,
    quoteIdentifiers: quoteIdentifiers,
  })

  if (context.inCallStatementContext) {
    pushCallStatementFallbackRoutines(context)
    return
  }

  pushScopedTables({
    cache: cache,
    databases: fallbackDatabases,
    items: items,
    seenLabels: seenLabels,
    sortPrefix: SORT_PREFIX_NEUTRAL,
    quoteIdentifiers: quoteIdentifiers,
  })
  pushScopedColumns({
    cache: cache,
    databases: fallbackDatabases,
    items: items,
    seenLabels: seenLabels,
    sortPrefix: SORT_PREFIX_NEUTRAL,
    quoteIdentifiers: quoteIdentifiers,
  })
  const routineType = context.inSelectListContext ? 'FUNCTION' : null
  pushScopedRoutines({
    cache: cache,
    databases: fallbackDatabases,
    items: items,
    seenLabels: seenLabels,
    sortPrefix: SORT_PREFIX_NEUTRAL,
    routineType: routineType,
    quoteIdentifiers: quoteIdentifiers,
  })
}

function pushParseFallbackSchemaItems(
  context: ParseFallbackContext,
  mode: ParseFallbackMode
): void {
  if (mode.type === 'databases') {
    pushHighRankedDatabases(context)
    return
  }
  if (mode.type === 'databasesAndTables') {
    pushHighRankedDatabases(context)
    pushTablesOfDatabase(context, mode.database, SORT_PREFIX_HIGH)
    return
  }
  if (mode.type === 'tables') {
    pushTablesOfDatabase(context, mode.database, SORT_PREFIX_NEUTRAL)
    return
  }
  if (mode.type === 'all') {
    pushAllFallbackSchemaItems(context)
  }
}

function keywordsAndSnippetsOnly(snippets: CompletionSnippet[] | undefined): ICompletionItem[] {
  const items: ICompletionItem[] = []
  pushFallbackKeywordsAndFunctions(items)
  items.push(...mapSnippetsToItems(snippets))
  return items
}

export function buildParseFallback(request: ParseFallbackRequest): ICompletionItem[] {
  const { cache, statementPrefix } = request

  if (cache.status !== 'ready') {
    return keywordsAndSnippetsOnly(request.snippets)
  }

  const mode = getParseFallbackMode({
    statementPrefix: statementPrefix,
    databases: cache.databases,
    scopedDatabase: request.selectedDatabase,
  })
  if (mode.type === 'none') {
    return []
  }

  const inSelectListContext = isSelectListContext(statementPrefix)
  const inCallStatementContext = isCallStatementContext(statementPrefix)
  const usesScopedDatabases = inSelectListContext || inCallStatementContext
  const items: ICompletionItem[] = []
  const context: ParseFallbackContext = {
    cache: cache,
    items: items,
    seenLabels: new Set<string>(),
    fallbackDatabases: usesScopedDatabases
      ? getScopedSchemaDatabases(cache.databases, request.broadSuggestionDatabase)
      : cache.databases,
    inSelectListContext: inSelectListContext,
    inCallStatementContext: inCallStatementContext,
    quoteIdentifiers: request.quoteIdentifiers,
  }
  pushParseFallbackKeywords(context, fallbackKeywordSortPrefix(mode, inCallStatementContext))
  pushParseFallbackSchemaItems(context, mode)
  items.push(...mapSnippetsToItems(request.snippets))
  return items
}
