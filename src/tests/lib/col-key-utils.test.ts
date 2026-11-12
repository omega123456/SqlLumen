/**
 * Tests for col_N key protocol utilities used by query-result wrappers.
 */

import { describe, it, expect } from 'vitest'
import { columnKey, columnIndexFromKey, buildTableColumnLookup } from '../../lib/col-key-utils'
import type { TableDataColumnMeta } from '../../types/schema'

describe('colKey', () => {
  it('builds col_0 from index 0', () => {
    expect(columnKey(0)).toBe('col_0')
  })

  it('builds col_42 from index 42', () => {
    expect(columnKey(42)).toBe('col_42')
  })
})

describe('columnIndexFromKey', () => {
  it('parses 0 from col_0', () => {
    expect(columnIndexFromKey('col_0')).toBe(0)
  })

  it('parses 42 from col_42', () => {
    expect(columnIndexFromKey('col_42')).toBe(42)
  })

  it('returns NaN for malformed key', () => {
    expect(columnIndexFromKey('not_a_key')).toBeNaN()
  })
})

describe('buildTableColumnLookup', () => {
  const makeCol = (name: string): TableDataColumnMeta => ({
    name,
    dataType: 'VARCHAR(255)',
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    isBinary: false,
    isBooleanAlias: false,
    hasDefault: false,
    columnDefault: null,
    isAutoIncrement: false,
  })

  it('returns empty map for empty input', () => {
    const map = buildTableColumnLookup([])
    expect(map.size).toBe(0)
  })

  it('builds a case-insensitive lookup by lowercase key', () => {
    const cols = [makeCol('Name'), makeCol('Email')]
    const map = buildTableColumnLookup(cols)
    expect(map.size).toBe(2)
    expect(map.get('name')?.name).toBe('Name')
    expect(map.get('email')?.name).toBe('Email')
  })

  it('allows lookup via lowercased input', () => {
    const cols = [makeCol('FooBar')]
    const map = buildTableColumnLookup(cols)
    expect(map.has('foobar')).toBe(true)
    expect(map.has('FooBar')).toBe(false)
    expect(map.has('FOOBAR')).toBe(false)
  })
})
