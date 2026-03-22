/**
 * Monaco CompletionItemProvider for SQL autocomplete with schema awareness.
 * Also exports a pub/sub mechanism for the doc panel to track the selected item.
 */

import { languages } from 'monaco-editor'
import type { editor, Position, IRange } from 'monaco-editor'
import type { TableInfo } from '../../types/schema'
import { getCache } from './schema-metadata-cache'
import { detectCursorContext, cursorToOffset } from './sql-parser-utils'

// ---------------------------------------------------------------------------
// Doc panel item pub/sub
// ---------------------------------------------------------------------------

export interface DocPanelItem {
  type: 'table' | 'column' | 'database' | 'routine' | 'keyword'
  name: string
  database?: string
  table?: string
  tableInfo?: TableInfo
  columnCount?: number
}

let _selectedDocItem: DocPanelItem | null = null
const _subscribers = new Set<(item: DocPanelItem | null) => void>()

export function subscribeDocItem(fn: (item: DocPanelItem | null) => void): () => void {
  _subscribers.add(fn)
  return () => {
    _subscribers.delete(fn)
  }
}

export function getDocItem(): DocPanelItem | null {
  return _selectedDocItem
}

function setDocItem(item: DocPanelItem | null): void {
  _selectedDocItem = item
  for (const fn of _subscribers) {
    fn(item)
  }
}

// ---------------------------------------------------------------------------
// SQL keywords
// ---------------------------------------------------------------------------

const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'INNER JOIN',
  'LEFT JOIN',
  'LEFT OUTER JOIN',
  'RIGHT JOIN',
  'ORDER BY',
  'GROUP BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'INSERT INTO',
  'UPDATE',
  'DELETE FROM',
  'CREATE TABLE',
  'CREATE INDEX',
  'ALTER TABLE',
  'DROP TABLE',
  'SHOW TABLES',
  'SHOW DATABASES',
  'DESCRIBE',
  'EXPLAIN',
  'USE',
  'WITH',
  'SET',
  'DISTINCT',
  'AS',
  'AND',
  'OR',
  'NOT',
  'NULL',
  'IS NULL',
  'IS NOT NULL',
  'IN',
  'NOT IN',
  'BETWEEN',
  'LIKE',
  'EXISTS',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'COALESCE',
  'IFNULL',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'ON',
  'USING',
  'UNION',
  'UNION ALL',
  'ALL',
  'ANY',
  'ASC',
  'DESC',
  'PRIMARY KEY',
  'FOREIGN KEY',
  'REFERENCES',
  'CONSTRAINT',
  'DEFAULT',
  'AUTO_INCREMENT',
  'NOT NULL',
  'UNIQUE',
]

// ---------------------------------------------------------------------------
// Helper: build keyword completion items
// ---------------------------------------------------------------------------

function buildKeywordSuggestions(prefix: string, range: IRange): languages.CompletionItem[] {
  const lower = prefix.toLowerCase()
  return SQL_KEYWORDS.filter((kw) => kw.toLowerCase().startsWith(lower)).map((kw) => ({
    label: kw,
    kind: languages.CompletionItemKind.Keyword,
    insertText: kw,
    range,
  }))
}

// ---------------------------------------------------------------------------
// AutocompleteProvider
// ---------------------------------------------------------------------------

/**
 * Metadata key stored in CompletionItem.detail for resolveCompletionItem to reconstruct
 * the DocPanelItem. We encode a JSON string prefixed with a marker so we can detect it.
 */
const DOC_META_PREFIX = '\u200B' // zero-width space as marker

function encodeDocMeta(item: DocPanelItem): string {
  return DOC_META_PREFIX + JSON.stringify(item)
}

function decodeDocMeta(detail: string | undefined): DocPanelItem | null {
  if (!detail || !detail.startsWith(DOC_META_PREFIX)) return null
  try {
    return JSON.parse(detail.slice(DOC_META_PREFIX.length)) as DocPanelItem
  } catch {
    return null
  }
}

/**
 * Build a human-readable detail string (what the user sees) plus encode doc metadata
 * into the completion item's documentation field for resolveCompletionItem.
 */
function buildCompletionDetail(
  displayDetail: string,
  docMeta: DocPanelItem
): { detail: string; documentation: string } {
  return {
    detail: displayDetail,
    documentation: encodeDocMeta(docMeta),
  }
}

export class AutocompleteProvider implements languages.CompletionItemProvider {
  triggerCharacters = [' ', '.', '(']

  constructor(private connectionId: string) {}

  resolveCompletionItem(item: languages.CompletionItem): languages.CompletionItem {
    // Try to extract doc metadata from the documentation field
    const docStr =
      typeof item.documentation === 'string'
        ? item.documentation
        : item.documentation &&
            typeof item.documentation === 'object' &&
            'value' in item.documentation
          ? item.documentation.value
          : undefined
    const meta = decodeDocMeta(docStr)
    if (meta) {
      setDocItem(meta)
    } else if (item.kind === languages.CompletionItemKind.Keyword) {
      setDocItem({ type: 'keyword', name: String(item.label) })
    }
    return item
  }

  provideCompletionItems(
    model: editor.ITextModel,
    position: Position
  ): languages.ProviderResult<languages.CompletionList> {
    const cache = getCache(this.connectionId)

    // Calculate the word range for replacement
    const word = model.getWordUntilPosition(position)
    const range: IRange = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: position.column,
    }

    // Handle loading state
    if (cache.status === 'loading') {
      setDocItem(null)
      return {
        suggestions: [
          {
            label: 'Loading schema...',
            kind: languages.CompletionItemKind.Text,
            insertText: '',
            range,
          },
        ],
      }
    }

    // Handle error state
    if (cache.status === 'error') {
      setDocItem(null)
      return {
        suggestions: [
          {
            label: 'Schema unavailable',
            kind: languages.CompletionItemKind.Text,
            insertText: '',
            range,
          },
        ],
      }
    }

    // Handle empty state — just show keywords
    if (cache.status === 'empty') {
      setDocItem(null)
      return { suggestions: buildKeywordSuggestions(word.word, range) }
    }

    // Cache is ready — detect context and build suggestions
    const fullText = model.getValue()
    const cursorOffset = cursorToOffset(fullText, position.lineNumber, position.column)
    const textBefore = fullText.substring(0, cursorOffset)

    const suggestions: languages.CompletionItem[] = []

    // ---- Dot context: "database." or "table." ----
    const dotMatch = textBefore.match(/(\w+)\.\s*(\w*)$/)
    if (dotMatch) {
      const dotPrefix = dotMatch[1]
      const afterDot = dotMatch[2] || ''

      // Check if it's a database name → suggest tables
      const matchedDb = cache.databases.find((db) => db.toLowerCase() === dotPrefix.toLowerCase())
      if (matchedDb) {
        const tables = cache.tables[matchedDb] ?? []
        const filtered = tables.filter((t) =>
          t.name.toLowerCase().startsWith(afterDot.toLowerCase())
        )
        for (const table of filtered) {
          const docMeta: DocPanelItem = {
            type: 'table',
            name: table.name,
            database: matchedDb,
            tableInfo: table,
            columnCount: (cache.columns[`${matchedDb}.${table.name}`] ?? []).length,
          }
          const meta = buildCompletionDetail(`${matchedDb}.${table.name}`, docMeta)
          suggestions.push({
            label: table.name,
            kind: languages.CompletionItemKind.Class,
            detail: meta.detail,
            documentation: meta.documentation,
            insertText: table.name,
            range,
          })
        }
        if (filtered.length > 0) {
          setDocItem({
            type: 'table',
            name: filtered[0].name,
            database: matchedDb,
            tableInfo: filtered[0],
            columnCount: (cache.columns[`${matchedDb}.${filtered[0].name}`] ?? []).length,
          })
        } else {
          setDocItem(null)
        }
        return { suggestions }
      }

      // Check if it's a table name → suggest columns
      for (const database of cache.databases) {
        const tables = cache.tables[database] ?? []
        const matchedTable = tables.find((t) => t.name.toLowerCase() === dotPrefix.toLowerCase())
        if (matchedTable) {
          const cols = cache.columns[`${database}.${matchedTable.name}`] ?? []
          const filtered = cols.filter((c) =>
            c.name.toLowerCase().startsWith(afterDot.toLowerCase())
          )
          for (const col of filtered) {
            const docMeta: DocPanelItem = {
              type: 'column',
              name: col.name,
              database,
              table: matchedTable.name,
            }
            const meta = buildCompletionDetail(col.dataType, docMeta)
            suggestions.push({
              label: col.name,
              kind: languages.CompletionItemKind.Field,
              detail: meta.detail,
              documentation: meta.documentation,
              insertText: col.name,
              range,
            })
          }
          if (filtered.length > 0) {
            setDocItem({
              type: 'column',
              name: filtered[0].name,
              database,
              table: matchedTable.name,
            })
          } else {
            setDocItem(null)
          }
          return { suggestions }
        }
      }
    }

    // ---- Clause-based context detection ----
    const context = detectCursorContext(fullText, cursorOffset)
    const prefix = word.word.toLowerCase()

    if (context.type === 'from-clause' || context.type === 'join-clause') {
      // Suggest databases and tables
      for (const db of cache.databases) {
        if (db.toLowerCase().startsWith(prefix)) {
          const docMeta: DocPanelItem = { type: 'database', name: db }
          suggestions.push({
            label: db,
            kind: languages.CompletionItemKind.Module,
            documentation: encodeDocMeta(docMeta),
            insertText: db,
            range,
          })
        }
        const tables = cache.tables[db] ?? []
        for (const table of tables) {
          if (table.name.toLowerCase().startsWith(prefix)) {
            const docMeta: DocPanelItem = {
              type: 'table',
              name: table.name,
              database: db,
              tableInfo: table,
              columnCount: (cache.columns[`${db}.${table.name}`] ?? []).length,
            }
            const meta = buildCompletionDetail(`${db}.${table.name}`, docMeta)
            suggestions.push({
              label: table.name,
              kind: languages.CompletionItemKind.Class,
              detail: meta.detail,
              documentation: meta.documentation,
              insertText: table.name,
              range,
            })
          }
        }
      }
      updateDocItemFromSuggestions(suggestions, cache)
    } else if (context.type === 'where-clause' || context.type === 'select-columns') {
      // Suggest columns if table context is detected
      if (context.table) {
        for (const db of cache.databases) {
          const key = `${db}.${context.table}`
          const cols = cache.columns[key] ?? []
          for (const col of cols) {
            if (col.name.toLowerCase().startsWith(prefix)) {
              const docMeta: DocPanelItem = {
                type: 'column',
                name: col.name,
                database: db,
                table: context.table,
              }
              const meta = buildCompletionDetail(col.dataType, docMeta)
              suggestions.push({
                label: col.name,
                kind: languages.CompletionItemKind.Field,
                detail: meta.detail,
                documentation: meta.documentation,
                insertText: col.name,
                range,
              })
            }
          }
        }
      }
      // Also suggest keywords
      suggestions.push(...buildKeywordSuggestions(prefix, range))

      if (suggestions.length > 0 && suggestions[0].kind === languages.CompletionItemKind.Field) {
        setDocItem({
          type: 'column',
          name: String(suggestions[0].label),
          table: context.table,
        })
      } else {
        setDocItem(null)
      }
    } else {
      // Generic context — suggest keywords, databases, tables, routines
      suggestions.push(...buildKeywordSuggestions(prefix, range))

      for (const db of cache.databases) {
        if (db.toLowerCase().startsWith(prefix)) {
          const docMeta: DocPanelItem = { type: 'database', name: db }
          suggestions.push({
            label: db,
            kind: languages.CompletionItemKind.Module,
            documentation: encodeDocMeta(docMeta),
            insertText: db,
            range,
          })
        }
        const tables = cache.tables[db] ?? []
        for (const table of tables) {
          if (table.name.toLowerCase().startsWith(prefix)) {
            const docMeta: DocPanelItem = {
              type: 'table',
              name: table.name,
              database: db,
              tableInfo: table,
              columnCount: (cache.columns[`${db}.${table.name}`] ?? []).length,
            }
            const meta = buildCompletionDetail(`${db}.${table.name}`, docMeta)
            suggestions.push({
              label: table.name,
              kind: languages.CompletionItemKind.Class,
              detail: meta.detail,
              documentation: meta.documentation,
              insertText: table.name,
              range,
            })
          }
        }
        const routines = cache.routines[db] ?? []
        for (const routine of routines) {
          if (routine.name.toLowerCase().startsWith(prefix)) {
            const docMeta: DocPanelItem = { type: 'routine', name: routine.name }
            suggestions.push({
              label: routine.name,
              kind: languages.CompletionItemKind.Function,
              detail: routine.routineType,
              documentation: encodeDocMeta(docMeta),
              insertText: routine.name,
              range,
            })
          }
        }
      }
      updateDocItemFromSuggestions(suggestions, cache)
    }

    return { suggestions }
  }
}

/**
 * Set the doc item from the first suggestion (for non-dot, non-column paths).
 */
function updateDocItemFromSuggestions(
  suggestions: languages.CompletionItem[],
  cache: ReturnType<typeof getCache>
): void {
  if (suggestions.length === 0) {
    setDocItem(null)
    return
  }
  const first = suggestions[0]
  if (first.kind === languages.CompletionItemKind.Class) {
    // Find the TableInfo for the first table suggestion
    for (const db of cache.databases) {
      const tableInfo = (cache.tables[db] ?? []).find((t) => t.name === first.label)
      if (tableInfo) {
        setDocItem({
          type: 'table',
          name: tableInfo.name,
          database: db,
          tableInfo,
          columnCount: (cache.columns[`${db}.${tableInfo.name}`] ?? []).length,
        })
        return
      }
    }
  } else if (first.kind === languages.CompletionItemKind.Module) {
    setDocItem({ type: 'database', name: String(first.label) })
  } else if (first.kind === languages.CompletionItemKind.Function) {
    setDocItem({ type: 'routine', name: String(first.label) })
  } else if (first.kind === languages.CompletionItemKind.Keyword) {
    setDocItem({ type: 'keyword', name: String(first.label) })
  } else {
    setDocItem(null)
  }
}
