/**
 * Tests for the grid column type helpers and auto-sizing.
 */

import { describe, it, expect } from 'vitest'
import {
  getAutoSizedColumnWidth,
  isJsonSqlType,
  isNumericSqlType,
  isWrappableTextSqlType,
} from '../../lib/grid-column-style'
import type { TableDataColumnMeta } from '../../types/schema'

// ---------------------------------------------------------------------------
// Helper exports
// ---------------------------------------------------------------------------

describe('isNumericSqlType', () => {
  it('returns true for integer types', () => {
    expect(isNumericSqlType('INT')).toBe(true)
    expect(isNumericSqlType('BIGINT')).toBe(true)
    expect(isNumericSqlType('TINYINT')).toBe(true)
  })

  it('returns true for decimal types', () => {
    expect(isNumericSqlType('DECIMAL(10,2)')).toBe(true)
    expect(isNumericSqlType('NUMERIC')).toBe(true)
    expect(isNumericSqlType('FLOAT')).toBe(true)
    expect(isNumericSqlType('DOUBLE')).toBe(true)
  })

  it('returns false for non-numeric types', () => {
    expect(isNumericSqlType('VARCHAR(255)')).toBe(false)
    expect(isNumericSqlType('TEXT')).toBe(false)
    expect(isNumericSqlType('DATETIME')).toBe(false)
    expect(isNumericSqlType('BLOB')).toBe(false)
  })
})

describe('isWrappableTextSqlType', () => {
  it('returns true for MySQL TEXT-family types', () => {
    expect(isWrappableTextSqlType('TEXT')).toBe(true)
    expect(isWrappableTextSqlType('tinytext')).toBe(true)
    expect(isWrappableTextSqlType('MEDIUMTEXT')).toBe(true)
    expect(isWrappableTextSqlType('LONGTEXT')).toBe(true)
  })

  it('returns false for non-TEXT string columns', () => {
    expect(isWrappableTextSqlType('VARCHAR(255)')).toBe(false)
    expect(isWrappableTextSqlType('CHAR(10)')).toBe(false)
    expect(isWrappableTextSqlType('JSON')).toBe(false)
  })
})

describe('isJsonSqlType', () => {
  it('returns true only for the MySQL JSON type', () => {
    expect(isJsonSqlType('JSON')).toBe(true)
    expect(isJsonSqlType(' json ')).toBe(true)
    expect(isJsonSqlType('LONGTEXT')).toBe(false)
    expect(isJsonSqlType('VARCHAR(255)')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getAutoSizedColumnWidth — FK icon offset (headerIconWidthPx)
// ---------------------------------------------------------------------------

describe('getAutoSizedColumnWidth', () => {
  function makeColumnMeta(
    name: string,
    dataType: string,
    overrides: Partial<TableDataColumnMeta> = {}
  ): TableDataColumnMeta {
    return {
      name,
      dataType,
      isNullable: false,
      isPrimaryKey: false,
      isUniqueKey: false,
      hasDefault: false,
      columnDefault: null,
      isBinary: false,
      isBooleanAlias: false,
      isAutoIncrement: false,
      ...overrides,
    }
  }

  it('returns a wider width when headerIconWidthPx is provided', () => {
    const col = makeColumnMeta('USER_ID', 'BIGINT')
    const rows: unknown[][] = [[42]]
    const withoutIcon = getAutoSizedColumnWidth({
      column: col,
      columnIndex: 0,
      rows: rows,
      displayName: 'USER_ID',
      headerIconWidthPx: 0,
    })
    const withIcon = getAutoSizedColumnWidth({
      column: col,
      columnIndex: 0,
      rows: rows,
      displayName: 'USER_ID',
      headerIconWidthPx: 14,
    })
    expect(withIcon).toBeGreaterThan(withoutIcon)
  })

  it('FK icon offset of 14px produces the expected difference when header dominates', () => {
    // Use a name long enough that headerWidth exceeds autoMinWidth,
    // so the icon offset directly increases the result.
    const col = makeColumnMeta('USER_ID', 'BIGINT')
    const rows: unknown[][] = [[1]]
    const base = getAutoSizedColumnWidth({
      column: col,
      columnIndex: 0,
      rows: rows,
      displayName: 'USER_ID',
      headerIconWidthPx: 0,
    })
    const withFk = getAutoSizedColumnWidth({
      column: col,
      columnIndex: 0,
      rows: rows,
      displayName: 'USER_ID',
      headerIconWidthPx: 14,
    })
    // The difference should be exactly 14px (ceil applied to the sum)
    expect(withFk - base).toBe(14)
  })

  it('headerIconWidthPx defaults to 0 when omitted', () => {
    const col = makeColumnMeta('USER_ID', 'BIGINT')
    const rows: unknown[][] = [[42]]
    const explicit = getAutoSizedColumnWidth({
      column: col,
      columnIndex: 0,
      rows: rows,
      displayName: 'USER_ID',
      headerIconWidthPx: 0,
    })
    const implicit = getAutoSizedColumnWidth({
      column: col,
      columnIndex: 0,
      rows: rows,
      displayName: 'USER_ID',
    })
    expect(implicit).toBe(explicit)
  })

  it('samples only the first 100 rows and ignores rows beyond that limit', () => {
    const col = makeColumnMeta('title', 'VARCHAR')
    // 100 rows with a short value
    const shortRows: unknown[][] = Array.from({ length: 100 }, () => ['hi'])
    // Same 100 rows plus one extra row with a very long value (row index 100)
    const rowsWithLongTail: unknown[][] = [...shortRows, ['a'.repeat(500)]]

    const widthShortOnly = getAutoSizedColumnWidth({
      column: col,
      columnIndex: 0,
      rows: shortRows,
      displayName: 'title',
    })
    const widthWithTail = getAutoSizedColumnWidth({
      column: col,
      columnIndex: 0,
      rows: rowsWithLongTail,
      displayName: 'title',
    })

    // Row 101 is beyond AUTO_SIZE_SAMPLE_LIMIT (100), so the widths must be equal
    expect(widthWithTail).toBe(widthShortOnly)
  })
})
