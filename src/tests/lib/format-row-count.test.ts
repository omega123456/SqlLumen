import { describe, expect, it } from 'vitest'
import {
  formatCount,
  formatRowCountParts,
  formatRowRange,
  type RowCountInput,
} from '../../lib/format-row-count'

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

  it('formats a filtered count against the live total', () => {
    expect(formatRowCount({ ...base, viewRowCount: 2340, isFiltered: true })).toBe(
      '2,340 of 12,340 rows'
    )
  })

  it('formats a truncated count', () => {
    expect(
      formatRowCount({ ...base, viewRowCount: 100000, totalRows: 100000, truncated: true })
    ).toBe('100,000+ rows · truncated')
  })

  it('formats a filtered and truncated count', () => {
    expect(
      formatRowCount({
        ...base,
        viewRowCount: 2340,
        totalRows: 100000,
        isFiltered: true,
        truncated: true,
      })
    ).toBe('2,340 of 100,000+ rows · truncated')
  })

  it('formats the auto-limit segment from the applied (clamped) limit', () => {
    expect(
      formatRowCount({
        ...base,
        viewRowCount: 1000,
        totalRows: 1000,
        autoLimitApplied: true,
        appliedRowLimit: 1000,
      })
    ).toBe('1,000 rows · 1,000-row limit applied')
  })

  it('shows only the truncated segment when both would apply', () => {
    const parts = formatRowCountParts({
      ...base,
      totalRows: 1000,
      viewRowCount: 1000,
      truncated: true,
      autoLimitApplied: true,
      appliedRowLimit: 1000,
    })
    expect(parts).toEqual({
      count: '1,000+ rows',
      segment: 'truncated',
      segmentKind: 'truncated',
    })
  })

  it('omits the auto-limit segment when no limit was injected', () => {
    expect(formatRowCountParts({ ...base, autoLimitApplied: true, appliedRowLimit: null })).toEqual(
      { count: '12,340 rows', segment: null, segmentKind: null }
    )
  })
})

describe('formatCount / formatRowRange', () => {
  it('formats numbers with locale separators', () => {
    expect(formatCount(1234567)).toBe('1,234,567')
  })

  it('formats a 1-based inclusive range', () => {
    expect(formatRowRange(12001, 13000)).toBe('12,001–13,000')
  })
})
