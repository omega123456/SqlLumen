import { describe, it, expect } from 'vitest'
import { formatTextOutput } from '../../../components/query-editor/result-text-format'
import type { ColumnMeta } from '../../../types/schema'

describe('formatTextOutput', () => {
  it('returns empty string for zero columns', () => {
    expect(formatTextOutput([], [])).toBe('')
  })

  it('truncates long values to max column width', () => {
    const cols: ColumnMeta[] = [{ name: 'val', dataType: 'VARCHAR' }]
    const longValue = 'a'.repeat(60)
    const longRows: unknown[][] = [[longValue]]
    const result = formatTextOutput(cols, longRows)
    const lines = result.split('\n')
    // Max width capped at 40; the data line should be 40 chars
    expect(lines[2].length).toBe(40)
    expect(lines[2]).toContain('…') // contains ellipsis
    // Value should be truncated to 39 chars + ellipsis
    expect(lines[2].trimEnd().length).toBe(40)
  })
})
