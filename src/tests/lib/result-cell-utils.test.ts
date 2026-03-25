import { describe, it, expect } from 'vitest'
import { formatCellValue } from '../../lib/result-cell-utils'

describe('formatCellValue', () => {
  it('returns NULL display for null', () => {
    const result = formatCellValue(null)
    expect(result).toEqual({ displayValue: 'NULL', isNull: true })
  })

  it('returns NULL display for undefined', () => {
    const result = formatCellValue(undefined)
    expect(result).toEqual({ displayValue: 'NULL', isNull: true })
  })

  it('returns string value as-is', () => {
    const result = formatCellValue('hello')
    expect(result).toEqual({ displayValue: 'hello', isNull: false })
  })

  it('returns empty string as non-null', () => {
    const result = formatCellValue('')
    expect(result).toEqual({ displayValue: '', isNull: false })
  })

  it('converts number to string', () => {
    const result = formatCellValue(42)
    expect(result).toEqual({ displayValue: '42', isNull: false })
  })

  it('converts zero to string', () => {
    const result = formatCellValue(0)
    expect(result).toEqual({ displayValue: '0', isNull: false })
  })

  it('converts boolean true to string', () => {
    const result = formatCellValue(true)
    expect(result).toEqual({ displayValue: 'true', isNull: false })
  })

  it('converts boolean false to string', () => {
    const result = formatCellValue(false)
    expect(result).toEqual({ displayValue: 'false', isNull: false })
  })

  it('serializes object to JSON', () => {
    const result = formatCellValue({ key: 'val' })
    expect(result).toEqual({ displayValue: '{"key":"val"}', isNull: false })
  })

  it('serializes array to JSON', () => {
    const result = formatCellValue([1, 2, 3])
    expect(result).toEqual({ displayValue: '[1,2,3]', isNull: false })
  })

  it('converts float to string', () => {
    const result = formatCellValue(3.14)
    expect(result).toEqual({ displayValue: '3.14', isNull: false })
  })

  it('converts negative number to string', () => {
    const result = formatCellValue(-7)
    expect(result).toEqual({ displayValue: '-7', isNull: false })
  })
})
