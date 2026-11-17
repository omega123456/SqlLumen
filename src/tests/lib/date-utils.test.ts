import { describe, it, expect } from 'vitest'
import {
  getTemporalColumnType,
  isTemporalColumn,
  isZeroDate,
  parseMysqlDate,
  formatMysqlDate,
  getTodayMysqlString,
  getMysqlFormatString,
  validateTemporalValue,
  TEMPORAL_CONFIGS,
} from '../../lib/date-utils'

// ---------------------------------------------------------------------------
// getTemporalColumnType
// ---------------------------------------------------------------------------

describe('getTemporalColumnType', () => {
  it('returns DATE for "DATE"', () => {
    expect(getTemporalColumnType('DATE')).toBe('DATE')
  })

  it('returns DATETIME for "DATETIME"', () => {
    expect(getTemporalColumnType('DATETIME')).toBe('DATETIME')
  })
})

// ---------------------------------------------------------------------------
// isTemporalColumn
// ---------------------------------------------------------------------------

describe('isTemporalColumn', () => {
  it('returns true for DATE', () => {
    expect(isTemporalColumn('DATE')).toBe(true)
  })

  it('returns false for INT', () => {
    expect(isTemporalColumn('INT')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isZeroDate
// ---------------------------------------------------------------------------

describe('isZeroDate', () => {
  it('returns true for "0000-00-00"', () => {
    expect(isZeroDate('0000-00-00')).toBe(true)
  })

  it('returns false for empty string', () => {
    expect(isZeroDate('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseMysqlDate
// ---------------------------------------------------------------------------

describe('parseMysqlDate', () => {
  it('parses valid DATE string', () => {
    const result = parseMysqlDate('2023-11-24', 'DATE')
    expect(result).toBeInstanceOf(Date)
    expect(result?.getFullYear()).toBe(2023)
    expect(result?.getMonth()).toBe(10) // 0-indexed
    expect(result?.getDate()).toBe(24)
  })

  it('returns null for zero datetime "0000-00-00 00:00:00"', () => {
    expect(parseMysqlDate('0000-00-00 00:00:00', 'DATETIME')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// formatMysqlDate
// ---------------------------------------------------------------------------

describe('formatMysqlDate', () => {
  it('returns null for null input', () => {
    expect(formatMysqlDate(null, 'DATE')).toBeNull()
  })

  it('returns null for invalid date', () => {
    expect(formatMysqlDate(new Date('invalid'), 'DATE')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getTodayMysqlString
// ---------------------------------------------------------------------------

describe('getTodayMysqlString', () => {
  it('returns YYYY-MM-DD format for DATE type', () => {
    const result = getTodayMysqlString('DATE')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns YYYY-MM-DD HH:mm:ss format for null type', () => {
    const result = getTodayMysqlString(null)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})

// ---------------------------------------------------------------------------
// getMysqlFormatString
// ---------------------------------------------------------------------------

describe('getMysqlFormatString', () => {
  it('returns "yyyy-MM-dd" for DATE', () => {
    expect(getMysqlFormatString('DATE')).toBe('yyyy-MM-dd')
  })

  it('returns default format for null type', () => {
    expect(getMysqlFormatString(null)).toBe('yyyy-MM-dd HH:mm:ss')
  })
})

// ---------------------------------------------------------------------------
// TEMPORAL_CONFIGS
// ---------------------------------------------------------------------------

describe('TEMPORAL_CONFIGS', () => {
  it('contains entries for all four temporal types', () => {
    expect(TEMPORAL_CONFIGS).toHaveProperty('DATE')
    expect(TEMPORAL_CONFIGS).toHaveProperty('DATETIME')
    expect(TEMPORAL_CONFIGS).toHaveProperty('TIMESTAMP')
    expect(TEMPORAL_CONFIGS).toHaveProperty('TIME')
  })

  it('DATETIME and TIMESTAMP share the same config object', () => {
    expect(TEMPORAL_CONFIGS.DATETIME).toBe(TEMPORAL_CONFIGS.TIMESTAMP)
  })
})

// ---------------------------------------------------------------------------
// validateTemporalValue
// ---------------------------------------------------------------------------

describe('validateTemporalValue', () => {
  it('returns null for empty string', () => {
    expect(validateTemporalValue('', 'TIME')).toBeNull()
  })

  it('returns null for zero datetime "0000-00-00 00:00:00" with DATETIME type', () => {
    expect(validateTemporalValue('0000-00-00 00:00:00', 'DATETIME')).toBeNull()
  })

  it('returns error for null type with invalid string', () => {
    const result = validateTemporalValue('not-valid', null)
    expect(result).not.toBeNull()
    expect(result).toContain('Invalid date')
  })
})
