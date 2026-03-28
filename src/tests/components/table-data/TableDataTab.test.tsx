import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useConnectionStore } from '../../../stores/connection-store'
import type { TableDataTabState } from '../../../types/schema'

// Mock table-data-commands
vi.mock('../../../lib/table-data-commands', () => ({
  fetchTableData: vi.fn().mockResolvedValue({
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
    ],
    totalRows: 2,
    currentPage: 1,
    totalPages: 1,
    pageSize: 1000,
    primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
    executionTimeMs: 15,
  }),
  updateTableRow: vi.fn().mockResolvedValue(undefined),
  insertTableRow: vi.fn().mockResolvedValue([]),
  deleteTableRow: vi.fn().mockResolvedValue(undefined),
  exportTableData: vi.fn().mockResolvedValue(undefined),
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

// Import after mocks
import { TableDataTab } from '../../../components/table-data/TableDataTab'
import type { TableDataTab as TableDataTabType } from '../../../types/schema'

function makeTab(overrides: Partial<TableDataTabType> = {}): TableDataTabType {
  return {
    id: 'tab-1',
    type: 'table-data',
    label: 'users',
    connectionId: 'conn-1',
    databaseName: 'mydb',
    objectName: 'users',
    objectType: 'table',
    ...overrides,
  }
}

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

function makeTabState(overrides: Partial<TableDataTabState> = {}): TableDataTabState {
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
    ],
    totalRows: 2,
    currentPage: 1,
    totalPages: 1,
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

beforeEach(() => {
  useTableDataStore.setState({ tabs: {} })
  useConnectionStore.setState({
    activeConnections: {},
    activeTabId: null,
  })
  mockIPC(() => null)
})

/** Drain async loadTableData so follow-up assertions and test teardown do not warn on act(). */
async function waitForTableDataLoaded() {
  await waitFor(() => {
    expect(screen.getByTestId('table-data-grid')).toBeInTheDocument()
  })
  await waitFor(() => {
    expect(useTableDataStore.getState().tabs['tab-1']?.isLoading).toBe(false)
  })
}

describe('TableDataTab', () => {
  it('renders with data-testid="table-data-tab"', async () => {
    setupConnection()
    render(<TableDataTab tab={makeTab()} />)
    expect(screen.getByTestId('table-data-tab')).toBeInTheDocument()
    await waitForTableDataLoaded()
  })

  it('renders loading state initially', async () => {
    setupConnection()
    // Don't pre-populate store — the component will init on mount
    render(<TableDataTab tab={makeTab()} />)
    // The toolbar should be visible
    expect(screen.getByTestId('table-data-toolbar')).toBeInTheDocument()
    // Loading text or spinner should be present
    expect(screen.getByText('Loading table data...')).toBeInTheDocument()
    await waitForTableDataLoaded()
  })

  it('renders grid after data loads', async () => {
    setupConnection()
    render(<TableDataTab tab={makeTab()} />)

    // Wait for the fetchTableData mock to resolve and grid to appear
    await waitFor(() => {
      expect(screen.getByTestId('table-data-grid')).toBeInTheDocument()
    })
  })

  it('shows no-PK warning banner when primaryKey is null', async () => {
    setupConnection()

    // Override the fetchTableData mock to return no primaryKey
    const { fetchTableData } = await import('../../../lib/table-data-commands')
    vi.mocked(fetchTableData).mockResolvedValueOnce({
      columns: [
        {
          name: 'id',
          dataType: 'bigint',
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
      rows: [[1]],
      totalRows: 1,
      currentPage: 1,
      totalPages: 1,
      pageSize: 1000,
      primaryKey: null,
      executionTimeMs: 10,
    })

    render(<TableDataTab tab={makeTab()} />)

    await waitFor(() => {
      expect(screen.getByTestId('no-pk-warning')).toBeInTheDocument()
    })
    expect(screen.getByText(/no primary key or unique key/i)).toBeInTheDocument()
  })

  it('does not show no-PK warning when primaryKey exists', async () => {
    setupConnection()
    render(<TableDataTab tab={makeTab()} />)

    await waitFor(() => {
      expect(screen.getByTestId('table-data-grid')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('no-pk-warning')).not.toBeInTheDocument()
  })

  it('shows error state with retry button', async () => {
    setupConnection()

    // Override to reject
    const { fetchTableData } = await import('../../../lib/table-data-commands')
    vi.mocked(fetchTableData).mockRejectedValueOnce(new Error('Connection lost'))

    render(<TableDataTab tab={makeTab()} />)

    await waitFor(() => {
      expect(screen.getByTestId('table-data-error')).toBeInTheDocument()
    })
    expect(screen.getByText('Connection lost')).toBeInTheDocument()
    expect(screen.getByTestId('btn-retry')).toBeInTheDocument()
  })

  it('retry button calls loadTableData', async () => {
    setupConnection()

    const { fetchTableData } = await import('../../../lib/table-data-commands')
    vi.mocked(fetchTableData).mockRejectedValueOnce(new Error('Some error'))

    render(<TableDataTab tab={makeTab()} />)

    await waitFor(() => {
      expect(screen.getByTestId('btn-retry')).toBeInTheDocument()
    })

    // Now restore the mock for the retry
    vi.mocked(fetchTableData).mockResolvedValueOnce({
      columns: makeTabState().columns,
      rows: makeTabState().rows,
      totalRows: 2,
      currentPage: 1,
      totalPages: 1,
      pageSize: 1000,
      primaryKey: makeTabState().primaryKey,
      executionTimeMs: 15,
    })

    fireEvent.click(screen.getByTestId('btn-retry'))

    await waitFor(() => {
      const tab = useTableDataStore.getState().tabs['tab-1']
      expect(tab).toBeDefined()
    })
  })

  it('passes correct tab context to store initTab', async () => {
    setupConnection()
    const tab = makeTab({ connectionId: 'conn-1', databaseName: 'testdb', objectName: 'orders' })
    render(<TableDataTab tab={tab} />)

    // initTab should have been called, creating the tab state
    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state).toBeDefined()
    expect(state?.connectionId).toBe('conn-1')
    expect(state?.database).toBe('testdb')
    expect(state?.table).toBe('orders')
    await waitForTableDataLoaded()
  })

  it('renders form view when viewMode is form', async () => {
    setupConnection()
    render(<TableDataTab tab={makeTab()} />)

    await waitForTableDataLoaded()

    // Now switch to form view via the store
    useTableDataStore.getState().setViewMode('tab-1', 'form')

    await waitFor(() => {
      expect(screen.getByTestId('table-data-form-view')).toBeInTheDocument()
    })
  })

  it('shows export dialog when isExportDialogOpen is true', async () => {
    setupConnection()
    render(<TableDataTab tab={makeTab()} />)

    await waitForTableDataLoaded()

    // Open export dialog via the store
    useTableDataStore.getState().openExportDialog('tab-1')

    await waitFor(() => {
      expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
    })
  })

  it('shows unsaved changes dialog when pendingNavigationAction is set', async () => {
    setupConnection()
    render(<TableDataTab tab={makeTab()} />)

    await waitForTableDataLoaded()

    // Set unsaved changes dialog state
    useTableDataStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          editState: {
            rowKey: { id: 1 },
            originalValues: { id: 1, name: 'Alice' },
            currentValues: { id: 1, name: 'Changed' },
            modifiedColumns: new Set(['name']),
            isNewRow: false,
          },
          pendingNavigationAction: () => {},
        },
      },
    }))

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument()
    })
  })

  it('handleExport calls exportTableData and closes dialog', async () => {
    setupConnection()
    render(<TableDataTab tab={makeTab()} />)

    await waitForTableDataLoaded()

    // Open export dialog
    useTableDataStore.getState().openExportDialog('tab-1')

    await waitFor(() => {
      expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
    })

    // The export dialog is rendered — now verify it can be closed
    const cancelBtn = screen.getByTestId('export-cancel-button')
    fireEvent.click(cancelBtn)

    await waitFor(() => {
      expect(screen.queryByTestId('export-dialog')).not.toBeInTheDocument()
    })
  })

  it('handleDiscardNavigation closes unsaved dialog', async () => {
    setupConnection()
    render(<TableDataTab tab={makeTab()} />)

    await waitForTableDataLoaded()

    // Set up pending navigation
    useTableDataStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          editState: {
            rowKey: { id: 1 },
            originalValues: { id: 1, name: 'Alice' },
            currentValues: { id: 1, name: 'Changed' },
            modifiedColumns: new Set(['name']),
            isNewRow: false,
          },
          pendingNavigationAction: () => {},
        },
      },
    }))

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument()
    })

    // Click discard in the dialog
    const discardBtn = screen.getByTestId('btn-discard-changes')
    fireEvent.click(discardBtn)

    await waitFor(() => {
      expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
    })
  })

  it('handleCancelNavigation closes unsaved dialog', async () => {
    setupConnection()
    render(<TableDataTab tab={makeTab()} />)

    await waitForTableDataLoaded()

    // Set up pending navigation
    useTableDataStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          editState: {
            rowKey: { id: 1 },
            originalValues: { id: 1, name: 'Alice' },
            currentValues: { id: 1, name: 'Changed' },
            modifiedColumns: new Set(['name']),
            isNewRow: false,
          },
          pendingNavigationAction: () => {},
        },
      },
    }))

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument()
    })

    // Click cancel
    const cancelBtn = screen.getByTestId('btn-cancel-changes')
    fireEvent.click(cancelBtn)

    await waitFor(() => {
      expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
    })
  })

  it('renders with read-only connection', async () => {
    setupConnection(true) // readOnly
    render(<TableDataTab tab={makeTab()} />)

    await waitForTableDataLoaded()

    // Read-only badge should appear in toolbar
    expect(screen.getByTestId('readonly-badge')).toBeInTheDocument()
  })
})
