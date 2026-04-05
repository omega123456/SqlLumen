import type {
  ColumnMeta,
  QueryTableEditInfo,
  TableDataColumnMeta,
  RowEditState,
} from '../types/schema'
import { stripLeadingSqlComments } from './sql-utils'

export type QueryEditColumnBindings = Map<number, string>

function normalizeIdentifier(identifier: string): string {
  const trimmed = identifier.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return trimmed.slice(1, -1).replace(/``/g, '`')
  }
  return trimmed
}

function splitQualifiedIdentifier(identifier: string): string[] {
  const parts: string[] = []
  let current = ''
  let inBackticks = false

  for (let i = 0; i < identifier.length; i++) {
    const char = identifier[i]

    if (char === '`') {
      current += char
      if (inBackticks && identifier[i + 1] === '`') {
        current += '`'
        i++
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

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]
    const next = trimmed[i + 1] ?? ''

    if (inSingle) {
      if (char === '\\') {
        i++
      } else if (char === "'") {
        inSingle = false
      }
      continue
    }

    if (inDouble) {
      if (char === '\\') {
        i++
      } else if (char === '"') {
        inDouble = false
      }
      continue
    }

    if (inBacktick) {
      if (char === '`' && next === '`') {
        i++
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
      const end = trimmed.indexOf('*/', i + 2)
      if (end === -1) return null
      i = end + 1
      continue
    }

    if (char === '-' && next === '-') {
      const end = trimmed.indexOf('\n', i + 2)
      if (end === -1) return null
      i = end
      continue
    }

    if (char === '#') {
      const end = trimmed.indexOf('\n', i + 1)
      if (end === -1) return null
      i = end
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

    const remaining = trimmed.slice(i)
    if (selectStart === -1 && /^SELECT\b/i.test(remaining)) {
      selectStart = i + 6
      i += 5
      continue
    }

    if (selectStart !== -1 && /^FROM\b/i.test(remaining)) {
      return trimmed.slice(selectStart, i).trim()
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

  for (let i = 0; i < selectList.length; i++) {
    const char = selectList[i]
    const next = selectList[i + 1] ?? ''

    if (inSingle) {
      current += char
      if (char === '\\') {
        current += next
        i++
      } else if (char === "'") {
        inSingle = false
      }
      continue
    }

    if (inDouble) {
      current += char
      if (char === '\\') {
        current += next
        i++
      } else if (char === '"') {
        inDouble = false
      }
      continue
    }

    if (inBacktick) {
      current += char
      if (char === '`' && next === '`') {
        current += next
        i++
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
      const end = selectList.indexOf('*/', i + 2)
      if (end === -1) {
        break
      }
      i = end + 1
      continue
    }

    if (char === '-' && next === '-') {
      const end = selectList.indexOf('\n', i + 2)
      if (end === -1) {
        break
      }
      i = end
      continue
    }

    if (char === '#') {
      const end = selectList.indexOf('\n', i + 1)
      if (end === -1) {
        break
      }
      i = end
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

  if (qualifierParts.length === 2) {
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

    if (target.length === 2) {
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
    targetTable.columns.map((col) => [col.name.toLowerCase(), col.name])
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

      if (parts.length === 3) {
        if (
          parts[0].toLowerCase() === targetTable.database.toLowerCase() &&
          parts[1].toLowerCase() === targetTable.table.toLowerCase()
        ) {
          const boundName = targetColumnLookup.get(parts[2].toLowerCase())
          if (boundName) {
            bindings.set(resultIndex, boundName)
          }
        }
      } else if (parts.length === 2) {
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
    targetTable.columns.map((col) => [col.name.toLowerCase(), col.name])
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
    for (let i = 0; i < resultColumns.length; i++) {
      const resultNameLower = resultColumns[i].name.toLowerCase()
      if (ambiguousNames.has(resultNameLower)) {
        continue
      }

      const boundName = tableColumnLookup.get(resultNameLower)
      if (boundName) {
        bindings.set(i, boundName)
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
  for (const col of columns) {
    const lower = col.name.toLowerCase()
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
  const tableColLookup = new Map<string, TableDataColumnMeta>()
  for (const tc of tableColumns) {
    tableColLookup.set(tc.name.toLowerCase(), tc)
  }

  for (let i = 0; i < resultColumns.length; i++) {
    const boundName = columnBindings?.get(i)
    if (hasExplicitBindings && !boundName) {
      map.set(i, false)
      continue
    }
    const resultColNameLower = resultColumns[i].name.toLowerCase()
    const colNameLower = boundName?.toLowerCase() ?? resultColNameLower

    // Ambiguous columns can't be reliably mapped to a single source unless
    // we have an explicit projection binding for this result index.
    if (!boundName && ambiguousNames.has(resultColNameLower)) {
      map.set(i, false)
      continue
    }

    // Must match a column in the target table
    const tableCol = tableColLookup.get(colNameLower)
    if (!tableCol) {
      map.set(i, false)
      continue
    }

    // Binary/blob columns aren't editable inline
    if (tableCol.isBinary) {
      map.set(i, false)
      continue
    }

    map.set(i, true)
  }

  return map
}

/**
 * Validates that all PK/unique key columns are present AND non-ambiguous
 * in the result set.
 */
export function validateKeyColumnsPresent(
  pkColumns: string[],
  resultColumns: ColumnMeta[],
  ambiguousNames: Set<string>,
  boundColumnIndexMap?: Map<string, number>
): { valid: boolean; missingColumns: string[] } {
  if (boundColumnIndexMap) {
    const missingColumns = pkColumns.filter((pk) => !boundColumnIndexMap.has(pk.toLowerCase()))
    return {
      valid: missingColumns.length === 0,
      missingColumns,
    }
  }

  const resultColNamesLower = new Set(resultColumns.map((c) => c.name.toLowerCase()))
  const missingColumns: string[] = []

  for (const pk of pkColumns) {
    const pkLower = pk.toLowerCase()
    if (!resultColNamesLower.has(pkLower) || ambiguousNames.has(pkLower)) {
      missingColumns.push(pk)
    }
  }

  return {
    valid: missingColumns.length === 0,
    missingColumns,
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
  pkColumnNames: string[],
  columnBindings?: QueryEditColumnBindings,
  boundColumnIndexMap?: Map<string, number>
): RowEditState {
  const originalValues: Record<string, unknown> = {}
  const currentValues: Record<string, unknown> = {}
  const rowKey: Record<string, unknown> = {}

  for (let i = 0; i < resultColumns.length; i++) {
    const colName = columnBindings?.get(i) ?? resultColumns[i].name
    if (editableMap.get(i)) {
      originalValues[colName] = row[i]
      currentValues[colName] = row[i]
    }
  }

  // Build rowKey from PK columns (always populated, regardless of editability)
  for (const pkCol of pkColumnNames) {
    const idx =
      boundColumnIndexMap?.get(pkCol.toLowerCase()) ??
      resultColumns.findIndex((c) => c.name.toLowerCase() === pkCol.toLowerCase())
    if (idx !== -1) {
      rowKey[pkCol] = row[idx]
    }
  }

  return {
    rowKey,
    originalValues,
    currentValues,
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
  pkColumnNames: string[]
): {
  pkColumns: string[]
  originalPkValues: Record<string, unknown>
  updatedValues: Record<string, unknown>
} {
  const originalPkValues: Record<string, unknown> = {}
  for (const pk of pkColumnNames) {
    originalPkValues[pk] = editState.rowKey[pk]
  }

  const updatedValues: Record<string, unknown> = {}
  for (const col of editState.modifiedColumns) {
    updatedValues[col] = editState.currentValues[col]
  }

  return {
    pkColumns: pkColumnNames,
    originalPkValues,
    updatedValues,
  }
}
