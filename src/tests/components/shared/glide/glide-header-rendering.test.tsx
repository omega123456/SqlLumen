import { describe, expect, it, vi } from 'vitest'
import {
  buildHeaderMeta,
  drawCustomHeader,
  getSortIconName,
} from '../../../../components/shared/glide/glide-header-rendering'
import type { CustomHeaderDrawing } from '../../../../components/shared/glide/glide-header-rendering'

describe('glide-header-rendering', () => {
  it('derives sort icons and header metadata from the column definition', () => {
    expect(getSortIconName('ASC')).toBe('↑')
    expect(getSortIconName('DESC')).toBe('↓')

    const meta = buildHeaderMeta(
      { key: 'age', name: 'Age', editable: false, foreignKey: { referencedTable: 'users' } },
      [{ columnKey: 'age', direction: 'DESC' }],
      'age'
    )
    expect(meta).toEqual({
      sortDirection: 'DESC',
      isReadOnly: true,
      hasFkLink: true,
      isHighlighted: true,
    })

    const blobMeta = buildHeaderMeta(
      { key: 'data', name: 'Data', editable: false, isBinary: true, blobViewerEditable: true },
      [],
      undefined
    )
    expect(blobMeta.isReadOnly).toBe(false)
  })

  it('draws custom header icons and text', () => {
    const ctx = {
      fillStyle: '',
      font: '',
      textAlign: '',
      fillText: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    drawCustomHeader({
      context: ctx,
      args: {
        column: { title: 'Age' },
        rect: { x: 1, y: 2, width: 100, height: 30 },
      } as CustomHeaderDrawing['args'],
      meta: { sortDirection: 'ASC', isReadOnly: true, hasFkLink: true, isHighlighted: true },
      theme: {
        bgSearchResult: '#eee',
        textHeaderSelected: '#111',
        textHeader: '#222',
        headerFontStyle: 'bold 12px',
        fontFamily: 'sans-serif',
        cellHorizontalPadding: 8,
      } as CustomHeaderDrawing['theme'],
    })
    expect((ctx.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      3
    )
  })

  it('draws plain headers without optional canvas affordances', () => {
    const ctx = {
      fillStyle: '',
      font: '',
      textAlign: '',
      fillText: vi.fn(),
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    drawCustomHeader({
      context: ctx,
      args: {
        column: { title: 'Name' },
        rect: { x: 4, y: 6, width: 120, height: 28 },
      } as CustomHeaderDrawing['args'],
      meta: { sortDirection: undefined, isReadOnly: false, hasFkLink: false, isHighlighted: false },
      theme: {
        bgSearchResult: '#eee',
        textHeaderSelected: '#111',
        textHeader: '#222',
        headerFontStyle: '12px',
        fontFamily: 'sans-serif',
        cellHorizontalPadding: 10,
      } as CustomHeaderDrawing['theme'],
    })
    expect(ctx.fillRect).not.toHaveBeenCalled()
    expect(ctx.fillText).toHaveBeenCalledTimes(1)
    expect(ctx.fillText).toHaveBeenCalledWith('Name', 14, 24)
  })
})
