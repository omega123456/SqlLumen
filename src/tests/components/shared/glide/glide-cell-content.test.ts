import { GridCellKind } from '@glideapps/glide-data-grid'
import { describe, expect, it } from 'vitest'
import {
  classifyCellValue,
  buildBlobCell,
  buildForeignKeyCell,
  formatBlobDisplayValue,
} from '../../../../components/shared/glide/glide-cell-content'

describe('glide-cell-content', () => {
  it('classifies BLOB cells', () => {
    const cell = classifyCellValue('[BLOB 12 B]', 'data')
    expect(cell.isBlob).toBe(true)
    expect(cell.displayValue).toBe('[BLOB 12 B]')
    expect(buildBlobCell(cell.displayValue).style).toBe('faded')
  })

  it('renders a staged empty envelope as [BLOB - 0 B*]', () => {
    const cell = classifyCellValue({ __sqllumen_blob__: true, kind: 'empty' }, 'photo')
    expect(cell.isBlob).toBe(true)
    expect(cell.displayValue).toBe('[BLOB - 0 B*]')
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

  it('falls back to [BLOB - 0 B*] for a bytes envelope with malformed base64', () => {
    const cell = classifyCellValue(
      { __sqllumen_blob__: true, kind: 'bytes', base64: '@@not base64@@' },
      'photo'
    )
    // isBlobEnvelope requires a string base64; malformed-but-string still routes
    // through the envelope arm and decodes to 0 bytes.
    expect(cell.displayValue).toBe('[BLOB - 0 B*]')
  })

  it('formats blob display values and builds foreign key cells', () => {
    expect(formatBlobDisplayValue(new Uint8Array([1, 2]))).toBe('[BLOB - 2 B]')
    expect(formatBlobDisplayValue(new ArrayBuffer(3))).toBe('[BLOB - 3 B]')
    expect(formatBlobDisplayValue('plain')).toBe('[BLOB]')
    // A blob column whose value arrives as inlined base64 derives its size.
    expect(formatBlobDisplayValue('aGk=', true)).toBe('[BLOB - 2 B]')

    const flags = classifyCellValue(new Uint8Array([1]), 'avatar', {
      isBlobColumn: true,
      isReadOnly: true,
      isModified: true,
      isFkCell: true,
      isSelectedRow: true,
      isEditingRow: true,
      isNewRow: true,
      highlightedColumnKey: 'avatar',
    })
    expect(flags).toMatchObject({ isBlob: true, isReadOnly: true, isHighlightedColumn: true })
    const fkCell = buildForeignKeyCell('42', flags)
    expect(fkCell.kind).toBe(GridCellKind.Text)
  })
})
