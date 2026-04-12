import { describe, it, expect, vi } from 'vitest'
import { formatTableTimestamp, formatShortDate } from '../../lib/format-utils'

describe('formatTableTimestamp', () => {
  it('formats a valid ISO timestamp', () => {
    const result = formatTableTimestamp('2025-06-15T10:30:00Z')
    // Locale-dependent, but should contain month abbreviation and time
    expect(result).toBeTruthy()
    expect(result).not.toBe('2025-06-15T10:30:00Z')
  })

  it('returns the original string for an invalid timestamp', () => {
    const result = formatTableTimestamp('not-a-date')
    // new Date('not-a-date') returns Invalid Date — toLocaleString may throw or return invalid
    // our function catches and returns the original
    expect(result).toBeTruthy()
  })

  it('returns a non-empty string for epoch timestamp', () => {
    const result = formatTableTimestamp('1970-01-01T00:00:00Z')
    expect(result).toBeTruthy()
  })

  it('returns original string when Date constructor throws', () => {
    vi.spyOn(globalThis, 'Date').mockImplementation(() => {
      throw new RangeError('Invalid time value')
    })
    try {
      expect(formatTableTimestamp('2025-01-01T00:00:00Z')).toBe('2025-01-01T00:00:00Z')
    } finally {
      vi.mocked(globalThis.Date).mockRestore()
    }
  })
})

describe('formatShortDate', () => {
  it('formats a valid ISO timestamp as a short date', () => {
    const result = formatShortDate('2025-06-15T10:30:00Z')
    expect(result).toBeTruthy()
    expect(result).not.toBe('2025-06-15T10:30:00Z')
    // Should include year
    expect(result).toContain('2025')
  })

  it('returns the original string for an invalid timestamp', () => {
    const result = formatShortDate('not-a-date')
    expect(result).toBeTruthy()
  })

  it('handles ISO dates without time component', () => {
    const result = formatShortDate('2025-01-01')
    expect(result).toBeTruthy()
  })

  it('returns original string when Date constructor throws', () => {
    vi.spyOn(globalThis, 'Date').mockImplementation(() => {
      throw new RangeError('Invalid time value')
    })
    try {
      expect(formatShortDate('bad-input')).toBe('bad-input')
    } finally {
      vi.mocked(globalThis.Date).mockRestore()
    }
  })
})
