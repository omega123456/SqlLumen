/**
 * Column CSS classes for AG Grid body cells — matches inline_editable_grid_*_pro_sync_v2
 * (mono + muted for PK/numeric, mono for temporal, body + primary for string types).
 */

import { getTemporalColumnType } from './date-utils'
import type { TableDataColumnMeta } from '../types/schema'

const NUMERIC_TYPE_PREFIXES = [
  'INT',
  'INTEGER',
  'TINYINT',
  'SMALLINT',
  'MEDIUMINT',
  'BIGINT',
  'FLOAT',
  'DOUBLE',
  'DECIMAL',
  'NUMERIC',
  'REAL',
] as const

export function isNumericSqlType(dataType: string): boolean {
  const upperType = dataType.toUpperCase()
  return NUMERIC_TYPE_PREFIXES.some((prefix) => upperType.startsWith(prefix))
}

function normalizedUpperType(dataType: string): string {
  return dataType.trim().toUpperCase().replace(/\(\d+\)/, '')
}

export function isStringishPrimarySqlType(dataType: string): boolean {
  const u = normalizedUpperType(dataType)
  return (
    u.startsWith('VARCHAR') ||
    u.startsWith('CHAR') ||
    u.startsWith('TEXT') ||
    u.startsWith('TINYTEXT') ||
    u.startsWith('MEDIUMTEXT') ||
    u.startsWith('LONGTEXT')
  )
}

export function getTableDataGridCellClass(col: TableDataColumnMeta, pkColumnNames: string[]): string {
  if (pkColumnNames.includes(col.name) || isNumericSqlType(col.dataType)) {
    return 'td-cell-mono-muted'
  }
  if (getTemporalColumnType(col.dataType)) {
    return 'td-cell-mono'
  }
  if (isStringishPrimarySqlType(col.dataType)) {
    return 'td-cell-body td-cell-primary'
  }
  return 'td-cell-body'
}

export function getResultGridCellClass(dataType: string): string {
  if (isNumericSqlType(dataType)) {
    return 'td-cell-mono-muted'
  }
  if (getTemporalColumnType(dataType)) {
    return 'td-cell-mono'
  }
  if (isStringishPrimarySqlType(dataType)) {
    return 'td-cell-body td-cell-primary'
  }
  return 'td-cell-body'
}
