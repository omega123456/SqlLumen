import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ResultTextView, formatTextOutput } from '../../../components/query-editor/ResultTextView'
import type { ColumnMeta } from '../../../types/schema'

// Mock the clipboard utility
const mockWriteClipboardText = vi.fn().mockResolvedValue(undefined)
vi.mock('../../../lib/context-menu-utils', () => ({
  writeClipboardText: (...args: unknown[]) => mockWriteClipboardText(...args),
}))

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

beforeEach(() => {
  vi.clearAllMocks()
})

// ── formatTextOutput unit tests ──────────────────────────────────────────

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
    // Row 2 has null email
    expect(result).toContain('NULL')
  })

  it('shows NULL for undefined values', () => {
    const result = formatTextOutput(columns, [[1, undefined, 'test']])
    expect(result).toContain('NULL')
  })

  it('pads columns to max width with spaces', () => {
    const result = formatTextOutput(columns, rows)
    const lines = result.split('\n')
    // Separator line is a reliable width reference since '─' doesn't get trimmed
    const separatorLen = lines[1].length
    // "id" col: max(2, 1) = 2, "name" col: max(4, 7) = 7, "email" col: max(5, 19) = 19
    // Total = 2 + 2(sep) + 7 + 2(sep) + 19 = 32
    expect(separatorLen).toBe(32)
    // Data rows: values are padded to their column widths
    // Row 0: "1 " + "  " + "Alice  " + "  " + "alice@example.com  "
    // The full row (including trailing padding) should equal separator length
    expect(lines[2].length).toBe(separatorLen)
  })

  it('uses two-space separator between columns', () => {
    const simpleCols: ColumnMeta[] = [
      { name: 'a', dataType: 'INT' },
      { name: 'b', dataType: 'INT' },
    ]
    const simpleRows: unknown[][] = [[1, 2]]
    const result = formatTextOutput(simpleCols, simpleRows)
    // With single-char columns, the output should be "a  b" (2-space sep)
    expect(result.split('\n')[0]).toBe('a  b')
  })

  it('caps column width at 40 characters', () => {
    const longCol: ColumnMeta[] = [{ name: 'x'.repeat(50), dataType: 'VARCHAR' }]
    const longRows: unknown[][] = [['short']]
    const result = formatTextOutput(longCol, longRows)
    const lines = result.split('\n')
    // Max width is capped at 40, and header name (50 chars) gets truncated
    // to 39 chars + '…' = 40 chars. Separator is exactly 40 dashes.
    const separatorLen = lines[1].length
    expect(separatorLen).toBe(40)
    // Header should be exactly 40 chars wide (truncated)
    expect(lines[0].length).toBe(40)
    expect(lines[0]).toContain('\u2026') // contains ellipsis
  })

  it('truncates long values to max column width', () => {
    const cols: ColumnMeta[] = [{ name: 'val', dataType: 'VARCHAR' }]
    const longValue = 'a'.repeat(60)
    const longRows: unknown[][] = [[longValue]]
    const result = formatTextOutput(cols, longRows)
    const lines = result.split('\n')
    // Max width capped at 40; the data line should be 40 chars
    expect(lines[2].length).toBe(40)
    expect(lines[2]).toContain('\u2026') // contains ellipsis
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

// ── ResultTextView component tests ───────────────────────────────────────

describe('ResultTextView', () => {
  it('renders with data-testid="result-text-view"', () => {
    render(<ResultTextView columns={columns} rows={rows} />)
    expect(screen.getByTestId('result-text-view')).toBeInTheDocument()
  })

  it('shows column names in the formatted output', () => {
    render(<ResultTextView columns={columns} rows={rows} />)
    const pre = screen.getByTestId('result-text-view').querySelector('pre')
    expect(pre).toBeTruthy()
    expect(pre!.textContent).toContain('id')
    expect(pre!.textContent).toContain('name')
    expect(pre!.textContent).toContain('email')
  })

  it('shows formatted rows with values', () => {
    render(<ResultTextView columns={columns} rows={rows} />)
    const pre = screen.getByTestId('result-text-view').querySelector('pre')
    expect(pre!.textContent).toContain('Alice')
    expect(pre!.textContent).toContain('Bob')
    expect(pre!.textContent).toContain('Charlie')
  })

  it('shows NULL as "NULL" text for null values', () => {
    render(<ResultTextView columns={columns} rows={rows} />)
    const pre = screen.getByTestId('result-text-view').querySelector('pre')
    // Row 2 has null email
    expect(pre!.textContent).toContain('NULL')
  })

  it('renders the Copy All button with correct data-testid', () => {
    render(<ResultTextView columns={columns} rows={rows} />)
    expect(screen.getByTestId('copy-all-button')).toBeInTheDocument()
  })

  it('Copy All button calls writeClipboardText with formatted text', async () => {
    render(<ResultTextView columns={columns} rows={rows} />)
    fireEvent.click(screen.getByTestId('copy-all-button'))
    await waitFor(() => {
      expect(mockWriteClipboardText).toHaveBeenCalledTimes(1)
    })
    // The argument should be the formatted text
    const arg = mockWriteClipboardText.mock.calls[0][0] as string
    expect(arg).toContain('id')
    expect(arg).toContain('Alice')
    expect(arg).toContain('NULL')
  })

  it('renders with empty columns and rows', () => {
    render(<ResultTextView columns={[]} rows={[]} />)
    expect(screen.getByTestId('result-text-view')).toBeInTheDocument()
  })

  it('renders with data but no rows', () => {
    render(<ResultTextView columns={columns} rows={[]} />)
    const pre = screen.getByTestId('result-text-view').querySelector('pre')
    // Should show header and separator but no data rows
    expect(pre!.textContent).toContain('id')
    expect(pre!.textContent).not.toContain('Alice')
  })

  it('Copy All button text says "Copy All"', () => {
    render(<ResultTextView columns={columns} rows={rows} />)
    expect(screen.getByTestId('copy-all-button')).toHaveTextContent('Copy All')
  })
})
