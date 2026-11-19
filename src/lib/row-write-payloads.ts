import type { BlobEnvelope, RowEditState, TableDataColumnMeta } from '../types/schema'
import {
  base64ByteLength,
  blobPlaceholder,
  convertBinaryPrimaryKeyValuesToEnvelopes,
  isBlobEnvelope,
  type ConvertBinaryPkValuesResult,
} from './blob-utils'

export type CellProjection = 'full' | 'blobPlaceholders'

export function coerceValueForColumn(value: unknown, dataType: string): unknown {
  if (isBlobEnvelope(value)) return value
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

function isInsertPayloadColumn(editState: RowEditState, column: TableDataColumnMeta): boolean {
  const isModified = editState.modifiedColumns.has(column.name)
  if (isModified) return true
  if (column.isAutoIncrement) return false
  return editState.insertEligibleColumns?.has(column.name) ?? false
}

export function buildInsertPayload(
  editState: RowEditState,
  tableColumns: TableDataColumnMeta[]
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const column of tableColumns) {
    if (!isInsertPayloadColumn(editState, column)) continue
    const currentValue = editState.currentValues[column.name]
    if (currentValue === undefined) continue
    values[column.name] = coerceValueForColumn(currentValue, column.dataType)
  }
  return values
}

export interface UpdatePayload {
  primaryKeyColumns: string[]
  originalPrimaryKeyValues: Record<string, unknown>
  updatedValues: Record<string, unknown>
}

export type BuildUpdatePayloadResult =
  { ok: true; payload: UpdatePayload } | { ok: false; error: string }

export interface UpdatePayloadInputs {
  editState: RowEditState
  keyColumns: string[]
  tableColumns: TableDataColumnMeta[]
  projection: CellProjection
}

type PrimaryKeyValueConversion = (
  keyColumns: string[],
  tableColumns: TableDataColumnMeta[],
  values: Record<string, unknown>
) => ConvertBinaryPkValuesResult

const PRIMARY_KEY_VALUE_CONVERSION: Record<CellProjection, PrimaryKeyValueConversion> = {
  full: (_keyColumns, _tableColumns, values) => ({ ok: true, values: values }),
  blobPlaceholders: convertBinaryPrimaryKeyValuesToEnvelopes,
}

function coercedUpdatedValues(
  editState: RowEditState,
  tableColumns: TableDataColumnMeta[]
): Record<string, unknown> {
  const columnsByName = new Map(tableColumns.map((column) => [column.name, column]))
  const updatedValues: Record<string, unknown> = {}
  for (const columnName of editState.modifiedColumns) {
    const rawValue = editState.currentValues[columnName]
    const columnMeta = columnsByName.get(columnName)
    updatedValues[columnName] = columnMeta
      ? coerceValueForColumn(rawValue, columnMeta.dataType)
      : rawValue
  }
  return updatedValues
}

export function buildUpdatePayload({
  editState,
  keyColumns,
  tableColumns,
  projection,
}: UpdatePayloadInputs): BuildUpdatePayloadResult {
  const originalPrimaryKeyValues: Record<string, unknown> = {}
  for (const keyColumn of keyColumns) {
    originalPrimaryKeyValues[keyColumn] = editState.rowKey[keyColumn]
  }
  const converted = PRIMARY_KEY_VALUE_CONVERSION[projection](
    keyColumns,
    tableColumns,
    originalPrimaryKeyValues
  )
  if (!converted.ok) return { ok: false, error: converted.error }
  return {
    ok: true,
    payload: {
      primaryKeyColumns: keyColumns,
      originalPrimaryKeyValues: converted.values,
      updatedValues: coercedUpdatedValues(editState, tableColumns),
    },
  }
}

const FULL_BLOB_VALUE_BY_KIND: Record<BlobEnvelope['kind'], (envelope: BlobEnvelope) => unknown> = {
  null: () => null,
  empty: () => '',
  bytes: (envelope) => envelope.base64 ?? '',
}

const PLACEHOLDER_BLOB_VALUE_BY_KIND: Record<
  BlobEnvelope['kind'],
  (envelope: BlobEnvelope) => unknown
> = {
  null: () => null,
  empty: () => blobPlaceholder(0),
  bytes: (envelope) => blobPlaceholder(base64ByteLength(envelope.base64 ?? '')),
}

const BLOB_VALUE_BY_PROJECTION: Record<CellProjection, typeof FULL_BLOB_VALUE_BY_KIND> = {
  full: FULL_BLOB_VALUE_BY_KIND,
  blobPlaceholders: PLACEHOLDER_BLOB_VALUE_BY_KIND,
}

export function projectSavedCellValue(value: unknown, projection: CellProjection): unknown {
  if (!isBlobEnvelope(value)) return value
  return BLOB_VALUE_BY_PROJECTION[projection][value.kind](value)
}
