import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { ResultPanel } from '../../../components/query-editor/ResultPanel'
import { useQueryStore, DEFAULT_RESULT_STATE } from '../../../stores/query-store'
import type { SingleResultState, TabQueryState } from '../../../stores/query-store'

// Mock react-data-grid
vi.mock('react-data-grid', async () => {
  const React = await import('react')
  return {
    DataGrid: React.forwardRef(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (props: Record<string, unknown>, _ref: unknown) => {
        return React.createElement(
          'div',
          {
            'data-testid': (props['data-testid'] as string) ?? 'rdg-inner',
            className: props.className as string,
          },
          'Grid Mock'
        )
      }
    ),
  }
})

// Mock clipboard utility
vi.mock('../../../lib/context-menu-utils', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}))

// Mock export-commands
vi.mock('../../../lib/export-commands', () => ({
  exportResults: vi.fn().mockResolvedValue({ bytesWritten: 1024, rowsExported: 5 }),
}))

// Mock query-commands
vi.mock('../../../lib/query-commands', () => ({
  executeQuery: vi.fn().mockResolvedValue({
    queryId: 'q1',
    columns: [],
    totalRows: 0,
    executionTimeMs: 0,
    affectedRows: 0,
    totalPages: 1,
    autoLimitApplied: false,
    firstPage: [],
  }),
  fetchResultPage: vi.fn().mockResolvedValue({ rows: [], page: 1, totalPages: 1 }),
  evictResults: vi.fn().mockResolvedValue(undefined),
  sortResults: vi.fn().mockResolvedValue({ rows: [], page: 1, totalPages: 1 }),
}))

// Mock table-data-commands
vi.mock('../../../lib/table-data-commands', () => ({
  fetchTableData: vi.fn().mockResolvedValue({
    columns: [],
    rows: [],
    totalRows: 0,
    currentPage: 1,
    totalPages: 1,
    pageSize: 100,
    primaryKey: null,
    executionTimeMs: 0,
  }),
  updateTableRow: vi.fn().mockResolvedValue(undefined),
  insertTableRow: vi.fn().mockResolvedValue([]),
  deleteTableRow: vi.fn().mockResolvedValue(undefined),
  exportTableData: vi.fn().mockResolvedValue(undefined),
}))

// Mock FkLookupDialog
vi.mock('../../../components/table-data/FkLookupDialog', () => ({
  FkLookupDialog: () => null,
}))

// Mock toast store — capture showSuccess calls
const mockShowSuccess = vi.fn()
vi.mock('../../../stores/toast-store', () => ({
  useToastStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      toasts: [],
      showError: vi.fn(),
      showSuccess: mockShowSuccess,
      showWarning: vi.fn(),
      dismiss: vi.fn(),
    }
    return selector(state)
  }),
}))

/**
 * Set up a tab in the query store with success status and filter-relevant state.
 */
function setupQueryTab(resultOverrides: Partial<SingleResultState> = {}) {
  const result: SingleResultState = {
    ...DEFAULT_RESULT_STATE,
    status: 'success',
    columns: [
      { name: 'id', dataType: 'INT' },
      { name: 'name', dataType: 'VARCHAR' },
    ],
    rows: [
      [1, 'Alice'],
      [2, 'Bob'],
    ],
    totalRows: 2,
    queryId: 'q1',
    ...resultOverrides,
  }

  const tab: TabQueryState = {
    content: '',
    filePath: null,
    status: 'success',
    cursorPosition: null,
    connectionId: 'conn-1',
    results: [result],
    activeResultIndex: 0,
    pendingNavigationAction: null,
    executionStartedAt: null,
    isCancelling: false,
    wasCancelled: false,
  }

  useQueryStore.setState({ tabs: { 'tab-1': tab } })
}

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  mockIPC(() => null)
  vi.clearAllMocks()
})

describe('ResultPanel — Filter button state', () => {
  it('filter button is disabled when no columns', () => {
    setupQueryTab({ columns: [], rows: [] })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('btn-filter')).toBeDisabled()
  })

  it('clear filter button is not visible when no filters', () => {
    setupQueryTab({ filterModel: [] })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.queryByTestId('btn-clear-filter')).not.toBeInTheDocument()
  })

  it('clear filter button is visible when filters are active', () => {
    setupQueryTab({
      filterModel: [{ column: 'name', operator: '==', value: 'Alice' }],
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('btn-clear-filter')).toBeInTheDocument()
  })
})

describe('ResultPanel — Clear filter', () => {
  it('clicking clear filter directly clears filters and shows toast', async () => {
    setupQueryTab({
      filterModel: [{ column: 'name', operator: '==', value: 'Alice' }],
      unfilteredRows: [
        [1, 'Alice'],
        [2, 'Bob'],
      ],
      rows: [[1, 'Alice']],
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

    // Click clear filter — no confirm dialog
    fireEvent.click(screen.getByTestId('btn-clear-filter'))

    // filterModel should be cleared immediately
    await waitFor(() => {
      const result = useQueryStore.getState().tabs['tab-1']!.results[0]
      expect(result.filterModel).toEqual([])
    })

    // Toast should be shown
    expect(mockShowSuccess).toHaveBeenCalledWith('Filters cleared')

    // No confirm dialog should appear
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
  })

  it('clear filter button is disabled when editing is active', () => {
    setupQueryTab({
      filterModel: [{ column: 'name', operator: '==', value: 'Alice' }],
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice' },
        currentValues: { id: 1, name: 'Alice' },
        modifiedColumns: new Set<string>(),
        isNewRow: false,
      },
      editingRowIndex: 0,
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('btn-clear-filter')).toBeDisabled()
  })

  it('filter button is disabled when editing is active', () => {
    setupQueryTab({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice' },
        currentValues: { id: 1, name: 'Alice' },
        modifiedColumns: new Set<string>(),
        isNewRow: false,
      },
      editingRowIndex: 0,
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('btn-filter')).toBeDisabled()
  })
})

describe('ResultPanel — Filter auto-populate from selectedCell', () => {
  it('filter dialog auto-populates with selected cell value', () => {
    setupQueryTab({
      selectedCell: { columnKey: 'name', value: 'Alice' },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

    // Should have a pre-populated filter row (not empty state)
    expect(screen.queryByTestId('filter-empty-state')).not.toBeInTheDocument()
    expect(screen.getByTestId('filter-row')).toBeInTheDocument()
  })

  it('filter dialog auto-populates IS NULL when cell value is null', () => {
    setupQueryTab({
      selectedCell: { columnKey: 'name', value: null },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

    // Should have a pre-populated filter row with IS NULL
    expect(screen.queryByTestId('filter-empty-state')).not.toBeInTheDocument()
    expect(screen.getByTestId('filter-row')).toBeInTheDocument()
  })

  it('filter dialog opens with empty state when no selected cell and no filters', () => {
    setupQueryTab({
      selectedCell: null,
      filterModel: [],
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('filter-empty-state')).toBeInTheDocument()
  })
})
