import type { TableDataColumnMeta } from '../types/schema'
import { isNullish } from './value-checks'

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

const WRAPPABLE_TEXT_TYPE_PREFIXES = ['TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT'] as const
const DATETIME_TYPE_PREFIXES = ['DATETIME', 'TIMESTAMP'] as const
const ENUM_OR_SET_TYPE_PREFIXES = ['ENUM', 'SET'] as const
const CHARACTER_TYPE_PREFIXES = ['VARCHAR', 'CHAR'] as const
const BINARY_TYPE_FRAGMENTS = ['BLOB', 'BINARY'] as const

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

export function isWrappableTextSqlType(dataType: string): boolean {
  const upperType = normalizedUpperType(dataType)
  return WRAPPABLE_TEXT_TYPE_PREFIXES.some((prefix) => upperType.startsWith(prefix))
}

export function isJsonSqlType(dataType: string): boolean {
  return normalizedUpperType(dataType) === 'JSON'
}

export function isStringishPrimarySqlType(dataType: string): boolean {
  const upperType = normalizedUpperType(dataType)
  return (
    upperType.startsWith('VARCHAR') ||
    upperType.startsWith('CHAR') ||
    isWrappableTextSqlType(upperType)
  )
}

const AUTO_WIDTH_MAX = 560

export const DEFAULT_COLUMN_WIDTH_PX = 150
export const HEADER_ICON_WIDTH_PX = 14

interface NullabilityWidths {
  nullable: number
  notNull: number
}

function widthForNullability(widths: NullabilityWidths, isNullable: boolean): number {
  return isNullable ? widths.nullable : widths.notNull
}

const DATETIME_AUTO_MIN_WIDTH: NullabilityWidths = { nullable: 300, notNull: 260 }
const DATETIME_AUTO_PADDING: NullabilityWidths = { nullable: 104, notNull: 72 }
const DATE_AUTO_MIN_WIDTH: NullabilityWidths = { nullable: 250, notNull: 220 }
const TIME_AUTO_MIN_WIDTH: NullabilityWidths = { nullable: 230, notNull: 200 }
const DATE_OR_TIME_AUTO_PADDING: NullabilityWidths = { nullable: 96, notNull: 64 }

export const AUTO_SIZE_SAMPLE_LIMIT = 100

interface ColumnWidthSizing {
  defaultWidth: number
  autoMinWidth: number
  autoCharPx: number
  autoPaddingPx: number
}

const BOOLEAN_COLUMN_SIZING: ColumnWidthSizing = {
  defaultWidth: 100,
  autoMinWidth: 90,
  autoCharPx: 8.5,
  autoPaddingPx: 28,
}

const NUMERIC_COLUMN_SIZING: ColumnWidthSizing = {
  defaultWidth: 120,
  autoMinWidth: 100,
  autoCharPx: 9,
  autoPaddingPx: 28,
}

const ENUM_OR_SET_COLUMN_SIZING: ColumnWidthSizing = {
  defaultWidth: 140,
  autoMinWidth: 150,
  autoCharPx: 10,
  autoPaddingPx: 36,
}

const CHARACTER_COLUMN_SIZING: ColumnWidthSizing = {
  defaultWidth: 200,
  autoMinWidth: 120,
  autoCharPx: 10,
  autoPaddingPx: 36,
}

const TEXT_COLUMN_SIZING: ColumnWidthSizing = {
  defaultWidth: 200,
  autoMinWidth: 180,
  autoCharPx: 10,
  autoPaddingPx: 40,
}

const JSON_COLUMN_SIZING: ColumnWidthSizing = {
  defaultWidth: 200,
  autoMinWidth: 200,
  autoCharPx: 10,
  autoPaddingPx: 40,
}

const BINARY_COLUMN_SIZING: ColumnWidthSizing = {
  defaultWidth: 140,
  autoMinWidth: 140,
  autoCharPx: 9,
  autoPaddingPx: 32,
}

const DEFAULT_COLUMN_SIZING: ColumnWidthSizing = {
  defaultWidth: 150,
  autoMinWidth: 90,
  autoCharPx: 9,
  autoPaddingPx: 32,
}

const TEMPORAL_CHAR_PX = 9
const DATETIME_DEFAULT_WIDTH = 180
const DATE_OR_TIME_DEFAULT_WIDTH = 120

function isBooleanColumnType(upperType: string): boolean {
  return upperType.startsWith('BOOL') || upperType === 'TINYINT(1)'
}

function getColumnWidthSizing(dataType: string, isNullable = false): ColumnWidthSizing {
  const upperType = dataType.trim().toUpperCase()
  if (isBooleanColumnType(upperType)) return BOOLEAN_COLUMN_SIZING
  if (isNumericSqlType(dataType)) return NUMERIC_COLUMN_SIZING
  const temporalSizing = temporalColumnWidthSizing(upperType, isNullable)
  if (temporalSizing) return temporalSizing
  return nonTemporalColumnWidthSizing(upperType)
}

function temporalColumnWidthSizing(
  upperType: string,
  isNullable: boolean
): ColumnWidthSizing | null {
  if (startsWithAny(upperType, DATETIME_TYPE_PREFIXES)) {
    return {
      defaultWidth: DATETIME_DEFAULT_WIDTH,
      autoMinWidth: widthForNullability(DATETIME_AUTO_MIN_WIDTH, isNullable),
      autoCharPx: TEMPORAL_CHAR_PX,
      autoPaddingPx: widthForNullability(DATETIME_AUTO_PADDING, isNullable),
    }
  }

  if (upperType.startsWith('DATE')) {
    return {
      defaultWidth: DATE_OR_TIME_DEFAULT_WIDTH,
      autoMinWidth: widthForNullability(DATE_AUTO_MIN_WIDTH, isNullable),
      autoCharPx: TEMPORAL_CHAR_PX,
      autoPaddingPx: widthForNullability(DATE_OR_TIME_AUTO_PADDING, isNullable),
    }
  }

  if (upperType.startsWith('TIME')) {
    return {
      defaultWidth: DATE_OR_TIME_DEFAULT_WIDTH,
      autoMinWidth: widthForNullability(TIME_AUTO_MIN_WIDTH, isNullable),
      autoCharPx: TEMPORAL_CHAR_PX,
      autoPaddingPx: widthForNullability(DATE_OR_TIME_AUTO_PADDING, isNullable),
    }
  }

  return null
}

function nonTemporalColumnWidthSizing(upperType: string): ColumnWidthSizing {
  if (startsWithAny(upperType, ENUM_OR_SET_TYPE_PREFIXES)) return ENUM_OR_SET_COLUMN_SIZING
  if (startsWithAny(upperType, CHARACTER_TYPE_PREFIXES)) {
    return CHARACTER_COLUMN_SIZING
  }
  if (upperType.includes('TEXT')) return TEXT_COLUMN_SIZING
  if (isJsonSqlType(upperType)) return JSON_COLUMN_SIZING
  if (includesAny(upperType, BINARY_TYPE_FRAGMENTS)) return BINARY_COLUMN_SIZING
  return DEFAULT_COLUMN_SIZING
}

function startsWithAny(upperType: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => upperType.startsWith(prefix))
}

function includesAny(upperType: string, fragments: readonly string[]): boolean {
  return fragments.some((fragment) => upperType.includes(fragment))
}

function stringifyGridValue(value: unknown): string {
  if (isNullish(value)) return 'NULL'
  return String(value)
}

export interface AutoSizedColumn {
  column: TableDataColumnMeta
  columnIndex: number
  rows: readonly unknown[][]
  displayName?: string
  headerIconWidthPx?: number
}

export function getAutoSizedColumnWidth({
  column,
  columnIndex,
  rows,
  displayName,
  headerIconWidthPx = 0,
}: AutoSizedColumn): number {
  const sizing = getColumnWidthSizing(column.dataType, column.isNullable)

  const HEADER_CHAR_PX = 8.5
  const HEADER_CELL_PADDING_PX = 48
  const HEADER_SUBPIXEL_BUFFER_PX = 12
  const HEADER_PADDING_PX = HEADER_CELL_PADDING_PX + HEADER_SUBPIXEL_BUFFER_PX
  const headerText = displayName ?? column.name
  const headerWidth = Math.ceil(
    headerText.length * HEADER_CHAR_PX + HEADER_PADDING_PX + headerIconWidthPx
  )

  let maxTextLength = 0
  const sampleCount = Math.min(rows.length, AUTO_SIZE_SAMPLE_LIMIT)

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const row = rows[sampleIndex]
    const value = row[columnIndex]
    const textLength = stringifyGridValue(value).length
    if (textLength > maxTextLength) {
      maxTextLength = textLength
    }
  }

  const dataWidth = Math.ceil(maxTextLength * sizing.autoCharPx + sizing.autoPaddingPx)
  const measuredWidth = Math.max(headerWidth, dataWidth)
  return Math.max(sizing.autoMinWidth, Math.min(AUTO_WIDTH_MAX, measuredWidth))
}

export function getDefaultColumnWidth(dataType: string): number {
  return getColumnWidthSizing(dataType).defaultWidth
}
