/**
 * Tests for col_N key protocol utilities used by query-result wrappers.
 */

import { describe, it, expect } from 'vitest'
import { columnKey, columnIndexFromKey, buildTableColumnLookup } from '../../lib/col-key-utils'

describe('colKey', () => {
  it('builds col_0 from index 0', () => {
    expect(columnKey(0)).toBe('col_0')
  })
})

describe('columnIndexFromKey', () => {
  it('parses 0 from col_0', () => {
    expect(columnIndexFromKey('col_0')).toBe(0)
  })
})

describe('buildTableColumnLookup', () => {
  it('returns empty map for empty input', () => {
    const map = buildTableColumnLookup([])
    expect(map.size).toBe(0)
  })
})
