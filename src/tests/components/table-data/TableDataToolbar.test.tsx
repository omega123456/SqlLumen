import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useConnectionStore } from '../../../stores/connection-store'
import type { TableDataTabState } from '../../../types/schema'
import { updateTableRow, fetchTableData, deleteTableRow } from '../../../lib/table-data-commands'

// Mock toast store
const mockShowError = vi.fn()
const mockShowSuccess = vi.fn()
vi.mock('../../../stores/toast-store', () => ({
  useToastStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      toasts: [],
      showError: mockShowError,
      showSuccess: mockShowSuccess,
      showInfo: vi.fn(),
      dismiss: vi.fn(),
    }
    return selector(state)
  }),
}))

// Mock AG Grid
vi.mock('ag-grid-community', () => ({
  AllCommunityModule: {},
  ModuleRegistry: { registerModules: vi.fn() },
}))

vi.mock('ag-grid-react', async () => {
  const React = await import('react')
  return {
    AgGridReact: vi.fn(() => {
      return React.createElement('div', { 'data-testid': 'ag-grid-inner' }, 'Grid Mock')
    }),
  }
})

// Mock table-data-commands
vi.mock('../../../lib/table-data-commands', () => ({
  fetchTableData: vi.fn().mockResolvedValue({
    columns: [],
    rows: [],
    totalRows: 0,
    currentPage: 1,
    totalPages: 1,
    pageSize: 1000,
    primaryKey: null,
    executionTimeMs: 0,
  }),
  updateTableRow: vi.fn().mockResolvedValue(undefined),
  insertTableRow: vi.fn().mockResolvedValue([]),
  deleteTableRow: vi.fn().mockResolvedValue(undefined),
  exportTableData: vi.fn().mockResolvedValue(undefined),
}))

import { TableDataToolbar } from '../../../components/table-data/TableDataToolbar'

function setupConnection(readOnly = false) {
  useConnectionStore.setState({
    activeConnections: {
      'conn-1': {
        id: 'conn-1',
        profile: {
          id: 'conn-1',
          name: 'Test DB',
          host: '127.0.0.1',
          port: 3306,
          username: 'root',
          hasPassword: true,
          defaultDatabase: null,
          sslEnabled: false,
          sslCaPath: null,
          sslCertPath: null,
          sslKeyPath: null,
          color: '#3b82f6',
          groupId: null,
          readOnly,
          sortOrder: 0,
          connectTimeoutSecs: 10,
          keepaliveIntervalSecs: 30,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        },
        status: 'connected',
        serverVersion: '8.0.35',
      },
    },
    activeTabId: 'conn-1',
  })
}

function makeDefaultTabState(overrides: Partial<TableDataTabState> = {}): TableDataTabState {
  return {
    columns: [
      {
        name: 'id',
        dataType: 'bigint',
        isNullable: false,
        isPrimaryKey: true,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isAutoIncrement: true,
      },
    ],
    rows: [[1], [2], [3]],
    totalRows: 42,
    currentPage: 1,
    totalPages: 3,
    pageSize: 1000,
    primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
    executionTimeMs: 15,
    connectionId: 'conn-1',
    database: 'mydb',
    table: 'users',
    editState: null,
    viewMode: 'grid',
    selectedRowKey: null,
    filterModel: {},
    sort: null,
    isLoading: false,
    error: null,
    saveError: null,
    isExportDialogOpen: false,
    pendingNavigationAction: null,
    ...overrides,
  }
}

function setupTabState(overrides: Partial<TableDataTabState> = {}) {
  useTableDataStore.setState({
    tabs: { 'tab-1': makeDefaultTabState(overrides) },
  })
}

beforeEach(() => {
  useTableDataStore.setState({ tabs: {} })
  useConnectionStore.setState({
    activeConnections: {},
    activeTabId: null,
  })
  mockIPC(() => null)
  vi.clearAllMocks()
})

describe('TableDataToolbar', () => {
  it('renders with data-testid="table-data-toolbar"', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('table-data-toolbar')).toBeInTheDocument()
  })

  it('shows row count and execution time', () => {
    setupConnection()
    setupTabState({ totalRows: 42, executionTimeMs: 15 })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByText('42 Rows')).toBeInTheDocument()
    expect(screen.getByText('(15ms)')).toBeInTheDocument()
  })

  it('Add Row button is disabled when no PK', () => {
    setupConnection()
    setupTabState({ primaryKey: null })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-add-row')).toBeDisabled()
  })

  it('Add Row button is disabled when read-only', () => {
    setupConnection(true) // readOnly=true
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-add-row')).toBeDisabled()
  })

  it('Add Row button is enabled when writable with PK', () => {
    setupConnection(false)
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-add-row')).not.toBeDisabled()
  })

  it('Save button is disabled when no editState', () => {
    setupConnection()
    setupTabState({ editState: null })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-save')).toBeDisabled()
  })

  it('Discard button is disabled when no editState', () => {
    setupConnection()
    setupTabState({ editState: null })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-discard')).toBeDisabled()
  })

  it('Save button is disabled when editState has no modifications', () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice' },
        currentValues: { id: 1, name: 'Alice' },
        modifiedColumns: new Set<string>(),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-save')).toBeDisabled()
  })

  it('Pagination prev disabled on page 1', () => {
    setupConnection()
    setupTabState({ currentPage: 1, totalPages: 3 })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('pagination-prev')).toBeDisabled()
  })

  it('Pagination next disabled on last page', () => {
    setupConnection()
    setupTabState({ currentPage: 3, totalPages: 3 })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('pagination-next')).toBeDisabled()
  })

  it('Pagination prev enabled when not on first page', () => {
    setupConnection()
    setupTabState({ currentPage: 2, totalPages: 3 })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('pagination-prev')).not.toBeDisabled()
  })

  it('Pagination next enabled when not on last page', () => {
    setupConnection()
    setupTabState({ currentPage: 1, totalPages: 3 })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('pagination-next')).not.toBeDisabled()
  })

  it('shows page indicator', () => {
    setupConnection()
    setupTabState({ currentPage: 2, totalPages: 5 })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('page-indicator')).toHaveTextContent('2 / 5')
  })

  it('shows read-only badge when connection is read-only', () => {
    setupConnection(true)
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('readonly-badge')).toBeInTheDocument()
  })

  it('does not show read-only badge when connection is writable', () => {
    setupConnection(false)
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.queryByTestId('readonly-badge')).not.toBeInTheDocument()
  })

  it('page size selector has correct options', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    const select = screen.getByTestId('page-size-select') as HTMLSelectElement
    const options = Array.from(select.options).map((o) => o.value)
    expect(options).toEqual(['100', '500', '1000', '5000'])
  })

  it('page size change updates store', async () => {
    setupConnection()
    setupTabState({ pageSize: 1000 })
    render(<TableDataToolbar tabId="tab-1" />)
    const callsBefore = vi.mocked(fetchTableData).mock.calls.length
    const select = screen.getByTestId('page-size-select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '500' } })
    await waitFor(() => {
      expect(vi.mocked(fetchTableData).mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('view mode buttons exist', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-grid-view')).toBeInTheDocument()
    expect(screen.getByTestId('btn-form-view')).toBeInTheDocument()
  })

  it('export button exists', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-export')).toBeInTheDocument()
  })

  it('export button opens export dialog', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('btn-export'))
    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab?.isExportDialogOpen).toBe(true)
  })

  it('shows no-PK badge when no primary key', () => {
    setupConnection()
    setupTabState({ primaryKey: null })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('nopk-badge')).toBeInTheDocument()
  })

  it('clicking Add Row calls insertNewRow', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('btn-add-row'))
    // insertNewRow is called on the store — verify no crash and editState is updated
    const state = useTableDataStore.getState().tabs['tab-1']
    // A new row editState should be created
    expect(state?.editState?.isNewRow).toBe(true)
  })

  it('Add Row button is disabled when already editing a new row', () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { __tempId: 'temp-1' },
        originalValues: {},
        currentValues: {},
        modifiedColumns: new Set(),
        isNewRow: true,
        tempId: 'temp-1',
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-add-row')).toBeDisabled()
  })

  it('clicking Delete Row shows confirmation dialog', () => {
    setupConnection()
    setupTabState({
      selectedRowKey: { id: 1 },
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1 },
        currentValues: { id: 1 },
        modifiedColumns: new Set(),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    const deleteBtn = screen.getByTestId('btn-delete-row')
    expect(deleteBtn).not.toBeDisabled()
    fireEvent.click(deleteBtn)
    // Confirmation dialog should appear
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    expect(screen.getByText('Delete Row')).toBeInTheDocument()
    expect(screen.getByText('Are you sure you want to delete this row?')).toBeInTheDocument()
  })

  it('confirming delete dialog calls deleteRow', async () => {
    setupConnection()
    setupTabState({
      selectedRowKey: { id: 1 },
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1 },
        currentValues: { id: 1 },
        modifiedColumns: new Set(),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('btn-delete-row'))
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()

    // Click confirm
    fireEvent.click(screen.getByTestId('confirm-confirm-button'))

    // Dialog should close
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(vi.mocked(deleteTableRow)).toHaveBeenCalled()
    })
  })

  it('cancelling delete dialog does not delete', () => {
    setupConnection()
    setupTabState({
      selectedRowKey: { id: 1 },
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1 },
        currentValues: { id: 1 },
        modifiedColumns: new Set(),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('btn-delete-row'))
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()

    // Click cancel
    fireEvent.click(screen.getByTestId('confirm-cancel-button'))

    // Dialog should close, but no delete occurred
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
  })

  it('Delete button disabled when selected row is a new row', () => {
    setupConnection()
    setupTabState({
      selectedRowKey: { __tempId: 'temp-1' },
      editState: {
        rowKey: { __tempId: 'temp-1' },
        originalValues: {},
        currentValues: {},
        modifiedColumns: new Set(),
        isNewRow: true,
        tempId: 'temp-1',
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-delete-row')).toBeDisabled()
  })

  it('Delete button disabled when no row is selected', () => {
    setupConnection()
    setupTabState({ editState: null, selectedRowKey: null })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-delete-row')).toBeDisabled()
  })

  it('Delete button enabled when row selected without editState', () => {
    setupConnection()
    setupTabState({ editState: null, selectedRowKey: { id: 2 } })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-delete-row')).not.toBeDisabled()
  })

  it('confirming delete discards edits when deleting the editing row', async () => {
    setupConnection()
    setupTabState({
      selectedRowKey: { id: 1 },
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice' },
        currentValues: { id: 1, name: 'Bob' },
        modifiedColumns: new Set(['name']),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('btn-delete-row'))
    fireEvent.click(screen.getByTestId('confirm-confirm-button'))

    await waitFor(() => {
      expect(vi.mocked(deleteTableRow)).toHaveBeenCalled()
    })
    // editState should be cleared (discard + delete)
    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).toBeNull()
  })

  it('clicking Save calls saveCurrentRow', async () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice' },
        currentValues: { id: 1, name: 'Bob' },
        modifiedColumns: new Set(['name']),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    const saveBtn = screen.getByTestId('btn-save')
    expect(saveBtn).not.toBeDisabled()
    fireEvent.click(saveBtn)
    await waitFor(() => {
      expect(vi.mocked(updateTableRow)).toHaveBeenCalled()
    })
  })

  it('clicking Discard calls discardCurrentRow', () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1 },
        currentValues: { id: 1 },
        modifiedColumns: new Set(),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    const discardBtn = screen.getByTestId('btn-discard')
    expect(discardBtn).not.toBeDisabled()
    fireEvent.click(discardBtn)
    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).toBeNull()
  })

  it('clicking Refresh calls refreshData', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    const callsBefore = vi.mocked(fetchTableData).mock.calls.length
    const refreshBtn = screen.getByTestId('btn-refresh')
    expect(refreshBtn).not.toBeDisabled()
    fireEvent.click(refreshBtn)
    await waitFor(() => {
      expect(vi.mocked(fetchTableData).mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('clicking Grid View toggles view mode', () => {
    setupConnection()
    setupTabState({ viewMode: 'form' })
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('btn-grid-view'))
    // No crash — view mode toggled via requestNavigationAction
  })

  it('clicking Form View toggles view mode', () => {
    setupConnection()
    setupTabState({ viewMode: 'grid' })
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('btn-form-view'))
    // No crash
  })

  it('clicking Next Page fetches next page', async () => {
    setupConnection()
    setupTabState({ currentPage: 1, totalPages: 3 })
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('pagination-next'))
    await waitFor(() => {
      expect(vi.mocked(fetchTableData).mock.calls.some((c) => c[0]?.page === 2)).toBe(true)
    })
  })

  it('clicking Prev Page fetches previous page', async () => {
    setupConnection()
    setupTabState({ currentPage: 2, totalPages: 3 })
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('pagination-prev'))
    await waitFor(() => {
      expect(vi.mocked(fetchTableData).mock.calls.some((c) => c[0]?.page === 1)).toBe(true)
    })
  })

  it('shows loading spinner when loading', () => {
    setupConnection()
    setupTabState({ isLoading: true })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('hides execution time when executionTimeMs is 0', () => {
    setupConnection()
    setupTabState({ executionTimeMs: 0 })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.queryByText(/\(\d+ms\)/)).not.toBeInTheDocument()
  })

  it('export button is disabled when no rows', () => {
    setupConnection()
    setupTabState({ totalRows: 0 })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-export')).toBeDisabled()
  })

  it('export button is disabled when loading', () => {
    setupConnection()
    setupTabState({ isLoading: true })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-export')).toBeDisabled()
  })

  it('buttons are disabled while loading', () => {
    setupConnection()
    setupTabState({ isLoading: true })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-add-row')).toBeDisabled()
    expect(screen.getByTestId('btn-refresh')).toBeDisabled()
  })

  it('Discard button is enabled when editState exists', () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1 },
        currentValues: { id: 1 },
        modifiedColumns: new Set(),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-discard')).not.toBeDisabled()
  })

  it('grid view button has active class when viewMode is grid', () => {
    setupConnection()
    setupTabState({ viewMode: 'grid' })
    render(<TableDataToolbar tabId="tab-1" />)
    const gridBtn = screen.getByTestId('btn-grid-view')
    expect(gridBtn.className).toContain('Active')
  })

  it('form view button has active class when viewMode is form', () => {
    setupConnection()
    setupTabState({ viewMode: 'form' })
    render(<TableDataToolbar tabId="tab-1" />)
    const formBtn = screen.getByTestId('btn-form-view')
    expect(formBtn.className).toContain('Active')
  })

  it('handleDeleteRow no-ops when no selectedRowKey and no editState', () => {
    setupConnection()
    setupTabState({ editState: null, selectedRowKey: null })
    render(<TableDataToolbar tabId="tab-1" />)
    // Delete button is already disabled, but verify clicking doesn't crash
    const deleteBtn = screen.getByTestId('btn-delete-row')
    fireEvent.click(deleteBtn) // no-op since disabled
    // Should not crash
  })
})

// ---------------------------------------------------------------------------
// Save validation — temporal field validation + toast tests
// ---------------------------------------------------------------------------

describe('TableDataToolbar — Save validation', () => {
  it('clicking Save with invalid temporal data shows error toast', async () => {
    setupConnection()
    setupTabState({
      columns: [
        {
          name: 'id',
          dataType: 'bigint',
          isNullable: false,
          isPrimaryKey: true,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isAutoIncrement: true,
        },
        {
          name: 'created_at',
          dataType: 'DATETIME',
          isNullable: true,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isAutoIncrement: false,
        },
      ],
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, created_at: '2023-01-01 00:00:00' },
        currentValues: { id: 1, created_at: 'garbage' },
        modifiedColumns: new Set(['created_at']),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    const saveBtn = screen.getByTestId('btn-save')
    expect(saveBtn).not.toBeDisabled()
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(
        'Invalid date value',
        expect.stringContaining('created_at')
      )
    })
  })

  it('clicking Save with valid data calls saveCurrentRow and shows success toast', async () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1 },
        currentValues: { id: 1, name: 'Bob' },
        modifiedColumns: new Set(['name']),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    const saveBtn = screen.getByTestId('btn-save')
    fireEvent.click(saveBtn)

    // Should NOT show error toast
    await waitFor(() => {
      expect(mockShowError).not.toHaveBeenCalled()
      expect(mockShowSuccess).toHaveBeenCalledWith('Row saved', 'Changes saved successfully.')
    })
  })

  it('clicking Save with blank temporal data shows error toast', async () => {
    setupConnection()
    setupTabState({
      columns: [
        {
          name: 'id',
          dataType: 'bigint',
          isNullable: false,
          isPrimaryKey: true,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isAutoIncrement: true,
        },
        {
          name: 'created_at',
          dataType: 'DATETIME',
          isNullable: true,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isAutoIncrement: false,
        },
      ],
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, created_at: '2023-01-01 00:00:00' },
        currentValues: { id: 1, created_at: '' },
        modifiedColumns: new Set(['created_at']),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    fireEvent.click(screen.getByTestId('btn-save'))

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(
        'Invalid date value',
        expect.stringContaining('created_at')
      )
    })
  })

  it('clicking Save shows an error toast when saving fails', async () => {
    ;(updateTableRow as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Save failed'))

    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice' },
        currentValues: { id: 1, name: 'Bob' },
        modifiedColumns: new Set(['name']),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    fireEvent.click(screen.getByTestId('btn-save'))

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Save failed', 'Save failed')
    })
    expect(mockShowSuccess).not.toHaveBeenCalled()
  })

  it('clicking Save with null temporal value does NOT show error', async () => {
    setupConnection()
    setupTabState({
      columns: [
        {
          name: 'id',
          dataType: 'bigint',
          isNullable: false,
          isPrimaryKey: true,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isAutoIncrement: true,
        },
        {
          name: 'created_at',
          dataType: 'DATETIME',
          isNullable: true,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isAutoIncrement: false,
        },
      ],
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, created_at: '2023-01-01 00:00:00' },
        currentValues: { id: 1, created_at: null },
        modifiedColumns: new Set(['created_at']),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    fireEvent.click(screen.getByTestId('btn-save'))

    await waitFor(() => {
      expect(mockShowError).not.toHaveBeenCalled()
    })
  })
})
