import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import {
  GridCellKind,
  type EditableGridCell,
  type GridCell,
  type Item,
} from '@glideapps/glide-data-grid'
import * as GlideDataGridModule from '../../../components/shared/glide/GlideDataGrid'
import { DataGrid, type DataGridHandle } from '../../../components/shared/DataGrid'
import type { GridHandle } from '../../../components/shared/glide/glide-grid-types'

// GlideDataGrid is a forwardRef object — vi.spyOn can't intercept it directly.
// Use Object.defineProperty to replace it per-test (local module namespace is mutable in vite-node).

const originalGlideDataGrid = GlideDataGridModule.GlideDataGrid
const mockGlideDataGrid = vi.fn()

beforeEach(() => {
  mockGlideDataGrid.mockClear()

  const mockFn = mockGlideDataGrid
  Object.defineProperty(GlideDataGridModule, 'GlideDataGrid', {
    value: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<GridHandle>) => {
      mockFn(props)
      React.useImperativeHandle(ref, () => ({
        scrollToCell: vi.fn(),
        selectCell: vi.fn(),
        element: null,
      }))
      return React.createElement(
        'div',
        {
          className: props.className as string | undefined,
          'data-testid': props['data-testid'] as string | undefined,
        },
        'grid'
      )
    }),
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  Object.defineProperty(GlideDataGridModule, 'GlideDataGrid', {
    value: originalGlideDataGrid,
    writable: true,
    configurable: true,
  })
})

describe('DataGrid', () => {
  it('adapts SqlLumen columns to Glide columns', () => {
    render(
      <DataGrid
        columns={[
          { key: 'id', name: 'ID', width: 80 },
          { key: 'name', name: 'Name', width: 'auto' },
        ]}
        rows={[{ id: 1, name: 'Ada' }]}
        data-testid="data-grid"
        className="custom-grid"
      />
    )

    expect(screen.getByTestId('data-grid')).toHaveClass('custom-grid')
    const props = mockGlideDataGrid.mock.lastCall?.[0] as Record<string, unknown>
    expect(props.columns).toEqual([
      { id: 'id', title: 'ID', width: 80 },
      { id: 'name', title: 'Name', width: 150 },
    ])
    expect(props.rows).toEqual([{ id: 1, name: 'Ada' }])
  })

  it('builds fallback text cells from row values', () => {
    render(
      <DataGrid
        columns={[{ key: 'name', name: 'Name' }]}
        rows={[{ name: 'Grace' }, { name: null }]}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as Record<string, unknown>
    const getCellContent = props.getCellContent as (cell: Item) => GridCell
    expect(getCellContent([0, 0])).toMatchObject({
      kind: GridCellKind.Text,
      data: 'Grace',
      displayData: 'Grace',
      allowOverlay: true,
    })
    expect(getCellContent([0, 1])).toMatchObject({ data: '', displayData: '' })
    expect(getCellContent([1, 0])).toMatchObject({ data: '', displayData: '' })
  })

  it('uses custom cell content and maps resize callbacks', () => {
    const getCellContent = vi.fn(
      (): GridCell => ({
        kind: GridCellKind.Text,
        data: 'custom',
        displayData: 'custom',
        allowOverlay: true,
      })
    )
    const onColumnResize = vi.fn()

    render(
      <DataGrid
        columns={[{ key: 'id', name: 'ID' }]}
        rows={[{ id: 1 }]}
        getCellContent={getCellContent}
        onColumnResize={onColumnResize}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as Record<string, unknown>
    expect(props.getCellContent).toBe(getCellContent)

    const onResize = props.onColumnResize as (columnIndex: number, width: number) => void
    onResize(0, 120)
    onResize(5, 200)
    expect(onColumnResize).toHaveBeenCalledTimes(1)
    expect(onColumnResize).toHaveBeenCalledWith({ key: 'id', name: 'ID', idx: 0 }, 120)
  })

  it('forwards the grid handle ref', () => {
    const ref = createRef<DataGridHandle>()
    render(<DataGrid ref={ref} columns={[]} rows={[]} />)
    expect(ref.current).toEqual({
      scrollToCell: expect.any(Function),
      selectCell: expect.any(Function),
      element: null,
    })
  })

  it('accepts editing callbacks without invoking them in the wrapper', () => {
    const onCellEdited = vi.fn((_cell: Item, _value: EditableGridCell) => undefined)
    render(<DataGrid columns={[]} rows={[]} onCellEdited={onCellEdited} />)
    expect(onCellEdited).not.toHaveBeenCalled()
  })
})
