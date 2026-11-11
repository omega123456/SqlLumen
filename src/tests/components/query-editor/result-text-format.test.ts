import { describe, it, expect } from 'vitest'
import { formatTextOutput } from '../../../components/query-editor/result-text-format'
import type { ColumnMeta } from '../../../types/schema'

const columns: ColumnMeta[] = [
  { name: 'id', dataType: 'INT' },
  { name: 'name', dataType: 'VARCHAR' },
  { name: 'email', dataType: 'VARCHAR' },
]

const rows: unknown[][] = [
  [1, 'Alice', 'alice@example.com'],
  [2, 'Bob', null],
  [3, 'Charlie', 'charlie@example.com'],
]

describe('formatTextOutput', () => {
  it('returns empty string for zero columns', () => {
    expect(formatTextOutput([], [])).toBe('')
  })

  it('formats column names in the header', () => {
    const result = formatTextOutput(columns, rows)
    const lines = result.split('\n')
    // Header should contain column names
    expect(lines[0]).toContain('id')
    expect(lines[0]).toContain('name')
    expect(lines[0]).toContain('email')
  })

  it('formats separator line with box-drawing dashes', () => {
    const result = formatTextOutput(columns, rows)
    const lines = result.split('\n')
    // Separator line (second line) should contain ─ characters
    expect(lines[1]).toMatch(/─/)
    expect(lines[1]).not.toMatch(/[a-zA-Z0-9]/)
  })

  it('formats data rows correctly', () => {
    const result = formatTextOutput(columns, rows)
    const lines = result.split('\n')
    // Should have header + separator + 3 data rows = 5 lines
    expect(lines.length).toBe(5)
  })

  it('shows NULL for null values', () => {
    const result = formatTextOutput(columns, rows)
    expect(result).toContain('NULL')
  })

  it('caps column width at 40 characters', () => {
    const longName = 'a'.repeat(50)
    const cols: ColumnMeta[] = [{ name: longName, dataType: 'VARCHAR' }]
    const result = formatTextOutput(cols, [])
    const lines = result.split('\n')
    // Max width is capped at 40, and header name (50 chars) gets truncated
    // to 39 chars + '…' = 40 chars. Separator is exactly 40 dashes.
    const separatorLen = lines[1].length
    expect(separatorLen).toBe(40)
    // Header should be exactly 40 chars wide (truncated)
    expect(lines[0].length).toBe(40)
    expect(lines[0]).toContain('…') // contains ellipsis
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

  it('handles rows with only NULL values', () => {
    const result = formatTextOutput(columns, [[null, null, null]])
    const lines = result.split('\n')
    expect(lines.length).toBe(3) // header + separator + 1 row
    expect(lines[2]).toContain('NULL')
  })

  it('handles empty rows array (just header + separator)', () => {
    const result = formatTextOutput(columns, [])
    const lines = result.split('\n')
    expect(lines.length).toBe(2) // header + separator only
  })
})
