import type { ColumnMeta, QueryTableEditInfo } from '../../types/schema'
import { isSameTextIgnoringCase } from '../value-checks'
import type { QueryEditColumnBindings } from '../query-edit-utils'
import type { ColumnBindingInputs } from './column-bindings'
import {
  extractTopLevelSelectList,
  normalizeIdentifier,
  splitQualifiedIdentifier,
  splitTopLevelSelectItems,
} from './select-list-scanner'

const DATABASE_AND_TABLE_PART_COUNT = 2

const DATABASE_TABLE_AND_COLUMN_PART_COUNT = 3

const TABLE_AND_COLUMN_PART_COUNT = 2

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

interface AliasTarget {
  database: string
  table: string
}

function resolveAliasTarget(
  target: string[],
  queryTablesInOrder: QueryTableEditInfo[]
): AliasTarget | null {
  if (target.length === DATABASE_AND_TABLE_PART_COUNT) {
    return { database: target[0], table: target[1] }
  }
  if (target.length !== 1) return null
  const tableName = target[0].toLowerCase()
  const resolved = queryTablesInOrder.find((table) =>
    isSameTextIgnoringCase(table.table, tableName)
  )
  if (!resolved) return null
  return { database: resolved.database, table: resolved.table }
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
    const alias = normalizeIdentifier(match[2]).toLowerCase()
    if (!alias) continue
    const target = resolveAliasTarget(splitQualifiedIdentifier(match[1]), queryTablesInOrder)
    if (target) map.set(alias, target)
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

export function buildProjectionBindings({
  sql,
  resultColumns,
  targetTable,
  queryTablesInOrder,
}: ColumnBindingInputs): QueryEditColumnBindings {
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

export function removeDuplicateBoundColumns(
  bindings: QueryEditColumnBindings
): QueryEditColumnBindings {
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

export function canUseDirectNameFallback(
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
