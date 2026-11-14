import { languages } from 'monaco-editor'
import type { ICompletionItem, CompletionSnippet } from 'monaco-sql-languages'

export const SORT_PREFIX_HIGH = '0_'
export const SORT_PREFIX_NEUTRAL = '1_'
export const SORT_PREFIX_LOW = '2_'

export type QuotedItem = ICompletionItem & { filterText?: string }
export type RoutineType = 'FUNCTION' | 'PROCEDURE'

function mysqlBacktickQuote(raw: string): string {
  return '`' + raw.replace(/`/g, '``') + '`'
}

function applyQuoting(item: QuotedItem, raw: string, quoteIdentifiers: boolean): QuotedItem {
  if (quoteIdentifiers) {
    item.insertText = mysqlBacktickQuote(raw)
    item.filterText = raw
  }
  return item
}

export function keywordItem(kw: string, sortPrefix = SORT_PREFIX_NEUTRAL): ICompletionItem {
  return {
    label: kw,
    kind: languages.CompletionItemKind.Keyword,
    insertText: kw,
    sortText: `${sortPrefix}${kw}`,
  }
}

export function builtinFunctionItem(
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

export function dbItem(
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

export function tableItem(
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

export function columnItem(
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

export interface RoutineItemInputs {
  name: string
  type: RoutineType
  sortPrefix?: string
  quoteIdentifiers?: boolean
}

export function routineItem({
  name,
  type,
  sortPrefix = SORT_PREFIX_NEUTRAL,
  quoteIdentifiers = false,
}: RoutineItemInputs): QuotedItem {
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

export function mapSnippetsToItems(
  snippets: CompletionSnippet[] | undefined,
  sortPrefix = SORT_PREFIX_NEUTRAL
): ICompletionItem[] {
  if (!snippets) return []

  return snippets.filter(shouldIncludeSnippet).map((snippet) => snippetToItem(snippet, sortPrefix))
}

export function schemaUnavailableItems(): ICompletionItem[] {
  return [
    {
      label: 'Schema unavailable',
      kind: languages.CompletionItemKind.Text,
      insertText: '',
      sortText: '0',
    },
  ]
}
