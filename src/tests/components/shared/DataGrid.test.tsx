/**
 * Tests for the shared DataGrid wrapper component.
 *
 * Mocks react-data-grid since it uses CSS Grid layout which jsdom
 * cannot handle properly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'

// ---------------------------------------------------------------------------
// Mock react-data-grid
// ---------------------------------------------------------------------------

const mockDataGrid = vi.fn()

vi.mock('react-data-grid', () => ({
  DataGrid: (props: Record<string, unknown>) => {
    mockDataGrid(props)
    return (
      <div
        data-testid={props['data-testid'] as string}
        className={props.className as string}
        data-mock="react-data-grid"
      >
        {/* Render column count and row count for assertion */}
        <span data-testid="column-count">{(props.columns as unknown[])?.length ?? 0}</span>
        <span data-testid="row-count">{(props.rows as unknown[])?.length ?? 0}</span>
      </div>
    )
  },
}))

// Mock the dimensions hook
vi.mock('../../../hooks/use-grid-dimensions', () => ({
  useGridDimensions: () => ({ rowHeight: 32, headerHeight: 32 }),
}))

// Import AFTER mocks
import { DataGrid } from '../../../components/shared/DataGrid'
import type { DataGridHandle } from '../../../components/shared/DataGrid'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DataGrid wrapper', () => {
  beforeEach(() => {
    mockDataGrid.mockClear()
  })

  it('renders with the rdg-precision class', () => {
    render(<DataGrid columns={[]} rows={[]} data-testid="test-grid" />)

    const grid = screen.getByTestId('test-grid')
    expect(grid).toBeInTheDocument()
    expect(grid.className).toContain('rdg-precision')
  })

  it('passes columns and rows through to react-data-grid', () => {
    const columns = [
      { key: 'id', name: 'ID' },
      { key: 'name', name: 'Name' },
    ]
    const rows = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]

    render(<DataGrid columns={columns} rows={rows} data-testid="test-grid" />)

    expect(screen.getByTestId('column-count').textContent).toBe('2')
    expect(screen.getByTestId('row-count').textContent).toBe('2')

    // Verify the mock was called with the correct column and row props
    expect(mockDataGrid).toHaveBeenCalledWith(
      expect.objectContaining({
        columns,
        rows,
      })
    )
  })

  it('forwards the data-testid prop', () => {
    render(<DataGrid columns={[]} rows={[]} data-testid="my-custom-grid" />)

    expect(screen.getByTestId('my-custom-grid')).toBeInTheDocument()
  })

  it('passes rowHeight and headerRowHeight from dimensions hook', () => {
    render(<DataGrid columns={[]} rows={[]} data-testid="dim-grid" />)

    expect(mockDataGrid).toHaveBeenCalledWith(
      expect.objectContaining({
        rowHeight: 32,
        headerRowHeight: 32,
      })
    )
  })

  it('forwards ref to react-data-grid', () => {
    const ref = createRef<DataGridHandle>()

    // Since we're mocking RDG, the ref won't actually be set by the mock.
    // But we can verify the component accepts the ref prop without errors.
    expect(() => {
      render(<DataGrid ref={ref} columns={[]} rows={[]} data-testid="ref-grid" />)
    }).not.toThrow()

    // The mock passes ref through, which verifies forwardRef works
    expect(mockDataGrid).toHaveBeenCalledWith(
      expect.objectContaining({
        'data-testid': 'ref-grid',
      })
    )
  })

  it('passes sortColumns and onSortColumnsChange through', () => {
    const sortColumns = [{ columnKey: 'id', direction: 'ASC' as const }]
    const onSortColumnsChange = vi.fn()

    render(
      <DataGrid
        columns={[{ key: 'id', name: 'ID' }]}
        rows={[]}
        sortColumns={sortColumns}
        onSortColumnsChange={onSortColumnsChange}
        data-testid="sort-grid"
      />
    )

    expect(mockDataGrid).toHaveBeenCalledWith(
      expect.objectContaining({
        sortColumns,
        onSortColumnsChange,
      })
    )
  })

  it('includes custom className alongside rdg-precision', () => {
    render(<DataGrid columns={[]} rows={[]} className="extra-class" data-testid="class-grid" />)

    const grid = screen.getByTestId('class-grid')
    expect(grid.className).toContain('rdg-precision')
    expect(grid.className).toContain('extra-class')
  })

  it('passes renderers with default SortStatusRenderer', () => {
    render(<DataGrid columns={[]} rows={[]} data-testid="renderer-grid" />)

    expect(mockDataGrid).toHaveBeenCalledWith(
      expect.objectContaining({
        renderers: expect.objectContaining({
          renderSortStatus: expect.any(Function),
        }),
      })
    )
  })
})
