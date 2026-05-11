import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import { GridCellKind, type GridCell } from '@glideapps/glide-data-grid'
import { GlideDataGrid } from '../../../../components/shared/glide/GlideDataGrid'
import type { GridHandle } from '../../../../components/shared/glide/glide-grid-types'

const mockDataEditor = vi.fn()
let mockSize = { width: 400, height: 300 }

vi.mock('../../../../hooks/use-element-size', () => ({
  useElementSize: () => mockSize,
}))

vi.mock('@glideapps/glide-data-grid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@glideapps/glide-data-grid')>()
  const React = await import('react')
  return {
    ...actual,
    DataEditor: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      mockDataEditor(props)
      React.useImperativeHandle(ref, () => ({
        scrollTo: mockScrollTo,
        focus: mockFocus,
        getBounds: mockGetBounds,
      }))
      return React.createElement('div', { 'data-testid': 'mock-data-editor' }, 'editor')
    }),
  }
})

const mockScrollTo = vi.fn()
const mockFocus = vi.fn()
const mockGetBounds = vi.fn(() => ({ x: 1, y: 2, width: 3, height: 4 }))

beforeEach(() => {
  mockDataEditor.mockClear()
  mockScrollTo.mockClear()
  mockFocus.mockClear()
  mockGetBounds.mockClear()
  mockSize = { width: 400, height: 300 }
})

describe('GlideDataGrid', () => {
  it('passes core grid data through to DataEditor', () => {
    const getCellContent = vi.fn(
      (): GridCell => ({
        kind: GridCellKind.Text,
        data: 'x',
        displayData: 'x',
        allowOverlay: false,
        readonly: true,
      })
    )
    render(
      <div style={{ width: 400, height: 300 }}>
        <GlideDataGrid
          columns={[{ title: 'Id', width: 80 }]}
          rows={[{ id: 1 }, { id: 2 }]}
          getCellContent={getCellContent}
          data-testid="glide-host"
        />
      </div>
    )
    expect(screen.getByTestId('glide-host')).toBeInTheDocument()
    const props = mockDataEditor.mock.lastCall?.[0] as Record<string, unknown>
    expect(props.columns).toEqual([{ title: 'Id', width: 80 }])
    expect(props.rows).toBe(2)
    expect(props.getCellContent).toBe(getCellContent)
  })

  it('renders a placeholder when host size is zero', () => {
    mockSize = { width: 0, height: 0 }
    render(
      <GlideDataGrid columns={[]} rows={[]} getCellContent={vi.fn()} data-testid="zero-grid" />
    )
    expect(screen.getByTestId('zero-grid-placeholder')).toBeInTheDocument()
  })

  it('emits column and row marker widths on the grid container', () => {
    render(
      <GlideDataGrid
        columns={[
          { title: 'Id', width: 80 },
          { title: 'Name', width: 160 },
          { title: 'Active', width: 96 },
        ]}
        rows={[]}
        getCellContent={vi.fn()}
        rowMarkers="checkbox"
        data-testid="attribute-grid"
      />
    )

    const host = screen.getByTestId('attribute-grid')
    expect(host).toHaveAttribute('data-glide-column-width', '[80,160,96]')
    expect(host).toHaveAttribute('data-row-marker-width', '32')
  })

  it('wires interaction callbacks', () => {
    const onColumnResize = vi.fn()
    const onHeaderClicked = vi.fn()
    const onCellClicked = vi.fn()
    render(
      <div style={{ width: 400, height: 300 }}>
        <GlideDataGrid
          columns={[{ title: 'Id', width: 80 }]}
          rows={[{ id: 1 }]}
          getCellContent={vi.fn()}
          onColumnResize={onColumnResize}
          onHeaderClicked={onHeaderClicked}
          onCellClicked={onCellClicked}
        />
      </div>
    )
    const props = mockDataEditor.mock.lastCall?.[0] as {
      onColumnResize: (column: unknown, width: number, index: number) => void
      onHeaderClicked: (index: number) => void
      onCellClicked: (cell: readonly [number, number], event: unknown) => void
    }
    props.onColumnResize({}, 120, 0)
    props.onHeaderClicked(0)
    props.onCellClicked([0, 0], {})
    expect(onColumnResize).toHaveBeenCalledWith(0, 120)
    expect(onHeaderClicked).toHaveBeenCalledWith(0)
    expect(onCellClicked).toHaveBeenCalledWith([0, 0], {})
  })

  it('exposes scrolling, focus, and element through the grid handle', () => {
    const ref = createRef<{
      scrollToCell: (pos: { idx?: number; rowIdx?: number }) => void
      selectCell: (pos: { idx: number; rowIdx: number }) => void
      element: HTMLDivElement | null
    }>()
    render(
      <GlideDataGrid
        ref={ref}
        columns={[{ title: 'Id', width: 80 }]}
        rows={[{ id: 1 }]}
        getCellContent={vi.fn()}
        data-testid="handle-grid"
      />
    )

    ref.current?.scrollToCell({ rowIdx: 4 })
    expect(mockScrollTo).toHaveBeenCalledWith(
      { amount: 0, unit: 'px' },
      { amount: 4, unit: 'px' },
      'both'
    )

    ref.current?.selectCell({ idx: 2, rowIdx: 3 })
    expect(mockScrollTo).toHaveBeenCalledWith(2, 3, 'both')
    expect(mockFocus).toHaveBeenCalled()
    expect(ref.current?.element).toBe(screen.getByTestId('handle-grid'))
  })

  it('selects cells through controlled grid selection and can request editor opening', () => {
    vi.useFakeTimers()
    const dispatchSpy = vi.spyOn(HTMLCanvasElement.prototype, 'dispatchEvent')
    const ref = createRef<GridHandle>()
    const onSelectionChange = vi.fn()
    render(
      <GlideDataGrid
        ref={ref}
        columns={[{ title: 'Id', width: 80 }]}
        rows={[{ id: 1 }]}
        getCellContent={vi.fn()}
        onSelectionChange={onSelectionChange}
      />
    )
    const canvas = document.createElement('canvas')
    canvas.setAttribute('data-testid', 'data-grid-canvas')
    screen.getByTestId('mock-data-editor').appendChild(canvas)

    act(() => {
      ref.current?.selectCell({ idx: 0, rowIdx: 0 }, { enableEditor: true, shouldFocusCell: true })
      vi.runAllTimers()
    })

    expect(onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({ current: expect.objectContaining({ cell: [0, 0] }) })
    )
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ key: 'Enter' }))
    dispatchSpy.mockRestore()
    vi.useRealTimers()
  })

  it('maps cell activation to double-click with current bounds', () => {
    const onCellDoubleClicked = vi.fn()
    render(
      <GlideDataGrid
        columns={[{ title: 'Id', width: 80 }]}
        rows={[{ id: 1 }]}
        getCellContent={vi.fn()}
        onCellDoubleClicked={onCellDoubleClicked}
      />
    )
    const props = mockDataEditor.mock.lastCall?.[0] as {
      onCellActivated: (cell: readonly [number, number]) => void
    }
    props.onCellActivated([2, 3])
    expect(mockGetBounds).toHaveBeenCalledWith(2, 3)
    expect(onCellDoubleClicked).toHaveBeenCalledWith([2, 3], {
      bounds: { x: 1, y: 2, width: 3, height: 4 },
    })
  })
})
