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
})

describe('isWrappableTextSqlType', () => {
  it('returns true for MySQL TEXT-family types', () => {
    expect(isWrappableTextSqlType('TEXT')).toBe(true)
    expect(isWrappableTextSqlType('tinytext')).toBe(true)
    expect(isWrappableTextSqlType('MEDIUMTEXT')).toBe(true)
    expect(isWrappableTextSqlType('LONGTEXT')).toBe(true)
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
})
