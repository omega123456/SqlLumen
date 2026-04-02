import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// Store captured BaseGridView props for assertions
let lastBaseGridProps: Record<string, unknown> = {}

// Mock the shared BaseGridView component (ResultGridView wraps it)
vi.mock('../../../components/shared/BaseGridView', async () => {
  const React = await import('react')
  const MockBaseGridView = React.forwardRef(function MockBaseGridView(
    props: Record<string, unknown>,
    ref: React.Ref<unknown>
  ) {
    void ref
    // Capture props for test assertions
    lastBaseGridProps = props
    const rows = (props.rows as Array<Record<string, unknown>>) ?? []
    return React.createElement(
      'div',
      { 'data-testid': props.testId ?? 'base-grid-view' },
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
  })
  return { BaseGridView: MockBaseGridView }
})

import { ResultGridView } from '../../../components/query-editor/ResultGridView'

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

function getLatestBaseGridProps(): Record<string, unknown> {
  return lastBaseGridProps
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
    lastBaseGridProps = {}
  })

  it('renders with data-testid="result-grid-view"', () => {
    render(<ResultGridView {...defaultProps} />)
    expect(screen.getByTestId('result-grid-view')).toBeInTheDocument()
  })

  it('passes correct number of column descriptors to BaseGridView', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestBaseGridProps()
    const colDefs = props.columns as Array<{ key: string; displayName: string }>
    expect(colDefs).toHaveLength(3)
  })

  it('maps column names to displayName property', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestBaseGridProps()
    const colDefs = props.columns as Array<{ displayName: string }>
    expect(colDefs[0].displayName).toBe('id')
    expect(colDefs[1].displayName).toBe('name')
    expect(colDefs[2].displayName).toBe('email')
  })

  it('uses index-based keys (col_N) for columns', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestBaseGridProps()
    const colDefs = props.columns as Array<{ key: string }>
    expect(colDefs[0].key).toBe('col_0')
    expect(colDefs[1].key).toBe('col_1')
    expect(colDefs[2].key).toBe('col_2')
  })

  it('transforms row arrays into keyed objects with __rowIdx', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestBaseGridProps()
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

  it('enables auto-sizing based on the visible query result values', () => {
    render(<ResultGridView {...defaultProps} />)

    const props = getLatestBaseGridProps()
    const autoSizeConfig = props.autoSizeConfig as
      | {
          enabled: boolean
          computeWidth: (
            col: { key: string; displayName: string; dataType: string },
            rows: Record<string, unknown>[]
          ) => number
        }
      | undefined
    const rowData = props.rows as Array<Record<string, unknown>>
    const gridColumns = props.columns as Array<{
      key: string
      displayName: string
      dataType: string
    }>

    expect(autoSizeConfig?.enabled).toBe(true)
    expect(autoSizeConfig?.computeWidth(gridColumns[2], rowData)).toBeGreaterThan(
      autoSizeConfig!.computeWidth(gridColumns[0], rowData)
    )
  })

  it('passes sortColumn and sortDirection translated to BaseGridView format', () => {
    render(<ResultGridView {...defaultProps} sortColumn="name" sortDirection="asc" />)
    const props = getLatestBaseGridProps()
    expect(props.sortColumn).toBe('col_1')
    expect(props.sortDirection).toBe('ASC')
  })

  it('passes sortColumn and sortDirection for DESC', () => {
    render(<ResultGridView {...defaultProps} sortColumn="id" sortDirection="desc" />)
    const props = getLatestBaseGridProps()
    expect(props.sortColumn).toBe('col_0')
    expect(props.sortDirection).toBe('DESC')
  })

  it('passes null sortColumn when no sort is active', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestBaseGridProps()
    expect(props.sortColumn).toBeNull()
    expect(props.sortDirection).toBeNull()
  })

  it('onSortChange calls onSortChanged with column name and lowercase direction', () => {
    const onSortChanged = vi.fn()
    render(<ResultGridView {...defaultProps} onSortChanged={onSortChanged} />)
    const props = getLatestBaseGridProps()
    const onSortChange = props.onSortChange as (
      colKey: string | null,
      direction: 'ASC' | 'DESC' | null
    ) => void

    onSortChange('col_1', 'ASC')
    expect(onSortChanged).toHaveBeenCalledWith('name', 'asc')
  })

  it('onSortChange handles DESC direction', () => {
    const onSortChanged = vi.fn()
    render(<ResultGridView {...defaultProps} onSortChanged={onSortChanged} />)
    const props = getLatestBaseGridProps()
    const onSortChange = props.onSortChange as (
      colKey: string | null,
      direction: 'ASC' | 'DESC' | null
    ) => void

    onSortChange('col_0', 'DESC')
    expect(onSortChanged).toHaveBeenCalledWith('id', 'desc')
  })

  it('onSortChange enforces sort clearing when null colKey is passed', () => {
    const onSortChanged = vi.fn()
    render(<ResultGridView {...defaultProps} onSortChanged={onSortChanged} sortColumn="name" />)
    const props = getLatestBaseGridProps()
    const onSortChange = props.onSortChange as (
      colKey: string | null,
      direction: 'ASC' | 'DESC' | null
    ) => void

    onSortChange(null, null)
    expect(onSortChanged).toHaveBeenCalledWith('name', null)
  })

  it('onSortChange does nothing when sort cleared and no previous sortColumn', () => {
    const onSortChanged = vi.fn()
    render(<ResultGridView {...defaultProps} onSortChanged={onSortChanged} sortColumn={null} />)
    const props = getLatestBaseGridProps()
    const onSortChange = props.onSortChange as (
      colKey: string | null,
      direction: 'ASC' | 'DESC' | null
    ) => void

    onSortChange(null, null)
    expect(onSortChanged).not.toHaveBeenCalled()
  })

  it('calls onRowSelected via cell click guard in read-only mode', async () => {
    const onRowSelected = vi.fn()
    render(<ResultGridView {...defaultProps} onRowSelected={onRowSelected} />)
    const props = getLatestBaseGridProps()
    const onCellClickGuard = props.onCellClickGuard as (args: {
      rowIdx: number
      columnKey: string
      rowData: Record<string, unknown>
    }) => Promise<{ proceed: boolean }>

    await act(async () => {
      await onCellClickGuard({
        rowIdx: 0,
        columnKey: 'col_0',
        rowData: { __rowIdx: 0, col_0: 1 },
      })
    })

    expect(onRowSelected).toHaveBeenCalledWith(0)
  })

  it('calls onRowSelected with correct index for different rows', async () => {
    const onRowSelected = vi.fn()
    render(<ResultGridView {...defaultProps} onRowSelected={onRowSelected} />)
    const props = getLatestBaseGridProps()
    const onCellClickGuard = props.onCellClickGuard as (args: {
      rowIdx: number
      columnKey: string
      rowData: Record<string, unknown>
    }) => Promise<{ proceed: boolean }>

    await act(async () => {
      await onCellClickGuard({
        rowIdx: 2,
        columnKey: 'col_0',
        rowData: { __rowIdx: 2, col_0: 3 },
      })
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
    const props = getLatestBaseGridProps()
    const rowData = props.rows as Array<Record<string, unknown>>
    expect(rowData).toHaveLength(0)
  })

  it('renders with empty columns', () => {
    render(<ResultGridView {...defaultProps} columns={[]} rows={[]} />)
    expect(screen.getByTestId('result-grid-view')).toBeInTheDocument()
    const props = getLatestBaseGridProps()
    const colDefs = props.columns as Array<{ key: string }>
    expect(colDefs).toHaveLength(0)
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
    const props = getLatestBaseGridProps()
    const onCellClickGuard = props.onCellClickGuard as (args: {
      rowIdx: number
      columnKey: string
      rowData: Record<string, unknown>
    }) => Promise<{ proceed: boolean }>

    await act(async () => {
      await onCellClickGuard({
        rowIdx: 0,
        columnKey: 'col_0',
        rowData: { __rowIdx: 0, col_0: 1 },
      })
    })

    // The grid itself reports local index 0 to onRowSelected
    // (The parent ResultPanel converts to absolute: (2-1)*10 + 0 = 10)
    expect(onRowSelected).toHaveBeenCalledWith(0)
  })

  it('passes currentPage and pageSize props to the component', () => {
    render(<ResultGridView {...defaultProps} currentPage={3} pageSize={50} />)
    expect(screen.getByTestId('result-grid-view')).toBeInTheDocument()
  })

  it('getRowClass returns selected class in read-only mode (editMode=null)', () => {
    render(
      <ResultGridView {...defaultProps} selectedRowIndex={1} currentPage={1} pageSize={1000} />
    )
    const props = getLatestBaseGridProps()
    const getRowClass = props.getRowClass as (row: Record<string, unknown>) => string | undefined

    // Selected row should get the highlight regardless of edit mode
    expect(getRowClass({ __rowIdx: 1 })).toBe('rdg-row-precision-selected')
    expect(getRowClass({ __rowIdx: 0 })).toBeUndefined()
  })

  it('getRowClass returns selected class when editMode is active', () => {
    render(
      <ResultGridView
        {...defaultProps}
        editMode="users"
        selectedRowIndex={1}
        currentPage={1}
        pageSize={1000}
      />
    )
    const props = getLatestBaseGridProps()
    const getRowClass = props.getRowClass as (row: Record<string, unknown>) => string | undefined

    // In edit mode, selected row should get the highlight
    expect(getRowClass({ __rowIdx: 1 })).toBe('rdg-row-precision-selected')
    // Other rows should not be selected
    expect(getRowClass({ __rowIdx: 0 })).toBeUndefined()
    expect(getRowClass({ __rowIdx: 2 })).toBeUndefined()
  })

  it('getRowClass handles page-offset conversion for selection in edit mode', () => {
    render(
      <ResultGridView
        {...defaultProps}
        editMode="users"
        selectedRowIndex={15}
        currentPage={2}
        pageSize={10}
      />
    )
    const props = getLatestBaseGridProps()
    const getRowClass = props.getRowClass as (row: Record<string, unknown>) => string | undefined

    // Absolute index 15 on page 2 (size 10) → local = 15 - (2-1)*10 = 5
    expect(getRowClass({ __rowIdx: 5 })).toBe('rdg-row-precision-selected')
    expect(getRowClass({ __rowIdx: 4 })).toBeUndefined()
  })

  it('getRowClass returns undefined when no row is selected', () => {
    render(<ResultGridView {...defaultProps} selectedRowIndex={null} />)
    const props = getLatestBaseGridProps()
    const getRowClass = props.getRowClass as (row: Record<string, unknown>) => string | undefined

    expect(getRowClass({ __rowIdx: 0 })).toBeUndefined()
  })

  it('provides a rowKeyGetter that returns string __rowIdx', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestBaseGridProps()
    const rowKeyGetter = props.rowKeyGetter as (row: Record<string, unknown>) => string

    expect(rowKeyGetter({ __rowIdx: 5, col_0: 1 })).toBe('5')
    expect(rowKeyGetter({ __rowIdx: 0, col_0: 2 })).toBe('0')
  })

  it('passes testId="result-grid-view" to BaseGridView', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestBaseGridProps()
    expect(props.testId).toBe('result-grid-view')
  })

  it('column descriptors have correct dataType from ColumnMeta', () => {
    render(<ResultGridView {...defaultProps} />)
    const props = getLatestBaseGridProps()
    const colDefs = props.columns as Array<{ dataType: string }>
    expect(colDefs[0].dataType).toBe('INT')
    expect(colDefs[1].dataType).toBe('VARCHAR')
    expect(colDefs[2].dataType).toBe('VARCHAR')
  })
})
