import { describe, it, expect } from 'vitest'
import { TextTableLayout } from '../../../../components/shared/data-view/text-format'
import type { ColumnMeta } from '../../../../types/schema'

describe('TextTableLayout', () => {
  it('returns empty text for zero columns', () => {
    const layout = TextTableLayout.fromRows([], [])
    expect(layout.fullText()).toBe('')
    expect(layout.lineLength).toBe(0)
  })

  it('truncates long values to max column width', () => {
    const cols: ColumnMeta[] = [{ name: 'val', dataType: 'VARCHAR' }]
    const longValue = 'a'.repeat(60)
    const layout = TextTableLayout.fromRows(cols, [[longValue]])
    const lines = layout.fullText().split('\n')
    // Max width capped at 40; the data line should be 40 chars
    expect(lines[2].length).toBe(40)
    expect(lines[2]).toContain('…') // contains ellipsis
    // Value should be truncated to 39 chars + ellipsis
    expect(lines[2].trimEnd().length).toBe(40)
    expect(lines[1]).toBe(layout.separatorLine())
    expect(layout.lineLength).toBe(40)
  })

  it('keeps every row on one aligned line when values hold line breaks, tabs and control characters', () => {
    const cols: ColumnMeta[] = [
      { name: 'address', dataType: 'TEXT' },
      { name: 'id', dataType: 'INT' },
    ]
    const layout = TextTableLayout.fromRows(cols, [
      ['8 North Street\r\nLocated on', 1],
      ['a\nb\rc', 2],
      ['x\ty\u0007z', 3],
    ])

    expect(layout.rowCount).toBe(3)
    expect(layout.rowLine(0)).toBe('8 North Street¶Located on  1 ')
    expect(layout.rowLine(1).startsWith('a¶b¶c ')).toBe(true)
    expect(layout.rowLine(2).startsWith('x»y z ')).toBe(true)
    const lines = [layout.headerLine(), layout.rowLine(0), layout.rowLine(1), layout.rowLine(2)]
    expect(lines.every((line) => line.length === layout.lineLength)).toBe(true)
    expect(layout.fullText().split('\n')).toHaveLength(5)
  })
})
