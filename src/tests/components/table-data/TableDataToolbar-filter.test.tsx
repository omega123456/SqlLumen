import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useConnectionStore } from '../../../stores/connection-store'
import type { TableDataTabState } from '../../../types/schema'

// Mock toast store
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

function setupConnection() {
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
          readOnly: false,
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
    selectedCell: null,
    filterModel: [],
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
  useConnectionStore.setState({ activeConnections: {}, activeTabId: null })
  mockIPC(() => null)
  vi.clearAllMocks()
})

describe('TableDataToolbar — Clear Filter button', () => {
  it('clear filter button is not visible when no filters', () => {
    setupConnection()
    setupTabState({ filterModel: [] })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.queryByTestId('btn-clear-filter')).not.toBeInTheDocument()
  })

  it('clear filter button is visible when filters are active', () => {
    setupConnection()
    setupTabState({
      filterModel: [{ column: 'name', operator: '==', value: 'Alice' }],
    })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-clear-filter')).toBeInTheDocument()
  })

  it('clicking clear filter directly clears filters and shows toast (no confirm dialog)', async () => {
    setupConnection()
    setupTabState({
      filterModel: [{ column: 'name', operator: '==', value: 'Alice' }],
    })
    render(<TableDataToolbar tabId="tab-1" />)

    // Click clear filter — should clear immediately via withNavigationGuard (no edits pending)
    fireEvent.click(screen.getByTestId('btn-clear-filter'))

    // No confirm dialog should appear
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()

    // filterModel should be cleared
    await waitFor(() => {
      const tab = useTableDataStore.getState().tabs['tab-1']
      expect(tab?.filterModel).toEqual([])
    })

    // Toast should be shown
    expect(mockShowSuccess).toHaveBeenCalledWith('Filters cleared')
  })

  it('confirming clear filter calls applyFilters([]) and shows "Filters cleared" toast', async () => {
    setupConnection()
    setupTabState({
      filterModel: [{ column: 'name', operator: '==', value: 'Alice' }],
    })
    render(<TableDataToolbar tabId="tab-1" />)

    // Click clear filter
    fireEvent.click(screen.getByTestId('btn-clear-filter'))

    // filterModel should be cleared
    await waitFor(() => {
      const tab = useTableDataStore.getState().tabs['tab-1']
      expect(tab?.filterModel).toEqual([])
    })

    // Toast should be shown
    expect(mockShowSuccess).toHaveBeenCalledWith('Filters cleared')
  })

  it('clear filter button has aria-label', () => {
    setupConnection()
    setupTabState({
      filterModel: [{ column: 'name', operator: '==', value: 'Alice' }],
    })
    render(<TableDataToolbar tabId="tab-1" />)

    const btn = screen.getByTestId('btn-clear-filter')
    expect(btn).toHaveAttribute('aria-label', 'Clear filters')
  })
})

describe('TableDataToolbar — Filter auto-populate from selectedCell', () => {
  it('filter dialog opens with empty conditions when no selected cell', () => {
    setupConnection()
    setupTabState({ selectedCell: null })
    render(<TableDataToolbar tabId="tab-1" />)

    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

    // Empty state should be visible (no conditions pre-populated)
    expect(screen.getByTestId('filter-empty-state')).toBeInTheDocument()
  })

  it('filter dialog auto-populates with selected cell value', () => {
    setupConnection()
    setupTabState({
      selectedCell: { columnKey: 'name', value: 'Alice' },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

    // Should have a filter row pre-populated (not empty state)
    expect(screen.queryByTestId('filter-empty-state')).not.toBeInTheDocument()
    expect(screen.getByTestId('filter-row')).toBeInTheDocument()
  })

  it('filter dialog auto-populates with IS NULL when cell value is null', () => {
    setupConnection()
    setupTabState({
      selectedCell: { columnKey: 'name', value: null },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

    // Should have a filter row
    expect(screen.queryByTestId('filter-empty-state')).not.toBeInTheDocument()
    expect(screen.getByTestId('filter-row')).toBeInTheDocument()
  })

  it('filter dialog uses existing filterModel when filters are active (ignores selectedCell)', () => {
    setupConnection()
    setupTabState({
      filterModel: [{ column: 'id', operator: '>', value: '10' }],
      selectedCell: { columnKey: 'name', value: 'Alice' },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

    // Should show the existing filter condition, not the selected cell
    expect(screen.getByTestId('filter-row')).toBeInTheDocument()
  })
})
