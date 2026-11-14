import type { TableDataColumnMeta, RowEditState } from '../../types/schema'
import { getTemporalColumnType, getTodayMysqlString } from '../../lib/date-utils'
import type { TemporalColumnType } from '../../lib/date-utils'
import {
  blobPlaceholder,
  convertBinaryPrimaryKeyValuesToEnvelopes,
  isBlobEnvelope,
} from '../../lib/blob-utils'

const BASE64_BYTES_PER_GROUP = 3

const BASE64_CHARS_PER_GROUP = 4

const BASE64_DOUBLE_PADDING = '=='

const BASE64_SINGLE_PADDING = '='

const CURRENT_TIMESTAMP_DEFAULT = /^current_timestamp(?:\(\d+\))?$/i

const CURRENT_VALUE_DEFAULT_BY_TEMPORAL_TYPE: Partial<
  Record<NonNullable<TemporalColumnType>, RegExp>
> = {
  DATE: /^current_date(?:\(\))?$/i,
  TIME: /^current_time(?:\(\))?$/i,
}

function base64PaddingLength(base64: string): number {
  if (base64.endsWith(BASE64_DOUBLE_PADDING)) return BASE64_DOUBLE_PADDING.length
  if (base64.endsWith(BASE64_SINGLE_PADDING)) return BASE64_SINGLE_PADDING.length
  return 0
}

export function buildCurrentValuesFromRow(
  columns: TableDataColumnMeta[],
  rowValues: unknown[]
): Record<string, unknown> {
  const currentValues: Record<string, unknown> = {}
  for (let index = 0; index < columns.length; index += 1) {
    currentValues[columns[index].name] = rowValues[index]
  }
  return currentValues
}

export function coerceValueForColumn(value: unknown, dataType: string): unknown {
  if (isBlobEnvelope(value)) {
    return value
  }
  if (typeof value !== 'string') return value
  if (!isBitDataType(dataType)) return value
  const parsed = parseInt(value, 10)
  return isSafeNonNegativeInteger(parsed) ? parsed : value
}

function isBitDataType(dataType: string): boolean {
  return dataType.toUpperCase() === 'BIT'
}

function isSafeNonNegativeInteger(parsed: number): boolean {
  return !Number.isNaN(parsed) && parsed >= 0 && parsed <= Number.MAX_SAFE_INTEGER
}

export function buildInsertPayload(
  columns: TableDataColumnMeta[],
  editState: RowEditState
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const { modifiedColumns, currentValues } = editState
  for (const column of columns) {
    const currentValue = currentValues[column.name]
    if (!modifiedColumns.has(column.name)) continue
    if (currentValue === undefined) continue
    values[column.name] = coerceValueForColumn(currentValue, column.dataType)
  }
  return values
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

export type BuildUpdatePayloadResult =
  | {
      ok: true
      originalPkValues: Record<string, unknown>
      updatedValues: Record<string, unknown>
    }
  | { ok: false; error: string }

export function buildUpdatePayload(
  editState: RowEditState,
  primaryKeyColumns: string[],
  columns: TableDataColumnMeta[]
): BuildUpdatePayloadResult {
  const columnsByName = new Map(columns.map((column) => [column.name, column]))

  const updatedValues: Record<string, unknown> = {}
  for (const column of editState.modifiedColumns) {
    const columnMeta = columnsByName.get(column)
    const rawValue = editState.currentValues[column]
    updatedValues[column] = columnMeta
      ? coerceValueForColumn(rawValue, columnMeta.dataType)
      : rawValue
  }

  const originalPrimaryKeyValues: Record<string, unknown> = {}
  for (const primaryKeyColumn of primaryKeyColumns) {
    originalPrimaryKeyValues[primaryKeyColumn] = editState.originalValues[primaryKeyColumn]
  }

  const converted = convertBinaryPrimaryKeyValuesToEnvelopes(
    primaryKeyColumns,
    columns,
    originalPrimaryKeyValues
  )
  if (!converted.ok) {
    return { ok: false, error: converted.error }
  }

  return { ok: true, originalPkValues: converted.values, updatedValues: updatedValues }
}

export function reconcileSavedBlobValue(value: unknown): unknown {
  if (!isBlobEnvelope(value)) return value
  const envelope = value
  if (envelope.kind === 'null') return null
  if (envelope.kind === 'empty') return blobPlaceholder(0)
  let byteLength = 0
  if (typeof envelope.base64 === 'string') {
    const base64 = envelope.base64
    const padding = base64PaddingLength(base64)
    const decodedLength = Math.floor(
      (base64.length * BASE64_BYTES_PER_GROUP) / BASE64_CHARS_PER_GROUP
    )
    byteLength = Math.max(0, decodedLength - padding)
  }
  return blobPlaceholder(byteLength)
}

export function isSeededFromColumnDefault(column: TableDataColumnMeta): boolean {
  return column.columnDefault != null && !column.isAutoIncrement
}
