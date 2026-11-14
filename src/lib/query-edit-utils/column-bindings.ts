import type { ColumnMeta, QueryTableEditInfo } from '../../types/schema'
import type { QueryEditColumnBindings } from '../query-edit-utils'
import {
  buildProjectionBindings,
  canUseDirectNameFallback,
  removeDuplicateBoundColumns,
} from './projection-bindings'

export interface ColumnBindingInputs {
  sql: string | null
  resultColumns: ColumnMeta[]
  targetTable: QueryTableEditInfo
  queryTablesInOrder: QueryTableEditInfo[]
}

interface ColumnNameLookup {
  resultColumns: ColumnMeta[]
  tableColumnLookup: Map<string, string>
}

function bindUnambiguousColumnsByName(
  bindings: QueryEditColumnBindings,
  { resultColumns, tableColumnLookup }: ColumnNameLookup
): void {
  const ambiguousNames = findAmbiguousColumns(resultColumns)
  resultColumns.forEach((column, columnIndex) => {
    const resultNameLower = column.name.toLowerCase()
    if (ambiguousNames.has(resultNameLower)) return
    const boundName = tableColumnLookup.get(resultNameLower)
    if (boundName) bindings.set(columnIndex, boundName)
  })
}

export function buildQueryEditColumnBindings({
  sql,
  resultColumns,
  targetTable,
  queryTablesInOrder,
}: ColumnBindingInputs): QueryEditColumnBindings {
  const bindings: QueryEditColumnBindings = new Map()
  const tableColumnLookup = new Map(
    targetTable.columns.map((column) => [column.name.toLowerCase(), column.name])
  )

  const projectionBindings = buildProjectionBindings({
    sql: sql,
    resultColumns: resultColumns,
    targetTable: targetTable,
    queryTablesInOrder: queryTablesInOrder,
  })
  for (const [index, columnName] of projectionBindings) {
    bindings.set(index, columnName)
  }

  const shouldBindByColumnName =
    projectionBindings.size === 0 && canUseDirectNameFallback(sql, queryTablesInOrder)
  if (shouldBindByColumnName) {
    bindUnambiguousColumnsByName(bindings, { resultColumns, tableColumnLookup })
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
