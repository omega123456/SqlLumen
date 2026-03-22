import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ResultGrid } from '../../../components/query-editor/ResultGrid'

const columns = [
  { name: 'id', dataType: 'INT' },
  { name: 'name', dataType: 'VARCHAR' },
  { name: 'email', dataType: 'VARCHAR' },
]

const rows: (string | null)[][] = [
  ['1', 'Alice', 'alice@example.com'],
  ['2', 'Bob', null],
  ['3', 'Charlie', 'charlie@example.com'],
]

describe('ResultGrid', () => {
  const defaultProps = {
    columns,
    rows,
    selectedRowIndex: null,
    onRowSelect: vi.fn(),
  }

  it('renders with data-testid="result-grid"', () => {
    render(<ResultGrid {...defaultProps} />)
    expect(screen.getByTestId('result-grid')).toBeInTheDocument()
  })

  it('renders column headers with sort indicators', () => {
    render(<ResultGrid {...defaultProps} />)
    // Column names appear alongside sort indicator ⇅
    const grid = screen.getByTestId('result-grid')
    const headers = grid.querySelectorAll('thead th')
    // First is #, then columns
    expect(headers[1]).toHaveTextContent('id')
    expect(headers[2]).toHaveTextContent('name')
    expect(headers[3]).toHaveTextContent('email')
    // Sort indicators are present
    const sortIndicators = grid.querySelectorAll('thead th span')
    expect(sortIndicators.length).toBe(3) // one per column
  })

  it('renders row number header', () => {
    render(<ResultGrid {...defaultProps} />)
    expect(screen.getByText('#')).toBeInTheDocument()
  })

  it('renders row data', () => {
    render(<ResultGrid {...defaultProps} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText('charlie@example.com')).toBeInTheDocument()
  })

  it('renders NULL cells as italic "NULL" spans', () => {
    render(<ResultGrid {...defaultProps} />)
    const nullCells = screen.getAllByText('NULL')
    expect(nullCells).toHaveLength(1) // row 2, email column
    expect(nullCells[0].tagName).toBe('SPAN')
  })

  it('fires onRowSelect callback with correct index on click', () => {
    const onRowSelect = vi.fn()
    render(<ResultGrid {...defaultProps} onRowSelect={onRowSelect} />)
    fireEvent.click(screen.getByText('Alice'))
    expect(onRowSelect).toHaveBeenCalledWith(0)
  })

  it('fires onRowSelect for different rows', () => {
    const onRowSelect = vi.fn()
    render(<ResultGrid {...defaultProps} onRowSelect={onRowSelect} />)
    fireEvent.click(screen.getByText('Charlie'))
    expect(onRowSelect).toHaveBeenCalledWith(2)
  })

  it('selected row has data-selected="true"', () => {
    render(<ResultGrid {...defaultProps} selectedRowIndex={1} />)
    const grid = screen.getByTestId('result-grid')
    const tbodyRows = grid.querySelectorAll('tbody tr')
    expect(tbodyRows[1]).toHaveAttribute('data-selected', 'true')
  })

  it('non-selected rows have data-selected="false"', () => {
    render(<ResultGrid {...defaultProps} selectedRowIndex={1} />)
    const grid = screen.getByTestId('result-grid')
    const tbodyRows = grid.querySelectorAll('tbody tr')
    expect(tbodyRows[0]).toHaveAttribute('data-selected', 'false')
    expect(tbodyRows[2]).toHaveAttribute('data-selected', 'false')
  })

  it('renders row numbers', () => {
    render(<ResultGrid {...defaultProps} />)
    const grid = screen.getByTestId('result-grid')
    const tbodyRows = grid.querySelectorAll('tbody tr')
    expect(tbodyRows[0]).toHaveTextContent('1')
    expect(tbodyRows[1]).toHaveTextContent('2')
    expect(tbodyRows[2]).toHaveTextContent('3')
  })

  it('renders empty grid when no rows', () => {
    render(<ResultGrid {...defaultProps} rows={[]} />)
    const grid = screen.getByTestId('result-grid')
    const tbodyRows = grid.querySelectorAll('tbody tr')
    expect(tbodyRows).toHaveLength(0)
    // Headers should still render
    const headers = grid.querySelectorAll('thead th')
    expect(headers.length).toBe(4) // # + 3 columns
  })

  it('renders duplicate column names without React key warnings', () => {
    const dupeColumns = [
      { name: 'id', dataType: 'INT' },
      { name: 'id', dataType: 'INT' },
      { name: 'name', dataType: 'VARCHAR' },
    ]
    const dupeRows: (string | null)[][] = [['1', '10', 'Alice']]
    render(
      <ResultGrid
        columns={dupeColumns}
        rows={dupeRows}
        selectedRowIndex={null}
        onRowSelect={vi.fn()}
      />
    )
    // Should render both 'id' headers (plus #)
    const grid = screen.getByTestId('result-grid')
    const headers = grid.querySelectorAll('thead th')
    // # + id + id + name = 4 headers
    expect(headers).toHaveLength(4)
    expect(headers[1]).toHaveTextContent('id')
    expect(headers[2]).toHaveTextContent('id')
  })
})
