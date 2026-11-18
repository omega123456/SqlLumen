import { getTemporalColumnType, getTodayMysqlString } from './date-utils'
import type { TemporalColumnType } from './date-utils'
import type { TableDataColumnMeta } from '../types/schema'
import { isGeneratedColumn } from './column-capabilities'

const CURRENT_TIMESTAMP_DEFAULT = /^current_timestamp(?:\(\d+\))?$/i

const CURRENT_VALUE_DEFAULT_BY_TEMPORAL_TYPE: Partial<
  Record<NonNullable<TemporalColumnType>, RegExp>
> = {
  DATE: /^current_date(?:\(\))?$/i,
  TIME: /^current_time(?:\(\))?$/i,
}

function normalizeColumnDefaultValue(columnDefault: string): unknown {
  const trimmedDefault = columnDefault.trim()

  if (/^null$/i.test(trimmedDefault)) {
    return null
  }

  const quotedMatch = trimmedDefault.match(/^'(.*)'$/s)
  if (quotedMatch) {
    return quotedMatch[1].replace(/''/g, "'")
  }

  return trimmedDefault
}

export function getInitialValueForNewRow(column: TableDataColumnMeta): unknown {
  if (column.isAutoIncrement) {
    return null
  }

  if (column.columnDefault == null) {
    return null
  }

  const temporalType = getTemporalColumnType(column.dataType)
  if (!temporalType) return normalizeColumnDefaultValue(column.columnDefault)
  if (isCurrentTemporalDefault(column.columnDefault, temporalType)) {
    return getTodayMysqlString(temporalType)
  }
  return normalizeColumnDefaultValue(column.columnDefault)
}

function isCurrentTemporalDefault(
  columnDefault: string,
  temporalType: NonNullable<TemporalColumnType>
): boolean {
  if (CURRENT_TIMESTAMP_DEFAULT.test(columnDefault)) return true
  const currentValueDefault = CURRENT_VALUE_DEFAULT_BY_TEMPORAL_TYPE[temporalType]
  return currentValueDefault?.test(columnDefault) === true
}

export function isSeededFromColumnDefault(column: TableDataColumnMeta): boolean {
  return column.columnDefault != null && !column.isAutoIncrement
}

export function isCopiedIntoClone(
  column: TableDataColumnMeta,
  keyColumns: readonly string[]
): boolean {
  if (column.isAutoIncrement) return false
  if (isGeneratedColumn(column)) return false
  const isBinaryKeyColumn = column.isBinary && keyColumns.includes(column.name)
  return !isBinaryKeyColumn
}
