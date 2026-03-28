import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock AG Grid modules before importing the component
vi.mock('ag-grid-community', () => ({
  AllCommunityModule: {},
  ModuleRegistry: { registerModules: vi.fn() },
}))

vi.mock('ag-grid-react', async () => {
  const React = await import('react')
  return {
    AgGridReact: vi.fn((props: Record<string, unknown>) => {
      // Render a simplified mock that exposes the column defs and row data
      const colDefs = props.columnDefs as Array<{ headerName: string; field: string }>
      const rowData = props.rowData as Array<Record<string, unknown>>

      return React.createElement(
        'div',
        { 'data-testid': 'ag-grid-inner' },
        // Render headers
        React.createElement(
          'div',
          { 'data-testid': 'ag-grid-headers' },
          colDefs?.map((col: { headerName: string; field: string }) =>
            React.createElement('span', { key: col.field, 'data-field': col.field }, col.headerName)
          )
        ),
        // Render rows
        React.createElement(
          'div',
          { 'data-testid': 'ag-grid-rows' },
          rowData?.map((row: Record<string, unknown>, i: number) =>
            React.createElement(
              'div',
              {
                key: i,
                'data-testid': `ag-grid-row-${i}`,
                onClick: () => {
                  const onRowClicked = props.onRowClicked as
                    | ((e: { rowIndex: number; data: unknown }) => void)
                    | undefined
                  onRowClicked?.({ rowIndex: i, data: row })
                },
              },
              ...Object.entries(row).map(([key, val]) =>
                React.createElement(
                  'span',
                  { key, 'data-field': key },
                  val === null ? 'NULL' : String(val)
                )
              )
            )
          )
        )
      )
    }),
  }
})

import { ResultGridView } from '../../../components/query-editor/ResultGridView'
import { AgGridReact } from 'ag-grid-react'

const columns = [
  { name: 'id', dataType: 'INT' },
  { name: 'name', dataType: 'VARCHAR' },
  { name: 'email', dataType: 'VARCHAR' },
]

const rows: unknown[][] = [
  [1, 'Alice', 'alice@example.com'],
  [2, 'Bob', null],
  [3, 'Charlie', 'charlie@example.com'],
]

function getLatestAgGridProps(): Record<string, unknown> {
  const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
  return mockCalls[mockCalls.length - 1][0] as Record<string, unknown>
}

describe('ResultGridView', () => {
  const defaultProps = {
    columns,
    rows,
    sortColumn: null as string | null,
    sortDirection: null as 'asc' | 'desc' | null,
    onSortChanged: vi.fn(),
    onRowSelected: vi.fn(),
    selectedRowIndex: null as number | null,
    currentPage: 1,
    pageSize: 1000,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders with data-testid="result-grid-view"', () => {
    render(<ResultGridView {...defaultProps} />)
    expect(screen.getByTestId('result-grid-view')).toBeInTheDocument()
  })

  it('has ag-theme-precision class on container', () => {
    render(<ResultGridView {...defaultProps} />)
    const container = screen.getByTestId('result-grid-view')
    expect(container.className).toContain('ag-theme-precision')
  })

  it('passes correct number of column defs to AgGridReact', () => {
    render(<ResultGridView {...defaultProps} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(mockCalls.length).toBeGreaterThanOrEqual(1)
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{ headerName: string; field: string }>
    expect(colDefs).toHaveLength(3)
  })

  it('maps column names to headerName', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{ headerName: string; field: string }>
    expect(colDefs[0].headerName).toBe('id')
    expect(colDefs[1].headerName).toBe('name')
    expect(colDefs[2].headerName).toBe('email')
  })

  it('uses index-based field names to handle duplicate columns', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{ headerName: string; field: string }>
    expect(colDefs[0].field).toBe('col_0')
    expect(colDefs[1].field).toBe('col_1')
    expect(colDefs[2].field).toBe('col_2')
  })

  it('transforms row arrays into keyed objects for AG Grid', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestAgGridProps()
    const rowData = props.rowData as Array<Record<string, unknown>>
    expect(rowData).toHaveLength(3)
    expect(rowData[0]).toEqual({ col_0: 1, col_1: 'Alice', col_2: 'alice@example.com' })
    expect(rowData[1]).toEqual({ col_0: 2, col_1: 'Bob', col_2: null })
  })

  it('sets sortable: true on all column defs', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{ sortable: boolean }>
    colDefs.forEach((col) => {
      expect(col.sortable).toBe(true)
    })
  })

  it('disables client-side sort via comparator returning 0', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{ comparator: () => number }>
    colDefs.forEach((col) => {
      expect(col.comparator()).toBe(0)
    })
  })

  it('sets suppressMultiSort to true', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestAgGridProps()
    expect(props.suppressMultiSort).toBe(true)
  })

  it('applies sort direction to matching column from sortColumn/sortDirection props', () => {
    render(<ResultGridView {...defaultProps} sortColumn="name" sortDirection="asc" />)
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{
      headerName: string
      sort: string | undefined
    }>
    // "name" column (index 1) should have sort: 'asc'
    expect(colDefs[1].sort).toBe('asc')
    // Other columns should have no sort
    expect(colDefs[0].sort).toBeUndefined()
    expect(colDefs[2].sort).toBeUndefined()
  })

  it('calls onRowSelected when a row is clicked', () => {
    const onRowSelected = vi.fn()
    render(<ResultGridView {...defaultProps} onRowSelected={onRowSelected} />)
    // Click the first row via our mock
    const row0 = screen.getByTestId('ag-grid-row-0')
    row0.click()
    expect(onRowSelected).toHaveBeenCalledWith(0)
  })

  it('calls onRowSelected with correct index for different rows', () => {
    const onRowSelected = vi.fn()
    render(<ResultGridView {...defaultProps} onRowSelected={onRowSelected} />)
    const row2 = screen.getByTestId('ag-grid-row-2')
    row2.click()
    expect(onRowSelected).toHaveBeenCalledWith(2)
  })

  it('renders NULL values as "NULL" in mock output', () => {
    render(<ResultGridView {...defaultProps} />)
    // Our mock renders NULL values as "NULL" string
    const nullCells = screen.getAllByText('NULL')
    expect(nullCells.length).toBeGreaterThanOrEqual(1)
  })

  it('renders with empty rows', () => {
    render(<ResultGridView {...defaultProps} rows={[]} />)
    expect(screen.getByTestId('result-grid-view')).toBeInTheDocument()
    // Verify row data is empty
    const props = getLatestAgGridProps()
    const rowData = props.rowData as Array<Record<string, unknown>>
    expect(rowData).toHaveLength(0)
  })

  it('renders with empty columns', () => {
    render(<ResultGridView {...defaultProps} columns={[]} rows={[]} />)
    expect(screen.getByTestId('result-grid-view')).toBeInTheDocument()
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{ headerName: string }>
    expect(colDefs).toHaveLength(0)
  })

  it('has cellClassRules for null detection', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{
      cellClassRules: Record<string, (params: { value: unknown }) => boolean>
    }>
    // Each column should have 'ag-cell-null' rule
    colDefs.forEach((col) => {
      expect(col.cellClassRules['ag-cell-null']).toBeDefined()
      expect(col.cellClassRules['ag-cell-null']({ value: null })).toBe(true)
      expect(col.cellClassRules['ag-cell-null']({ value: 'hello' })).toBe(false)
    })
  })

  it('has valueFormatter that returns "NULL" for null values', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{
      valueFormatter: (params: { value: unknown }) => string
    }>
    expect(colDefs[0].valueFormatter({ value: null })).toBe('NULL')
    expect(colDefs[0].valueFormatter({ value: 42 })).toBe('42')
    expect(colDefs[0].valueFormatter({ value: 'hello' })).toBe('hello')
  })

  it('enables column resizing', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{ resizable: boolean }>
    colDefs.forEach((col) => {
      expect(col.resizable).toBe(true)
    })
  })

  it('calls onRowSelected with page-local row index (parent converts to absolute)', () => {
    const onRowSelected = vi.fn()
    render(
      <ResultGridView
        {...defaultProps}
        onRowSelected={onRowSelected}
        currentPage={2}
        pageSize={10}
      />
    )
    // Click the first row (local index 0) on page 2
    const row0 = screen.getByTestId('ag-grid-row-0')
    row0.click()
    // The grid itself reports local index 0 to onRowSelected
    // (The parent ResultPanel converts to absolute: (2-1)*10 + 0 = 10)
    expect(onRowSelected).toHaveBeenCalledWith(0)
  })

  it('passes currentPage and pageSize props to the component', () => {
    render(<ResultGridView {...defaultProps} currentPage={3} pageSize={50} />)
    // Component should render without errors with these props
    expect(screen.getByTestId('result-grid-view')).toBeInTheDocument()
  })

  it('handleSortChanged calls onSortChanged with column name and direction', () => {
    const onSortChanged = vi.fn()
    render(<ResultGridView {...defaultProps} onSortChanged={onSortChanged} />)
    const props = getLatestAgGridProps()
    const handleSortChanged = props.onSortChanged as (event: {
      api: { getColumnState: () => Array<{ colId: string; sort: string | null }> }
    }) => void

    // Simulate sort on col_1 (name) ascending
    handleSortChanged({
      api: {
        getColumnState: () => [
          { colId: 'col_0', sort: null },
          { colId: 'col_1', sort: 'asc' },
          { colId: 'col_2', sort: null },
        ],
      },
    })

    expect(onSortChanged).toHaveBeenCalledWith('name', 'asc')
  })

  it('handleSortChanged calls onSortChanged with null when sort is cleared', () => {
    const onSortChanged = vi.fn()
    render(<ResultGridView {...defaultProps} onSortChanged={onSortChanged} sortColumn="name" />)
    const props = getLatestAgGridProps()
    const handleSortChanged = props.onSortChanged as (event: {
      api: { getColumnState: () => Array<{ colId: string; sort: string | null }> }
    }) => void

    // Simulate sort cleared — no column has sort
    handleSortChanged({
      api: {
        getColumnState: () => [
          { colId: 'col_0', sort: null },
          { colId: 'col_1', sort: null },
          { colId: 'col_2', sort: null },
        ],
      },
    })

    expect(onSortChanged).toHaveBeenCalledWith('name', null)
  })

  it('handleSortChanged does nothing when sort cleared and no previous sortColumn', () => {
    const onSortChanged = vi.fn()
    render(<ResultGridView {...defaultProps} onSortChanged={onSortChanged} sortColumn={null} />)
    const props = getLatestAgGridProps()
    const handleSortChanged = props.onSortChanged as (event: {
      api: { getColumnState: () => Array<{ colId: string; sort: string | null }> }
    }) => void

    handleSortChanged({
      api: {
        getColumnState: () => [
          { colId: 'col_0', sort: null },
          { colId: 'col_1', sort: null },
        ],
      },
    })

    expect(onSortChanged).not.toHaveBeenCalled()
  })

  it('getRowClass returns selected class for matching row index', () => {
    render(
      <ResultGridView {...defaultProps} selectedRowIndex={1} currentPage={1} pageSize={1000} />
    )
    const props = getLatestAgGridProps()
    const getRowClass = props.getRowClass as (params: {
      rowIndex: number | undefined
    }) => string | undefined

    // Local row 1 should be selected (absolute 1, page 1, size 1000 → local = 1)
    expect(getRowClass({ rowIndex: 1 })).toBe('ag-row-precision-selected')
    // Other rows should not be selected
    expect(getRowClass({ rowIndex: 0 })).toBeUndefined()
    expect(getRowClass({ rowIndex: 2 })).toBeUndefined()
  })

  it('getRowClass handles page-offset conversion for selection', () => {
    render(<ResultGridView {...defaultProps} selectedRowIndex={15} currentPage={2} pageSize={10} />)
    const props = getLatestAgGridProps()
    const getRowClass = props.getRowClass as (params: {
      rowIndex: number | undefined
    }) => string | undefined

    // Absolute index 15 on page 2 (size 10) → local = 15 - (2-1)*10 = 5
    expect(getRowClass({ rowIndex: 5 })).toBe('ag-row-precision-selected')
    expect(getRowClass({ rowIndex: 4 })).toBeUndefined()
  })

  it('getRowClass returns undefined when no row is selected', () => {
    render(<ResultGridView {...defaultProps} selectedRowIndex={null} />)
    const props = getLatestAgGridProps()
    const getRowClass = props.getRowClass as (params: {
      rowIndex: number | undefined
    }) => string | undefined

    expect(getRowClass({ rowIndex: 0 })).toBeUndefined()
    expect(getRowClass({ rowIndex: undefined })).toBeUndefined()
  })

  it('handleSortChanged handles desc sort direction', () => {
    const onSortChanged = vi.fn()
    render(<ResultGridView {...defaultProps} onSortChanged={onSortChanged} />)
    const props = getLatestAgGridProps()
    const handleSortChanged = props.onSortChanged as (event: {
      api: { getColumnState: () => Array<{ colId: string; sort: string | null }> }
    }) => void

    handleSortChanged({
      api: {
        getColumnState: () => [
          { colId: 'col_0', sort: 'desc' },
          { colId: 'col_1', sort: null },
        ],
      },
    })

    expect(onSortChanged).toHaveBeenCalledWith('id', 'desc')
  })
})
