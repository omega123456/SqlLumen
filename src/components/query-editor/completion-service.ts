/**
 * Custom completionService callback for monaco-sql-languages.
 *
 * Uses a model-URI → connectionId registry so the global completionService
 * knows which connection's schema to use for each editor instance.
 *
 * Handles:
 * - Parse-failure fallback (when suggestions is null): dump all schema items + keywords
 * - Normal flow: map syntax context types to schema lookups
 * - Dot notation: db.table / table.column scoping
 * - Alias resolution: alias.column via buildAliasMap
 * - Loading/error/missing cache states
 * - Context-aware ranking: column context → columns ranked first, keywords lower
 *
 * Bundle size note: Added monaco-sql-languages + dt-sql-parser; removed node-sql-parser.
 * Net change: ~+200 KB (ANTLR4 runtime adds size, node-sql-parser removal partially offsets)
 */

import { languages } from 'monaco-editor'
import type { editor, Position } from 'monaco-editor'
import type { CompletionService, ICompletionItem, CompletionSnippet } from 'monaco-sql-languages'
import type { Suggestions, EntityContext } from 'monaco-sql-languages'
import { EntityContextType } from 'monaco-sql-languages'
import { getCache } from './schema-metadata-cache'
import { buildAliasMap, buildAliasMapFromText, stripQuotes } from './alias-resolver'
import type { AliasMap } from './alias-resolver'
import { logParseFallback } from '../../lib/app-log-commands'
import { useConnectionStore } from '../../stores/connection-store'
import { parseNodeId, useSchemaStore } from '../../stores/schema-store'
import { SQL_KEYWORDS, SQL_BUILTIN_FUNCTIONS, STORED_PROGRAM_BODY_KEYWORDS } from './sql-keywords'
import { findStatementAtCursor, splitStatements } from './sql-parser-utils'
import { useSettingsStore } from '../../stores/settings-store'

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** A parsed table reference that may include a database qualifier. */
interface TableRef {
  database: string | null
  table: string
}

type ParseFallbackMode =
  | { type: 'all' }
  | { type: 'databases' }
  | { type: 'databasesAndTables'; database: string }
  | { type: 'tables'; database: string }
  | { type: 'none' }

// ---------------------------------------------------------------------------
// Model-URI → connection/tab context registry
// ---------------------------------------------------------------------------

import type { TabType } from '../../types/schema'

interface ModelContext {
  connectionId: string
  tabId: string
  tabType: TabType
}

const modelConnections = new Map<string, ModelContext>()

export function registerModelConnection(
  uri: string,
  connectionId: string,
  tabId?: string,
  tabType?: TabType
): void {
  modelConnections.set(uri, {
    connectionId: connectionId,
    tabId: tabId ?? '',
    tabType: tabType ?? 'query-editor',
  })
}

export function unregisterModelConnection(uri: string): void {
  modelConnections.delete(uri)
}

export function getModelConnectionId(uri: string): string | undefined {
  return modelConnections.get(uri)?.connectionId
}

/** Returns the full model context (connectionId, tabId, tabType) for a given model URI. */
export function getModelContext(
  uri: string
): { connectionId: string; tabId: string; tabType: TabType } | undefined {
  return modelConnections.get(uri)
}

/** Reset all model-connection mappings. For test cleanup only. */
export function resetModelConnections(): void {
  modelConnections.clear()
}

// Basic SQL keywords + built-in functions imported from ./sql-keywords

// ---------------------------------------------------------------------------
// Context-aware sort prefixes
// ---------------------------------------------------------------------------

/** Highest priority — shown first (e.g. columns in column context). */
const SORT_PREFIX_HIGH = '0_'
/** Neutral priority — default tier for all items outside of ranked contexts. */
const SORT_PREFIX_NEUTRAL = '1_'
/** Lower priority — still shown but ranked below high/neutral (e.g. keywords in column context). */
const SORT_PREFIX_LOW = '2_'

// ---------------------------------------------------------------------------
// Backtick quoting
// ---------------------------------------------------------------------------

type QuotedItem = ICompletionItem & { filterText?: string }

/**
 * Wraps a MySQL identifier in backtick quotes, escaping any internal
 * backtick characters per MySQL rules (` → ``).
 */
function mysqlBacktickQuote(raw: string): string {
  return '`' + raw.replace(/`/g, '``') + '`'
}

/**
 * If `quoteIdentifiers` is true, sets `insertText` to the backtick-quoted
 * form of `raw` and `filterText` to the raw identifier. Returns the item
 * for convenient chaining.
 */
function applyQuoting(item: QuotedItem, raw: string, quoteIdentifiers: boolean): QuotedItem {
  if (quoteIdentifiers) {
    item.insertText = mysqlBacktickQuote(raw)
    item.filterText = raw
  }
  return item
}

/**
 * Detect whether the parser-provided syntax suggestions indicate a column
 * context (e.g. cursor inside WHERE, SELECT-list, HAVING, ON).
 */
function hasColumnContext(suggestions: Suggestions): boolean {
  return suggestions.syntax.some(
    (suggestion) => suggestion.syntaxContextType === EntityContextType.COLUMN
  )
}

function hasTableContext(suggestions: Suggestions): boolean {
  return suggestions.syntax.some(
    (suggestion) => suggestion.syntaxContextType === EntityContextType.TABLE
  )
}

function hasFunctionContext(suggestions: Suggestions): boolean {
  return suggestions.syntax.some(
    (suggestion) => suggestion.syntaxContextType === EntityContextType.FUNCTION
  )
}

function getCurrentWordPrefix(model: editor.IReadOnlyModel, position: Position): string {
  return model.getWordUntilPosition(position).word.toUpperCase()
}

function canSupplementStoredProgramBodyKeywords(
  suggestions: Suggestions,
  currentWordPrefix: string
): boolean {
  if (suggestions.syntax.length === 0) {
    return true
  }

  return currentWordPrefix.length > 0 && 'DECLARE'.startsWith(currentWordPrefix)
}

function hasUnclosedStoredProgramBegin(statementPrefix: string): boolean {
  const tokens =
    statementPrefix.match(/\bBEGIN\b|\bEND\s+(?:IF|CASE|LOOP|WHILE|REPEAT)\b|\bEND\b/gi) ?? []
  let depth = 0

  for (const token of tokens) {
    const upperToken = token.toUpperCase()

    if (upperToken === 'BEGIN') {
      depth += 1
      continue
    }
    if (upperToken === 'END' && depth > 0) {
      depth -= 1
    }
  }

  return depth > 0
}

function isStoredProgramBodyContext(statementPrefix: string): boolean {
  const routineDeclarationPrefixMatch = statementPrefix.match(
    /CREATE\b[\s\S]*\b(?:PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/i
  )

  if (!routineDeclarationPrefixMatch || routineDeclarationPrefixMatch.index === undefined) {
    return false
  }

  const routinePrefix = statementPrefix.slice(routineDeclarationPrefixMatch.index)
  const sanitizedPrefix = statementPrefix
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ')
    .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, ' ')
    .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, ' ')
    .replace(/`[^`]*`/g, ' ')

  const sanitizedRoutinePrefix = routinePrefix
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ')
    .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, ' ')
    .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, ' ')
    .replace(/`[^`]*`/g, ' ')

  return (
    /CREATE\b[\s\S]*\b(?:PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/i.test(sanitizedPrefix) &&
    hasUnclosedStoredProgramBegin(sanitizedRoutinePrefix)
  )
}

export function getSelectedDatabase(connectionId: string | undefined): string | null {
  if (!connectionId) return null

  const selectedNodeId = useSchemaStore.getState().connectionStates[connectionId]?.selectedNodeId
  if (!selectedNodeId) return null

  try {
    const parsed = parseNodeId(selectedNodeId)
    return parsed.database || null
  } catch (error) {
    logParseFallback('[completion-service] getSelectedDatabase', error)
    return null
  }
}

function getCurrentStatementPrefix(model: editor.IReadOnlyModel, position: Position): string {
  const sql = model.getValue()
  const caretOffset = model.getOffsetAt(position)
  const statements = splitStatements(sql)
  const statement = findStatementAtCursor(statements, caretOffset)
  const statementStart = statement?.start ?? 0

  return sql.slice(statementStart, caretOffset)
}

function getCurrentStatementText(model: editor.IReadOnlyModel, position: Position): string {
  const sql = model.getValue()
  const caretOffset = model.getOffsetAt(position)
  const statements = splitStatements(sql)
  const statement = findStatementAtCursor(statements, caretOffset)

  return statement?.sql ?? sql
}

function getCursorPrefix(model: editor.IReadOnlyModel, position: Position): string {
  const sql = model.getValue()
  const caretOffset = model.getOffsetAt(position)

  return sql.slice(0, caretOffset)
}

function isInTableReferenceClause(statementPrefix: string): boolean {
  return /\b(?:FROM|JOIN|UPDATE|INTO|TABLE|DESCRIBE|DESC)\s+(?:[\w`"']+\.)?[\w`"']*$/i.test(
    statementPrefix.trimEnd()
  )
}

function isSelectListContext(statementPrefix: string): boolean {
  const trimmedPrefix = statementPrefix.trimStart()
  return /^SELECT\b/i.test(trimmedPrefix) && !/\bFROM\b/i.test(trimmedPrefix)
}

function isCallStatementContext(statementPrefix: string): boolean {
  return /^CALL\b/i.test(statementPrefix.trimStart())
}

function isAfterSelectWildcard(statementPrefix: string): boolean {
  return /^\s*SELECT(?:\s+(?:ALL|DISTINCT(?:ROW)?))?\s+(?:(?:[\w`"']+\.){0,2}\*)\s*$/i.test(
    statementPrefix
  )
}

function getScopedSchemaDatabases(
  databases: readonly string[],
  scopedDatabase: string | null
): readonly string[] {
  if (scopedDatabase && databases.includes(scopedDatabase)) {
    return [scopedDatabase]
  }

  return databases
}

function getParseFallbackMode(
  statementPrefix: string,
  databases: readonly string[],
  scopedDatabase: string | null
): ParseFallbackMode {
  if (/\b(?:FROM|JOIN|UPDATE|INTO|TABLE|DESCRIBE|DESC)\s+$/i.test(statementPrefix)) {
    return scopedDatabase
      ? { type: 'databasesAndTables', database: scopedDatabase }
      : { type: 'databases' }
  }

  const tableDotMatch = statementPrefix.match(
    /\b(?:FROM|JOIN|UPDATE|INTO|TABLE|DESCRIBE|DESC)\s+(?:([\w`"']+)\.)?([\w`"']+)\.\s*$/i
  )

  if (!tableDotMatch) {
    return { type: 'all' }
  }

  const qualifier = tableDotMatch[1] ? stripQuotes(tableDotMatch[1]) : null
  const identifier = stripQuotes(tableDotMatch[2])

  if (qualifier) {
    return { type: 'none' }
  }

  const matchedDatabase = databases.find((db) => db.toLowerCase() === identifier.toLowerCase())
  if (matchedDatabase) {
    return { type: 'tables', database: matchedDatabase }
  }

  return { type: 'none' }
}

// ---------------------------------------------------------------------------
// Helpers — completion-item factory functions
// ---------------------------------------------------------------------------

function keywordItem(kw: string, sortPrefix = SORT_PREFIX_NEUTRAL): ICompletionItem {
  return {
    label: kw,
    kind: languages.CompletionItemKind.Keyword,
    insertText: kw,
    sortText: `${sortPrefix}${kw}`,
  }
}

function builtinFunctionItem(
  functionName: string,
  sortPrefix = SORT_PREFIX_NEUTRAL
): ICompletionItem {
  return {
    label: functionName,
    kind: languages.CompletionItemKind.Function,
    insertText: functionName,
    sortText: `${sortPrefix}${functionName}`,
  }
}

function pushBuiltinFunctions(
  items: ICompletionItem[],
  seenLabels: Set<string> | null,
  sortPrefix = SORT_PREFIX_NEUTRAL
): void {
  for (const functionName of SQL_BUILTIN_FUNCTIONS) {
    if (seenLabels && seenLabels.has(`fn:${functionName}`)) {
      continue
    }

    seenLabels?.add(`fn:${functionName}`)
    items.push(builtinFunctionItem(functionName, sortPrefix))
  }
}

function pushFallbackKeywordsAndFunctions(
  items: ICompletionItem[],
  sortPrefix = SORT_PREFIX_NEUTRAL
): void {
  const seenLabels = new Set<string>()

  for (const kw of SQL_KEYWORDS) {
    if (seenLabels.has(kw)) {
      continue
    }

    seenLabels.add(kw)
    items.push(keywordItem(kw, sortPrefix))
  }

  for (const functionName of SQL_BUILTIN_FUNCTIONS) {
    if (seenLabels.has(functionName)) {
      continue
    }

    seenLabels.add(functionName)
    items.push(builtinFunctionItem(functionName, sortPrefix))
  }
}

function pushStoredProgramBodyKeywords(
  items: ICompletionItem[],
  statementPrefix: string,
  suggestions: Suggestions,
  currentWordPrefix: string,
  existingKeywords: readonly string[],
  sortPrefix = SORT_PREFIX_NEUTRAL
): void {
  if (
    !isStoredProgramBodyContext(statementPrefix) ||
    !canSupplementStoredProgramBodyKeywords(suggestions, currentWordPrefix)
  ) {
    return
  }

  const seenKeywords = new Set(existingKeywords.map((kw) => kw.toUpperCase()))

  for (const kw of STORED_PROGRAM_BODY_KEYWORDS) {
    if (seenKeywords.has(kw)) {
      continue
    }

    seenKeywords.add(kw)
    items.push(keywordItem(kw, sortPrefix))
  }
}

function pushDatabases(
  databases: readonly string[],
  items: ICompletionItem[],
  seenLabels: Set<string>,
  sortPrefix = SORT_PREFIX_NEUTRAL,
  quoteIdentifiers = false
): void {
  for (const db of databases) {
    if (seenLabels.has(`db:${db}`)) {
      continue
    }

    seenLabels.add(`db:${db}`)
    items.push(dbItem(db, sortPrefix, quoteIdentifiers))
  }
}

function pushScopedTables(
  cache: ReturnType<typeof getCache>,
  databases: readonly string[],
  items: ICompletionItem[],
  seenLabels: Set<string>,
  sortPrefix = SORT_PREFIX_NEUTRAL,
  quoteIdentifiers = false
): void {
  for (const db of databases) {
    const tables = cache.tables[db] ?? []
    for (const table of tables) {
      if (seenLabels.has(`tbl:${db}:${table.name}`)) {
        continue
      }

      seenLabels.add(`tbl:${db}:${table.name}`)
      items.push(tableItem(table.name, sortPrefix, quoteIdentifiers))
    }
  }
}

function pushScopedColumns(
  cache: ReturnType<typeof getCache>,
  databases: readonly string[],
  items: ICompletionItem[],
  seenLabels: Set<string>,
  sortPrefix = SORT_PREFIX_NEUTRAL,
  quoteIdentifiers = false
): void {
  for (const db of databases) {
    const tables = cache.tables[db] ?? []
    for (const table of tables) {
      const columns = cache.columns[`${db}.${table.name}`] ?? []
      for (const column of columns) {
        if (seenLabels.has(`col:${column.name}`)) {
          continue
        }

        seenLabels.add(`col:${column.name}`)
        items.push(columnItem(column.name, sortPrefix, quoteIdentifiers))
      }
    }
  }
}

function matchesRoutineType(
  routine: { routineType: string },
  routineType: 'FUNCTION' | 'PROCEDURE' | null
): boolean {
  return routineType === null || routine.routineType === routineType
}

function routineCompletionKey(routine: { name: string; routineType: string }): string {
  return routine.routineType === 'FUNCTION' ? `fn:${routine.name}` : `proc:${routine.name}`
}

function pushScopedRoutines(
  cache: ReturnType<typeof getCache>,
  databases: readonly string[],
  items: ICompletionItem[],
  seenLabels: Set<string>,
  sortPrefix = SORT_PREFIX_NEUTRAL,
  routineType: 'FUNCTION' | 'PROCEDURE' | null = null,
  quoteIdentifiers = false
): void {
  for (const db of databases) {
    const routines = cache.routines[db] ?? []
    for (const routine of routines) {
      if (!matchesRoutineType(routine, routineType)) {
        continue
      }

      const routineKey = routineCompletionKey(routine)

      if (seenLabels.has(routineKey)) {
        continue
      }

      seenLabels.add(routineKey)
      items.push(
        routineItem(
          routine.name,
          routine.routineType as 'FUNCTION' | 'PROCEDURE',
          sortPrefix,
          quoteIdentifiers
        )
      )
    }
  }
}

function dbItem(
  db: string,
  sortPrefix = SORT_PREFIX_NEUTRAL,
  quoteIdentifiers = false
): QuotedItem {
  return applyQuoting(
    {
      label: db,
      kind: languages.CompletionItemKind.Module,
      sortText: `${sortPrefix}${db}`,
    },
    db,
    quoteIdentifiers
  )
}

function tableItem(
  tableName: string,
  sortPrefix = SORT_PREFIX_NEUTRAL,
  quoteIdentifiers = false
): QuotedItem {
  return applyQuoting(
    {
      label: tableName,
      kind: languages.CompletionItemKind.Class,
      sortText: `${sortPrefix}${tableName}`,
    },
    tableName,
    quoteIdentifiers
  )
}

function columnItem(
  columnName: string,
  sortPrefix = SORT_PREFIX_NEUTRAL,
  quoteIdentifiers = false
): QuotedItem {
  return applyQuoting(
    {
      label: columnName,
      kind: languages.CompletionItemKind.Field,
      sortText: `${sortPrefix}${columnName}`,
    },
    columnName,
    quoteIdentifiers
  )
}

function routineItem(
  name: string,
  type: 'FUNCTION' | 'PROCEDURE',
  sortPrefix = SORT_PREFIX_NEUTRAL,
  quoteIdentifiers = false
): QuotedItem {
  return applyQuoting(
    {
      label: name,
      kind:
        type === 'FUNCTION'
          ? languages.CompletionItemKind.Function
          : languages.CompletionItemKind.Module,
      sortText: `${sortPrefix}${name}`,
    },
    name,
    quoteIdentifiers
  )
}

function snippetToItem(
  snippet: CompletionSnippet,
  sortPrefix = SORT_PREFIX_NEUTRAL
): ICompletionItem {
  const insertText =
    snippet.insertText ??
    (typeof snippet.body === 'string' ? snippet.body : snippet.body.join('\n'))
  return {
    label: { label: snippet.label, description: snippet.description },
    kind: languages.CompletionItemKind.Snippet,
    insertText: insertText,
    insertTextRules: languages.CompletionItemInsertTextRule.InsertAsSnippet,
    sortText: `${sortPrefix}${snippet.label}`,
  }
}

function shouldIncludeSnippet(snippet: CompletionSnippet): boolean {
  return /^[A-Z][A-Za-z0-9 ]*$/.test(snippet.label)
}

function mapSnippetsToItems(
  snippets: CompletionSnippet[] | undefined,
  sortPrefix = SORT_PREFIX_NEUTRAL
): ICompletionItem[] {
  if (!snippets) return []

  return snippets.filter(shouldIncludeSnippet).map((snippet) => snippetToItem(snippet, sortPrefix))
}

// ---------------------------------------------------------------------------
// Helper: detect dotted prefix before the current word (for manual invoke)
// ---------------------------------------------------------------------------

/**
 * Returns true when the text immediately before the current word (at the
 * cursor position) ends with a dot — e.g. `users.em|` where `|` is the
 * cursor.  This lets dot-notation handling fire even when the user
 * manually invokes autocomplete (Ctrl+Space) instead of typing `.`.
 */
function hasDottedPrefixBeforeWord(model: editor.IReadOnlyModel, position: Position): boolean {
  const lineContent = model.getLineContent(position.lineNumber)
  const wordInfo = model.getWordUntilPosition(position)
  const textBeforeWord = lineContent.substring(0, wordInfo.startColumn - 1)
  // Check if text before current word ends with "word." pattern
  return /[\w`"']\.\s*$/.test(textBeforeWord)
}

type SchemaCache = ReturnType<typeof getCache>
type AliasTarget = NonNullable<ReturnType<AliasMap['get']>>

const DOT_PREFIX_PATTERN = /(?:([\w`"']+)\.)?([\w`"']+)\.\s*$/
const IDENTIFIER_QUOTE_CHARACTERS = /[`"']/g
const WILDCARD_FOLLOW_UP_KEYWORDS = ['FROM']

function resolveActiveDatabase(connectionId: string | undefined): string | null {
  if (!connectionId) return null
  const activeConnection = useConnectionStore.getState().activeConnections[connectionId]
  return activeConnection?.sessionDatabase ?? activeConnection?.profile.defaultDatabase ?? null
}

function hasParserKeywords(suggestions: Suggestions | null): suggestions is Suggestions {
  return suggestions !== null && suggestions.keywords.length > 0
}

function hasUsableSuggestions(suggestions: Suggestions | null): suggestions is Suggestions {
  if (suggestions === null) return false
  return suggestions.syntax.length > 0 || suggestions.keywords.length > 0
}

function schemaUnavailableItems(): ICompletionItem[] {
  return [
    {
      label: 'Schema unavailable',
      kind: languages.CompletionItemKind.Text,
      insertText: '',
      sortText: '0',
    },
  ]
}

interface CaretText {
  statementPrefix: string
  statementText: string
  cursorPrefix: string
  currentWordPrefix: string
}

interface ConnectionlessCompletionRequest {
  suggestions: Suggestions | null
  caret: CaretText
  snippets: CompletionSnippet[] | undefined
}

function buildConnectionlessCompletions(
  request: ConnectionlessCompletionRequest
): ICompletionItem[] {
  const { suggestions, caret } = request
  const items: ICompletionItem[] = []
  if (!hasParserKeywords(suggestions)) {
    pushFallbackKeywordsAndFunctions(items)
    items.push(...mapSnippetsToItems(request.snippets))
    return items
  }
  items.push(...suggestions.keywords.map((keyword) => keywordItem(keyword)))
  pushStoredProgramBodyKeywords(
    items,
    caret.cursorPrefix,
    suggestions,
    caret.currentWordPrefix,
    suggestions.keywords
  )
  if (hasFunctionContext(suggestions)) {
    pushBuiltinFunctions(items, null)
  }
  items.push(...mapSnippetsToItems(request.snippets))
  return items
}

export const completionService: CompletionService = async (
  model: editor.IReadOnlyModel,
  position: Position,
  completionContext: languages.CompletionContext,
  suggestions: Suggestions | null,
  entities: EntityContext[] | null,
  snippets?: CompletionSnippet[]
): Promise<ICompletionItem[]> => {
  const quoteIdentifiers =
    useSettingsStore.getState().getSetting('editor.autocompleteBackticks') === 'true'
  const connectionId = modelConnections.get(model.uri.toString())?.connectionId
  const activeDatabase = resolveActiveDatabase(connectionId)
  const selectedDatabase = getSelectedDatabase(connectionId)
  const resolutionDatabase = activeDatabase ?? selectedDatabase
  const broadSuggestionDatabase = selectedDatabase ?? activeDatabase
  const caret: CaretText = {
    statementPrefix: getCurrentStatementPrefix(model, position),
    statementText: getCurrentStatementText(model, position),
    cursorPrefix: getCursorPrefix(model, position),
    currentWordPrefix: getCurrentWordPrefix(model, position),
  }
  const aliasMap = buildAliasMap(entities, resolutionDatabase)

  if (!connectionId) {
    return buildConnectionlessCompletions({
      suggestions: suggestions,
      caret: caret,
      snippets: snippets,
    })
  }

  // Completion must never await schema loading: Monaco shows "loading..." until this resolves.
  const cache = getCache(connectionId)
  if (cache.status === 'error') {
    return schemaUnavailableItems()
  }

  const dotCompletions = resolveDotCompletions(
    {
      model: model,
      position: position,
      cache: cache,
      aliasMap: aliasMap,
      resolutionDatabase: resolutionDatabase,
      caret: caret,
      quoteIdentifiers: quoteIdentifiers,
    },
    completionContext
  )
  if (dotCompletions !== null) return dotCompletions

  // dt-sql-parser degrades to empty syntax and keywords when it chokes earlier in the statement.
  if (!hasUsableSuggestions(suggestions)) {
    return buildParseFallback({
      cache: cache,
      statementPrefix: caret.statementPrefix,
      selectedDatabase: selectedDatabase,
      broadSuggestionDatabase: broadSuggestionDatabase,
      snippets: snippets,
      quoteIdentifiers: quoteIdentifiers,
    })
  }

  return buildSyntaxCompletions({
    cache: cache,
    suggestions: suggestions,
    entities: entities,
    snippets: snippets,
    caret: caret,
    resolutionDatabase: resolutionDatabase,
    selectedDatabase: selectedDatabase,
    broadSuggestionDatabase: broadSuggestionDatabase,
    quoteIdentifiers: quoteIdentifiers,
  })
}

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

interface SyntaxCompletionRequest {
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
  pushDatabases(
    context.cache.databases,
    context.items,
    context.seenLabels,
    context.sortPrefixes.callSchema,
    context.quoteIdentifiers
  )
}

function pushTableContextItems(context: SyntaxCompletionContext): void {
  const { cache, items, seenLabels, sortPrefixes, quoteIdentifiers } = context
  pushDatabases(cache.databases, items, seenLabels, sortPrefixes.schema, quoteIdentifiers)
  if (!context.selectedDatabase) return
  pushScopedTables(
    cache,
    [context.selectedDatabase],
    items,
    seenLabels,
    sortPrefixes.schema,
    quoteIdentifiers
  )
}

function pushSelectListSchemaItems(
  context: SyntaxCompletionContext,
  fallbackDatabases: readonly string[]
): void {
  const { cache, items, seenLabels, sortPrefixes, quoteIdentifiers } = context
  pushDatabases(cache.databases, items, seenLabels, sortPrefixes.schema, quoteIdentifiers)
  pushScopedTables(
    cache,
    fallbackDatabases,
    items,
    seenLabels,
    sortPrefixes.schema,
    quoteIdentifiers
  )
  pushScopedRoutines(
    cache,
    fallbackDatabases,
    items,
    seenLabels,
    sortPrefixes.schema,
    'FUNCTION',
    quoteIdentifiers
  )
}

function pushColumnContextItems(context: SyntaxCompletionContext): void {
  const scopedTables = findTablesInCaretStatement(
    context.entities,
    context.caret.statementText,
    context.resolutionDatabase
  )
  if (scopedTables.length > 0) {
    for (const tableRef of scopedTables) {
      addColumnsForTable(context, tableRef)
    }
    return
  }

  const fallbackDatabases = scopedSchemaDatabases(context)
  pushScopedColumns(
    context.cache,
    fallbackDatabases,
    context.items,
    context.seenLabels,
    context.sortPrefixes.column,
    context.quoteIdentifiers
  )
  if (context.inSelectListContext) {
    pushSelectListSchemaItems(context, fallbackDatabases)
  }
}

function pushFunctionContextItems(context: SyntaxCompletionContext): void {
  pushBuiltinFunctions(context.items, context.seenLabels, context.sortPrefixes.schema)
  pushScopedRoutines(
    context.cache,
    context.cache.databases,
    context.items,
    context.seenLabels,
    context.sortPrefixes.schema,
    'FUNCTION',
    context.quoteIdentifiers
  )
}

function pushProcedureContextItems(context: SyntaxCompletionContext): void {
  if (context.inCallStatementContext) return
  pushScopedRoutines(
    context.cache,
    scopedSchemaDatabases(context),
    context.items,
    context.seenLabels,
    context.sortPrefixes.schema,
    'PROCEDURE',
    context.quoteIdentifiers
  )
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
  pushDatabases(cache.databases, items, seenLabels, sortPrefixes.callSchema, quoteIdentifiers)
  pushScopedRoutines(
    cache,
    scopedSchemaDatabases(context),
    items,
    seenLabels,
    sortPrefixes.callSchema,
    'PROCEDURE',
    quoteIdentifiers
  )
}

function pushRankedKeywordsAndSnippets(context: SyntaxCompletionContext): void {
  const { items, suggestions, caret, sortPrefixes } = context
  for (const keyword of suggestions.keywords) {
    items.push(keywordItem(keyword, sortPrefixes.keyword))
  }
  pushStoredProgramBodyKeywords(
    items,
    caret.cursorPrefix,
    suggestions,
    caret.currentWordPrefix,
    suggestions.keywords,
    sortPrefixes.keyword
  )
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

function buildSyntaxCompletions(request: SyntaxCompletionRequest): ICompletionItem[] {
  const statementPrefix = request.caret.statementPrefix
  const isColumnContext = hasColumnContext(request.suggestions)
  const inCallStatementContext = isCallStatementContext(statementPrefix)
  const sortPrefixes = resolveSortPrefixes({
    isColumnContext: isColumnContext,
    isTableContext: hasTableContext(request.suggestions),
    inCallStatementContext: inCallStatementContext,
  })

  if (isColumnContext && isAfterSelectWildcard(statementPrefix)) {
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

interface DotNotationRequest {
  model: editor.IReadOnlyModel
  position: Position
  cache: SchemaCache
  aliasMap: AliasMap
  resolutionDatabase: string | null
  caret: CaretText
  quoteIdentifiers: boolean
}

interface DotTarget {
  qualifiedDatabase: string | null
  tablePart: string
  prefixLower: string
}

function resolveDotCompletions(
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

function resolveAliasTarget(
  request: DotNotationRequest,
  prefixLower: string
): AliasTarget | undefined {
  if (isInTableReferenceClause(request.caret.statementPrefix)) return undefined
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
  routineType: 'FUNCTION' | 'PROCEDURE'
): Array<{ name: string }> {
  const routines = cache.routines[database] ?? []
  return routines.filter((routine) => routine.routineType === routineType)
}

function databaseDotCompletions(request: DotNotationRequest, database: string): ICompletionItem[] {
  const { cache, quoteIdentifiers } = request
  const statementPrefix = request.caret.statementPrefix
  if (isCallStatementContext(statementPrefix)) {
    return routinesOfType(cache, database, 'PROCEDURE').map((routine) =>
      routineItem(routine.name, 'PROCEDURE', SORT_PREFIX_NEUTRAL, quoteIdentifiers)
    )
  }
  const tables = cache.tables[database] ?? []
  const items = tables.map((table) => tableItem(table.name, SORT_PREFIX_NEUTRAL, quoteIdentifiers))
  if (isInTableReferenceClause(statementPrefix)) return items
  const functions = routinesOfType(cache, database, 'FUNCTION').map((routine) =>
    routineItem(routine.name, 'FUNCTION', SORT_PREFIX_NEUTRAL, quoteIdentifiers)
  )
  return [...items, ...functions]
}

function databaseSearchOrder(
  databases: readonly string[],
  preferredDatabase: string | null
): readonly string[] {
  if (!preferredDatabase) return databases
  return [preferredDatabase, ...databases.filter((database) => database !== preferredDatabase)]
}

function findTableByLowerName(
  cache: SchemaCache,
  database: string,
  tableNameLower: string
): { name: string } | undefined {
  const tables = cache.tables[database] ?? []
  return tables.find((table) => table.name.toLowerCase() === tableNameLower)
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

function handleDotNotation(request: DotNotationRequest): ICompletionItem[] | null {
  const { cache, quoteIdentifiers } = request
  if (cache.status !== 'ready') return null
  const dotMatch = matchDotPrefix(request.model, request.position)
  if (!dotMatch) return null
  const target = parseDotTarget(dotMatch)

  const aliasTarget = resolveAliasTarget(request, target.prefixLower)
  if (aliasTarget) {
    const tableKey = `${aliasTarget.database}.${aliasTarget.table}`
    return columnCompletionItems(cache, tableKey, quoteIdentifiers)
  }

  const matchedDatabase = cache.databases.find(
    (database) => database.toLowerCase() === target.prefixLower
  )
  if (matchedDatabase) return databaseDotCompletions(request, matchedDatabase)
  if (isInTableReferenceClause(request.caret.statementPrefix)) return null
  return tableDotCompletions(request, target)
}

function isCaretStatementTable(entity: EntityContext): boolean {
  return (
    entity.entityContextType === EntityContextType.TABLE &&
    entity.belongStmt?.isContainCaret === true
  )
}

function findTablesInCaretStatement(
  entities: EntityContext[] | null,
  currentStatementText: string,
  resolutionDatabase: string | null
): TableRef[] {
  const tableRefs: TableRef[] = []

  for (const entity of entities ?? []) {
    if (!isCaretStatementTable(entity) || !entity.text) continue
    const tableRef = parseTableRefText(entity.text)
    if (!tableRef) continue
    tableRefs.push(tableRef)
  }

  if (tableRefs.length > 0) return tableRefs

  return findTablesInStatementText(currentStatementText, resolutionDatabase)
}

function parseTableRefText(text: string): TableRef | null {
  if (text.includes('.')) {
    const parts = text.split('.')
    const database = stripQuotes(parts[0].trim())
    const table = stripQuotes(parts[parts.length - 1].trim())
    if (!database || !table) return null
    return { database, table }
  }

  const table = stripQuotes(text.trim())
  if (!table) return null
  return { database: null, table: table }
}

function findTablesInStatementText(
  currentStatementText: string,
  resolutionDatabase: string | null
): TableRef[] {
  const tableRefs: TableRef[] = []
  const seen = new Set<string>()
  const pattern = /\b(?:FROM|JOIN|UPDATE|INTO)\s+([\w`"']+(?:\s*\.\s*[\w`"']+)?)/gi

  let match: RegExpExecArray | null
  while ((match = pattern.exec(currentStatementText)) !== null) {
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

interface ParseFallbackRequest {
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

function pushAllFallbackSchemaItems(context: ParseFallbackContext): void {
  const { cache, items, seenLabels, fallbackDatabases, quoteIdentifiers } = context
  const databaseSortPrefix = context.inCallStatementContext ? SORT_PREFIX_HIGH : SORT_PREFIX_NEUTRAL
  pushDatabases(cache.databases, items, seenLabels, databaseSortPrefix, quoteIdentifiers)

  if (context.inCallStatementContext) {
    pushScopedRoutines(
      cache,
      fallbackDatabases,
      items,
      seenLabels,
      SORT_PREFIX_HIGH,
      'PROCEDURE',
      quoteIdentifiers
    )
    return
  }

  pushScopedTables(
    cache,
    fallbackDatabases,
    items,
    seenLabels,
    SORT_PREFIX_NEUTRAL,
    quoteIdentifiers
  )
  pushScopedColumns(
    cache,
    fallbackDatabases,
    items,
    seenLabels,
    SORT_PREFIX_NEUTRAL,
    quoteIdentifiers
  )
  const routineType = context.inSelectListContext ? 'FUNCTION' : null
  pushScopedRoutines(
    cache,
    fallbackDatabases,
    items,
    seenLabels,
    SORT_PREFIX_NEUTRAL,
    routineType,
    quoteIdentifiers
  )
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

function buildParseFallback(request: ParseFallbackRequest): ICompletionItem[] {
  const { cache, statementPrefix } = request
  const items: ICompletionItem[] = []

  if (cache.status !== 'ready') {
    pushFallbackKeywordsAndFunctions(items)
    items.push(...mapSnippetsToItems(request.snippets))
    return items
  }

  const mode = getParseFallbackMode(statementPrefix, cache.databases, request.selectedDatabase)
  if (mode.type === 'none') {
    return []
  }

  const inSelectListContext = isSelectListContext(statementPrefix)
  const inCallStatementContext = isCallStatementContext(statementPrefix)
  const usesScopedDatabases = inSelectListContext || inCallStatementContext
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
