import type { ICompletionItem, CompletionSnippet } from 'monaco-sql-languages'
import type { Suggestions, EntityContext } from 'monaco-sql-languages'
import { EntityContextType } from 'dt-sql-parser'
import {
  getScopedSchemaDatabases,
  hasColumnContext,
  hasTableContext,
  isAfterSelectWildcard,
  isCallStatementContext,
  isSelectListContext,
} from './caret-context'
import {
  SORT_PREFIX_HIGH,
  SORT_PREFIX_LOW,
  SORT_PREFIX_NEUTRAL,
  columnItem,
  keywordItem,
  mapSnippetsToItems,
} from './completion-items'
import {
  pushBuiltinFunctions,
  pushDatabases,
  pushScopedColumns,
  pushScopedRoutines,
  pushScopedTables,
  pushStoredProgramBodyKeywords,
} from './completion-item-push'
import type { CaretText, SchemaCache, TableRef } from './completion-types'
import {
  databaseSearchOrder,
  findTableByLowerName,
  findTablesInCaretStatement,
} from './table-references'

const WILDCARD_FOLLOW_UP_KEYWORDS = ['FROM']

interface SortPrefixes {
  column: string
  schema: string
  callSchema: string
  keyword: string
}

interface SortContextFlags {
  isColumnContext: boolean
  isTableContext: boolean
  inCallStatementContext: boolean
}

function resolveSortPrefixes(flags: SortContextFlags): SortPrefixes {
  const schema = flags.isTableContext ? SORT_PREFIX_HIGH : SORT_PREFIX_NEUTRAL
  const isRankedContext =
    flags.isColumnContext || flags.isTableContext || flags.inCallStatementContext
  return {
    column: flags.isColumnContext ? SORT_PREFIX_HIGH : SORT_PREFIX_NEUTRAL,
    schema: schema,
    callSchema: flags.inCallStatementContext ? SORT_PREFIX_HIGH : schema,
    keyword: isRankedContext ? SORT_PREFIX_LOW : SORT_PREFIX_NEUTRAL,
  }
}

export interface SyntaxCompletionRequest {
  cache: SchemaCache
  suggestions: Suggestions
  entities: EntityContext[] | null
  snippets: CompletionSnippet[] | undefined
  caret: CaretText
  resolutionDatabase: string | null
  selectedDatabase: string | null
  broadSuggestionDatabase: string | null
  quoteIdentifiers: boolean
}

interface SyntaxCompletionContext extends SyntaxCompletionRequest {
  items: ICompletionItem[]
  seenLabels: Set<string>
  sortPrefixes: SortPrefixes
  inSelectListContext: boolean
  inCallStatementContext: boolean
}

function scopedSchemaDatabases(context: SyntaxCompletionContext): readonly string[] {
  return getScopedSchemaDatabases(context.cache.databases, context.broadSuggestionDatabase)
}

function pushDatabaseContextItems(context: SyntaxCompletionContext): void {
  pushDatabases({
    databases: context.cache.databases,
    items: context.items,
    seenLabels: context.seenLabels,
    sortPrefix: context.sortPrefixes.callSchema,
    quoteIdentifiers: context.quoteIdentifiers,
  })
}

function pushTableContextItems(context: SyntaxCompletionContext): void {
  const { cache, items, seenLabels, sortPrefixes, quoteIdentifiers } = context
  pushDatabases({
    databases: cache.databases,
    items: items,
    seenLabels: seenLabels,
    sortPrefix: sortPrefixes.schema,
    quoteIdentifiers: quoteIdentifiers,
  })
  if (!context.selectedDatabase) return
  pushScopedTables({
    cache: cache,
    databases: [context.selectedDatabase],
    items: items,
    seenLabels: seenLabels,
    sortPrefix: sortPrefixes.schema,
    quoteIdentifiers: quoteIdentifiers,
  })
}

function pushSelectListSchemaItems(
  context: SyntaxCompletionContext,
  fallbackDatabases: readonly string[]
): void {
  const { cache, items, seenLabels, sortPrefixes, quoteIdentifiers } = context
  pushDatabases({
    databases: cache.databases,
    items: items,
    seenLabels: seenLabels,
    sortPrefix: sortPrefixes.schema,
    quoteIdentifiers: quoteIdentifiers,
  })
  pushScopedTables({
    cache: cache,
    databases: fallbackDatabases,
    items: items,
    seenLabels: seenLabels,
    sortPrefix: sortPrefixes.schema,
    quoteIdentifiers: quoteIdentifiers,
  })
  pushScopedRoutines({
    cache: cache,
    databases: fallbackDatabases,
    items: items,
    seenLabels: seenLabels,
    sortPrefix: sortPrefixes.schema,
    routineType: 'FUNCTION',
    quoteIdentifiers: quoteIdentifiers,
  })
}

function pushUnseenColumns(context: SyntaxCompletionContext, tableKey: string): void {
  const columns = context.cache.columns[tableKey] ?? []
  for (const column of columns) {
    const label = `col:${column.name}`
    if (context.seenLabels.has(label)) continue
    context.seenLabels.add(label)
    context.items.push(
      columnItem(column.name, context.sortPrefixes.column, context.quoteIdentifiers)
    )
  }
}

function addColumnsForTable(context: SyntaxCompletionContext, tableRef: TableRef): void {
  if (tableRef.database) {
    pushUnseenColumns(context, `${tableRef.database}.${tableRef.table}`)
    return
  }

  const tableNameLower = tableRef.table.toLowerCase()
  const searchOrder = databaseSearchOrder(context.cache.databases, context.resolutionDatabase)
  for (const database of searchOrder) {
    const matchedTable = findTableByLowerName(context.cache, database, tableNameLower)
    if (matchedTable) {
      pushUnseenColumns(context, `${database}.${matchedTable.name}`)
    }
  }
}

function pushColumnContextItems(context: SyntaxCompletionContext): void {
  const scopedTables = findTablesInCaretStatement({
    entities: context.entities,
    statementText: context.caret.statementText,
    resolutionDatabase: context.resolutionDatabase,
  })
  if (scopedTables.length > 0) {
    for (const tableRef of scopedTables) {
      addColumnsForTable(context, tableRef)
    }
    return
  }

  const fallbackDatabases = scopedSchemaDatabases(context)
  pushScopedColumns({
    cache: context.cache,
    databases: fallbackDatabases,
    items: context.items,
    seenLabels: context.seenLabels,
    sortPrefix: context.sortPrefixes.column,
    quoteIdentifiers: context.quoteIdentifiers,
  })
  if (context.inSelectListContext) {
    pushSelectListSchemaItems(context, fallbackDatabases)
  }
}

function pushFunctionContextItems(context: SyntaxCompletionContext): void {
  pushBuiltinFunctions(context.items, context.seenLabels, context.sortPrefixes.schema)
  pushScopedRoutines({
    cache: context.cache,
    databases: context.cache.databases,
    items: context.items,
    seenLabels: context.seenLabels,
    sortPrefix: context.sortPrefixes.schema,
    routineType: 'FUNCTION',
    quoteIdentifiers: context.quoteIdentifiers,
  })
}

function pushProcedureContextItems(context: SyntaxCompletionContext): void {
  if (context.inCallStatementContext) return
  pushScopedRoutines({
    cache: context.cache,
    databases: scopedSchemaDatabases(context),
    items: context.items,
    seenLabels: context.seenLabels,
    sortPrefix: context.sortPrefixes.schema,
    routineType: 'PROCEDURE',
    quoteIdentifiers: context.quoteIdentifiers,
  })
}

const SYNTAX_CONTEXT_COMPLETIONS: Partial<
  Record<string, (context: SyntaxCompletionContext) => void>
> = {
  [EntityContextType.DATABASE]: pushDatabaseContextItems,
  [EntityContextType.TABLE]: pushTableContextItems,
  [EntityContextType.COLUMN]: pushColumnContextItems,
  [EntityContextType.FUNCTION]: pushFunctionContextItems,
  [EntityContextType.PROCEDURE]: pushProcedureContextItems,
}

function pushCallStatementItems(context: SyntaxCompletionContext): void {
  const { cache, items, seenLabels, sortPrefixes, quoteIdentifiers } = context
  pushDatabases({
    databases: cache.databases,
    items: items,
    seenLabels: seenLabels,
    sortPrefix: sortPrefixes.callSchema,
    quoteIdentifiers: quoteIdentifiers,
  })
  pushScopedRoutines({
    cache: cache,
    databases: scopedSchemaDatabases(context),
    items: items,
    seenLabels: seenLabels,
    sortPrefix: sortPrefixes.callSchema,
    routineType: 'PROCEDURE',
    quoteIdentifiers: quoteIdentifiers,
  })
}

function pushRankedKeywordsAndSnippets(context: SyntaxCompletionContext): void {
  const { items, suggestions, caret, sortPrefixes } = context
  for (const keyword of suggestions.keywords) {
    items.push(keywordItem(keyword, sortPrefixes.keyword))
  }
  pushStoredProgramBodyKeywords({
    items: items,
    statementPrefix: caret.cursorPrefix,
    suggestions: suggestions,
    currentWordPrefix: caret.currentWordPrefix,
    existingKeywords: suggestions.keywords,
    sortPrefix: sortPrefixes.keyword,
  })
  items.push(...mapSnippetsToItems(context.snippets, sortPrefixes.keyword))
}

function buildWildcardFollowUpItems(
  request: SyntaxCompletionRequest,
  keywordSortPrefix: string
): ICompletionItem[] {
  const parserKeywords = request.suggestions.keywords
  const keywordLabels = parserKeywords.length > 0 ? parserKeywords : WILDCARD_FOLLOW_UP_KEYWORDS
  const items = keywordLabels.map((keyword) => keywordItem(keyword, keywordSortPrefix))
  items.push(...mapSnippetsToItems(request.snippets, keywordSortPrefix))
  return items
}

export function buildSyntaxCompletions(request: SyntaxCompletionRequest): ICompletionItem[] {
  const statementPrefix = request.caret.statementPrefix
  const isColumnContext = hasColumnContext(request.suggestions)
  const inCallStatementContext = isCallStatementContext(statementPrefix)
  const sortPrefixes = resolveSortPrefixes({
    isColumnContext: isColumnContext,
    isTableContext: hasTableContext(request.suggestions),
    inCallStatementContext: inCallStatementContext,
  })

  if (isAfterSelectWildcard(request.suggestions)) {
    return buildWildcardFollowUpItems(request, sortPrefixes.keyword)
  }

  const context: SyntaxCompletionContext = {
    ...request,
    items: [],
    seenLabels: new Set<string>(),
    sortPrefixes: sortPrefixes,
    inSelectListContext: isSelectListContext(statementPrefix),
    inCallStatementContext: inCallStatementContext,
  }
  for (const syntaxSuggestion of request.suggestions.syntax) {
    SYNTAX_CONTEXT_COMPLETIONS[syntaxSuggestion.syntaxContextType]?.(context)
  }
  if (inCallStatementContext) {
    pushCallStatementItems(context)
  }
  pushRankedKeywordsAndSnippets(context)
  return context.items
}
