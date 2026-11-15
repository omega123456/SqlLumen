import type { TableDataColumnMeta } from '../../types/schema'

export const ENUM_NULL_SENTINEL = '__MYSQL_CLIENT_ENUM_NULL__'

export function isEnumColumn(
  columnMeta?: TableDataColumnMeta
): columnMeta is TableDataColumnMeta & { enumValues: string[] } {
  return Array.isArray(columnMeta?.enumValues) && columnMeta.enumValues.length > 0
}

export function isSetColumn(
  columnMeta?: TableDataColumnMeta
): columnMeta is TableDataColumnMeta & { setValues: string[] } {
  return Array.isArray(columnMeta?.setValues) && columnMeta.setValues.length > 0
}

export function getEnumFallbackValue(columnMeta?: TableDataColumnMeta): string {
  return isEnumColumn(columnMeta) ? (columnMeta.enumValues[0] ?? '') : ''
}

export function parseSetCellValue(rawValue: unknown): string[] | null {
  if (rawValue == null) {
    return null
  }

  if (Array.isArray(rawValue)) {
    return rawValue.map((value) => String(value))
  }

  const serialized = String(rawValue)
  if (serialized === '') {
    return []
  }

  return serialized
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

export function serializeSetCellValue(values: string[] | null | undefined): string | null {
  if (values == null) {
    return null
  }

  return values.join(',')
}
