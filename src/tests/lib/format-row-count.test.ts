import { describe, expect, it } from 'vitest'
import { formatCount, formatRowCountParts, type RowCountInput } from '../../lib/format-row-count'

const base: RowCountInput = {
  viewRowCount: 12340,
  totalRows: 12340,
  isFiltered: false,
  truncated: false,
  autoLimitApplied: false,
  appliedRowLimit: null,
}

/** The unified row-count line as the toolbar renders it: count, then " · segment". */
function formatRowCount(input: RowCountInput): string {
  const parts = formatRowCountParts(input)
  return parts.segment ? `${parts.count} · ${parts.segment}` : parts.count
}

describe('formatRowCountParts as one line (wireframe 3)', () => {
  it('formats a plain count with locale separators', () => {
    expect(formatRowCount(base)).toBe('12,340 rows')
  })

  it('uses the singular for one row', () => {
    expect(formatRowCount({ ...base, viewRowCount: 1, totalRows: 1 })).toBe('1 row')
  })
})

describe('formatCount / formatRowRange', () => {
  it('formats numbers with locale separators', () => {
    expect(formatCount(1234567)).toBe('1,234,567')
  })
})
