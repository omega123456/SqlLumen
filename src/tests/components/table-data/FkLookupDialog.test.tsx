import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import type { TableDataResponse } from '../../../types/schema'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchTableData = vi.fn<(...args: unknown[]) => Promise<TableDataResponse>>()

vi.mock('../../../lib/table-data-commands', () => ({
  fetchTableData: (...args: unknown[]) => mockFetchTableData(args[0]),
  updateTableRow: vi.fn().mockResolvedValue(undefined),
  insertTableRow: vi.fn().mockResolvedValue([]),
  deleteTableRow: vi.fn().mockResolvedValue(undefined),
  exportTableData: vi.fn().mockResolvedValue(undefined),
}))

// Mock BaseGridView to avoid react-data-grid complexity in unit tests
vi.mock('../../../components/shared/BaseGridView', () => ({
  BaseGridView: (props: Record<string, unknown>) => {
    const sortChangeHandler = props.onSortChange as
      | ((col: string | null, dir: 'ASC' | 'DESC' | null) => void)
      | undefined
    const rowClickHandler = props.onRowClick as
      | ((rowData: Record<string, unknown>) => void)
      | undefined
    const cellDoubleClickHandler = props.onCellDoubleClick as
      | ((rowData: Record<string, unknown>, columnKey: string) => void)
      | undefined
    const getRowClassFn = props.getRowClass as
      | ((rowData: Record<string, unknown>) => string | undefined)
      | undefined
    const rows = (props.rows as Record<string, unknown>[]) ?? []

    return (
      <div
        data-testid={props.testId as string}
        data-highlight-column={props.highlightColumnKey as string}
        data-sort-column={props.sortColumn as string}
        data-sort-direction={props.sortDirection as string}
      >
        <span data-testid="grid-row-count">{rows.length}</span>
        {/* Allow tests to trigger sort changes */}
        <button data-testid="mock-sort-trigger" onClick={() => sortChangeHandler?.('name', 'ASC')}>
          Sort
        </button>
        {/* Render clickable rows for row selection / double-click tests */}
        {rows.map((row, idx) => {
          const rowClass = getRowClassFn?.(row) ?? ''
          return (
            <div
              key={idx}
              data-testid={`mock-row-${idx}`}
              data-row-class={rowClass}
              onClick={() => rowClickHandler?.(row)}
              onDoubleClick={() => cellDoubleClickHandler?.(row, 'id')}
            >
              {String(row.id ?? idx)} — {String(row.name ?? '')}
            </div>
          )
        })}
      </div>
    )
  },
}))

// Import the component under test AFTER mocks are set up
import {
  FkLookupDialog,
  type FkLookupDialogProps,
} from '../../../components/table-data/FkLookupDialog'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeTableDataResponse(overrides: Partial<TableDataResponse> = {}): TableDataResponse {
  return {
    columns: [
      {
        name: 'id',
        dataType: 'int',
        isNullable: false,
        isPrimaryKey: true,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isBooleanAlias: false,
        isAutoIncrement: true,
      },
      {
        name: 'name',
        dataType: 'varchar',
        isNullable: true,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isBooleanAlias: false,
        isAutoIncrement: false,
      },
    ],
    rows: [
      [1, 'Alice'],
      [2, 'Bob'],
      [3, 'Charlie'],
    ],
    totalRows: 3,
    currentPage: 1,
    totalPages: 1,
    pageSize: 100,
    primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
    executionTimeMs: 12,
    ...overrides,
  }
}

function makeDefaultProps(overrides: Partial<FkLookupDialogProps> = {}): FkLookupDialogProps {
  return {
    isOpen: true,
    onClose: vi.fn(),
    onApply: vi.fn(),
    connectionId: 'conn-1',
    database: 'mydb',
    sourceTable: 'orders',
    sourceColumn: 'user_id',
    currentValue: 1,
    // database prop is the referenced table database used by the dialog query
    referencedTable: 'users',
    referencedColumn: 'id',
    isReadOnly: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockIPC(() => null)
  mockFetchTableData.mockResolvedValue(makeTableDataResponse())
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FkLookupDialog', () => {
  it('renders with correct title and subtitle', async () => {
    render(<FkLookupDialog {...makeDefaultProps()} />)

    await waitFor(() => {
      expect(screen.getByTestId('fk-lookup-title')).toHaveTextContent('Look Up — users.id')
    })
    expect(screen.getByTestId('fk-lookup-subtitle')).toHaveTextContent('orders.user_id → users.id')
  })

  it('has correct data-testid on dialog wrapper', async () => {
    render(<FkLookupDialog {...makeDefaultProps()} />)

    await waitFor(() => {
      expect(screen.getByTestId('fk-lookup-dialog')).toBeInTheDocument()
    })
    expect(screen.getByTestId('fk-lookup-dialog-panel')).toBeInTheDocument()
  })

  it('loads data with pre-filter when currentValue is provided', async () => {
    render(<FkLookupDialog {...makeDefaultProps({ currentValue: 42 })} />)

    await waitFor(() => {
      expect(mockFetchTableData).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'conn-1',
          database: 'mydb',
          table: 'users',
          page: 1,
          pageSize: 100,
          filterModel: [{ column: 'id', operator: '==', value: '42' }],
        })
      )
    })
  })

  it('loads data without filter when currentValue is null', async () => {
    render(<FkLookupDialog {...makeDefaultProps({ currentValue: null })} />)

    await waitFor(() => {
      expect(mockFetchTableData).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'conn-1',
          database: 'mydb',
          table: 'users',
          page: 1,
          pageSize: 100,
          filterModel: undefined,
        })
      )
    })
  })

  it('loads data without filter when currentValue is empty string', async () => {
    render(<FkLookupDialog {...makeDefaultProps({ currentValue: '' })} />)

    await waitFor(() => {
      expect(mockFetchTableData).toHaveBeenCalledWith(
        expect.objectContaining({
          filterModel: undefined,
        })
      )
    })
  })

  it('loads data without filter when currentValue is undefined', async () => {
    render(<FkLookupDialog {...makeDefaultProps({ currentValue: undefined })} />)

    await waitFor(() => {
      expect(mockFetchTableData).toHaveBeenCalledWith(
        expect.objectContaining({
          filterModel: undefined,
        })
      )
    })
  })

  it('toolbar shows StatusArea, Filter button, and PaginationGroup', async () => {
    render(<FkLookupDialog {...makeDefaultProps()} />)

    await waitFor(() => {
      expect(screen.getByTestId('status-area')).toBeInTheDocument()
    })
    expect(screen.getByTestId('fk-lookup-btn-filter')).toBeInTheDocument()
    expect(screen.getByTestId('pagination-group')).toBeInTheDocument()
  })

  it('shows row count and execution time after loading', async () => {
    render(<FkLookupDialog {...makeDefaultProps()} />)

    await waitFor(() => {
      expect(screen.getByText('3 Rows')).toBeInTheDocument()
    })
    expect(screen.getByText('(12ms)')).toBeInTheDocument()
  })

  it('filter button opens FilterDialog', async () => {
    render(<FkLookupDialog {...makeDefaultProps()} />)

    await waitFor(() => {
      expect(screen.getByTestId('fk-lookup-btn-filter')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('fk-lookup-btn-filter'))

    await waitFor(() => {
      expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()
    })
  })

  it('applying filters from FilterDialog reloads data with new filter', async () => {
    render(<FkLookupDialog {...makeDefaultProps({ currentValue: null })} />)

    // Wait for initial load
    await waitFor(() => {
      expect(mockFetchTableData).toHaveBeenCalledTimes(1)
    })

    // Open filter dialog
    fireEvent.click(screen.getByTestId('fk-lookup-btn-filter'))

    await waitFor(() => {
      expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()
    })

    // Add a filter condition
    fireEvent.click(screen.getByTestId('filter-add-button'))
    // Apply
    fireEvent.click(screen.getByTestId('filter-apply-button'))

    // Dialog should close and data should reload
    await waitFor(() => {
      expect(screen.queryByTestId('filter-dialog')).not.toBeInTheDocument()
    })

    // Should have loaded again with the new filter
    await waitFor(() => {
      expect(mockFetchTableData).toHaveBeenCalledTimes(2)
    })
  })

  it('filter badge shows count when filters are active', async () => {
    render(<FkLookupDialog {...makeDefaultProps({ currentValue: 1 })} />)

    // Pre-filter applies 1 condition
    await waitFor(() => {
      expect(screen.getByTestId('fk-lookup-filter-badge')).toHaveTextContent('1')
    })
  })

  it('no filter badge when no filters active', async () => {
    render(<FkLookupDialog {...makeDefaultProps({ currentValue: null })} />)

    await waitFor(() => {
      expect(mockFetchTableData).toHaveBeenCalled()
    })

    expect(screen.queryByTestId('fk-lookup-filter-badge')).not.toBeInTheDocument()
  })

  it('Escape key with FilterDialog open should NOT close FkLookupDialog', async () => {
    const onClose = vi.fn()
    render(<FkLookupDialog {...makeDefaultProps({ onClose })} />)

    // Wait for data
    await waitFor(() => {
      expect(mockFetchTableData).toHaveBeenCalled()
    })

    // Open filter dialog
    fireEvent.click(screen.getByTestId('fk-lookup-btn-filter'))
    await waitFor(() => {
      expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()
    })

    // Press Escape — should NOT close the FK lookup dialog
    fireEvent.keyDown(document, { key: 'Escape' })

    // FkLookupDialog should still be open
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('fk-lookup-dialog')).toBeInTheDocument()
  })

  it('Escape key without FilterDialog open closes FkLookupDialog', async () => {
    const onClose = vi.fn()
    render(<FkLookupDialog {...makeDefaultProps({ onClose })} />)

    await waitFor(() => {
      expect(mockFetchTableData).toHaveBeenCalled()
    })

    // Press Escape — filter dialog is NOT open, so this should close
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('pagination page change triggers data reload', async () => {
    mockFetchTableData.mockResolvedValue(makeTableDataResponse({ currentPage: 1, totalPages: 3 }))

    render(<FkLookupDialog {...makeDefaultProps({ currentValue: null })} />)

    await waitFor(() => {
      expect(mockFetchTableData).toHaveBeenCalledTimes(1)
    })

    // Click next page
    fireEvent.click(screen.getByTestId('pagination-next'))

    await waitFor(() => {
      expect(mockFetchTableData).toHaveBeenCalledTimes(2)
      expect(mockFetchTableData).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
    })
  })

  it('pagination page size change triggers data reload and resets page to 1', async () => {
    const user = userEvent.setup()
    render(<FkLookupDialog {...makeDefaultProps({ currentValue: null })} />)

    await waitFor(() => {
      expect(mockFetchTableData).toHaveBeenCalledTimes(1)
    })

    // Change page size
    await user.click(screen.getByTestId('page-size-select'))
    await user.click(screen.getByRole('option', { name: '500' }))

    await waitFor(() => {
      expect(mockFetchTableData).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 500, page: 1 })
      )
    })
  })

  it('sort change triggers data reload', async () => {
    render(<FkLookupDialog {...makeDefaultProps({ currentValue: null })} />)

    await waitFor(() => {
      expect(mockFetchTableData).toHaveBeenCalledTimes(1)
    })

    // Trigger sort via mock grid
    fireEvent.click(screen.getByTestId('mock-sort-trigger'))

    await waitFor(() => {
      expect(mockFetchTableData).toHaveBeenCalledWith(
        expect.objectContaining({
          sortColumn: 'name',
          sortDirection: 'ASC',
        })
      )
    })
  })

  it('loading state renders correctly', async () => {
    // Make fetchTableData hang (never resolve)
    mockFetchTableData.mockReturnValue(new Promise(() => {}))

    render(<FkLookupDialog {...makeDefaultProps()} />)

    // Should show loading indicator
    await waitFor(() => {
      expect(screen.getByTestId('fk-lookup-loading')).toBeInTheDocument()
    })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('error state with retry button renders correctly', async () => {
    mockFetchTableData.mockRejectedValueOnce(new Error('Network error'))

    render(<FkLookupDialog {...makeDefaultProps()} />)

    await waitFor(() => {
      expect(screen.getByTestId('fk-lookup-error')).toBeInTheDocument()
    })
    // Error message appears in both StatusArea and the error container;
    // use getAllByText to account for both, and verify the error container text specifically.
    expect(screen.getAllByText('Network error').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('fk-lookup-retry')).toBeInTheDocument()
    // StatusArea should show error status
    expect(screen.getByTestId('status-error')).toBeInTheDocument()
  })

  it('clicking retry reloads data', async () => {
    mockFetchTableData.mockRejectedValueOnce(new Error('Network error'))

    render(<FkLookupDialog {...makeDefaultProps()} />)

    await waitFor(() => {
      expect(screen.getByTestId('fk-lookup-error')).toBeInTheDocument()
    })

    const callCountBeforeRetry = mockFetchTableData.mock.calls.length

    // Now make the retry succeed
    mockFetchTableData.mockResolvedValueOnce(makeTableDataResponse())

    fireEvent.click(screen.getByTestId('fk-lookup-retry'))

    await waitFor(() => {
      expect(mockFetchTableData.mock.calls.length).toBeGreaterThan(callCountBeforeRetry)
    })
  })

  it('empty state renders correctly when no rows returned', async () => {
    mockFetchTableData.mockResolvedValue(makeTableDataResponse({ rows: [], totalRows: 0 }))

    render(<FkLookupDialog {...makeDefaultProps()} />)

    await waitFor(() => {
      expect(screen.getByTestId('fk-lookup-empty')).toBeInTheDocument()
    })
    expect(screen.getByText('No rows found')).toBeInTheDocument()
  })

  it('Apply button is disabled when no row selected', async () => {
    render(<FkLookupDialog {...makeDefaultProps()} />)

    await waitFor(() => {
      expect(screen.getByTestId('fk-lookup-apply')).toBeInTheDocument()
    })
    expect(screen.getByTestId('fk-lookup-apply')).toBeDisabled()
  })

  it('Cancel button calls onClose', async () => {
    const onClose = vi.fn()
    render(<FkLookupDialog {...makeDefaultProps({ onClose })} />)

    await waitFor(() => {
      expect(screen.getByTestId('fk-lookup-cancel')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('fk-lookup-cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('close button (X) calls onClose', async () => {
    const onClose = vi.fn()
    render(<FkLookupDialog {...makeDefaultProps({ onClose })} />)

    await waitFor(() => {
      expect(screen.getByTestId('fk-lookup-close')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('fk-lookup-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('referenced column is highlighted via highlightColumnKey', async () => {
    render(<FkLookupDialog {...makeDefaultProps()} />)

    await waitFor(() => {
      const grid = screen.getByTestId('fk-lookup-base-grid')
      expect(grid.getAttribute('data-highlight-column')).toBe('id')
    })
  })

  it('does not render when isOpen is false', () => {
    render(<FkLookupDialog {...makeDefaultProps({ isOpen: false })} />)

    expect(screen.queryByTestId('fk-lookup-dialog')).not.toBeInTheDocument()
  })

  it('does not call fetchTableData when isOpen is false', () => {
    render(<FkLookupDialog {...makeDefaultProps({ isOpen: false })} />)

    expect(mockFetchTableData).not.toHaveBeenCalled()
  })

  it('grid shows correct row count', async () => {
    render(<FkLookupDialog {...makeDefaultProps()} />)

    await waitFor(() => {
      expect(screen.getByTestId('grid-row-count')).toHaveTextContent('3')
    })
  })

  // -------------------------------------------------------------------------
  // Phase 6B: Row selection and Apply integration tests
  // -------------------------------------------------------------------------

  it('row click selects row with selected-row styling', async () => {
    render(<FkLookupDialog {...makeDefaultProps()} />)

    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0')).toBeInTheDocument()
    })

    // Click first row
    fireEvent.click(screen.getByTestId('mock-row-0'))

    // The selected row should have the precision-selected class via getRowClass
    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0').getAttribute('data-row-class')).toBe(
        'rdg-row-precision-selected'
      )
    })

    // Other rows should not be selected
    expect(screen.getByTestId('mock-row-1').getAttribute('data-row-class')).toBe('')
    expect(screen.getByTestId('mock-row-2').getAttribute('data-row-class')).toBe('')
  })

  it('Apply button enabled when row is selected and isReadOnly is false', async () => {
    render(<FkLookupDialog {...makeDefaultProps()} />)

    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0')).toBeInTheDocument()
    })

    // Apply disabled before selection
    expect(screen.getByTestId('fk-lookup-apply')).toBeDisabled()

    // Click a row to select
    fireEvent.click(screen.getByTestId('mock-row-0'))

    // Apply should now be enabled
    await waitFor(() => {
      expect(screen.getByTestId('fk-lookup-apply')).toBeEnabled()
    })
  })

  it('Apply button disabled when isReadOnly is true (even with row selected)', async () => {
    render(<FkLookupDialog {...makeDefaultProps({ isReadOnly: true })} />)

    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0')).toBeInTheDocument()
    })

    // Click a row to select
    fireEvent.click(screen.getByTestId('mock-row-0'))

    // Apply should still be disabled because isReadOnly
    expect(screen.getByTestId('fk-lookup-apply')).toBeDisabled()
  })

  it('clicking Apply calls onApply with referenced column value from selected row', async () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(<FkLookupDialog {...makeDefaultProps({ onApply, onClose })} />)

    await waitFor(() => {
      expect(screen.getByTestId('mock-row-1')).toBeInTheDocument()
    })

    // Click second row (id=2, name='Bob')
    fireEvent.click(screen.getByTestId('mock-row-1'))

    await waitFor(() => {
      expect(screen.getByTestId('fk-lookup-apply')).toBeEnabled()
    })

    fireEvent.click(screen.getByTestId('fk-lookup-apply'))

    // onApply should be called with the 'id' value of the selected row (referenced column is 'id')
    expect(onApply).toHaveBeenCalledWith(2)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('double-click quick-selects and calls onApply immediately', async () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(<FkLookupDialog {...makeDefaultProps({ onApply, onClose })} />)

    await waitFor(() => {
      expect(screen.getByTestId('mock-row-2')).toBeInTheDocument()
    })

    // Double-click third row (id=3, name='Charlie')
    fireEvent.doubleClick(screen.getByTestId('mock-row-2'))

    // onApply called immediately with the referenced column value
    expect(onApply).toHaveBeenCalledWith(3)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('double-click is a no-op when isReadOnly is true', async () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(<FkLookupDialog {...makeDefaultProps({ onApply, onClose, isReadOnly: true })} />)

    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0')).toBeInTheDocument()
    })

    // Double-click first row
    fireEvent.doubleClick(screen.getByTestId('mock-row-0'))

    // Should not call onApply or onClose
    expect(onApply).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Enter key calls onApply when row is selected and dialog is not read-only', async () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(<FkLookupDialog {...makeDefaultProps({ onApply, onClose })} />)

    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0')).toBeInTheDocument()
    })

    // Select a row first
    fireEvent.click(screen.getByTestId('mock-row-0'))

    // Press Enter
    fireEvent.keyDown(document, { key: 'Enter' })

    expect(onApply).toHaveBeenCalledWith(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Enter key is a no-op when isReadOnly is true', async () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(<FkLookupDialog {...makeDefaultProps({ onApply, onClose, isReadOnly: true })} />)

    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0')).toBeInTheDocument()
    })

    // Select a row
    fireEvent.click(screen.getByTestId('mock-row-0'))

    // Press Enter
    fireEvent.keyDown(document, { key: 'Enter' })

    expect(onApply).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Enter key is a no-op when isFilterDialogOpen is true', async () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(<FkLookupDialog {...makeDefaultProps({ onApply, onClose })} />)

    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0')).toBeInTheDocument()
    })

    // Select a row
    fireEvent.click(screen.getByTestId('mock-row-0'))

    // Open the filter dialog
    fireEvent.click(screen.getByTestId('fk-lookup-btn-filter'))
    await waitFor(() => {
      expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()
    })

    // Press Enter — should NOT trigger apply because filter dialog is open
    fireEvent.keyDown(document, { key: 'Enter' })

    expect(onApply).not.toHaveBeenCalled()
  })

  it('selection cleared on filter change', async () => {
    render(<FkLookupDialog {...makeDefaultProps({ currentValue: null })} />)

    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0')).toBeInTheDocument()
    })

    // Select a row
    fireEvent.click(screen.getByTestId('mock-row-0'))
    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0').getAttribute('data-row-class')).toBe(
        'rdg-row-precision-selected'
      )
    })

    // Open filter dialog and apply new filters
    fireEvent.click(screen.getByTestId('fk-lookup-btn-filter'))
    await waitFor(() => {
      expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('filter-add-button'))
    fireEvent.click(screen.getByTestId('filter-apply-button'))

    // After filter change, selection should be cleared
    await waitFor(() => {
      expect(screen.queryByTestId('filter-dialog')).not.toBeInTheDocument()
    })

    // After data reloads, row should not be selected
    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0').getAttribute('data-row-class')).toBe('')
    })
  })

  it('selection cleared on sort change', async () => {
    render(<FkLookupDialog {...makeDefaultProps({ currentValue: null })} />)

    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0')).toBeInTheDocument()
    })

    // Select a row
    fireEvent.click(screen.getByTestId('mock-row-0'))
    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0').getAttribute('data-row-class')).toBe(
        'rdg-row-precision-selected'
      )
    })

    // Trigger sort change
    fireEvent.click(screen.getByTestId('mock-sort-trigger'))

    // Selection should be cleared
    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0').getAttribute('data-row-class')).toBe('')
    })
  })

  it('selection cleared on page change', async () => {
    mockFetchTableData.mockResolvedValue(makeTableDataResponse({ currentPage: 1, totalPages: 3 }))

    render(<FkLookupDialog {...makeDefaultProps({ currentValue: null })} />)

    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0')).toBeInTheDocument()
    })

    // Select a row
    fireEvent.click(screen.getByTestId('mock-row-0'))
    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0').getAttribute('data-row-class')).toBe(
        'rdg-row-precision-selected'
      )
    })

    // Click next page
    fireEvent.click(screen.getByTestId('pagination-next'))

    // Selection should be cleared
    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0').getAttribute('data-row-class')).toBe('')
    })
  })

  it('row key falls back to row index when referenced table has no PK', async () => {
    // Response with no primary key
    mockFetchTableData.mockResolvedValue(
      makeTableDataResponse({
        primaryKey: { keyColumns: [], hasAutoIncrement: false, isUniqueKeyFallback: false },
      })
    )

    render(<FkLookupDialog {...makeDefaultProps()} />)

    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0')).toBeInTheDocument()
    })

    // Select first row — should work even without PK (falls back to index-based key)
    fireEvent.click(screen.getByTestId('mock-row-0'))

    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0').getAttribute('data-row-class')).toBe(
        'rdg-row-precision-selected'
      )
    })

    // Other rows should not be selected
    expect(screen.getByTestId('mock-row-1').getAttribute('data-row-class')).toBe('')
  })

  it('Cancel closes without calling onApply', async () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(<FkLookupDialog {...makeDefaultProps({ onApply, onClose })} />)

    await waitFor(() => {
      expect(screen.getByTestId('mock-row-0')).toBeInTheDocument()
    })

    // Select a row first
    fireEvent.click(screen.getByTestId('mock-row-0'))

    // Click Cancel
    fireEvent.click(screen.getByTestId('fk-lookup-cancel'))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onApply).not.toHaveBeenCalled()
  })
})
