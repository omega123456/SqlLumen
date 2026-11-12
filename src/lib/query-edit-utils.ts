import type {
  ColumnMeta,
  QueryTableEditInfo,
  TableDataColumnMeta,
  RowEditState,
} from '../types/schema'
import { stripLeadingSqlComments } from './sql-utils'
import { coerceValueForColumn } from '../stores/table-data-store'

const BACKTICK_PAIR_LENGTH = 2
const COMMENT_MARKER_LENGTH = 2
const SELECT_KEYWORD_LENGTH = 'SELECT'.length
const DATABASE_AND_TABLE_PART_COUNT = 2
const DATABASE_TABLE_AND_COLUMN_PART_COUNT = 3
const TABLE_AND_COLUMN_PART_COUNT = 2

export type QueryEditColumnBindings = Map<number, string>

function normalizeIdentifier(identifier: string): string {
  const trimmed = identifier.trim()
  if (isBacktickQuoted(trimmed)) {
    return trimmed.slice(1, -1).replace(/``/g, '`')
  }
  return trimmed
}

function isBacktickQuoted(identifier: string): boolean {
  const hasRoomForQuotes = identifier.length >= BACKTICK_PAIR_LENGTH
  return hasRoomForQuotes && identifier.startsWith('`') && identifier.endsWith('`')
}

function splitQualifiedIdentifier(identifier: string): string[] {
  const parts: string[] = []
  let current = ''
  let inBackticks = false

  for (let charIndex = 0; charIndex < identifier.length; charIndex++) {
    const char = identifier[charIndex]

    if (char === '`') {
      current += char
      const isEscapedBacktick = inBackticks && identifier[charIndex + 1] === '`'
      if (isEscapedBacktick) {
        current += '`'
        charIndex++
        continue
      }
      inBackticks = !inBackticks
      continue
    }

    const isPartSeparator = char === '.' && !inBackticks
    if (isPartSeparator) {
      if (current.trim()) {
        parts.push(normalizeIdentifier(current))
      }
      current = ''
      continue
    }

    current += char
  }

  if (current.trim()) {
    parts.push(normalizeIdentifier(current))
  }

  return parts
}

const QUOTE_CHARACTERS = new Set(["'", '"', '`'])
const UNTERMINATED_COMMENT = -1
const SELECT_KEYWORD_PATTERN = /^SELECT\b/i
const FROM_KEYWORD_PATTERN = /^FROM\b/i

function isQuoteEscapeAt(text: string, index: number, quote: string): boolean {
  if (quote === '`') return text[index] === '`' && text[index + 1] === '`'
  return text[index] === '\\'
}

function findQuotedLiteralEnd(text: string, openIndex: number): number {
  const quote = text[openIndex]
  let index = openIndex + 1
  while (index < text.length) {
    if (isQuoteEscapeAt(text, index, quote)) {
      index += BACKTICK_PAIR_LENGTH
      continue
    }
    if (text[index] === quote) return index
    index++
  }
  return index
}

function blockCommentLastIndex(text: string, index: number): number {
  const closeIndex = text.indexOf('*/', index + COMMENT_MARKER_LENGTH)
  return closeIndex === -1 ? UNTERMINATED_COMMENT : closeIndex + 1
}

function commentEndIndex(text: string, index: number): number | null {
  if (text.startsWith('/*', index)) return blockCommentLastIndex(text, index)
  if (text.startsWith('--', index)) return text.indexOf('\n', index + COMMENT_MARKER_LENGTH)
  if (text[index] === '#') return text.indexOf('\n', index + 1)
  return null
}

function skipLiteralOrComment(text: string, index: number): number | null {
  if (QUOTE_CHARACTERS.has(text[index])) return findQuotedLiteralEnd(text, index)
  return commentEndIndex(text, index)
}

function nextParenDepth(depth: number, char: string): number {
  if (char === '(') return depth + 1
  if (char === ')') return Math.max(0, depth - 1)
  return depth
}

function findTopLevelKeyword(
  text: string,
  keywordPattern: RegExp,
  fromIndex: number
): number | null {
  let depth = 0
  for (let index = fromIndex; index < text.length; index++) {
    const skipEnd = skipLiteralOrComment(text, index)
    if (skipEnd === UNTERMINATED_COMMENT) return null
    if (skipEnd !== null) {
      index = skipEnd
      continue
    }
    depth = nextParenDepth(depth, text[index])
    const isTopLevelKeyword = depth === 0 && keywordPattern.test(text.slice(index))
    if (isTopLevelKeyword) return index
  }
  return null
}

function extractTopLevelSelectList(sql: string): string | null {
  const trimmed = stripLeadingSqlComments(sql)
  const selectIndex = findTopLevelKeyword(trimmed, SELECT_KEYWORD_PATTERN, 0)
  if (selectIndex === null) return null
  const selectStart = selectIndex + SELECT_KEYWORD_LENGTH
  const fromIndex = findTopLevelKeyword(trimmed, FROM_KEYWORD_PATTERN, selectStart)
  if (fromIndex === null) return null
  return trimmed.slice(selectStart, fromIndex).trim()
}

function splitTopLevelSelectItems(selectList: string): string[] {
  const items: string[] = []
  let current = ''
  let depth = 0

  for (let index = 0; index < selectList.length; index++) {
    const char = selectList[index]
    if (QUOTE_CHARACTERS.has(char)) {
      const literalEnd = findQuotedLiteralEnd(selectList, index)
      current += selectList.slice(index, literalEnd + 1)
      index = literalEnd
      continue
    }

    const commentEnd = commentEndIndex(selectList, index)
    if (commentEnd === UNTERMINATED_COMMENT) break
    if (commentEnd !== null) {
      index = commentEnd
      continue
    }

    current += char
    depth = nextParenDepth(depth, char)
    const isTopLevelComma = char === ',' && depth === 0
    if (isTopLevelComma) {
      items.push(current.slice(0, -1).trim())
      current = ''
    }
  }

  if (current.trim()) {
    items.push(current.trim())
  }

  return items.filter(Boolean)
}

function matchesTableTarget(
  qualifierParts: string[],
  targetTable: QueryTableEditInfo,
  aliasMap: Map<string, { database: string; table: string }>
): boolean {
  if (qualifierParts.length === 1) {
    const qualifier = qualifierParts[0].toLowerCase()
    const isTargetTableName = qualifier === targetTable.table.toLowerCase()
    if (isTargetTableName) {
      return true
    }

    const aliasTarget = aliasMap.get(qualifier)
    return (
      aliasTarget?.database.toLowerCase() === targetTable.database.toLowerCase() &&
      aliasTarget.table.toLowerCase() === targetTable.table.toLowerCase()
    )
  }

  if (qualifierParts.length === DATABASE_AND_TABLE_PART_COUNT) {
    return (
      qualifierParts[0].toLowerCase() === targetTable.database.toLowerCase() &&
      qualifierParts[1].toLowerCase() === targetTable.table.toLowerCase()
    )
  }

  return false
}

function buildAliasMapFromSql(
  queryTablesInOrder: QueryTableEditInfo[],
  sql: string
): Map<
  string,
  {
    database: string
    table: string
  }
> {
  const map = new Map<string, { database: string; table: string }>()
  const pattern =
    /\b(?:FROM|JOIN)\s+((?:`[^`]+`|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:`[^`]+`|[A-Za-z_][\w$]*))?)\s+(?:AS\s+)?((?:`[^`]+`|[A-Za-z_][\w$]*))/gi

  let match: RegExpExecArray | null
  while ((match = pattern.exec(sql)) !== null) {
    const target = splitQualifiedIdentifier(match[1])
    const alias = normalizeIdentifier(match[2]).toLowerCase()
    if (!alias) continue

    if (target.length === 1) {
      const tableName = target[0].toLowerCase()
      const resolved = queryTablesInOrder.find((table) => table.table.toLowerCase() === tableName)
      if (resolved) {
        map.set(alias, { database: resolved.database, table: resolved.table })
      }
      continue
    }

    if (target.length === DATABASE_AND_TABLE_PART_COUNT) {
      map.set(alias, { database: target[0], table: target[1] })
    }
  }

  return map
}

type TableTargetsByAlias = Map<string, { database: string; table: string }>

const QUALIFIED_WILDCARD_PATTERN =
  /^((?:`[^`]+`|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:`[^`]+`|[A-Za-z_][\w$]*)){0,2})\s*\.\s*\*$/i
const DIRECT_COLUMN_PATTERN =
  /^((?:`[^`]+`|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:`[^`]+`|[A-Za-z_][\w$]*)){0,2})(?:\s+AS\s+(?:`[^`]+`|[A-Za-z_][\w$]*)|\s+(?:`[^`]+`|[A-Za-z_][\w$]*))?$/i

interface ProjectionContext {
  resultColumns: ColumnMeta[]
  targetTable: QueryTableEditInfo
  queryTablesInOrder: QueryTableEditInfo[]
  aliasMap: TableTargetsByAlias
  targetColumnLookup: Map<string, string>
  bindings: QueryEditColumnBindings
  resultIndex: number
}

function isTableNamed(table: QueryTableEditInfo, database: string, tableName: string): boolean {
  const isSameDatabase = table.database.toLowerCase() === database.toLowerCase()
  return isSameDatabase && table.table.toLowerCase() === tableName.toLowerCase()
}

function isSameTable(left: QueryTableEditInfo, right: QueryTableEditInfo): boolean {
  return isTableNamed(right, left.database, left.table)
}

function isResultColumnNamed(resultName: string | undefined, columnName: string): boolean {
  if (!resultName) return false
  return resultName.toLowerCase() === columnName.toLowerCase()
}

function emitTableColumns(context: ProjectionContext, table: QueryTableEditInfo): boolean {
  const bindToTarget = isSameTable(table, context.targetTable)
  for (const column of table.columns) {
    const actualResultName = context.resultColumns[context.resultIndex]?.name
    if (!isResultColumnNamed(actualResultName, column.name)) return false
    if (bindToTarget) {
      context.bindings.set(context.resultIndex, column.name)
    }
    context.resultIndex++
  }
  return true
}

function bindAllTablesWildcard(context: ProjectionContext): boolean {
  return context.queryTablesInOrder.every((table) => emitTableColumns(context, table))
}

function bindQualifiedWildcard(context: ProjectionContext, qualifier: string): boolean {
  const qualifierParts = splitQualifiedIdentifier(qualifier)
  const matchingTable = context.queryTablesInOrder.find((table) =>
    matchesTableTarget(qualifierParts, table, context.aliasMap)
  )
  if (!matchingTable) return false
  return emitTableColumns(context, matchingTable)
}

function resolveFullyQualifiedBinding(
  context: ProjectionContext,
  parts: string[]
): string | undefined {
  const [database, table, column] = parts
  if (!isTableNamed(context.targetTable, database, table)) return undefined
  return context.targetColumnLookup.get(column.toLowerCase())
}

function resolveTableQualifiedBinding(
  context: ProjectionContext,
  parts: string[]
): string | undefined {
  const [table, column] = parts
  if (!matchesTableTarget([table], context.targetTable, context.aliasMap)) return undefined
  return context.targetColumnLookup.get(column.toLowerCase())
}

function resolveUnqualifiedBinding(
  context: ProjectionContext,
  parts: string[]
): string | undefined {
  const hasSingleTable = context.queryTablesInOrder.length === 1
  if (!hasSingleTable) return undefined
  return context.targetColumnLookup.get(parts[0].toLowerCase())
}

function resolveDirectColumnBinding(
  context: ProjectionContext,
  parts: string[]
): string | undefined {
  if (parts.length === DATABASE_TABLE_AND_COLUMN_PART_COUNT) {
    return resolveFullyQualifiedBinding(context, parts)
  }
  if (parts.length === TABLE_AND_COLUMN_PART_COUNT) {
    return resolveTableQualifiedBinding(context, parts)
  }
  if (parts.length === 1) {
    return resolveUnqualifiedBinding(context, parts)
  }
  return undefined
}

function hasRemainingResultColumn(context: ProjectionContext): boolean {
  return context.resultIndex < context.resultColumns.length
}

function bindDirectColumn(context: ProjectionContext, columnExpression: string): boolean {
  if (!hasRemainingResultColumn(context)) return false
  const parts = splitQualifiedIdentifier(columnExpression)
  const boundName = resolveDirectColumnBinding(context, parts)
  if (boundName) {
    context.bindings.set(context.resultIndex, boundName)
  }
  context.resultIndex++
  return true
}

function skipComputedColumn(context: ProjectionContext): boolean {
  if (!hasRemainingResultColumn(context)) return false
  context.resultIndex++
  return true
}

function bindProjectionItem(context: ProjectionContext, item: string): boolean {
  const trimmed = item.trim()
  if (!trimmed) return true
  if (trimmed === '*') return bindAllTablesWildcard(context)

  const wildcardMatch = trimmed.match(QUALIFIED_WILDCARD_PATTERN)
  if (wildcardMatch) return bindQualifiedWildcard(context, wildcardMatch[1])

  const directColumnMatch = trimmed.match(DIRECT_COLUMN_PATTERN)
  if (directColumnMatch) return bindDirectColumn(context, directColumnMatch[1])

  return skipComputedColumn(context)
}

function buildProjectionBindings(
  sql: string | null,
  resultColumns: ColumnMeta[],
  targetTable: QueryTableEditInfo,
  queryTablesInOrder: QueryTableEditInfo[]
): QueryEditColumnBindings {
  if (!sql) return new Map()

  const selectList = extractTopLevelSelectList(sql)
  if (!selectList) return new Map()

  const items = splitTopLevelSelectItems(selectList)
  if (items.length === 0) return new Map()

  const context: ProjectionContext = {
    resultColumns: resultColumns,
    targetTable: targetTable,
    queryTablesInOrder: queryTablesInOrder,
    aliasMap: buildAliasMapFromSql(queryTablesInOrder, sql),
    targetColumnLookup: new Map(
      targetTable.columns.map((column) => [column.name.toLowerCase(), column.name])
    ),
    bindings: new Map(),
    resultIndex: 0,
  }
  const isEveryItemBound = items.every((item) => bindProjectionItem(context, item))
  if (!isEveryItemBound) return new Map()
  if (hasRemainingResultColumn(context)) return new Map()
  return context.bindings
}

function removeDuplicateBoundColumns(bindings: QueryEditColumnBindings): QueryEditColumnBindings {
  const counts = new Map<string, number>()
  for (const columnName of bindings.values()) {
    const lower = columnName.toLowerCase()
    counts.set(lower, (counts.get(lower) ?? 0) + 1)
  }

  const duplicateNames = new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name)
  )
  if (duplicateNames.size === 0) {
    return bindings
  }

  const filtered: QueryEditColumnBindings = new Map()
  for (const [index, columnName] of bindings) {
    if (!duplicateNames.has(columnName.toLowerCase())) {
      filtered.set(index, columnName)
    }
  }
  return filtered
}

function canUseDirectNameFallback(
  sql: string | null,
  queryTablesInOrder: QueryTableEditInfo[]
): boolean {
  if (!sql) return true
  if (queryTablesInOrder.length !== 1) return false
  if (!/\bFROM\b/i.test(sql)) return false

  const selectList = extractTopLevelSelectList(sql)
  if (!selectList) {
    return false
  }

  const items = splitTopLevelSelectItems(selectList)
  if (items.length === 0) {
    return false
  }

  return items.every((item) => {
    const trimmed = item.trim()
    if (!trimmed) return false
    if (trimmed === '*') return true
    if (/[()]/.test(trimmed)) return false
    if (/\bAS\b/i.test(trimmed)) return false
    if (/^['"`\d-]/.test(trimmed)) return false
    if (/\b[A-Za-z_][\w$]*\s*\.\s*\*$/i.test(trimmed)) return false
    return /^((?:`[^`]+`|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:`[^`]+`|[A-Za-z_][\w$]*)){0,2})$/i.test(
      trimmed
    )
  })
}

export function buildQueryEditColumnBindings(
  sql: string | null,
  resultColumns: ColumnMeta[],
  targetTable: QueryTableEditInfo,
  queryTablesInOrder: QueryTableEditInfo[]
): QueryEditColumnBindings {
  const bindings: QueryEditColumnBindings = new Map()
  const tableColumnLookup = new Map(
    targetTable.columns.map((column) => [column.name.toLowerCase(), column.name])
  )

  const projectionBindings = buildProjectionBindings(
    sql,
    resultColumns,
    targetTable,
    queryTablesInOrder
  )
  for (const [index, columnName] of projectionBindings) {
    bindings.set(index, columnName)
  }

  const shouldBindByColumnName =
    projectionBindings.size === 0 && canUseDirectNameFallback(sql, queryTablesInOrder)
  if (shouldBindByColumnName) {
    const ambiguousNames = findAmbiguousColumns(resultColumns)
    for (let columnIndex = 0; columnIndex < resultColumns.length; columnIndex++) {
      const resultNameLower = resultColumns[columnIndex].name.toLowerCase()
      if (ambiguousNames.has(resultNameLower)) {
        continue
      }

      const boundName = tableColumnLookup.get(resultNameLower)
      if (boundName) {
        bindings.set(columnIndex, boundName)
      }
    }
  }

  return removeDuplicateBoundColumns(bindings)
}

export function buildBoundColumnIndexMap(bindings: QueryEditColumnBindings): Map<string, number> {
  const map = new Map<string, number>()
  for (const [index, columnName] of bindings) {
    map.set(columnName.toLowerCase(), index)
  }
  return map
}

/**
 * Returns lowercased column names that appear more than once in the result columns.
 * Used to detect ambiguous columns from JOINs or subqueries.
 */
export function findAmbiguousColumns(columns: ColumnMeta[]): Set<string> {
  const counts = new Map<string, number>()
  for (const column of columns) {
    const lower = column.name.toLowerCase()
    counts.set(lower, (counts.get(lower) ?? 0) + 1)
  }
  const ambiguous = new Set<string>()
  for (const [name, count] of counts) {
    if (count > 1) {
      ambiguous.add(name)
    }
  }
  return ambiguous
}

interface ResultColumnEditability {
  boundName: string | undefined
  resultColumnName: string
  hasExplicitBindings: boolean
  ambiguousNames: Set<string>
  tableColumnLookup: Map<string, TableDataColumnMeta>
}

function isEditableResultColumn(check: ResultColumnEditability): boolean {
  const { boundName } = check
  const isUnbound = !boundName
  if (check.hasExplicitBindings && isUnbound) return false
  const resultColumnNameLower = check.resultColumnName.toLowerCase()
  const isAmbiguousName = check.ambiguousNames.has(resultColumnNameLower)
  if (isUnbound && isAmbiguousName) return false
  const tableColumn = check.tableColumnLookup.get(boundName?.toLowerCase() ?? resultColumnNameLower)
  if (!tableColumn) return false
  return !tableColumn.isBinary
}

/**
 * For a selected table, maps result column indices to whether they are editable.
 * A column is editable if:
 *  - Its name matches a table column name (case-insensitive)
 *  - It is NOT in ambiguousNames
 *  - The matched table column is NOT binary/blob
 */
export function buildEditableColumnMap(
  resultColumns: ColumnMeta[],
  tableColumns: TableDataColumnMeta[],
  ambiguousNames: Set<string>,
  columnBindings?: QueryEditColumnBindings
): Map<number, boolean> {
  const map = new Map<number, boolean>()
  const hasExplicitBindings = columnBindings !== undefined

  // Build lookup from lowercased table column name → meta
  const tableColumnLookup = new Map<string, TableDataColumnMeta>()
  for (const tc of tableColumns) {
    tableColumnLookup.set(tc.name.toLowerCase(), tc)
  }

  for (let columnIndex = 0; columnIndex < resultColumns.length; columnIndex++) {
    const isEditable = isEditableResultColumn({
      boundName: columnBindings?.get(columnIndex),
      resultColumnName: resultColumns[columnIndex].name,
      hasExplicitBindings: hasExplicitBindings,
      ambiguousNames: ambiguousNames,
      tableColumnLookup: tableColumnLookup,
    })
    map.set(columnIndex, isEditable)
  }

  return map
}

/**
 * Validates that all PK/unique key columns are present AND non-ambiguous
 * in the result set.
 */
export function validateKeyColumnsPresent(
  primaryKeyColumns: string[],
  resultColumns: ColumnMeta[],
  ambiguousNames: Set<string>,
  boundColumnIndexMap?: Map<string, number>
): { valid: boolean; missingColumns: string[] } {
  if (boundColumnIndexMap) {
    const missingColumns = primaryKeyColumns.filter(
      (primaryKey) => !boundColumnIndexMap.has(primaryKey.toLowerCase())
    )
    return {
      valid: missingColumns.length === 0,
      missingColumns: missingColumns,
    }
  }

  const resultColumnNamesLower = new Set(resultColumns.map((column) => column.name.toLowerCase()))
  const missingColumns: string[] = []

  for (const primaryKey of primaryKeyColumns) {
    const primaryKeyLower = primaryKey.toLowerCase()
    const isUsableKeyColumn =
      resultColumnNamesLower.has(primaryKeyLower) && !ambiguousNames.has(primaryKeyLower)
    if (!isUsableKeyColumn) {
      missingColumns.push(primaryKey)
    }
  }

  return {
    valid: missingColumns.length === 0,
    missingColumns: missingColumns,
  }
}

/**
 * Builds a RowEditState from a positional row array.
 * Extracts values by column index, keyed by real column name.
 * Only captures values for columns that are in the editableMap.
 */
export function buildRowEditState(
  row: unknown[],
  resultColumns: ColumnMeta[],
  editableMap: Map<number, boolean>,
  primaryKeyColumnNames: string[],
  columnBindings?: QueryEditColumnBindings,
  boundColumnIndexMap?: Map<string, number>
): RowEditState {
  const originalValues: Record<string, unknown> = {}
  const currentValues: Record<string, unknown> = {}
  const rowKey: Record<string, unknown> = {}

  for (let columnIndex = 0; columnIndex < resultColumns.length; columnIndex++) {
    const columnName = columnBindings?.get(columnIndex) ?? resultColumns[columnIndex].name
    if (editableMap.get(columnIndex)) {
      originalValues[columnName] = row[columnIndex]
      currentValues[columnName] = row[columnIndex]
    }
  }

  // Build rowKey from PK columns (always populated, regardless of editability)
  for (const primaryKeyColumn of primaryKeyColumnNames) {
    const index =
      boundColumnIndexMap?.get(primaryKeyColumn.toLowerCase()) ??
      resultColumns.findIndex(
        (column) => column.name.toLowerCase() === primaryKeyColumn.toLowerCase()
      )
    if (index !== -1) {
      rowKey[primaryKeyColumn] = row[index]
    }
  }

  return {
    rowKey: rowKey,
    originalValues: originalValues,
    currentValues: currentValues,
    modifiedColumns: new Set<string>(),
    isNewRow: false,
  }
}

/**
 * Builds the update_table_row payload from edit state.
 * Only modified columns appear in updatedValues.
 * PK values come from rowKey (original identity).
 */
export function buildUpdatePayload(
  editState: RowEditState,
  primaryKeyColumnNames: string[],
  columns?: TableDataColumnMeta[]
): {
  pkColumns: string[]
  originalPkValues: Record<string, unknown>
  updatedValues: Record<string, unknown>
} {
  const columnsByName = columns
    ? new Map(columns.map((column) => [column.name, column]))
    : undefined

  const originalPrimaryKeyValues: Record<string, unknown> = {}
  for (const primaryKey of primaryKeyColumnNames) {
    originalPrimaryKeyValues[primaryKey] = editState.rowKey[primaryKey]
  }

  const updatedValues: Record<string, unknown> = {}
  for (const column of editState.modifiedColumns) {
    const rawValue = editState.currentValues[column]
    const columnMeta = columnsByName?.get(column)
    updatedValues[column] = columnMeta
      ? coerceValueForColumn(rawValue, columnMeta.dataType)
      : rawValue
  }

  return {
    pkColumns: primaryKeyColumnNames,
    originalPkValues: originalPrimaryKeyValues,
    updatedValues: updatedValues,
  }
}

/**
 * Builds the insert_table_row payload from edit state.
 * Only modified columns appear in values, and generated primary keys remain omitted.
 */
export function buildInsertPayload(
  editState: RowEditState,
  tableColumns: TableDataColumnMeta[]
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const insertEligibleColumns = editState.insertEligibleColumns

  for (const column of tableColumns) {
    if (column.isAutoIncrement) {
      continue
    }

    const isModified = editState.modifiedColumns.has(column.name)
    const isInsertEligible = insertEligibleColumns?.has(column.name) ?? false
    const isPayloadColumn = isModified || isInsertEligible
    if (!isPayloadColumn) {
      continue
    }

    const currentValue = editState.currentValues[column.name]
    if (currentValue !== undefined) {
      values[column.name] = coerceValueForColumn(currentValue, column.dataType)
    }
  }

  return values
}
