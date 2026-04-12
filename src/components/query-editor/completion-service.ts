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
import { getCache, getPendingLoad, loadCache } from './schema-metadata-cache'
import { buildAliasMap, buildAliasMapFromText, stripQuotes } from './alias-resolver'
import type { AliasMap } from './alias-resolver'
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
    connectionId,
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
  return suggestions.syntax.some((s) => s.syntaxContextType === EntityContextType.COLUMN)
}

function hasTableContext(suggestions: Suggestions): boolean {
  return suggestions.syntax.some((s) => s.syntaxContextType === EntityContextType.TABLE)
}

function hasFunctionContext(suggestions: Suggestions): boolean {
  return suggestions.syntax.some((s) => s.syntaxContextType === EntityContextType.FUNCTION)
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
    } else if (upperToken === 'END' && depth > 0) {
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
  } catch {
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

function builtinFunctionItem(fn: string, sortPrefix = SORT_PREFIX_NEUTRAL): ICompletionItem {
  return {
    label: fn,
    kind: languages.CompletionItemKind.Function,
    insertText: fn,
    sortText: `${sortPrefix}${fn}`,
  }
}

function pushBuiltinFunctions(
  items: ICompletionItem[],
  seenLabels: Set<string> | null,
  sortPrefix = SORT_PREFIX_NEUTRAL
): void {
  for (const fn of SQL_BUILTIN_FUNCTIONS) {
    if (seenLabels && seenLabels.has(`fn:${fn}`)) {
      continue
    }

    seenLabels?.add(`fn:${fn}`)
    items.push(builtinFunctionItem(fn, sortPrefix))
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

  for (const fn of SQL_BUILTIN_FUNCTIONS) {
    if (seenLabels.has(fn)) {
      continue
    }

    seenLabels.add(fn)
    items.push(builtinFunctionItem(fn, sortPrefix))
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
      const cols = cache.columns[`${db}.${table.name}`] ?? []
      for (const col of cols) {
        if (seenLabels.has(`col:${col.name}`)) {
          continue
        }

        seenLabels.add(`col:${col.name}`)
        items.push(columnItem(col.name, sortPrefix, quoteIdentifiers))
      }
    }
  }
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
      if (routineType && routine.routineType !== routineType) {
        continue
      }

      const routineKey =
        routine.routineType === 'FUNCTION' ? `fn:${routine.name}` : `proc:${routine.name}`

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
  colName: string,
  sortPrefix = SORT_PREFIX_NEUTRAL,
  quoteIdentifiers = false
): QuotedItem {
  return applyQuoting(
    {
      label: colName,
      kind: languages.CompletionItemKind.Field,
      sortText: `${sortPrefix}${colName}`,
    },
    colName,
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
    insertText,
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

// ---------------------------------------------------------------------------
// completionService implementation
// ---------------------------------------------------------------------------

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

  // -------------------------------------------------------------------
  // Resolve the active database for alias resolution
  // -------------------------------------------------------------------
  const activeDatabase = connectionId
    ? (useConnectionStore.getState().activeConnections[connectionId]?.sessionDatabase ??
      useConnectionStore.getState().activeConnections[connectionId]?.profile.defaultDatabase ??
      null)
    : null
  const selectedDatabase = getSelectedDatabase(connectionId)
  const resolutionDatabase = activeDatabase ?? selectedDatabase
  const broadSuggestionDatabase = selectedDatabase ?? activeDatabase
  const currentStatementPrefix = getCurrentStatementPrefix(model, position)
  const currentStatementText = getCurrentStatementText(model, position)
  const cursorPrefix = getCursorPrefix(model, position)
  const currentWordPrefix = getCurrentWordPrefix(model, position)

  // Build alias map from entities (pure function — no side effects)
  const aliasMap = buildAliasMap(entities, resolutionDatabase)

  // -------------------------------------------------------------------
  // Await pending cache loads (must happen BEFORE parse-failure check
  // so buildParseFallback() can access schema items when the cache is
  // still loading at the time the parser fails).
  // -------------------------------------------------------------------
  if (connectionId) {
    const pendingLoad = getPendingLoad(connectionId)
    if (pendingLoad) {
      await pendingLoad
    }
    const earlyCache = getCache(connectionId)
    // If the cache is still empty (useEffect hasn't fired loadCache yet),
    // trigger a load now and await it. This prevents a race where the
    // completionService fires before React's useEffect schedules the load.
    if (earlyCache.status === 'empty') {
      await loadCache(connectionId)
    }
  }

  // -------------------------------------------------------------------
  // -------------------------------------------------------------------
  // No connectionId → keywords + built-in functions (neutral ranking).
  // Fall back to SQL_KEYWORDS when parser provides empty keywords list.
  // -------------------------------------------------------------------
  if (!connectionId) {
    const items: ICompletionItem[] = []

    if (suggestions?.keywords.length) {
      items.push(...suggestions.keywords.map((kw) => keywordItem(kw)))
      pushStoredProgramBodyKeywords(
        items,
        cursorPrefix,
        suggestions,
        currentWordPrefix,
        suggestions.keywords
      )
    } else {
      pushFallbackKeywordsAndFunctions(items)
    }

    // Include built-in functions during keyword fallback and explicit function context.
    if (suggestions?.keywords.length && suggestions && hasFunctionContext(suggestions)) {
      pushBuiltinFunctions(items, null)
    }

    items.push(...mapSnippetsToItems(snippets))
    return items
  }

  // -------------------------------------------------------------------
  // Look up cache — already loaded/awaited above, so this just reads
  // the current state.
  // -------------------------------------------------------------------
  const cache = getCache(connectionId)

  if (cache.status === 'loading') {
    return [
      {
        label: 'Loading schema...',
        kind: languages.CompletionItemKind.Text,
        insertText: '',
        sortText: '0',
      },
    ]
  }

  if (cache.status === 'error') {
    return [
      {
        label: 'Schema unavailable',
        kind: languages.CompletionItemKind.Text,
        insertText: '',
        sortText: '0',
      },
    ]
  }

  // -------------------------------------------------------------------
  // Dot notation handling (includes alias resolution)
  // Triggers on explicit '.' keypress OR when the text before the
  // current word already contains a dot (e.g. manual Ctrl+Space on
  // "users.em" should still resolve "users." columns).
  // -------------------------------------------------------------------
  const isDotContext =
    completionContext.triggerCharacter === '.' || hasDottedPrefixBeforeWord(model, position)

  if (isDotContext) {
    const dotResult = handleDotNotation(
      model,
      position,
      connectionId,
      aliasMap,
      resolutionDatabase,
      currentStatementPrefix,
      currentStatementText,
      quoteIdentifiers
    )
    if (dotResult !== null) return dotResult
    if (isInTableReferenceClause(currentStatementPrefix)) {
      return []
    }
  }

  // -------------------------------------------------------------------
  // Parse-failure fallback: suggestions is null when the parser fails.
  // Cache is now ready (if available) so buildParseFallback can include
  // schema items.
  // -------------------------------------------------------------------
  if (suggestions === null) {
    return buildParseFallback(
      connectionId,
      currentStatementPrefix,
      selectedDatabase,
      broadSuggestionDatabase,
      snippets,
      quoteIdentifiers
    )
  }

  // -------------------------------------------------------------------
  // Normal flow: map syntax context types to schema items
  // Context-aware ranking: in column context, columns get priority '0_',
  // other schema items get '1_', and keywords/snippets get '2_'.
  // Outside column context, everything gets neutral '1_'.
  // -------------------------------------------------------------------
  const items: ICompletionItem[] = []
  const seenLabels = new Set<string>()
  const isColumnContext = hasColumnContext(suggestions)
  const isTableContext = hasTableContext(suggestions)
  const inSelectListContext = isSelectListContext(currentStatementPrefix)
  const inCallStatementContext = isCallStatementContext(currentStatementPrefix)
  const afterSelectWildcard = isAfterSelectWildcard(currentStatementPrefix)

  // In column context: columns='0_', other schema='1_', keywords/snippets='2_'
  // Otherwise: everything='1_' (neutral)
  const columnSortPrefix = isColumnContext ? SORT_PREFIX_HIGH : SORT_PREFIX_NEUTRAL
  const schemaSortPrefix = isTableContext ? SORT_PREFIX_HIGH : SORT_PREFIX_NEUTRAL
  const callSchemaSortPrefix = inCallStatementContext ? SORT_PREFIX_HIGH : schemaSortPrefix
  const kwSortPrefix =
    isColumnContext || isTableContext || inCallStatementContext
      ? SORT_PREFIX_LOW
      : SORT_PREFIX_NEUTRAL
  const snippetSortPrefix =
    isColumnContext || isTableContext || inCallStatementContext
      ? SORT_PREFIX_LOW
      : SORT_PREFIX_NEUTRAL

  if (isColumnContext && afterSelectWildcard) {
    const keywordLabels = suggestions.keywords.length > 0 ? suggestions.keywords : ['FROM']

    for (const kw of keywordLabels) {
      items.push(keywordItem(kw, kwSortPrefix))
    }

    items.push(...mapSnippetsToItems(snippets, snippetSortPrefix))
    return items
  }

  for (const syntaxSuggestion of suggestions.syntax) {
    const ctxType = syntaxSuggestion.syntaxContextType

    if (ctxType === EntityContextType.DATABASE) {
      pushDatabases(
        cache.databases,
        items,
        seenLabels,
        inCallStatementContext ? callSchemaSortPrefix : schemaSortPrefix,
        quoteIdentifiers
      )
    } else if (ctxType === EntityContextType.TABLE) {
      pushDatabases(cache.databases, items, seenLabels, schemaSortPrefix, quoteIdentifiers)

      if (selectedDatabase) {
        pushScopedTables(
          cache,
          [selectedDatabase],
          items,
          seenLabels,
          schemaSortPrefix,
          quoteIdentifiers
        )
      }
    } else if (ctxType === EntityContextType.COLUMN) {
      // Try to scope columns by tables in the current caret statement
      const scopedTables = findTablesInCaretStatement(
        entities,
        currentStatementText,
        resolutionDatabase
      )
      if (scopedTables.length > 0) {
        for (const tableRef of scopedTables) {
          addColumnsForTable(
            cache,
            tableRef,
            items,
            seenLabels,
            columnSortPrefix,
            resolutionDatabase,
            quoteIdentifiers
          )
        }
      } else {
        // Broad fallback: prefer the current database context, otherwise all databases.
        const fallbackDatabases = getScopedSchemaDatabases(cache.databases, broadSuggestionDatabase)

        pushScopedColumns(
          cache,
          fallbackDatabases,
          items,
          seenLabels,
          columnSortPrefix,
          quoteIdentifiers
        )

        if (inSelectListContext) {
          pushDatabases(cache.databases, items, seenLabels, schemaSortPrefix, quoteIdentifiers)
          pushScopedTables(
            cache,
            fallbackDatabases,
            items,
            seenLabels,
            schemaSortPrefix,
            quoteIdentifiers
          )
          pushScopedRoutines(
            cache,
            fallbackDatabases,
            items,
            seenLabels,
            schemaSortPrefix,
            'FUNCTION',
            quoteIdentifiers
          )
        }
      }
    } else if (ctxType === EntityContextType.FUNCTION) {
      pushBuiltinFunctions(items, seenLabels, schemaSortPrefix)
      pushScopedRoutines(
        cache,
        cache.databases,
        items,
        seenLabels,
        schemaSortPrefix,
        'FUNCTION',
        quoteIdentifiers
      )
    } else if (ctxType === EntityContextType.PROCEDURE) {
      if (!inCallStatementContext) {
        const fallbackDatabases = getScopedSchemaDatabases(cache.databases, broadSuggestionDatabase)

        pushScopedRoutines(
          cache,
          fallbackDatabases,
          items,
          seenLabels,
          schemaSortPrefix,
          'PROCEDURE',
          quoteIdentifiers
        )
      }
    }
  }

  if (inCallStatementContext) {
    const fallbackDatabases = getScopedSchemaDatabases(cache.databases, broadSuggestionDatabase)

    pushDatabases(cache.databases, items, seenLabels, callSchemaSortPrefix, quoteIdentifiers)
    pushScopedRoutines(
      cache,
      fallbackDatabases,
      items,
      seenLabels,
      callSchemaSortPrefix,
      'PROCEDURE',
      quoteIdentifiers
    )
  }

  // Keywords (ranked lower in column context, neutral otherwise)
  for (const kw of suggestions.keywords) {
    items.push(keywordItem(kw, kwSortPrefix))
  }

  pushStoredProgramBodyKeywords(
    items,
    cursorPrefix,
    suggestions,
    currentWordPrefix,
    suggestions.keywords,
    kwSortPrefix
  )

  // Snippets (ranked same as keywords)
  items.push(...mapSnippetsToItems(snippets, snippetSortPrefix))

  return items
}

// ---------------------------------------------------------------------------
// Dot notation: "alias." → columns, "database." → tables, "table." → columns
// ---------------------------------------------------------------------------

function handleDotNotation(
  model: editor.IReadOnlyModel,
  position: Position,
  connectionId: string,
  aliasMap: AliasMap,
  resolutionDatabase: string | null,
  currentStatementPrefix: string,
  currentStatementText: string,
  quoteIdentifiers = false
): ICompletionItem[] | null {
  const cache = getCache(connectionId)
  if (cache.status !== 'ready') return null

  // Get text before the cursor on the current line
  const lineContent = model.getLineContent(position.lineNumber)
  const textBefore = lineContent.substring(0, position.column - 1)

  // Match optional "db." prefix before "word." pattern at end of text.
  // Group 1: optional database qualifier (e.g. "analytics_db" in "analytics_db.events.")
  // Group 2: the word immediately before the trailing dot
  let dotMatch = textBefore.match(/(?:([\w`"']+)\.)?([\w`"']+)\.\s*$/)

  // If no match, the cursor may be in a partial word after a dot (e.g. "users.em|").
  // Strip the current partial word to reveal the dot pattern.
  if (!dotMatch) {
    const wordInfo = model.getWordUntilPosition(position)
    const textBeforeWord = lineContent.substring(0, wordInfo.startColumn - 1)
    dotMatch = textBeforeWord.match(/(?:([\w`"']+)\.)?([\w`"']+)\.\s*$/)
  }

  if (!dotMatch) return null

  // Extract parts — qualifiedDb is set only for "db.table." syntax
  const qualifiedDb = dotMatch[1] ? dotMatch[1].replace(/[`"']/g, '') : null
  const tablePart = dotMatch[2].replace(/[`"']/g, '')
  const prefixLower = tablePart.toLowerCase()

  // 1. Check entity-based alias map first (case-insensitive)
  const aliasResolution = aliasMap.get(prefixLower)
  if (aliasResolution && !isInTableReferenceClause(currentStatementPrefix)) {
    const cols = cache.columns[`${aliasResolution.database}.${aliasResolution.table}`] ?? []
    return cols.map((col) => columnItem(col.name, SORT_PREFIX_NEUTRAL, quoteIdentifiers))
  }

  // 1b. Text-based alias fallback: when the parser doesn't provide entities,
  //     extract aliases from the current statement so aliases declared later
  //     in the same statement still resolve while avoiding cross-statement bleed.
  const textAliasMap = buildAliasMapFromText(currentStatementText, resolutionDatabase)
  const textAliasResolution = textAliasMap.get(prefixLower)
  if (textAliasResolution && !isInTableReferenceClause(currentStatementPrefix)) {
    const cols = cache.columns[`${textAliasResolution.database}.${textAliasResolution.table}`] ?? []
    return cols.map((col) => columnItem(col.name, SORT_PREFIX_NEUTRAL, quoteIdentifiers))
  }

  // 2. Check if it's a database name → suggest that db's tables
  const matchedDb = cache.databases.find((db) => db.toLowerCase() === prefixLower)
  if (matchedDb) {
    const items: ICompletionItem[] = []

    if (isCallStatementContext(currentStatementPrefix)) {
      const routines = cache.routines[matchedDb] ?? []
      items.push(
        ...routines
          .filter((routine) => routine.routineType === 'PROCEDURE')
          .map((routine) =>
            routineItem(routine.name, 'PROCEDURE', SORT_PREFIX_NEUTRAL, quoteIdentifiers)
          )
      )

      return items
    }

    const tables = cache.tables[matchedDb] ?? []
    items.push(
      ...tables.map((table) => tableItem(table.name, SORT_PREFIX_NEUTRAL, quoteIdentifiers))
    )

    if (isInTableReferenceClause(currentStatementPrefix)) {
      return items
    }

    const routines = cache.routines[matchedDb] ?? []
    items.push(
      ...routines
        .filter((routine) => routine.routineType === 'FUNCTION')
        .map((routine) =>
          routineItem(
            routine.name,
            routine.routineType as 'FUNCTION' | 'PROCEDURE',
            SORT_PREFIX_NEUTRAL,
            quoteIdentifiers
          )
        )
    )

    return items
  }

  if (isInTableReferenceClause(currentStatementPrefix)) {
    return null
  }

  // 3. Check if it's a table name → suggest that table's columns.
  //    When qualifiedDb is set (db.table. syntax), do an exact lookup
  //    to avoid ambiguity with duplicate table names across databases.
  //    When unqualified, prefer resolutionDatabase to avoid picking a
  //    same-named table from the wrong database.
  if (qualifiedDb) {
    const cols = cache.columns[`${qualifiedDb}.${tablePart}`] ?? []
    if (cols.length > 0) {
      return cols.map((col) => columnItem(col.name, SORT_PREFIX_NEUTRAL, quoteIdentifiers))
    }

    return null
  }
  const searchOrder = resolutionDatabase
    ? [resolutionDatabase, ...cache.databases.filter((db) => db !== resolutionDatabase)]
    : cache.databases

  for (const db of searchOrder) {
    const tables = cache.tables[db] ?? []
    const matchedTable = tables.find((t) => t.name.toLowerCase() === prefixLower)
    if (matchedTable) {
      const cols = cache.columns[`${db}.${matchedTable.name}`] ?? []
      return cols.map((col) => columnItem(col.name, SORT_PREFIX_NEUTRAL, quoteIdentifiers))
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Find TABLE entities in the statement containing the caret
// ---------------------------------------------------------------------------

function findTablesInCaretStatement(
  entities: EntityContext[] | null,
  currentStatementText: string,
  resolutionDatabase: string | null
): TableRef[] {
  const tableRefs: TableRef[] = []

  if (entities) {
    for (const entity of entities) {
      if (
        entity.entityContextType === EntityContextType.TABLE &&
        entity.belongStmt?.isContainCaret
      ) {
        const text = entity.text
        if (!text) continue
        const tableRef = parseTableRefText(text)
        if (!tableRef) continue
        tableRefs.push(tableRef)
      }
    }
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
  return { database: null, table }
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

// ---------------------------------------------------------------------------
// Add columns for a table reference (exact lookup when database is provided,
// falls back to searching all databases when database is null)
// ---------------------------------------------------------------------------

function addColumnsForTable(
  cache: ReturnType<typeof getCache>,
  tableRef: TableRef,
  items: ICompletionItem[],
  seenLabels: Set<string>,
  sortPrefix = SORT_PREFIX_NEUTRAL,
  resolutionDatabase: string | null = null,
  quoteIdentifiers = false
): void {
  if (tableRef.database) {
    // Exact lookup: database is known
    const cols = cache.columns[`${tableRef.database}.${tableRef.table}`] ?? []
    for (const col of cols) {
      if (!seenLabels.has(`col:${col.name}`)) {
        seenLabels.add(`col:${col.name}`)
        items.push(columnItem(col.name, sortPrefix, quoteIdentifiers))
      }
    }
  } else {
    // Fallback: search all databases for matching table name,
    // preferring resolutionDatabase to avoid picking a same-named table
    // from the wrong database.
    const searchOrder = resolutionDatabase
      ? [resolutionDatabase, ...cache.databases.filter((db) => db !== resolutionDatabase)]
      : cache.databases

    for (const db of searchOrder) {
      const tables = cache.tables[db] ?? []
      const matchedTable = tables.find((t) => t.name.toLowerCase() === tableRef.table.toLowerCase())
      if (matchedTable) {
        const cols = cache.columns[`${db}.${matchedTable.name}`] ?? []
        for (const col of cols) {
          if (!seenLabels.has(`col:${col.name}`)) {
            seenLabels.add(`col:${col.name}`)
            items.push(columnItem(col.name, sortPrefix, quoteIdentifiers))
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Parse-failure fallback: dump everything from cache + basic keywords
// ---------------------------------------------------------------------------

function buildParseFallback(
  connectionId: string | undefined,
  currentStatementPrefix: string,
  selectedDatabase: string | null,
  broadSuggestionDatabase: string | null,
  snippets?: CompletionSnippet[],
  quoteIdentifiers = false
): ICompletionItem[] {
  const items: ICompletionItem[] = []

  // If we have a connection, dump all schema items
  if (connectionId) {
    const cache = getCache(connectionId)
    if (cache.status === 'ready') {
      const mode = getParseFallbackMode(currentStatementPrefix, cache.databases, selectedDatabase)
      const inSelectListContext = isSelectListContext(currentStatementPrefix)
      const inCallStatementContext = isCallStatementContext(currentStatementPrefix)
      const fallbackDatabases =
        inSelectListContext || inCallStatementContext
          ? getScopedSchemaDatabases(cache.databases, broadSuggestionDatabase)
          : cache.databases
      const seenLabels = new Set<string>()

      if (mode.type === 'none') {
        return []
      }

      const keywordSortPrefix = inCallStatementContext
        ? SORT_PREFIX_LOW
        : mode.type === 'databases' || mode.type === 'databasesAndTables'
          ? SORT_PREFIX_LOW
          : SORT_PREFIX_NEUTRAL

      if (inCallStatementContext) {
        for (const kw of SQL_KEYWORDS) {
          items.push(keywordItem(kw, keywordSortPrefix))
        }
      } else {
        // Basic keywords and built-in functions (ranked lower when database/table context detected)
        pushFallbackKeywordsAndFunctions(items, keywordSortPrefix)
      }

      if (mode.type === 'databases') {
        for (const db of cache.databases) {
          items.push(dbItem(db, SORT_PREFIX_HIGH, quoteIdentifiers))
        }
      } else if (mode.type === 'databasesAndTables') {
        for (const db of cache.databases) {
          items.push(dbItem(db, SORT_PREFIX_HIGH, quoteIdentifiers))
        }

        const tables = cache.tables[mode.database] ?? []
        for (const table of tables) {
          items.push(tableItem(table.name, SORT_PREFIX_HIGH, quoteIdentifiers))
        }
      } else if (mode.type === 'tables') {
        const tables = cache.tables[mode.database] ?? []
        for (const table of tables) {
          items.push(tableItem(table.name, SORT_PREFIX_NEUTRAL, quoteIdentifiers))
        }
      } else if (mode.type === 'all') {
        pushDatabases(
          cache.databases,
          items,
          seenLabels,
          inCallStatementContext ? SORT_PREFIX_HIGH : SORT_PREFIX_NEUTRAL,
          quoteIdentifiers
        )

        if (inCallStatementContext) {
          pushScopedRoutines(
            cache,
            fallbackDatabases,
            items,
            seenLabels,
            SORT_PREFIX_HIGH,
            'PROCEDURE',
            quoteIdentifiers
          )
        } else {
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

          if (inSelectListContext) {
            pushScopedRoutines(
              cache,
              fallbackDatabases,
              items,
              seenLabels,
              SORT_PREFIX_NEUTRAL,
              'FUNCTION',
              quoteIdentifiers
            )
          } else {
            pushScopedRoutines(
              cache,
              fallbackDatabases,
              items,
              seenLabels,
              SORT_PREFIX_NEUTRAL,
              null,
              quoteIdentifiers
            )
          }
        }
      }
    }
  } else {
    // Basic keywords and built-in functions (neutral ranking in fallback — no context available)
    pushFallbackKeywordsAndFunctions(items)
  }

  // Snippets
  items.push(...mapSnippetsToItems(snippets))

  return items
}
