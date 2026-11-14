import type { ICompletionItem, Suggestions } from 'monaco-sql-languages'
import { SQL_KEYWORDS, SQL_BUILTIN_FUNCTIONS, STORED_PROGRAM_BODY_KEYWORDS } from '../sql-keywords'
import { canSupplementStoredProgramBodyKeywords, isStoredProgramBodyContext } from './caret-context'
import {
  SORT_PREFIX_NEUTRAL,
  builtinFunctionItem,
  columnItem,
  dbItem,
  keywordItem,
  routineItem,
  tableItem,
  type RoutineType,
} from './completion-items'
import type { SchemaCache } from './completion-types'

export function pushBuiltinFunctions(
  items: ICompletionItem[],
  seenLabels: Set<string> | null,
  sortPrefix = SORT_PREFIX_NEUTRAL
): void {
  for (const functionName of SQL_BUILTIN_FUNCTIONS) {
    if (seenLabels?.has(`fn:${functionName}`)) {
      continue
    }

    seenLabels?.add(`fn:${functionName}`)
    items.push(builtinFunctionItem(functionName, sortPrefix))
  }
}

export function pushFallbackKeywordsAndFunctions(
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

interface StoredProgramKeywordPush {
  items: ICompletionItem[]
  statementPrefix: string
  suggestions: Suggestions
  currentWordPrefix: string
  existingKeywords: readonly string[]
  sortPrefix?: string
}

export function pushStoredProgramBodyKeywords({
  items,
  statementPrefix,
  suggestions,
  currentWordPrefix,
  existingKeywords,
  sortPrefix = SORT_PREFIX_NEUTRAL,
}: StoredProgramKeywordPush): void {
  if (!isStoredProgramBodyContext(statementPrefix)) return
  if (!canSupplementStoredProgramBodyKeywords(suggestions, currentWordPrefix)) return

  const seenKeywords = new Set(existingKeywords.map((kw) => kw.toUpperCase()))

  for (const kw of STORED_PROGRAM_BODY_KEYWORDS) {
    if (seenKeywords.has(kw)) {
      continue
    }

    seenKeywords.add(kw)
    items.push(keywordItem(kw, sortPrefix))
  }
}

interface CompletionSink {
  items: ICompletionItem[]
  seenLabels: Set<string>
  sortPrefix?: string
  quoteIdentifiers?: boolean
}

interface DatabasePush extends CompletionSink {
  databases: readonly string[]
}

interface ScopedSchemaPush extends DatabasePush {
  cache: SchemaCache
}

function pushUnseenItem(
  sink: CompletionSink,
  key: string,
  createItem: () => ICompletionItem
): void {
  if (sink.seenLabels.has(key)) return
  sink.seenLabels.add(key)
  sink.items.push(createItem())
}

export function pushDatabases({
  databases,
  items,
  seenLabels,
  sortPrefix = SORT_PREFIX_NEUTRAL,
  quoteIdentifiers = false,
}: DatabasePush): void {
  const sink = { items, seenLabels }
  for (const db of databases) {
    pushUnseenItem(sink, `db:${db}`, () => dbItem(db, sortPrefix, quoteIdentifiers))
  }
}

export function pushScopedTables({
  cache,
  databases,
  items,
  seenLabels,
  sortPrefix = SORT_PREFIX_NEUTRAL,
  quoteIdentifiers = false,
}: ScopedSchemaPush): void {
  const sink = { items, seenLabels }
  for (const db of databases) {
    for (const table of cache.tables[db] ?? []) {
      pushUnseenItem(sink, `tbl:${db}:${table.name}`, () =>
        tableItem(table.name, sortPrefix, quoteIdentifiers)
      )
    }
  }
}

function columnsOfDatabase(cache: SchemaCache, db: string) {
  return (cache.tables[db] ?? []).flatMap((table) => cache.columns[`${db}.${table.name}`] ?? [])
}

export function pushScopedColumns({
  cache,
  databases,
  items,
  seenLabels,
  sortPrefix = SORT_PREFIX_NEUTRAL,
  quoteIdentifiers = false,
}: ScopedSchemaPush): void {
  const sink = { items, seenLabels }
  for (const db of databases) {
    for (const column of columnsOfDatabase(cache, db)) {
      pushUnseenItem(sink, `col:${column.name}`, () =>
        columnItem(column.name, sortPrefix, quoteIdentifiers)
      )
    }
  }
}

function matchesRoutineType(routine: { routineType: string }, routineType: RoutineType | null) {
  return routineType === null || routine.routineType === routineType
}

function routineCompletionKey(routine: { name: string; routineType: string }): string {
  return routine.routineType === 'FUNCTION' ? `fn:${routine.name}` : `proc:${routine.name}`
}

interface ScopedRoutinePush extends ScopedSchemaPush {
  routineType?: RoutineType | null
}

export function pushScopedRoutines({
  cache,
  databases,
  items,
  seenLabels,
  sortPrefix = SORT_PREFIX_NEUTRAL,
  routineType = null,
  quoteIdentifiers = false,
}: ScopedRoutinePush): void {
  const sink = { items, seenLabels }
  for (const db of databases) {
    const routines = (cache.routines[db] ?? []).filter((routine) =>
      matchesRoutineType(routine, routineType)
    )
    for (const routine of routines) {
      pushUnseenItem(sink, routineCompletionKey(routine), () =>
        routineItem({
          name: routine.name,
          type: routine.routineType as RoutineType,
          sortPrefix: sortPrefix,
          quoteIdentifiers: quoteIdentifiers,
        })
      )
    }
  }
}
