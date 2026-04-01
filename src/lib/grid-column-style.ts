/**
 * Column CSS classes and default widths for data grid body cells — matches
 * inline_editable_grid_*_pro_sync_v2
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
  return dataType
    .trim()
    .toUpperCase()
    .replace(/\(\d+\)/, '')
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

/**
 * Consolidated cell class resolver for all data grids (table data + query result).
 *
 * When `pkColumnNames` is provided and `columnName` is in that list the column
 * gets the same mono-muted treatment as numeric types — matching the original
 * `getTableDataGridCellClass` behaviour.
 */
export function getGridCellClass(
  columnName: string,
  dataType: string,
  pkColumnNames?: string[]
): string {
  if ((pkColumnNames && pkColumnNames.includes(columnName)) || isNumericSqlType(dataType)) {
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

const AUTO_WIDTH_MAX = 560

interface ColumnWidthSizing {
  defaultWidth: number
  autoMinWidth: number
  autoCharPx: number
  autoPaddingPx: number
}

function getColumnWidthSizing(dataType: string, isNullable = false): ColumnWidthSizing {
  const upperType = dataType.trim().toUpperCase()

  if (upperType.startsWith('BOOL') || upperType === 'TINYINT(1)') {
    return {
      defaultWidth: 100,
      autoMinWidth: 90,
      autoCharPx: 8.5,
      autoPaddingPx: 28,
    }
  }

  if (isNumericSqlType(dataType)) {
    return {
      defaultWidth: 120,
      autoMinWidth: 100,
      autoCharPx: 9,
      autoPaddingPx: 28,
    }
  }

  if (upperType.startsWith('DATETIME') || upperType.startsWith('TIMESTAMP')) {
    return {
      defaultWidth: 180,
      autoMinWidth: isNullable ? 300 : 260,
      autoCharPx: 9,
      autoPaddingPx: isNullable ? 104 : 72,
    }
  }

  if (upperType.startsWith('DATE')) {
    return {
      defaultWidth: 120,
      autoMinWidth: isNullable ? 250 : 220,
      autoCharPx: 9,
      autoPaddingPx: isNullable ? 96 : 64,
    }
  }

  if (upperType.startsWith('TIME')) {
    return {
      defaultWidth: 120,
      autoMinWidth: isNullable ? 230 : 200,
      autoCharPx: 9,
      autoPaddingPx: isNullable ? 96 : 64,
    }
  }

  if (upperType.startsWith('ENUM') || upperType.startsWith('SET')) {
    return {
      defaultWidth: 140,
      autoMinWidth: 150,
      autoCharPx: 10,
      autoPaddingPx: 36,
    }
  }

  if (upperType.startsWith('VARCHAR') || upperType.startsWith('CHAR')) {
    return {
      defaultWidth: 200,
      autoMinWidth: 120,
      autoCharPx: 10,
      autoPaddingPx: 36,
    }
  }

  if (upperType.includes('TEXT')) {
    return {
      defaultWidth: 200,
      autoMinWidth: 180,
      autoCharPx: 10,
      autoPaddingPx: 40,
    }
  }

  if (upperType.includes('BLOB') || upperType.includes('BINARY')) {
    return {
      defaultWidth: 140,
      autoMinWidth: 140,
      autoCharPx: 9,
      autoPaddingPx: 32,
    }
  }

  return {
    defaultWidth: 150,
    autoMinWidth: 90,
    autoCharPx: 9,
    autoPaddingPx: 32,
  }
}

function stringifyGridValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  return String(value)
}

export function getAutoSizedColumnWidth(
  column: TableDataColumnMeta,
  columnIndex: number,
  rows: readonly unknown[][]
): number {
  const sizing = getColumnWidthSizing(column.dataType, column.isNullable)

  let maxTextLength = column.name.length

  for (const row of rows) {
    const value = row[columnIndex]
    const textLength = stringifyGridValue(value).length
    if (textLength > maxTextLength) {
      maxTextLength = textLength
    }
  }

  const measuredWidth = Math.ceil(maxTextLength * sizing.autoCharPx + sizing.autoPaddingPx)
  return Math.max(sizing.autoMinWidth, Math.min(AUTO_WIDTH_MAX, measuredWidth))
}

/** Default column width (in px) based on SQL data type — used by react-data-grid columns. */
export function getDefaultColumnWidth(dataType: string): number {
  return getColumnWidthSizing(dataType).defaultWidth
}
