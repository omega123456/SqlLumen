import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// Mock the shared DataGrid wrapper
vi.mock('../../../components/shared/DataGrid', async () => {
  const React = await import('react')
  return {
    DataGrid: vi.fn((props: Record<string, unknown>) => {
      const rows = (props.rows as Array<Record<string, unknown>>) ?? []
      return React.createElement(
        'div',
        { 'data-testid': props['data-testid'] },
        rows.map((row: Record<string, unknown>, i: number) =>
          React.createElement(
            'div',
            { key: i, 'data-testid': `grid-row-${i}` },
            ...Object.entries(row)
              .filter(([k]: [string, unknown]) => !k.startsWith('__'))
              .map(([k, v]: [string, unknown]) =>
                React.createElement(
                  'span',
                  { key: k, 'data-key': k },
                  v === null ? 'NULL' : String(v)
                )
              )
          )
        )
      )
    }),
  }
})

import { ResultGridView } from '../../../components/query-editor/ResultGridView'
import { DataGrid } from '../../../components/shared/DataGrid'

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

function getLatestDataGridProps(): Record<string, unknown> {
  const mockCalls = (DataGrid as unknown as ReturnType<typeof vi.fn>).mock.calls
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
    tabId: 'tab-test',
    editMode: null as string | null,
    editableColumnMap: new Map<number, boolean>(),
    editState: null,
    editingRowIndex: null as number | null,
    editTableColumns: [],
    onStartEditing: vi.fn(),
    onUpdateCellValue: vi.fn(),
    onSyncCellValue: vi.fn(),
    onAutoSave: vi.fn().mockResolvedValue(true),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders with data-testid="result-grid-view"', () => {
    render(<ResultGridView {...defaultProps} />)
    expect(screen.getByTestId('result-grid-view')).toBeInTheDocument()
  })

  it('passes correct number of column defs to DataGrid', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{ key: string; name: string }>
    expect(colDefs).toHaveLength(3)
  })

  it('maps column names to name property', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{ name: string }>
    expect(colDefs[0].name).toBe('id')
    expect(colDefs[1].name).toBe('name')
    expect(colDefs[2].name).toBe('email')
  })

  it('uses index-based keys (col_N) for columns', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{ key: string }>
    expect(colDefs[0].key).toBe('col_0')
    expect(colDefs[1].key).toBe('col_1')
    expect(colDefs[2].key).toBe('col_2')
  })

  it('transforms row arrays into keyed objects with __rowIdx', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestDataGridProps()
    const rowData = props.rows as Array<Record<string, unknown>>
    expect(rowData).toHaveLength(3)
    expect(rowData[0]).toEqual({
      __rowIdx: 0,
      col_0: 1,
      col_1: 'Alice',
      col_2: 'alice@example.com',
    })
    expect(rowData[1]).toEqual({ __rowIdx: 1, col_0: 2, col_1: 'Bob', col_2: null })
  })

  it('sets sortable: true on all column defs', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{ sortable: boolean }>
    colDefs.forEach((col) => {
      expect(col.sortable).toBe(true)
    })
  })

  it('sets resizable: true on all column defs', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{ resizable: boolean }>
    colDefs.forEach((col) => {
      expect(col.resizable).toBe(true)
    })
  })

  it('derives sortColumns from sortColumn/sortDirection props (ASC conversion)', () => {
    render(<ResultGridView {...defaultProps} sortColumn="name" sortDirection="asc" />)
    const props = getLatestDataGridProps()
    const sortColumns = props.sortColumns as Array<{ columnKey: string; direction: string }>
    expect(sortColumns).toEqual([{ columnKey: 'col_1', direction: 'ASC' }])
  })

  it('derives sortColumns from sortColumn/sortDirection props (DESC conversion)', () => {
    render(<ResultGridView {...defaultProps} sortColumn="id" sortDirection="desc" />)
    const props = getLatestDataGridProps()
    const sortColumns = props.sortColumns as Array<{ columnKey: string; direction: string }>
    expect(sortColumns).toEqual([{ columnKey: 'col_0', direction: 'DESC' }])
  })

  it('has empty sortColumns when no sort is active', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestDataGridProps()
    const sortColumns = props.sortColumns as Array<{ columnKey: string; direction: string }>
    expect(sortColumns).toEqual([])
  })

  it('calls onRowSelected when a cell is clicked', async () => {
    const onRowSelected = vi.fn()
    render(<ResultGridView {...defaultProps} onRowSelected={onRowSelected} />)
    const props = getLatestDataGridProps()
    const onCellClick = props.onCellClick as (args: unknown, event: unknown) => void

    await act(async () => {
      onCellClick(
        {
          row: { __rowIdx: 0 },
          rowIdx: 0,
          column: { key: 'col_0', idx: 0 },
          selectCell: vi.fn(),
        },
        { preventGridDefault: vi.fn(), isGridDefaultPrevented: () => false }
      )
    })

    expect(onRowSelected).toHaveBeenCalledWith(0)
  })

  it('calls onRowSelected with correct index for different rows', async () => {
    const onRowSelected = vi.fn()
    render(<ResultGridView {...defaultProps} onRowSelected={onRowSelected} />)
    const props = getLatestDataGridProps()
    const onCellClick = props.onCellClick as (args: unknown, event: unknown) => void

    await act(async () => {
      onCellClick(
        {
          row: { __rowIdx: 2 },
          rowIdx: 2,
          column: { key: 'col_0', idx: 0 },
          selectCell: vi.fn(),
        },
        { preventGridDefault: vi.fn(), isGridDefaultPrevented: () => false }
      )
    })

    expect(onRowSelected).toHaveBeenCalledWith(2)
  })

  it('renders NULL values as "NULL" in mock output', () => {
    render(<ResultGridView {...defaultProps} />)
    const nullCells = screen.getAllByText('NULL')
    expect(nullCells.length).toBeGreaterThanOrEqual(1)
  })

  it('renders with empty rows', () => {
    render(<ResultGridView {...defaultProps} rows={[]} />)
    expect(screen.getByTestId('result-grid-view')).toBeInTheDocument()
    const props = getLatestDataGridProps()
    const rowData = props.rows as Array<Record<string, unknown>>
    expect(rowData).toHaveLength(0)
  })

  it('renders with empty columns', () => {
    render(<ResultGridView {...defaultProps} columns={[]} rows={[]} />)
    expect(screen.getByTestId('result-grid-view')).toBeInTheDocument()
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{ key: string }>
    expect(colDefs).toHaveLength(0)
  })

  it('cellClass function returns rdg-cell-null for null values', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{
      cellClass: (row: Record<string, unknown>) => string
    }>
    // Column 2 (email) — row 1 has null email
    const result = colDefs[2].cellClass({ __rowIdx: 1, col_2: null })
    expect(result).toContain('rdg-cell-null')
  })

  it('cellClass function does not include rdg-cell-null for non-null values', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{
      cellClass: (row: Record<string, unknown>) => string
    }>
    const result = colDefs[0].cellClass({ __rowIdx: 0, col_0: 1 })
    expect(result).not.toContain('rdg-cell-null')
  })

  it('cellClass includes data-type class from getResultGridCellClass', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{
      cellClass: (row: Record<string, unknown>) => string
    }>
    // INT column → td-cell-mono-muted
    expect(colDefs[0].cellClass({ __rowIdx: 0, col_0: 1 })).toContain('td-cell-mono-muted')
  })

  it('calls onRowSelected with page-local row index (parent converts to absolute)', async () => {
    const onRowSelected = vi.fn()
    render(
      <ResultGridView
        {...defaultProps}
        onRowSelected={onRowSelected}
        currentPage={2}
        pageSize={10}
      />
    )
    const props = getLatestDataGridProps()
    const onCellClick = props.onCellClick as (args: unknown, event: unknown) => void

    await act(async () => {
      onCellClick(
        {
          row: { __rowIdx: 0 },
          rowIdx: 0,
          column: { key: 'col_0', idx: 0 },
          selectCell: vi.fn(),
        },
        { preventGridDefault: vi.fn(), isGridDefaultPrevented: () => false }
      )
    })

    // The grid itself reports local index 0 to onRowSelected
    // (The parent ResultPanel converts to absolute: (2-1)*10 + 0 = 10)
    expect(onRowSelected).toHaveBeenCalledWith(0)
  })

  it('passes currentPage and pageSize props to the component', () => {
    render(<ResultGridView {...defaultProps} currentPage={3} pageSize={50} />)
    expect(screen.getByTestId('result-grid-view')).toBeInTheDocument()
  })

  it('onSortColumnsChange calls onSortChanged with column name and lowercase direction', () => {
    const onSortChanged = vi.fn()
    render(<ResultGridView {...defaultProps} onSortChanged={onSortChanged} />)
    const props = getLatestDataGridProps()
    const onSortColumnsChange = props.onSortColumnsChange as (
      cols: Array<{ columnKey: string; direction: string }>
    ) => void

    // react-data-grid passes uppercase direction
    onSortColumnsChange([{ columnKey: 'col_1', direction: 'ASC' }])

    // App expects lowercase
    expect(onSortChanged).toHaveBeenCalledWith('name', 'asc')
  })

  it('onSortColumnsChange handles DESC direction', () => {
    const onSortChanged = vi.fn()
    render(<ResultGridView {...defaultProps} onSortChanged={onSortChanged} />)
    const props = getLatestDataGridProps()
    const onSortColumnsChange = props.onSortColumnsChange as (
      cols: Array<{ columnKey: string; direction: string }>
    ) => void

    onSortColumnsChange([{ columnKey: 'col_0', direction: 'DESC' }])
    expect(onSortChanged).toHaveBeenCalledWith('id', 'desc')
  })

  it('onSortColumnsChange enforces single-sort by keeping only the last column', () => {
    const onSortChanged = vi.fn()
    render(<ResultGridView {...defaultProps} onSortChanged={onSortChanged} />)
    const props = getLatestDataGridProps()
    const onSortColumnsChange = props.onSortColumnsChange as (
      cols: Array<{ columnKey: string; direction: string }>
    ) => void

    // Simulate multi-sort attempt
    onSortColumnsChange([
      { columnKey: 'col_0', direction: 'ASC' },
      { columnKey: 'col_1', direction: 'DESC' },
    ])

    // Should keep only the last (col_1 → name)
    expect(onSortChanged).toHaveBeenCalledWith('name', 'desc')
  })

  it('onSortColumnsChange calls onSortChanged with null when sort is cleared', () => {
    const onSortChanged = vi.fn()
    render(<ResultGridView {...defaultProps} onSortChanged={onSortChanged} sortColumn="name" />)
    const props = getLatestDataGridProps()
    const onSortColumnsChange = props.onSortColumnsChange as (
      cols: Array<{ columnKey: string; direction: string }>
    ) => void

    // Empty array means sort cleared
    onSortColumnsChange([])
    expect(onSortChanged).toHaveBeenCalledWith('name', null)
  })

  it('onSortColumnsChange does nothing when sort cleared and no previous sortColumn', () => {
    const onSortChanged = vi.fn()
    render(<ResultGridView {...defaultProps} onSortChanged={onSortChanged} sortColumn={null} />)
    const props = getLatestDataGridProps()
    const onSortColumnsChange = props.onSortColumnsChange as (
      cols: Array<{ columnKey: string; direction: string }>
    ) => void

    onSortColumnsChange([])
    expect(onSortChanged).not.toHaveBeenCalled()
  })

  it('rowClass returns selected class in read-only mode (editMode=null)', () => {
    render(
      <ResultGridView {...defaultProps} selectedRowIndex={1} currentPage={1} pageSize={1000} />
    )
    const props = getLatestDataGridProps()
    const rowClass = props.rowClass as (row: Record<string, unknown>) => string | undefined

    // Selected row should get the highlight regardless of edit mode
    expect(rowClass({ __rowIdx: 1 })).toBe('rdg-row-precision-selected')
    expect(rowClass({ __rowIdx: 0 })).toBeUndefined()
  })

  it('rowClass returns selected class when editMode is active', () => {
    render(
      <ResultGridView
        {...defaultProps}
        editMode="users"
        selectedRowIndex={1}
        currentPage={1}
        pageSize={1000}
      />
    )
    const props = getLatestDataGridProps()
    const rowClass = props.rowClass as (row: Record<string, unknown>) => string | undefined

    // In edit mode, selected row should get the highlight
    expect(rowClass({ __rowIdx: 1 })).toBe('rdg-row-precision-selected')
    // Other rows should not be selected
    expect(rowClass({ __rowIdx: 0 })).toBeUndefined()
    expect(rowClass({ __rowIdx: 2 })).toBeUndefined()
  })

  it('rowClass handles page-offset conversion for selection in edit mode', () => {
    render(
      <ResultGridView
        {...defaultProps}
        editMode="users"
        selectedRowIndex={15}
        currentPage={2}
        pageSize={10}
      />
    )
    const props = getLatestDataGridProps()
    const rowClass = props.rowClass as (row: Record<string, unknown>) => string | undefined

    // Absolute index 15 on page 2 (size 10) → local = 15 - (2-1)*10 = 5
    expect(rowClass({ __rowIdx: 5 })).toBe('rdg-row-precision-selected')
    expect(rowClass({ __rowIdx: 4 })).toBeUndefined()
  })

  it('rowClass returns undefined when no row is selected', () => {
    render(<ResultGridView {...defaultProps} selectedRowIndex={null} />)
    const props = getLatestDataGridProps()
    const rowClass = props.rowClass as (row: Record<string, unknown>) => string | undefined

    expect(rowClass({ __rowIdx: 0 })).toBeUndefined()
  })

  it('provides a rowKeyGetter that returns __rowIdx', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestDataGridProps()
    const rowKeyGetter = props.rowKeyGetter as (row: Record<string, unknown>) => number

    expect(rowKeyGetter({ __rowIdx: 5, col_0: 1 })).toBe(5)
    expect(rowKeyGetter({ __rowIdx: 0, col_0: 2 })).toBe(0)
  })

  it('has renderCell on all columns (TableDataCellRenderer)', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{ renderCell: unknown }>
    colDefs.forEach((col) => {
      expect(col.renderCell).toBeDefined()
      expect(typeof col.renderCell).toBe('function')
    })
  })
})
