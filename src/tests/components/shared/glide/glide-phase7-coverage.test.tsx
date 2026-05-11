import { cleanup, render, screen } from '@testing-library/react'
import { GridCellKind } from '@glideapps/glide-data-grid'
import { describe, expect, it, vi } from 'vitest'
import {
  buildFkCell,
  classifyCellValue,
  formatBlobDisplayValue,
} from '../../../../components/shared/glide/glide-cell-content'
import { buildGlideColumns } from '../../../../components/shared/glide/glide-column-adapter'
import {
  buildHeaderMeta,
  drawCustomHeader,
  getSortIconName,
} from '../../../../components/shared/glide/glide-header-rendering'
import {
  getGlideEditor,
  wrapEditorAsGlideOverlay,
} from '../../../../components/shared/glide/glide-editors'
import type { CellEditorBaseProps } from '../../../../components/shared/grid-cell-editors'

describe('Glide phase 7 coverage helpers', () => {
  it('covers value classification and FK cell helpers', () => {
    expect(formatBlobDisplayValue(new Uint8Array([1, 2]))).toBe('[BLOB 2 B]')
    expect(formatBlobDisplayValue(new ArrayBuffer(3))).toBe('[BLOB 3 B]')
    expect(formatBlobDisplayValue('plain')).toBe('[BLOB]')

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
    const fkCell = buildFkCell('42', flags)
    expect(fkCell.kind).toBe(GridCellKind.Text)
  })

  it('covers column and header metadata adapters', () => {
    const columns = buildGlideColumns(
      [
        { key: '', name: <span>Name</span>, width: '180px' },
        { key: 'age', name: 'Age', width: Number.NaN },
      ],
      { hasRowMarker: true }
    )
    expect(columns[0]).toMatchObject({ id: '0', title: '', width: 180 })
    expect(columns[1]).toMatchObject({ id: 'age', title: 'Age', width: 150 })
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
    drawCustomHeader(
      ctx,
      { column: { title: 'Age' }, rect: { x: 1, y: 2, width: 100, height: 30 } } as Parameters<
        typeof drawCustomHeader
      >[1],
      { sortDirection: 'ASC', isReadOnly: true, hasFkLink: true, isHighlighted: true },
      {
        bgSearchResult: '#eee',
        textHeaderSelected: '#111',
        textHeader: '#222',
        headerFontStyle: 'bold 12px',
        fontFamily: 'sans-serif',
        cellHorizontalPadding: 8,
      } as Parameters<typeof drawCustomHeader>[3]
    )
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
    drawCustomHeader(
      ctx,
      { column: { title: 'Name' }, rect: { x: 4, y: 6, width: 120, height: 28 } } as Parameters<
        typeof drawCustomHeader
      >[1],
      { sortDirection: undefined, isReadOnly: false, hasFkLink: false, isHighlighted: false },
      {
        bgSearchResult: '#eee',
        textHeaderSelected: '#111',
        textHeader: '#222',
        headerFontStyle: '12px',
        fontFamily: 'sans-serif',
        cellHorizontalPadding: 10,
      } as Parameters<typeof drawCustomHeader>[3]
    )
    expect(ctx.fillRect).not.toHaveBeenCalled()
    expect(ctx.fillText).toHaveBeenCalledTimes(1)
    expect(ctx.fillText).toHaveBeenCalledWith('Name', 14, 24)
  })

  it('wraps vendor-neutral editors as Glide overlays', () => {
    const Editor = (props: CellEditorBaseProps) => (
      <div>
        <button type="button" onClick={() => props.onRowChange({ [props.column.key]: 'next' })}>
          edit {props.column.key}
        </button>
        <button type="button" onClick={() => props.onRowChange({ [props.column.key]: null })}>
          clear {props.column.key}
        </button>
        <button type="button" onClick={() => props.onClose(false)}>
          cancel
        </button>
        <button type="button" onClick={() => props.onClose()}>
          commit
        </button>
      </div>
    )
    const Overlay = wrapEditorAsGlideOverlay(Editor)
    const onChange = vi.fn()
    cleanup()
    render(
      <Overlay
        value={
          {
            kind: GridCellKind.Text,
            data: 'old',
            displayData: 'old',
            allowOverlay: true,
            glideEditorData: { row: { name: 'old' }, columnKey: 'name', isNullable: false },
          } as Parameters<typeof Overlay>[0]['value']
        }
        onChange={onChange}
        onFinishedEditing={vi.fn()}
      />
    )
    screen.getByRole('button', { name: 'edit name' }).click()
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ data: 'next', displayData: 'next' })
    )
    screen.getByRole('button', { name: 'clear name' }).click()
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ data: '', displayData: 'NULL', copyData: 'NULL' })
    )

    const onFinishedEditing = vi.fn()
    cleanup()
    render(
      <Overlay
        value={
          { kind: GridCellKind.Boolean, data: true, allowOverlay: false } as Parameters<
            typeof Overlay
          >[0]['value']
        }
        onChange={vi.fn()}
        onFinishedEditing={onFinishedEditing}
      />
    )
    expect(screen.queryByRole('button', { name: /edit/ })).not.toBeInTheDocument()

    render(
      <Overlay
        value={
          {
            kind: GridCellKind.Text,
            data: 'old',
            displayData: 'old',
            allowOverlay: true,
            glideEditorData: { row: { name: 'old' }, columnKey: 'name', isNullable: false },
          } as Parameters<typeof Overlay>[0]['value']
        }
        onChange={vi.fn()}
        onFinishedEditing={onFinishedEditing}
      />
    )
    screen.getByRole('button', { name: 'cancel' }).click()
    expect(onFinishedEditing).toHaveBeenCalledWith(undefined)
    screen.getByRole('button', { name: 'edit name' }).click()
    screen.getByRole('button', { name: 'commit' }).click()
    expect(onFinishedEditing).toHaveBeenCalledWith(expect.objectContaining({ data: 'next' }))
    expect(getGlideEditor({ key: 'x', name: 'X' }, 'none')).toBeNull()
    expect(getGlideEditor({ key: 'x', name: 'X' }, 'enum')).toBeTypeOf('function')
    expect(getGlideEditor({ key: 'x', name: 'X' }, 'datetime')).toBeTypeOf('function')
    expect(getGlideEditor({ key: 'x', name: 'X' }, 'text')).toBeTypeOf('function')
  })
})
