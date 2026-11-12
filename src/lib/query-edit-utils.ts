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
  if (trimmed.length >= BACKTICK_PAIR_LENGTH && trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return trimmed.slice(1, -1).replace(/``/g, '`')
  }
  return trimmed
}

function splitQualifiedIdentifier(identifier: string): string[] {
  const parts: string[] = []
  let current = ''
  let inBackticks = false

  for (let charIndex = 0; charIndex < identifier.length; charIndex++) {
    const char = identifier[charIndex]

    if (char === '`') {
      current += char
      if (inBackticks && identifier[charIndex + 1] === '`') {
        current += '`'
        charIndex++
        continue
      }
      inBackticks = !inBackticks
      continue
    }

    if (char === '.' && !inBackticks) {
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

function extractTopLevelSelectList(sql: string): string | null {
  const trimmed = stripLeadingSqlComments(sql)
  let depth = 0
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  let selectStart = -1

  for (let charIndex = 0; charIndex < trimmed.length; charIndex++) {
    const char = trimmed[charIndex]
    const next = trimmed[charIndex + 1] ?? ''

    if (inSingle) {
      if (char === '\\') {
        charIndex++
      } else if (char === "'") {
        inSingle = false
      }
      continue
    }

    if (inDouble) {
      if (char === '\\') {
        charIndex++
      } else if (char === '"') {
        inDouble = false
      }
      continue
    }

    if (inBacktick) {
      if (char === '`' && next === '`') {
        charIndex++
      } else if (char === '`') {
        inBacktick = false
      }
      continue
    }

    if (char === "'") {
      inSingle = true
      continue
    }

    if (char === '"') {
      inDouble = true
      continue
    }

    if (char === '`') {
      inBacktick = true
      continue
    }

    if (char === '/' && next === '*') {
      const end = trimmed.indexOf('*/', charIndex + COMMENT_MARKER_LENGTH)
      if (end === -1) return null
      charIndex = end + 1
      continue
    }

    if (char === '-' && next === '-') {
      const end = trimmed.indexOf('\n', charIndex + COMMENT_MARKER_LENGTH)
      if (end === -1) return null
      charIndex = end
      continue
    }

    if (char === '#') {
      const end = trimmed.indexOf('\n', charIndex + 1)
      if (end === -1) return null
      charIndex = end
      continue
    }

    if (char === '(') {
      depth++
      continue
    }

    if (char === ')') {
      depth = Math.max(0, depth - 1)
      continue
    }

    if (depth !== 0) continue

    const remaining = trimmed.slice(charIndex)
    if (selectStart === -1 && /^SELECT\b/i.test(remaining)) {
      selectStart = charIndex + SELECT_KEYWORD_LENGTH
      charIndex += SELECT_KEYWORD_LENGTH - 1
      continue
    }

    if (selectStart !== -1 && /^FROM\b/i.test(remaining)) {
      return trimmed.slice(selectStart, charIndex).trim()
    }
  }

  return null
}

function splitTopLevelSelectItems(selectList: string): string[] {
  const items: string[] = []
  let current = ''
  let depth = 0
  let inSingle = false
  let inDouble = false
  let inBacktick = false

  for (let index = 0; index < selectList.length; index++) {
    const char = selectList[index]
    const next = selectList[index + 1] ?? ''

    if (inSingle) {
      current += char
      if (char === '\\') {
        current += next
        index++
      } else if (char === "'") {
        inSingle = false
      }
      continue
    }

    if (inDouble) {
      current += char
      if (char === '\\') {
        current += next
        index++
      } else if (char === '"') {
        inDouble = false
      }
      continue
    }

    if (inBacktick) {
      current += char
      if (char === '`' && next === '`') {
        current += next
        index++
      } else if (char === '`') {
        inBacktick = false
      }
      continue
    }

    if (char === "'") {
      current += char
      inSingle = true
      continue
    }

    if (char === '"') {
      current += char
      inDouble = true
      continue
    }

    if (char === '`') {
      current += char
      inBacktick = true
      continue
    }

    if (char === '/' && next === '*') {
      const end = selectList.indexOf('*/', index + COMMENT_MARKER_LENGTH)
      if (end === -1) {
        break
      }
      index = end + 1
      continue
    }

    if (char === '-' && next === '-') {
      const end = selectList.indexOf('\n', index + COMMENT_MARKER_LENGTH)
      if (end === -1) {
        break
      }
      index = end
      continue
    }

    if (char === '#') {
      const end = selectList.indexOf('\n', index + 1)
      if (end === -1) {
        break
      }
      index = end
      continue
    }

    current += char

    if (char === '(') {
      depth++
      continue
    }

    if (char === ')') {
      depth = Math.max(0, depth - 1)
      continue
    }

    if (char === ',' && depth === 0) {
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
    if (qualifier === targetTable.table.toLowerCase()) {
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

  const targetColumnLookup = new Map(
    targetTable.columns.map((column) => [column.name.toLowerCase(), column.name])
  )
  const aliasMap = buildAliasMapFromSql(queryTablesInOrder, sql)
  const bindings: QueryEditColumnBindings = new Map()
  let resultIndex = 0

  const emitTableColumns = (table: QueryTableEditInfo, bindToTarget: boolean) => {
    for (const column of table.columns) {
      if (resultIndex >= resultColumns.length) return false
      const actualResultName = resultColumns[resultIndex]?.name
      if (!actualResultName || actualResultName.toLowerCase() !== column.name.toLowerCase()) {
        return false
      }
      if (bindToTarget) {
        bindings.set(resultIndex, column.name)
      }
      resultIndex++
    }
    return true
  }

  const directColumnPattern =
    /^((?:`[^`]+`|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:`[^`]+`|[A-Za-z_][\w$]*)){0,2})(?:\s+AS\s+(?:`[^`]+`|[A-Za-z_][\w$]*)|\s+(?:`[^`]+`|[A-Za-z_][\w$]*))?$/i

  for (const item of items) {
    const trimmed = item.trim()
    if (!trimmed) continue

    if (trimmed === '*') {
      for (const table of queryTablesInOrder) {
        const bindToTarget =
          table.database.toLowerCase() === targetTable.database.toLowerCase() &&
          table.table.toLowerCase() === targetTable.table.toLowerCase()
        if (!emitTableColumns(table, bindToTarget)) return new Map()
      }
      continue
    }

    const wildcardMatch = trimmed.match(
      /^((?:`[^`]+`|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:`[^`]+`|[A-Za-z_][\w$]*)){0,2})\s*\.\s*\*$/i
    )
    if (wildcardMatch) {
      const qualifierParts = splitQualifiedIdentifier(wildcardMatch[1])
      const matchingTable = queryTablesInOrder.find((table) =>
        matchesTableTarget(qualifierParts, table, aliasMap)
      )
      if (!matchingTable) return new Map()

      const bindToTarget =
        matchingTable.database.toLowerCase() === targetTable.database.toLowerCase() &&
        matchingTable.table.toLowerCase() === targetTable.table.toLowerCase()
      if (!emitTableColumns(matchingTable, bindToTarget)) return new Map()
      continue
    }

    const directColumnMatch = trimmed.match(directColumnPattern)
    if (directColumnMatch) {
      if (resultIndex >= resultColumns.length) return new Map()
      const parts = splitQualifiedIdentifier(directColumnMatch[1])

      if (parts.length === DATABASE_TABLE_AND_COLUMN_PART_COUNT) {
        if (
          parts[0].toLowerCase() === targetTable.database.toLowerCase() &&
          parts[1].toLowerCase() === targetTable.table.toLowerCase()
        ) {
          const boundName = targetColumnLookup.get(parts[2].toLowerCase())
          if (boundName) {
            bindings.set(resultIndex, boundName)
          }
        }
      } else if (parts.length === TABLE_AND_COLUMN_PART_COUNT) {
        if (matchesTableTarget([parts[0]], targetTable, aliasMap)) {
          const boundName = targetColumnLookup.get(parts[1].toLowerCase())
          if (boundName) {
            bindings.set(resultIndex, boundName)
          }
        }
      } else if (parts.length === 1 && queryTablesInOrder.length === 1) {
        const boundName = targetColumnLookup.get(parts[0].toLowerCase())
        if (boundName) {
          bindings.set(resultIndex, boundName)
        }
      }

      resultIndex++
      continue
    }

    if (resultIndex >= resultColumns.length) return new Map()
    resultIndex++
  }

  if (resultIndex !== resultColumns.length) {
    return new Map()
  }

  return bindings
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
  if (queryTablesInOrder.length !== 1 || !/\bFROM\b/i.test(sql)) {
    return false
  }

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

  if (projectionBindings.size === 0 && canUseDirectNameFallback(sql, queryTablesInOrder)) {
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
    const boundName = columnBindings?.get(columnIndex)
    if (hasExplicitBindings && !boundName) {
      map.set(columnIndex, false)
      continue
    }
    const resultColumnNameLower = resultColumns[columnIndex].name.toLowerCase()
    const columnNameLower = boundName?.toLowerCase() ?? resultColumnNameLower

    // Ambiguous columns can't be reliably mapped to a single source unless
    // we have an explicit projection binding for this result index.
    if (!boundName && ambiguousNames.has(resultColumnNameLower)) {
      map.set(columnIndex, false)
      continue
    }

    // Must match a column in the target table
    const tableColumn = tableColumnLookup.get(columnNameLower)
    if (!tableColumn) {
      map.set(columnIndex, false)
      continue
    }

    // Binary/blob columns aren't editable inline
    if (tableColumn.isBinary) {
      map.set(columnIndex, false)
      continue
    }

    map.set(columnIndex, true)
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
    if (!resultColumnNamesLower.has(primaryKeyLower) || ambiguousNames.has(primaryKeyLower)) {
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
    if (!isModified && !isInsertEligible) {
      continue
    }

    if (editState.currentValues[column.name] !== undefined) {
      values[column.name] = coerceValueForColumn(
        editState.currentValues[column.name],
        column.dataType
      )
    }
  }

  return values
}
