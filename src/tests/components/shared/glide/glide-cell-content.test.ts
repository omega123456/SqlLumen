import { describe, expect, it } from 'vitest'
import {
  classifyCellValue,
  buildBlobCell,
  buildNullCell,
  buildTextCell,
} from '../../../../components/shared/glide/glide-cell-content'

describe('glide-cell-content', () => {
  it('classifies normal text cells', () => {
    const cell = classifyCellValue('abc', 'name')
    expect(cell.isNull).toBe(false)
    expect(cell.displayValue).toBe('abc')
  })
  it('classifies NULL cells', () => {
    expect(classifyCellValue(null, 'name').displayValue).toBe('NULL')
    expect(classifyCellValue(undefined, 'name').isNull).toBe(true)
    expect(buildNullCell().allowOverlay).toBe(false)
  })
  it('classifies BLOB cells', () => {
    const cell = classifyCellValue('[BLOB 12 B]', 'data')
    expect(cell.isBlob).toBe(true)
    expect(cell.displayValue).toBe('[BLOB 12 B]')
    expect(buildBlobCell(cell.displayValue).style).toBe('faded')
  })
  it('classifies visual state flags', () => {
    const cell = classifyCellValue('1', 'fk_id', {
      isModified: true,
      isReadOnly: true,
      isFkCell: true,
      highlightedColumnKey: 'fk_id',
    })
    expect(cell.isModified).toBe(true)
    expect(cell.isReadOnly).toBe(true)
    expect(cell.isFkCell).toBe(true)
    expect(cell.isHighlightedColumn).toBe(true)
    expect(buildTextCell(cell.displayValue, cell).style).toBe('faded')
  })
})
