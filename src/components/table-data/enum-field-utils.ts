import type { TableDataColumnMeta } from '../../types/schema'

export const ENUM_NULL_SENTINEL = '__MYSQL_CLIENT_ENUM_NULL__'

export function isEnumColumn(
  columnMeta?: TableDataColumnMeta
): columnMeta is TableDataColumnMeta & { enumValues: string[] } {
  return Array.isArray(columnMeta?.enumValues) && columnMeta.enumValues.length > 0
}

export function getEnumFallbackValue(columnMeta?: TableDataColumnMeta): string {
  return isEnumColumn(columnMeta) ? (columnMeta.enumValues[0] ?? '') : ''
}
