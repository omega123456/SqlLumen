import { describe, it, expect } from 'vitest'
import { formatCellValue } from '../../lib/result-cell-utils'

describe('formatCellValue', () => {
  it('returns NULL display for null', () => {
    const result = formatCellValue(null)
    expect(result).toEqual({ displayValue: 'NULL', isNull: true })
  })

  it('serializes array to JSON', () => {
    const result = formatCellValue([1, 2, 3])
    expect(result).toEqual({ displayValue: '[1,2,3]', isNull: false })
  })
})
