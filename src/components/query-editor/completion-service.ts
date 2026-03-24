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
import { SQL_KEYWORDS } from './sql-keywords'

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** A parsed table reference that may include a database qualifier. */
interface TableRef {
  database: string | null
  table: string
}

// ---------------------------------------------------------------------------
// Model-URI → connectionId registry
// ---------------------------------------------------------------------------

const modelConnections = new Map<string, string>()

export function registerModelConnection(uri: string, connectionId: string): void {
  modelConnections.set(uri, connectionId)
}

export function unregisterModelConnection(uri: string): void {
  modelConnections.delete(uri)
}

/** Reset all model-connection mappings. For test cleanup only. */
export function resetModelConnections(): void {
  modelConnections.clear()
}

// Basic SQL keywords imported from ./sql-keywords (SQL_KEYWORDS)

// ---------------------------------------------------------------------------
// Context-aware sort prefixes
// ---------------------------------------------------------------------------

/** Highest priority — shown first (e.g. columns in column context). */
const SORT_PREFIX_HIGH = '0_'
/** Neutral priority — default tier for all items outside of ranked contexts. */
const SORT_PREFIX_NEUTRAL = '1_'
/** Lower priority — still shown but ranked below high/neutral (e.g. keywords in column context). */
const SORT_PREFIX_LOW = '2_'

/**
 * Detect whether the parser-provided syntax suggestions indicate a column
 * context (e.g. cursor inside WHERE, SELECT-list, HAVING, ON).
 */
function hasColumnContext(suggestions: Suggestions): boolean {
  return suggestions.syntax.some((s) => s.syntaxContextType === EntityContextType.COLUMN)
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

function dbItem(db: string, sortPrefix = SORT_PREFIX_NEUTRAL): ICompletionItem {
  return {
    label: db,
    kind: languages.CompletionItemKind.Module,
    sortText: `${sortPrefix}${db}`,
  }
}

function tableItem(tableName: string, sortPrefix = SORT_PREFIX_NEUTRAL): ICompletionItem {
  return {
    label: tableName,
    kind: languages.CompletionItemKind.Class,
    sortText: `${sortPrefix}${tableName}`,
  }
}

function columnItem(colName: string, sortPrefix = SORT_PREFIX_NEUTRAL): ICompletionItem {
  return {
    label: colName,
    kind: languages.CompletionItemKind.Field,
    sortText: `${sortPrefix}${colName}`,
  }
}

function routineItem(
  name: string,
  type: 'FUNCTION' | 'PROCEDURE',
  sortPrefix = SORT_PREFIX_NEUTRAL
): ICompletionItem {
  return {
    label: name,
    kind:
      type === 'FUNCTION'
        ? languages.CompletionItemKind.Function
        : languages.CompletionItemKind.Module,
    sortText: `${sortPrefix}${name}`,
  }
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
  const connectionId = modelConnections.get(model.uri.toString())

  // -------------------------------------------------------------------
  // Resolve the active database for alias resolution
  // -------------------------------------------------------------------
  const activeDatabase = connectionId
    ? (useConnectionStore.getState().activeConnections[connectionId]?.profile.defaultDatabase ??
      null)
    : null

  // Build alias map from entities (pure function — no side effects)
  const aliasMap = buildAliasMap(entities, activeDatabase)

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
  // Parse-failure fallback: suggestions is null when the parser fails.
  // Cache is now ready (if available) so buildParseFallback can include
  // schema items.
  // -------------------------------------------------------------------
  if (suggestions === null) {
    return buildParseFallback(connectionId, snippets)
  }

  // -------------------------------------------------------------------
  // No connectionId → keywords only (neutral ranking).
  // Fall back to SQL_KEYWORDS when parser provides empty keywords list.
  // -------------------------------------------------------------------
  if (!connectionId) {
    const kwList = suggestions.keywords.length > 0 ? suggestions.keywords : SQL_KEYWORDS
    const items: ICompletionItem[] = kwList.map((kw) => keywordItem(kw))
    if (snippets) {
      items.push(...snippets.map((s) => snippetToItem(s)))
    }
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
    const dotResult = handleDotNotation(model, position, connectionId, aliasMap, activeDatabase)
    if (dotResult.length > 0) return dotResult
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

  // In column context: columns='0_', other schema='1_', keywords/snippets='2_'
  // Otherwise: everything='1_' (neutral)
  const columnSortPrefix = isColumnContext ? SORT_PREFIX_HIGH : SORT_PREFIX_NEUTRAL
  const schemaSortPrefix = SORT_PREFIX_NEUTRAL
  const kwSortPrefix = isColumnContext ? SORT_PREFIX_LOW : SORT_PREFIX_NEUTRAL
  const snippetSortPrefix = isColumnContext ? SORT_PREFIX_LOW : SORT_PREFIX_NEUTRAL

  for (const syntaxSuggestion of suggestions.syntax) {
    const ctxType = syntaxSuggestion.syntaxContextType

    if (ctxType === EntityContextType.DATABASE) {
      for (const db of cache.databases) {
        if (!seenLabels.has(`db:${db}`)) {
          seenLabels.add(`db:${db}`)
          items.push(dbItem(db, schemaSortPrefix))
        }
      }
    } else if (ctxType === EntityContextType.TABLE) {
      for (const db of cache.databases) {
        const tables = cache.tables[db] ?? []
        for (const table of tables) {
          if (!seenLabels.has(`tbl:${table.name}`)) {
            seenLabels.add(`tbl:${table.name}`)
            items.push(tableItem(table.name, schemaSortPrefix))
          }
        }
      }
    } else if (ctxType === EntityContextType.COLUMN) {
      // Try to scope columns by tables in the current caret statement
      const scopedTables = findTablesInCaretStatement(entities)
      if (scopedTables.length > 0) {
        for (const tableRef of scopedTables) {
          addColumnsForTable(cache, tableRef, items, seenLabels, columnSortPrefix, activeDatabase)
        }
      } else {
        // Broad fallback: all columns from all tables
        for (const db of cache.databases) {
          const tables = cache.tables[db] ?? []
          for (const table of tables) {
            const cols = cache.columns[`${db}.${table.name}`] ?? []
            for (const col of cols) {
              if (!seenLabels.has(`col:${col.name}`)) {
                seenLabels.add(`col:${col.name}`)
                items.push(columnItem(col.name, columnSortPrefix))
              }
            }
          }
        }
      }
    } else if (ctxType === EntityContextType.FUNCTION) {
      for (const db of cache.databases) {
        const routines = cache.routines[db] ?? []
        for (const routine of routines) {
          if (routine.routineType === 'FUNCTION' && !seenLabels.has(`fn:${routine.name}`)) {
            seenLabels.add(`fn:${routine.name}`)
            items.push(routineItem(routine.name, 'FUNCTION', schemaSortPrefix))
          }
        }
      }
    } else if (ctxType === EntityContextType.PROCEDURE) {
      for (const db of cache.databases) {
        const routines = cache.routines[db] ?? []
        for (const routine of routines) {
          if (routine.routineType === 'PROCEDURE' && !seenLabels.has(`proc:${routine.name}`)) {
            seenLabels.add(`proc:${routine.name}`)
            items.push(routineItem(routine.name, 'PROCEDURE', schemaSortPrefix))
          }
        }
      }
    }
  }

  // Keywords (ranked lower in column context, neutral otherwise)
  for (const kw of suggestions.keywords) {
    items.push(keywordItem(kw, kwSortPrefix))
  }

  // Snippets (ranked same as keywords)
  if (snippets) {
    items.push(...snippets.map((s) => snippetToItem(s, snippetSortPrefix)))
  }

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
  activeDatabase: string | null
): ICompletionItem[] {
  const cache = getCache(connectionId)
  if (cache.status !== 'ready') return []

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

  if (!dotMatch) return []

  // Extract parts — qualifiedDb is set only for "db.table." syntax
  const qualifiedDb = dotMatch[1] ? dotMatch[1].replace(/[`"']/g, '') : null
  const tablePart = dotMatch[2].replace(/[`"']/g, '')
  const prefixLower = tablePart.toLowerCase()

  // 1. Check entity-based alias map first (case-insensitive)
  const aliasResolution = aliasMap.get(prefixLower)
  if (aliasResolution) {
    const cols = cache.columns[`${aliasResolution.database}.${aliasResolution.table}`] ?? []
    return cols.map((col) => columnItem(col.name))
  }

  // 1b. Text-based alias fallback: when the parser doesn't provide entities
  //     (e.g. no syntax suggestions), extract aliases from the SQL text.
  //     Pass caretOffset to scope scanning to text before the cursor.
  const caretOffset = model.getOffsetAt(position)
  const textAliasMap = buildAliasMapFromText(model.getValue(), activeDatabase, caretOffset)
  const textAliasResolution = textAliasMap.get(prefixLower)
  if (textAliasResolution) {
    const cols = cache.columns[`${textAliasResolution.database}.${textAliasResolution.table}`] ?? []
    return cols.map((col) => columnItem(col.name))
  }

  // 2. Check if it's a database name → suggest that db's tables
  const matchedDb = cache.databases.find((db) => db.toLowerCase() === prefixLower)
  if (matchedDb) {
    const tables = cache.tables[matchedDb] ?? []
    return tables.map((table) => tableItem(table.name))
  }

  // 3. Check if it's a table name → suggest that table's columns.
  //    When qualifiedDb is set (db.table. syntax), do an exact lookup
  //    to avoid ambiguity with duplicate table names across databases.
  //    When unqualified, prefer activeDatabase to avoid picking a
  //    same-named table from the wrong database.
  if (qualifiedDb) {
    const cols = cache.columns[`${qualifiedDb}.${tablePart}`] ?? []
    return cols.map((col) => columnItem(col.name))
  }
  const searchOrder = activeDatabase
    ? [activeDatabase, ...cache.databases.filter((db) => db !== activeDatabase)]
    : cache.databases

  for (const db of searchOrder) {
    const tables = cache.tables[db] ?? []
    const matchedTable = tables.find((t) => t.name.toLowerCase() === prefixLower)
    if (matchedTable) {
      const cols = cache.columns[`${db}.${matchedTable.name}`] ?? []
      return cols.map((col) => columnItem(col.name))
    }
  }

  return []
}

// ---------------------------------------------------------------------------
// Find TABLE entities in the statement containing the caret
// ---------------------------------------------------------------------------

function findTablesInCaretStatement(entities: EntityContext[] | null): TableRef[] {
  if (!entities) return []
  const tableRefs: TableRef[] = []
  for (const entity of entities) {
    if (entity.entityContextType === EntityContextType.TABLE && entity.belongStmt?.isContainCaret) {
      const text = entity.text
      if (!text) continue
      if (text.includes('.')) {
        // Qualified: "db.table" or "`db`.`table`"
        const parts = text.split('.')
        tableRefs.push({
          database: stripQuotes(parts[0]),
          table: stripQuotes(parts[parts.length - 1]),
        })
      } else {
        // Unqualified: "table" or "`table`"
        tableRefs.push({ database: null, table: stripQuotes(text) })
      }
    }
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
  activeDatabase: string | null = null
): void {
  if (tableRef.database) {
    // Exact lookup: database is known
    const cols = cache.columns[`${tableRef.database}.${tableRef.table}`] ?? []
    for (const col of cols) {
      if (!seenLabels.has(`col:${col.name}`)) {
        seenLabels.add(`col:${col.name}`)
        items.push(columnItem(col.name, sortPrefix))
      }
    }
  } else {
    // Fallback: search all databases for matching table name,
    // preferring activeDatabase to avoid picking a same-named table
    // from the wrong database.
    const searchOrder = activeDatabase
      ? [activeDatabase, ...cache.databases.filter((db) => db !== activeDatabase)]
      : cache.databases

    for (const db of searchOrder) {
      const tables = cache.tables[db] ?? []
      const matchedTable = tables.find((t) => t.name.toLowerCase() === tableRef.table.toLowerCase())
      if (matchedTable) {
        const cols = cache.columns[`${db}.${matchedTable.name}`] ?? []
        for (const col of cols) {
          if (!seenLabels.has(`col:${col.name}`)) {
            seenLabels.add(`col:${col.name}`)
            items.push(columnItem(col.name, sortPrefix))
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
  snippets?: CompletionSnippet[]
): ICompletionItem[] {
  const items: ICompletionItem[] = []

  // Basic keywords (neutral ranking in fallback — no context available)
  for (const kw of SQL_KEYWORDS) {
    items.push(keywordItem(kw))
  }

  // If we have a connection, dump all schema items
  if (connectionId) {
    const cache = getCache(connectionId)
    if (cache.status === 'ready') {
      // Databases
      for (const db of cache.databases) {
        items.push(dbItem(db))
      }

      // Tables from all databases
      for (const db of cache.databases) {
        const tables = cache.tables[db] ?? []
        for (const table of tables) {
          items.push(tableItem(table.name))
        }
      }

      // Columns from all tables
      for (const db of cache.databases) {
        const tables = cache.tables[db] ?? []
        for (const table of tables) {
          const cols = cache.columns[`${db}.${table.name}`] ?? []
          for (const col of cols) {
            items.push(columnItem(col.name))
          }
        }
      }

      // Routines (functions + procedures)
      for (const db of cache.databases) {
        const routines = cache.routines[db] ?? []
        for (const routine of routines) {
          items.push(routineItem(routine.name, routine.routineType as 'FUNCTION' | 'PROCEDURE'))
        }
      }
    }
  }

  // Snippets
  if (snippets) {
    items.push(...snippets.map((s) => snippetToItem(s)))
  }

  return items
}
