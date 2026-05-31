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

  it('renders a staged bytes envelope as [BLOB - N bytes*]', () => {
    // "hi" → base64 "aGk=" (2 bytes)
    const cell = classifyCellValue(
      { __sqllumen_blob__: true, kind: 'bytes', base64: 'aGk=' },
      'photo',
      { isModified: true }
    )
    expect(cell.isBlob).toBe(true)
    expect(cell.displayValue).toBe('[BLOB - 2 bytes*]')
    expect(cell.isModified).toBe(true)
  })

  it('renders a staged empty envelope as [BLOB - 0 bytes*]', () => {
    const cell = classifyCellValue({ __sqllumen_blob__: true, kind: 'empty' }, 'photo')
    expect(cell.isBlob).toBe(true)
    expect(cell.displayValue).toBe('[BLOB - 0 bytes*]')
  })

  it('renders a staged null envelope as NULL with pending highlight', () => {
    const cell = classifyCellValue({ __sqllumen_blob__: true, kind: 'null' }, 'photo', {
      isModified: true,
    })
    expect(cell.isNull).toBe(true)
    expect(cell.isBlob).toBe(false)
    expect(cell.displayValue).toBe('NULL')
    expect(cell.isModified).toBe(true)
  })

  it('falls back to [BLOB - 0 bytes*] for a bytes envelope with malformed base64', () => {
    const cell = classifyCellValue(
      { __sqllumen_blob__: true, kind: 'bytes', base64: '@@not base64@@' },
      'photo'
    )
    // isBlobEnvelope requires a string base64; malformed-but-string still routes
    // through the envelope arm and decodes to 0 bytes.
    expect(cell.displayValue).toBe('[BLOB - 0 bytes*]')
  })
})
