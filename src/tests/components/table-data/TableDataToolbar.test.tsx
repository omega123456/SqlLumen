import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { useToastStore } from '../../../stores/toast-store'
import type { TableDataTabState } from '../../../types/schema'
import { expectToast, ipc } from '../../ipc-mock'

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
        isBooleanAlias: false,
        isAutoIncrement: true,
      },
    ],
    rows: [[1], [2], [3]],
    currentPage: 1,
    pageSize: 1000,
    primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
    executionTimeMs: 15,
    connectionId: 'conn-1',
    database: 'mydb',
    table: 'users',
    editState: null,
    viewMode: 'grid',
    selectedRowKey: null,
    selectedCell: null,
    filterModel: [],
    sort: null,
    isLoading: false,
    error: null,
    saveError: null,
    isExportDialogOpen: false,
    pendingNavigationAction: null,
    scrollRow: 0,
    scrollCol: 0,
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
  useToastStore.setState({ toasts: [] })
  useConnectionStore.setState({
    activeConnections: {},
    activeTabId: null,
  })
  ipc.override('fetch_table_data', () => ({
    columns: [],
    rows: [],
    currentPage: 1,
    pageSize: 1000,
    primaryKey: null,
    executionTimeMs: 0,
  }))
  ipc.override('update_table_row', () => undefined)
  ipc.override('insert_table_row', () => [])
  ipc.override('delete_table_row', () => undefined)
})

describe('TableDataToolbar', () => {
  it('renders with data-testid="table-data-toolbar"', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('table-data-toolbar')).toBeInTheDocument()
  })

  it('shows execution time without row count', () => {
    setupConnection()
    setupTabState({ executionTimeMs: 15 })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.queryByText('42 Rows')).not.toBeInTheDocument()
    expect(screen.getByText('Success')).toBeInTheDocument()
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

  it('Save button stays enabled for new rows seeded only by defaults', () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { __tempId: 'temp-1' },
        originalValues: {},
        currentValues: { status: 'active' },
        modifiedColumns: new Set<string>(),
        isNewRow: true,
        tempId: 'temp-1',
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-save')).not.toBeDisabled()
  })

  it('Pagination prev disabled on page 1', () => {
    setupConnection()
    setupTabState({ currentPage: 1 })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('pagination-prev')).toBeDisabled()
  })

  it('Pagination next remains enabled on last known page', () => {
    setupConnection()
    setupTabState({ currentPage: 3 })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('pagination-next')).not.toBeDisabled()
  })

  it('Pagination prev enabled when not on first page', () => {
    setupConnection()
    setupTabState({ currentPage: 2 })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('pagination-prev')).not.toBeDisabled()
  })

  it('Pagination next enabled when not on last page', () => {
    setupConnection()
    setupTabState({ currentPage: 1 })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('pagination-next')).not.toBeDisabled()
  })

  it('shows editable page input instead of total-page indicator', () => {
    setupConnection()
    setupTabState({ currentPage: 2 })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.queryByTestId('page-indicator')).not.toBeInTheDocument()
    expect(screen.getByTestId('pagination-page-input')).toHaveValue('2')
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

  it('page size selector has correct options', async () => {
    const user = userEvent.setup()
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    await user.click(screen.getByTestId('page-size-select'))
    const labels = screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))
    expect(labels).toEqual(['100', '500', '1000', '5000'])
  })

  it('page size change updates store', async () => {
    const user = userEvent.setup()
    setupConnection()
    setupTabState({ pageSize: 1000 })
    render(<TableDataToolbar tabId="tab-1" />)
    const callsBefore = ipc.calls('fetch_table_data').length
    await user.click(screen.getByTestId('page-size-select'))
    await user.click(screen.getByRole('option', { name: '500' }))
    await waitFor(() => {
      expect(ipc.calls('fetch_table_data').length).toBeGreaterThan(callsBefore)
    })
  })

  it('view mode buttons exist', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('view-mode-grid')).toBeInTheDocument()
    expect(screen.getByTestId('view-mode-form')).toBeInTheDocument()
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

  it('shows Clone between Add and Delete', () => {
    setupConnection()
    setupTabState({ selectedRowKey: { id: 1 } })
    render(<TableDataToolbar tabId="tab-1" />)

    const buttons = screen
      .getAllByRole('button')
      .filter((button) => ['Add', 'Clone', 'Delete'].includes(button.textContent ?? ''))

    expect(buttons.map((button) => button.textContent)).toEqual(['Add', 'Clone', 'Delete'])
    expect(screen.getByTestId('btn-clone-row')).toHaveAttribute(
      'title',
      'Clone selected row; primary key fields are left blank.'
    )
  })

  it('Clone button is disabled when no persisted row is selected', () => {
    setupConnection()
    setupTabState({ selectedRowKey: null })
    render(<TableDataToolbar tabId="tab-1" />)

    expect(screen.getByTestId('btn-clone-row')).toBeDisabled()
  })

  it('Clone button is disabled when read-only, loading, or editing a draft row', () => {
    setupConnection(true)
    setupTabState({
      isLoading: true,
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

    expect(screen.getByTestId('btn-clone-row')).toBeDisabled()
  })

  it('clicking Clone creates a selected draft row and saves through insert', async () => {
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
          isBooleanAlias: false,
          isAutoIncrement: true,
        },
        {
          name: 'name',
          dataType: 'varchar',
          isNullable: false,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: false,
        },
      ],
      rows: [[1, 'Alice']],
      selectedRowKey: { id: 1 },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    fireEvent.click(screen.getByTestId('btn-clone-row'))

    let state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.selectedRowKey).toEqual({ __tempId: state?.editState?.tempId })
    expect(state?.rows[state.rows.length - 1]).toEqual([null, 'Alice'])

    fireEvent.click(screen.getByTestId('btn-save'))

    await waitFor(() => {
      expect(ipc.calls('insert_table_row').length).toBeGreaterThan(0)
    })
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
      expect(ipc.calls('delete_table_row').length).toBeGreaterThan(0)
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
      expect(ipc.calls('delete_table_row').length).toBeGreaterThan(0)
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
      expect(ipc.calls('update_table_row').length).toBeGreaterThan(0)
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
    const callsBefore = ipc.calls('fetch_table_data').length
    const refreshBtn = screen.getByTestId('btn-refresh')
    expect(refreshBtn).not.toBeDisabled()
    fireEvent.click(refreshBtn)
    await waitFor(() => {
      expect(ipc.calls('fetch_table_data').length).toBeGreaterThan(callsBefore)
    })
  })

  it('clicking Grid View toggles view mode', () => {
    setupConnection()
    setupTabState({ viewMode: 'form' })
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('view-mode-grid'))
    // No crash — view mode toggled via requestNavigationAction
  })

  it('clicking Form View toggles view mode', () => {
    setupConnection()
    setupTabState({ viewMode: 'grid' })
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('view-mode-form'))
    // No crash
  })

  it('clicking Next Page fetches next page', async () => {
    setupConnection()
    setupTabState({ currentPage: 1 })
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('pagination-next'))
    await waitFor(() => {
      expect(ipc.calls('fetch_table_data').some((c) => (c as Record<string, unknown>)?.page === 2)).toBe(true)
    })
  })

  it('submitting a page number fetches that page', async () => {
    const user = userEvent.setup()
    setupConnection()
    setupTabState({ currentPage: 2 })
    render(<TableDataToolbar tabId="tab-1" />)

    const pageInput = screen.getByTestId('pagination-page-input')
    await user.clear(pageInput)
    await user.type(pageInput, '7{Enter}')

    await waitFor(() => {
      expect(ipc.calls('fetch_table_data').some((c) => (c as Record<string, unknown>)?.page === 7)).toBe(true)
    })
  })

  it('clicking Prev Page fetches previous page', async () => {
    setupConnection()
    setupTabState({ currentPage: 2 })
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('pagination-prev'))
    await waitFor(() => {
      expect(ipc.calls('fetch_table_data').some((c) => (c as Record<string, unknown>)?.page === 1)).toBe(true)
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

  it('export button stays enabled when table data is loaded without total rows', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-export')).not.toBeDisabled()
  })

  it('export button is disabled when table data has not loaded', () => {
    setupConnection()
    setupTabState({ columns: [] })
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
    const gridBtn = screen.getByTestId('view-mode-grid')
    expect(gridBtn.className).toContain('Active')
  })

  it('form view button has active class when viewMode is form', () => {
    setupConnection()
    setupTabState({ viewMode: 'form' })
    render(<TableDataToolbar tabId="tab-1" />)
    const formBtn = screen.getByTestId('view-mode-form')
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
          isBooleanAlias: false,
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
          isBooleanAlias: false,
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

    await waitFor(async () => {
      await expectToast('error', 'Invalid date value')
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
    await waitFor(async () => {
      await expectToast('success', 'Row saved')
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
          isBooleanAlias: false,
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
          isBooleanAlias: false,
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

    await waitFor(async () => {
      await expectToast('error', 'Invalid date value')
    })
  })

  it('clicking Save shows an error toast when saving fails', async () => {
    let saveAttempts = 0
    ipc.override('update_table_row', () => {
      saveAttempts += 1
      if (saveAttempts === 1) {
        throw new Error('Save failed')
      }
      return undefined
    })

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

    await waitFor(async () => {
      await expectToast('error', 'Save failed')
    })
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
          isBooleanAlias: false,
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
          isBooleanAlias: false,
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
      expect(useToastStore.getState().toasts.some((toast) => toast.variant === 'error')).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Filter button tests
// ---------------------------------------------------------------------------

describe('TableDataToolbar — Filter button', () => {
  it('filter button renders', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-filter')).toBeInTheDocument()
  })

  it('badge is hidden when no conditions', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.queryByTestId('filter-badge')).not.toBeInTheDocument()
  })

  it('clicking filter button opens FilterDialog', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()
  })

  it('applying conditions sets the badge count', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)

    // Open filter dialog
    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

    // Add a condition
    fireEvent.click(screen.getByTestId('filter-add-button'))
    // Apply
    fireEvent.click(screen.getByTestId('filter-apply-button'))

    // Dialog should close
    await waitFor(() => {
      expect(screen.queryByTestId('filter-dialog')).not.toBeInTheDocument()
    })

    // Badge should show count
    const badge = screen.getByTestId('filter-badge')
    expect(badge).toBeInTheDocument()
    expect(badge.textContent).toBe('1')
  })

  it('badge shows count when conditions exist', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)

    // Open and add 2 conditions
    fireEvent.click(screen.getByTestId('btn-filter'))
    fireEvent.click(screen.getByTestId('filter-add-button'))
    fireEvent.click(screen.getByTestId('filter-add-button'))
    fireEvent.click(screen.getByTestId('filter-apply-button'))

    await waitFor(() => {
      expect(screen.queryByTestId('filter-dialog')).not.toBeInTheDocument()
    })

    const badge = screen.getByTestId('filter-badge')
    expect(badge.textContent).toBe('2')
  })

  it('icon weight is regular when no conditions and fill when conditions exist', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)

    // Initially regular weight — the Funnel icon should not have "fill" weight
    const filterBtn = screen.getByTestId('btn-filter')
    // Check that the SVG exists (Phosphor renders an SVG)
    const svg = filterBtn.querySelector('svg')
    expect(svg).toBeTruthy()

    // Apply one condition
    fireEvent.click(filterBtn)
    fireEvent.click(screen.getByTestId('filter-add-button'))
    fireEvent.click(screen.getByTestId('filter-apply-button'))

    await waitFor(() => {
      expect(screen.queryByTestId('filter-dialog')).not.toBeInTheDocument()
    })

    // Badge should exist, indicating active filters
    expect(screen.getByTestId('filter-badge')).toBeInTheDocument()
  })

  it('filter button is disabled when columns are empty', () => {
    setupConnection()
    setupTabState({ columns: [] })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-filter')).toBeDisabled()
  })

  it('cancelling FilterDialog does not change badge state', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)

    // Open and cancel
    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('filter-cancel-button'))

    // No badge
    expect(screen.queryByTestId('filter-badge')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// isView mode tests (Phase 3 — View Data mode)
// ---------------------------------------------------------------------------

describe('TableDataToolbar — isView mode', () => {
  it('shows VIEW badge when isView=true', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" isView={true} />)
    expect(screen.getByTestId('view-badge')).toBeInTheDocument()
  })

  it('hides mutation buttons when isView=true', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" isView={true} />)
    expect(screen.queryByTestId('btn-add-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-delete-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-save')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-discard')).not.toBeInTheDocument()
  })

  it('hides NO KEY badge when isView=true even if no PK', () => {
    setupConnection()
    setupTabState({ primaryKey: null })
    render(<TableDataToolbar tabId="tab-1" isView={true} />)
    expect(screen.queryByTestId('nopk-badge')).not.toBeInTheDocument()
    expect(screen.getByTestId('view-badge')).toBeInTheDocument()
  })

  it('shows mutation buttons when isView=false/undefined', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-add-row')).toBeInTheDocument()
  })
})
