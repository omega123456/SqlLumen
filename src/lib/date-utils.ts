/**
 * Date utilities for MySQL temporal column types.
 *
 * Provides parsing, formatting, and type detection for MySQL DATE, DATETIME,
 * TIMESTAMP, and TIME columns. Uses date-fns for all date manipulation.
 */

import { format, parse, isValid, startOfToday } from 'date-fns'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** MySQL temporal column types supported by the date picker. */
export type TemporalColumnType = 'DATE' | 'DATETIME' | 'TIMESTAMP' | 'TIME' | null

// ---------------------------------------------------------------------------
// Temporal configuration — single source of truth for format strings
// ---------------------------------------------------------------------------

/** Configuration for a single MySQL temporal column type. */
interface TemporalConfig {
  /** Human-readable format string (e.g., 'YYYY-MM-DD HH:mm:ss'). */
  format: string
  /** date-fns format strings to try when parsing. First valid match wins. */
  parseFormats: string[]
  /** date-fns format string used for formatting output. */
  dateFnsFormat: string
}

/** Shared config for DATETIME and TIMESTAMP (identical semantics). */
const DATETIME_CONFIG: TemporalConfig = {
  format: 'YYYY-MM-DD HH:mm:ss',
  parseFormats: ['yyyy-MM-dd HH:mm:ss', "yyyy-MM-dd'T'HH:mm:ss"],
  dateFnsFormat: 'yyyy-MM-dd HH:mm:ss',
}

/**
 * Canonical configuration for all MySQL temporal column types.
 * DATETIME and TIMESTAMP share the same config object.
 */
export const TEMPORAL_CONFIGS: Record<NonNullable<TemporalColumnType>, TemporalConfig> = {
  DATE: {
    format: 'YYYY-MM-DD',
    parseFormats: ['yyyy-MM-dd'],
    dateFnsFormat: 'yyyy-MM-dd',
  },
  DATETIME: DATETIME_CONFIG,
  TIMESTAMP: DATETIME_CONFIG,
  TIME: {
    format: 'HH:mm:ss',
    parseFormats: ['HH:mm:ss'],
    dateFnsFormat: 'HH:mm:ss',
  },
}

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

/**
 * Detect the temporal column type from a MySQL data type string.
 * Handles parameterized variants like `DATETIME(6)`, `TIMESTAMP(3)`.
 * Returns null for non-temporal types (including YEAR).
 */
export function getTemporalColumnType(dataType: string): TemporalColumnType {
  // Normalize: uppercase, trim, strip parenthesized precision
  const normalized = dataType
    .trim()
    .toUpperCase()
    .replace(/\(\d+\)/, '')

  switch (normalized) {
    case 'DATE':
      return 'DATE'
    case 'DATETIME':
      return 'DATETIME'
    case 'TIMESTAMP':
      return 'TIMESTAMP'
    case 'TIME':
      return 'TIME'
    default:
      return null
  }
}

/**
 * Returns true if the given data type string represents a temporal column
 * (DATE, DATETIME, TIMESTAMP, or TIME).
 */
export function isTemporalColumn(dataType: string): boolean {
  return getTemporalColumnType(dataType) !== null
}

// ---------------------------------------------------------------------------
// Zero-date detection
// ---------------------------------------------------------------------------

/** MySQL zero date/time patterns. `00:00:00` is intentionally excluded — it is a valid TIME (midnight). */
const ZERO_DATE_PATTERNS = [
  '0000-00-00',
  '0000-00-00 00:00:00',
  '0000-00-00T00:00:00',
  '0000-00-00 00:00:00.000000',
  '0000-00-00 00:00:00.000',
]

/**
 * Returns true if the value is a MySQL zero date/time string.
 * Zero dates represent unset temporal values in MySQL.
 */
export function isZeroDate(value: string): boolean {
  if (!value) return false
  const trimmed = value.trim()
  return ZERO_DATE_PATTERNS.includes(trimmed) || /^0{4}-0{2}-0{2}/.test(trimmed)
}

// ---------------------------------------------------------------------------
// Format strings
// ---------------------------------------------------------------------------

/**
 * Returns the date-fns format string for the given temporal column type.
 * Returns 'yyyy-MM-dd HH:mm:ss' as default for null types.
 */
export function getMysqlFormatString(type: TemporalColumnType): string {
  if (type === null) return TEMPORAL_CONFIGS.DATETIME.dateFnsFormat
  return TEMPORAL_CONFIGS[type].dateFnsFormat
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a MySQL date/time string to a JavaScript Date object.
 * Returns null for null, empty, or zero date values.
 */
export function parseMysqlDate(value: string | null, type: TemporalColumnType): Date | null {
  if (value === null || value === undefined || value === '') return null
  // Zero-date check only for non-TIME types — 00:00:00 is a valid TIME (midnight)
  if (type !== 'TIME' && isZeroDate(value)) return null

  const config = type !== null ? TEMPORAL_CONFIGS[type] : TEMPORAL_CONFIGS.DATETIME
  const refDate = new Date(2000, 0, 1)

  // Strip fractional seconds (e.g., ".123456"). The picker works at whole-second
  // precision; fractional seconds are truncated. Safe for all types — DATE values
  // never end with fractional seconds so the regex is a no-op.
  const cleaned = value.trim().replace(/\.\d+$/, '')

  // Try each parse format in order — first valid match wins.
  for (const fmt of config.parseFormats) {
    const parsed = parse(cleaned, fmt, refDate)
    if (isValid(parsed)) return parsed
  }

  return null
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a JavaScript Date to a MySQL date/time string.
 * Returns null for null date input.
 */
export function formatMysqlDate(date: Date | null, type: TemporalColumnType): string | null {
  if (date === null) return null
  if (!isValid(date)) return null

  const formatStr = getMysqlFormatString(type)
  return format(date, formatStr)
}

// ---------------------------------------------------------------------------
// Today helper
// ---------------------------------------------------------------------------

/**
 * Validates a string value for a given temporal column type.
 * Returns null if valid, or an error message string if invalid.
 * Null/empty values are considered valid (use NULL toggle for null intent).
 * Zero dates are valid (they pass through to MySQL as-is).
 */
export function validateTemporalValue(
  value: string | null | undefined,
  type: TemporalColumnType
): string | null {
  // null/undefined/empty = valid (not our concern — NULL toggle handles null intent)
  if (value === null || value === undefined || value === '') return null
  // Zero dates pass through as-is — MySQL handles them
  if (type !== 'TIME' && isZeroDate(value)) return null

  // Try to parse — if parseMysqlDate returns null, it's invalid
  const parsed = parseMysqlDate(value, type)
  if (parsed === null) {
    const formatStr = type ? TEMPORAL_CONFIGS[type].format : 'YYYY-MM-DD HH:mm:ss'
    return `Invalid ${type ?? 'date'} value. Expected format: ${formatStr}`
  }
  return null
}

// ---------------------------------------------------------------------------
// Today helper
// ---------------------------------------------------------------------------

/**
 * Returns today's date/current time formatted as a MySQL string for the given type.
 */
export function getTodayMysqlString(type: TemporalColumnType): string {
  const now = new Date()
  if (type === null) return format(now, TEMPORAL_CONFIGS.DATETIME.dateFnsFormat)

  const config = TEMPORAL_CONFIGS[type]
  // DATE uses startOfToday() to avoid time component; all others use current time
  const base = type === 'DATE' ? startOfToday() : now
  return format(base, config.dateFnsFormat)
}
