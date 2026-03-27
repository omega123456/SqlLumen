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

  it('returns TIMESTAMP for "TIMESTAMP"', () => {
    expect(getTemporalColumnType('TIMESTAMP')).toBe('TIMESTAMP')
  })

  it('returns TIME for "TIME"', () => {
    expect(getTemporalColumnType('TIME')).toBe('TIME')
  })

  it('handles parameterized DATETIME(6)', () => {
    expect(getTemporalColumnType('DATETIME(6)')).toBe('DATETIME')
  })

  it('handles parameterized TIMESTAMP(3)', () => {
    expect(getTemporalColumnType('TIMESTAMP(3)')).toBe('TIMESTAMP')
  })

  it('handles lowercase "datetime"', () => {
    expect(getTemporalColumnType('datetime')).toBe('DATETIME')
  })

  it('handles mixed case "Timestamp(3)"', () => {
    expect(getTemporalColumnType('Timestamp(3)')).toBe('TIMESTAMP')
  })

  it('returns null for VARCHAR(255)', () => {
    expect(getTemporalColumnType('VARCHAR(255)')).toBeNull()
  })

  it('returns null for INT', () => {
    expect(getTemporalColumnType('INT')).toBeNull()
  })

  it('returns null for YEAR', () => {
    expect(getTemporalColumnType('YEAR')).toBeNull()
  })

  it('returns null for TINYINT', () => {
    expect(getTemporalColumnType('TINYINT')).toBeNull()
  })

  it('returns null for BLOB', () => {
    expect(getTemporalColumnType('BLOB')).toBeNull()
  })

  it('returns null for TEXT', () => {
    expect(getTemporalColumnType('TEXT')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(getTemporalColumnType('')).toBeNull()
  })

  it('handles whitespace around type', () => {
    expect(getTemporalColumnType('  DATE  ')).toBe('DATE')
  })

  it('returns null for BIGINT', () => {
    expect(getTemporalColumnType('BIGINT')).toBeNull()
  })

  it('returns null for DECIMAL', () => {
    expect(getTemporalColumnType('DECIMAL(10,2)')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isTemporalColumn
// ---------------------------------------------------------------------------

describe('isTemporalColumn', () => {
  it('returns true for DATE', () => {
    expect(isTemporalColumn('DATE')).toBe(true)
  })

  it('returns true for DATETIME', () => {
    expect(isTemporalColumn('DATETIME')).toBe(true)
  })

  it('returns true for TIMESTAMP', () => {
    expect(isTemporalColumn('TIMESTAMP')).toBe(true)
  })

  it('returns true for TIME', () => {
    expect(isTemporalColumn('TIME')).toBe(true)
  })

  it('returns true for DATETIME(6)', () => {
    expect(isTemporalColumn('DATETIME(6)')).toBe(true)
  })

  it('returns false for VARCHAR', () => {
    expect(isTemporalColumn('VARCHAR(255)')).toBe(false)
  })

  it('returns false for YEAR', () => {
    expect(isTemporalColumn('YEAR')).toBe(false)
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

  it('returns true for "0000-00-00 00:00:00"', () => {
    expect(isZeroDate('0000-00-00 00:00:00')).toBe(true)
  })

  it('returns false for "00:00:00" (valid midnight TIME, not a zero date)', () => {
    expect(isZeroDate('00:00:00')).toBe(false)
  })

  it('returns true for "0000-00-00T00:00:00"', () => {
    expect(isZeroDate('0000-00-00T00:00:00')).toBe(true)
  })

  it('returns true for "0000-00-00 00:00:00.000000"', () => {
    expect(isZeroDate('0000-00-00 00:00:00.000000')).toBe(true)
  })

  it('returns true for "0000-00-00 00:00:00.000"', () => {
    expect(isZeroDate('0000-00-00 00:00:00.000')).toBe(true)
  })

  it('returns false for valid date "2023-11-24"', () => {
    expect(isZeroDate('2023-11-24')).toBe(false)
  })

  it('returns false for valid datetime "2023-11-24 14:30:00"', () => {
    expect(isZeroDate('2023-11-24 14:30:00')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isZeroDate('')).toBe(false)
  })

  it('returns false for valid time "09:30:00"', () => {
    expect(isZeroDate('09:30:00')).toBe(false)
  })

  it('returns true for zero date with leading whitespace', () => {
    expect(isZeroDate(' 0000-00-00 ')).toBe(true)
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

  it('parses valid DATETIME string', () => {
    const result = parseMysqlDate('2023-11-24 14:30:45', 'DATETIME')
    expect(result).toBeInstanceOf(Date)
    expect(result?.getHours()).toBe(14)
    expect(result?.getMinutes()).toBe(30)
    expect(result?.getSeconds()).toBe(45)
  })

  it('parses valid TIMESTAMP string', () => {
    const result = parseMysqlDate('2023-11-24 08:15:00', 'TIMESTAMP')
    expect(result).toBeInstanceOf(Date)
    expect(result?.getFullYear()).toBe(2023)
  })

  it('parses valid TIME string', () => {
    const result = parseMysqlDate('09:30:00', 'TIME')
    expect(result).toBeInstanceOf(Date)
    expect(result?.getHours()).toBe(9)
    expect(result?.getMinutes()).toBe(30)
  })

  it('returns null for null input', () => {
    expect(parseMysqlDate(null, 'DATE')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseMysqlDate('', 'DATETIME')).toBeNull()
  })

  it('returns null for zero date "0000-00-00"', () => {
    expect(parseMysqlDate('0000-00-00', 'DATE')).toBeNull()
  })

  it('returns null for zero datetime "0000-00-00 00:00:00"', () => {
    expect(parseMysqlDate('0000-00-00 00:00:00', 'DATETIME')).toBeNull()
  })

  it('returns a valid midnight Date for TIME "00:00:00" (not null)', () => {
    const result = parseMysqlDate('00:00:00', 'TIME')
    expect(result).toBeInstanceOf(Date)
    expect(result?.getHours()).toBe(0)
    expect(result?.getMinutes()).toBe(0)
    expect(result?.getSeconds()).toBe(0)
  })

  it('parses DATETIME with fractional seconds (truncated to whole seconds)', () => {
    const result = parseMysqlDate('2024-01-15 10:30:00.123456', 'DATETIME')
    expect(result).toBeInstanceOf(Date)
    expect(result?.getFullYear()).toBe(2024)
    expect(result?.getMonth()).toBe(0) // January
    expect(result?.getDate()).toBe(15)
    expect(result?.getHours()).toBe(10)
    expect(result?.getMinutes()).toBe(30)
    expect(result?.getSeconds()).toBe(0)
  })

  it('parses TIMESTAMP with fractional seconds (truncated to whole seconds)', () => {
    const result = parseMysqlDate('2024-01-15 10:30:00.123', 'TIMESTAMP')
    expect(result).toBeInstanceOf(Date)
    expect(result?.getFullYear()).toBe(2024)
    expect(result?.getMonth()).toBe(0) // January
    expect(result?.getDate()).toBe(15)
    expect(result?.getHours()).toBe(10)
    expect(result?.getMinutes()).toBe(30)
    expect(result?.getSeconds()).toBe(0)
  })

  it('parses ISO-like DATETIME with T separator', () => {
    const result = parseMysqlDate('2024-01-15T10:30:00', 'DATETIME')
    expect(result).toBeInstanceOf(Date)
    expect(result?.getFullYear()).toBe(2024)
    expect(result?.getHours()).toBe(10)
  })

  it('returns null for invalid date string', () => {
    expect(parseMysqlDate('not-a-date', 'DATE')).toBeNull()
  })

  it('parses TIME with fractional seconds (truncated to whole seconds)', () => {
    const result = parseMysqlDate('12:34:56.123456', 'TIME')
    expect(result).toBeInstanceOf(Date)
    expect(result?.getHours()).toBe(12)
    expect(result?.getMinutes()).toBe(34)
    expect(result?.getSeconds()).toBe(56)
  })

  it('parses TIME(3) with 3-digit fractional seconds', () => {
    const result = parseMysqlDate('08:15:30.999', 'TIME')
    expect(result).toBeInstanceOf(Date)
    expect(result?.getHours()).toBe(8)
    expect(result?.getMinutes()).toBe(15)
    expect(result?.getSeconds()).toBe(30)
  })

  it('returns null for negative TIME values (unsupported by picker)', () => {
    expect(parseMysqlDate('-01:00:00', 'TIME')).toBeNull()
  })

  it('returns null for TIME values exceeding 23 hours (unsupported by picker)', () => {
    expect(parseMysqlDate('25:00:00', 'TIME')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// formatMysqlDate
// ---------------------------------------------------------------------------

describe('formatMysqlDate', () => {
  it('formats Date to DATE string', () => {
    const date = new Date(2023, 10, 24) // Nov 24, 2023
    expect(formatMysqlDate(date, 'DATE')).toBe('2023-11-24')
  })

  it('formats Date to DATETIME string', () => {
    const date = new Date(2023, 10, 24, 14, 30, 45)
    expect(formatMysqlDate(date, 'DATETIME')).toBe('2023-11-24 14:30:45')
  })

  it('formats Date to TIMESTAMP string', () => {
    const date = new Date(2023, 10, 24, 8, 15, 0)
    expect(formatMysqlDate(date, 'TIMESTAMP')).toBe('2023-11-24 08:15:00')
  })

  it('formats Date to TIME string', () => {
    const date = new Date(2023, 10, 24, 9, 30, 0)
    expect(formatMysqlDate(date, 'TIME')).toBe('09:30:00')
  })

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

  it('returns YYYY-MM-DD HH:mm:ss format for DATETIME type', () => {
    const result = getTodayMysqlString('DATETIME')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('returns YYYY-MM-DD HH:mm:ss format for TIMESTAMP type', () => {
    const result = getTodayMysqlString('TIMESTAMP')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('returns HH:mm:ss format for TIME type', () => {
    const result = getTodayMysqlString('TIME')
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/)
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

  it('returns "yyyy-MM-dd HH:mm:ss" for DATETIME', () => {
    expect(getMysqlFormatString('DATETIME')).toBe('yyyy-MM-dd HH:mm:ss')
  })

  it('returns "yyyy-MM-dd HH:mm:ss" for TIMESTAMP', () => {
    expect(getMysqlFormatString('TIMESTAMP')).toBe('yyyy-MM-dd HH:mm:ss')
  })

  it('returns "HH:mm:ss" for TIME', () => {
    expect(getMysqlFormatString('TIME')).toBe('HH:mm:ss')
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

  it('each config has format, parseFormats, and dateFnsFormat', () => {
    for (const key of ['DATE', 'DATETIME', 'TIMESTAMP', 'TIME'] as const) {
      const cfg = TEMPORAL_CONFIGS[key]
      expect(cfg).toHaveProperty('format')
      expect(cfg).toHaveProperty('parseFormats')
      expect(cfg).toHaveProperty('dateFnsFormat')
      expect(Array.isArray(cfg.parseFormats)).toBe(true)
      expect(cfg.parseFormats.length).toBeGreaterThan(0)
    }
  })

  it('DATETIME has ISO-like fallback parse format', () => {
    expect(TEMPORAL_CONFIGS.DATETIME.parseFormats).toContain("yyyy-MM-dd'T'HH:mm:ss")
  })

  it('dateFnsFormat matches getMysqlFormatString for each type', () => {
    expect(TEMPORAL_CONFIGS.DATE.dateFnsFormat).toBe(getMysqlFormatString('DATE'))
    expect(TEMPORAL_CONFIGS.DATETIME.dateFnsFormat).toBe(getMysqlFormatString('DATETIME'))
    expect(TEMPORAL_CONFIGS.TIMESTAMP.dateFnsFormat).toBe(getMysqlFormatString('TIMESTAMP'))
    expect(TEMPORAL_CONFIGS.TIME.dateFnsFormat).toBe(getMysqlFormatString('TIME'))
  })
})

// ---------------------------------------------------------------------------
// validateTemporalValue
// ---------------------------------------------------------------------------

describe('validateTemporalValue', () => {
  it('returns null for a valid DATE string', () => {
    expect(validateTemporalValue('2023-11-24', 'DATE')).toBeNull()
  })

  it('returns null for a valid DATETIME string', () => {
    expect(validateTemporalValue('2023-11-24 14:30:45', 'DATETIME')).toBeNull()
  })

  it('returns null for a valid TIMESTAMP string', () => {
    expect(validateTemporalValue('2023-11-24 08:15:00', 'TIMESTAMP')).toBeNull()
  })

  it('returns null for a valid TIME string', () => {
    expect(validateTemporalValue('09:30:00', 'TIME')).toBeNull()
  })

  it('returns error string for invalid DATE "not-a-date"', () => {
    const result = validateTemporalValue('not-a-date', 'DATE')
    expect(result).not.toBeNull()
    expect(result).toContain('Invalid DATE')
    expect(result).toContain('YYYY-MM-DD')
  })

  it('returns error string for invalid DATETIME "garbage"', () => {
    const result = validateTemporalValue('garbage', 'DATETIME')
    expect(result).not.toBeNull()
    expect(result).toContain('Invalid DATETIME')
    expect(result).toContain('YYYY-MM-DD HH:mm:ss')
  })

  it('returns error string for invalid TIME "25:00:00"', () => {
    const result = validateTemporalValue('25:00:00', 'TIME')
    expect(result).not.toBeNull()
    expect(result).toContain('Invalid TIME')
  })

  it('returns null for null value', () => {
    expect(validateTemporalValue(null, 'DATE')).toBeNull()
  })

  it('returns null for undefined value', () => {
    expect(validateTemporalValue(undefined, 'DATETIME')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(validateTemporalValue('', 'TIME')).toBeNull()
  })

  it('returns null for zero date "0000-00-00" with DATE type (passes through)', () => {
    expect(validateTemporalValue('0000-00-00', 'DATE')).toBeNull()
  })

  it('returns null for zero datetime "0000-00-00 00:00:00" with DATETIME type', () => {
    expect(validateTemporalValue('0000-00-00 00:00:00', 'DATETIME')).toBeNull()
  })

  it('returns null for midnight "00:00:00" with TIME type (valid)', () => {
    expect(validateTemporalValue('00:00:00', 'TIME')).toBeNull()
  })

  it('returns error for random text in TIMESTAMP column', () => {
    const result = validateTemporalValue('hello world', 'TIMESTAMP')
    expect(result).not.toBeNull()
    expect(result).toContain('Invalid TIMESTAMP')
  })

  it('returns null for null type with valid datetime string', () => {
    expect(validateTemporalValue('2024-01-15 10:30:00', null)).toBeNull()
  })

  it('returns error for null type with invalid string', () => {
    const result = validateTemporalValue('not-valid', null)
    expect(result).not.toBeNull()
    expect(result).toContain('Invalid date')
  })
})
