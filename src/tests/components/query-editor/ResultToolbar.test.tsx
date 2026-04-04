import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { ResultToolbar } from '../../../components/query-editor/ResultToolbar'
import { useQueryStore, type TabQueryState } from '../../../stores/query-store'

const DEFAULT_TAB_STATE: TabQueryState = {
  content: '',
  filePath: null,
  status: 'idle',
  columns: [],
  rows: [],
  totalRows: 0,
  executionTimeMs: 0,
  affectedRows: 0,
  queryId: null,
  currentPage: 1,
  totalPages: 1,
  pageSize: 1000,
  autoLimitApplied: false,
  errorMessage: null,
  cursorPosition: null,
  viewMode: 'grid',
  sortColumn: null,
  sortDirection: null,
  selectedRowIndex: null,
  exportDialogOpen: false,
  lastExecutedSql: null,
  editMode: null,
  editTableMetadata: {},
  editState: null,
  isAnalyzingQuery: false,
  editableColumnMap: new Map(),
  editColumnBindings: new Map(),
  editBoundColumnIndexMap: new Map(),
  pendingNavigationAction: null,
  saveError: null,
  editConnectionId: null,
  editingRowIndex: null,
}

/** Helper to set up store state for a tab. */
function setupTabState(tabId: string, overrides: Partial<TabQueryState> = {}) {
  useQueryStore.setState({
    tabs: {
      [tabId]: { ...DEFAULT_TAB_STATE, ...overrides },
    },
  })
}

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  mockIPC(() => null)
})

describe('ResultToolbar', () => {
  const tabId = 'tab-1'
  const connectionId = 'conn-1'

  it('renders with data-testid="result-toolbar"', () => {
    setupTabState(tabId, {
      status: 'success',
      totalRows: 10,
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.getByTestId('result-toolbar')).toBeInTheDocument()
  })

  it('renders success status with correct row count', () => {
    setupTabState(tabId, {
      status: 'success',
      totalRows: 42,
      columns: [
        { name: 'id', dataType: 'INT' },
        { name: 'name', dataType: 'VARCHAR' },
        { name: 'email', dataType: 'VARCHAR' },
      ],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.getByText('42 Rows')).toBeInTheDocument()
  })

  it('renders error status with error message', () => {
    setupTabState(tabId, {
      status: 'error',
      errorMessage: "Table 'users' doesn't exist",
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.getByText("Table 'users' doesn't exist")).toBeInTheDocument()
  })

  it('shows "(1000 row limit applied)" when autoLimitApplied', () => {
    setupTabState(tabId, {
      status: 'success',
      totalRows: 42,
      autoLimitApplied: true,
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.getByText('(1000 row limit applied)')).toBeInTheDocument()
  })

  it('does not show auto-limit text when autoLimitApplied is false', () => {
    setupTabState(tabId, {
      status: 'success',
      totalRows: 42,
      autoLimitApplied: false,
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.queryByText('(1000 row limit applied)')).not.toBeInTheDocument()
  })

  it('prev button is disabled on page 1', () => {
    setupTabState(tabId, {
      status: 'success',
      currentPage: 1,
      totalPages: 3,
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.getByLabelText('Previous page')).toBeDisabled()
  })

  it('next button is disabled on last page', () => {
    setupTabState(tabId, {
      status: 'success',
      currentPage: 3,
      totalPages: 3,
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.getByLabelText('Next page')).toBeDisabled()
  })

  it('prev button is enabled when not on first page', () => {
    setupTabState(tabId, {
      status: 'success',
      currentPage: 2,
      totalPages: 3,
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.getByLabelText('Previous page')).not.toBeDisabled()
  })

  it('next button is enabled when not on last page', () => {
    setupTabState(tabId, {
      status: 'success',
      currentPage: 1,
      totalPages: 3,
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.getByLabelText('Next page')).not.toBeDisabled()
  })

  it('calls fetchPage via store when prev button clicked', async () => {
    mockIPC((cmd) => {
      if (cmd === 'fetch_result_page') {
        return { rows: [[1]], page: 1, totalPages: 3 }
      }
      return null
    })
    setupTabState(tabId, {
      status: 'success',
      currentPage: 2,
      totalPages: 3,
      queryId: 'q1',
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    fireEvent.click(screen.getByLabelText('Previous page'))
    await waitFor(() => {
      const tab = useQueryStore.getState().getTabState(tabId)
      expect(tab.currentPage).toBe(1)
      expect(tab.rows).toEqual([[1]])
    })
  })

  it('calls fetchPage via store when next button clicked', async () => {
    mockIPC((cmd) => {
      if (cmd === 'fetch_result_page') {
        return { rows: [[2]], page: 2, totalPages: 3 }
      }
      return null
    })
    setupTabState(tabId, {
      status: 'success',
      currentPage: 1,
      totalPages: 3,
      queryId: 'q1',
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    fireEvent.click(screen.getByLabelText('Next page'))
    await waitFor(() => {
      const tab = useQueryStore.getState().getTabState(tabId)
      expect(tab.currentPage).toBe(2)
      expect(tab.rows).toEqual([[2]])
    })
  })

  it('shows page text', () => {
    setupTabState(tabId, {
      status: 'success',
      currentPage: 2,
      totalPages: 5,
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument()
  })

  it('shows execution time', () => {
    setupTabState(tabId, {
      status: 'success',
      executionTimeMs: 42,
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.getByText('(42ms)')).toBeInTheDocument()
  })

  it('truncates long error messages to 200 chars', () => {
    const longError = 'A'.repeat(250)
    setupTabState(tabId, {
      status: 'error',
      errorMessage: longError,
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    const displayed = screen.getByText(/^A+/)
    expect(displayed.textContent!.length).toBeLessThanOrEqual(201) // 200 + ellipsis char
  })

  it('shows row count for DML results with affected rows', () => {
    setupTabState(tabId, {
      status: 'success',
      totalRows: 0,
      affectedRows: 5,
      columns: [],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    // Shared StatusArea shows "{N} Rows" when totalRows is provided
    expect(screen.getByText('5 Rows')).toBeInTheDocument()
  })

  it('shows "Success" for DDL results with no affected rows', () => {
    setupTabState(tabId, {
      status: 'success',
      totalRows: 0,
      affectedRows: 0,
      columns: [],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    // Shared StatusArea shows "Success" when no totalRows
    expect(screen.getByText('Success')).toBeInTheDocument()
  })

  it('hides pagination in error state', () => {
    setupTabState(tabId, {
      status: 'error',
      errorMessage: 'Some error',
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.queryByLabelText('Previous page')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument()
  })

  it('hides pagination for DML results (no columns)', () => {
    setupTabState(tabId, {
      status: 'success',
      totalRows: 0,
      affectedRows: 3,
      columns: [],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.queryByLabelText('Previous page')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument()
  })

  // --- View mode toggle tests ---

  it('renders view mode toggle buttons', () => {
    setupTabState(tabId, { status: 'success', columns: [{ name: 'id', dataType: 'INT' }] })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.getByTestId('view-mode-grid')).toBeInTheDocument()
    expect(screen.getByTestId('view-mode-form')).toBeInTheDocument()
    expect(screen.getByTestId('view-mode-text')).toBeInTheDocument()
  })

  it('sets view mode to form when form button clicked', () => {
    setupTabState(tabId, { status: 'success', columns: [{ name: 'id', dataType: 'INT' }] })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    fireEvent.click(screen.getByTestId('view-mode-form'))
    const state = useQueryStore.getState().tabs[tabId]
    expect(state?.viewMode).toBe('form')
  })

  it('sets view mode to text when text button clicked', () => {
    setupTabState(tabId, { status: 'success', columns: [{ name: 'id', dataType: 'INT' }] })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    fireEvent.click(screen.getByTestId('view-mode-text'))
    const state = useQueryStore.getState().tabs[tabId]
    expect(state?.viewMode).toBe('text')
  })

  // --- Export button tests ---

  it('renders export button', () => {
    setupTabState(tabId, { status: 'success', columns: [{ name: 'id', dataType: 'INT' }] })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.getByTestId('export-button')).toBeInTheDocument()
    expect(screen.getByText('Export')).toBeInTheDocument()
  })

  it('export button is enabled when results exist', () => {
    setupTabState(tabId, { status: 'success', columns: [{ name: 'id', dataType: 'INT' }] })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.getByTestId('export-button')).not.toBeDisabled()
  })

  it('export button is disabled when no results (idle)', () => {
    setupTabState(tabId, { status: 'idle' })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.getByTestId('export-button')).toBeDisabled()
  })

  it('opens export dialog when export button clicked', () => {
    setupTabState(tabId, { status: 'success', columns: [{ name: 'id', dataType: 'INT' }] })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    fireEvent.click(screen.getByTestId('export-button'))
    const state = useQueryStore.getState().tabs[tabId]
    expect(state?.exportDialogOpen).toBe(true)
  })

  // --- Page size selector tests ---

  it('renders page size selector for success with columns', () => {
    setupTabState(tabId, {
      status: 'success',
      columns: [{ name: 'id', dataType: 'INT' }],
      pageSize: 1000,
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.getByTestId('page-size-select')).toBeInTheDocument()
  })

  it('page size selector has correct options', async () => {
    const user = userEvent.setup()
    setupTabState(tabId, {
      status: 'success',
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    await user.click(screen.getByTestId('page-size-select'))
    const labels = screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))
    expect(labels).toEqual(['100', '500', '1000', '5000'])
  })

  it('does not show page size selector for DML results', () => {
    setupTabState(tabId, {
      status: 'success',
      columns: [],
      affectedRows: 3,
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.queryByTestId('page-size-select')).not.toBeInTheDocument()
  })

  // --- Data testid verification ---

  it('has correct data-testid attributes', () => {
    setupTabState(tabId, {
      status: 'success',
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
    expect(screen.getByTestId('result-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('view-mode-grid')).toBeInTheDocument()
    expect(screen.getByTestId('view-mode-form')).toBeInTheDocument()
    expect(screen.getByTestId('view-mode-text')).toBeInTheDocument()
    expect(screen.getByTestId('export-button')).toBeInTheDocument()
    expect(screen.getByTestId('page-size-select')).toBeInTheDocument()
    expect(screen.getByTestId('pagination-prev')).toBeInTheDocument()
    expect(screen.getByTestId('pagination-next')).toBeInTheDocument()
  })

  // --- Unsaved-change protection for pagination ---

  describe('pagination unsaved-change guard', () => {
    it('defers prev page via requestNavigationAction when edits are pending', () => {
      const requestNavSpy = vi.fn()
      setupTabState(tabId, {
        status: 'success',
        currentPage: 2,
        totalPages: 3,
        queryId: 'q1',
        columns: [{ name: 'id', dataType: 'INT' }],
        editState: {
          rowKey: { id: 1 },
          originalValues: { name: 'Alice' },
          currentValues: { name: 'Changed' },
          modifiedColumns: new Set(['name']),
          isNewRow: false,
        },
      })
      useQueryStore.setState({ requestNavigationAction: requestNavSpy })

      render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
      fireEvent.click(screen.getByLabelText('Previous page'))

      expect(requestNavSpy).toHaveBeenCalledWith(tabId, expect.any(Function))
    })

    it('defers next page via requestNavigationAction when edits are pending', () => {
      const requestNavSpy = vi.fn()
      setupTabState(tabId, {
        status: 'success',
        currentPage: 1,
        totalPages: 3,
        queryId: 'q1',
        columns: [{ name: 'id', dataType: 'INT' }],
        editState: {
          rowKey: { id: 1 },
          originalValues: { name: 'Alice' },
          currentValues: { name: 'Changed' },
          modifiedColumns: new Set(['name']),
          isNewRow: false,
        },
      })
      useQueryStore.setState({ requestNavigationAction: requestNavSpy })

      render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
      fireEvent.click(screen.getByLabelText('Next page'))

      expect(requestNavSpy).toHaveBeenCalledWith(tabId, expect.any(Function))
    })

    it('defers page size change via requestNavigationAction when edits are pending', async () => {
      const user = userEvent.setup()
      const requestNavSpy = vi.fn()
      setupTabState(tabId, {
        status: 'success',
        currentPage: 1,
        totalPages: 1,
        queryId: 'q1',
        columns: [{ name: 'id', dataType: 'INT' }],
        pageSize: 1000,
        editState: {
          rowKey: { id: 1 },
          originalValues: { name: 'Alice' },
          currentValues: { name: 'Changed' },
          modifiedColumns: new Set(['name']),
          isNewRow: false,
        },
      })
      useQueryStore.setState({ requestNavigationAction: requestNavSpy })

      render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
      await user.click(screen.getByTestId('page-size-select'))
      await user.click(screen.getByRole('option', { name: '500' }))

      expect(requestNavSpy).toHaveBeenCalledWith(tabId, expect.any(Function))
    })

    it('executes pagination immediately when no edits are pending', () => {
      setupTabState(tabId, {
        status: 'success',
        currentPage: 1,
        totalPages: 3,
        queryId: 'q1',
        columns: [{ name: 'id', dataType: 'INT' }],
        // No editState — no pending edits
      })

      render(<ResultToolbar tabId={tabId} connectionId={connectionId} />)
      fireEvent.click(screen.getByLabelText('Next page'))

      // With no pending edits, requestNavigationAction executes the action
      // immediately rather than storing it as pendingNavigationAction
      const tab = useQueryStore.getState().tabs[tabId]
      expect(tab?.pendingNavigationAction).toBeNull()
    })
  })
})
