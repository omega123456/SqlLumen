import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { EditModeDropdown } from '../../../components/query-editor/EditModeDropdown'
import { useQueryStore, type TabQueryState } from '../../../stores/query-store'
import { useConnectionStore } from '../../../stores/connection-store'
import type { QueryTableEditInfo } from '../../../types/schema'

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
  editForeignKeys: [],
  editState: null,
  isAnalyzingQuery: false,
  editableColumnMap: new Map(),
  editColumnBindings: new Map(),
  editBoundColumnIndexMap: new Map(),
  pendingNavigationAction: null,
  saveError: null,
  editConnectionId: null,
  editingRowIndex: null,
  executionStartedAt: null,
  isCancelling: false,
  wasCancelled: false,
}

const MOCK_TABLE_INFO: QueryTableEditInfo = {
  database: 'test_db',
  table: 'users',
  columns: [
    {
      name: 'id',
      dataType: 'INT',
      isBooleanAlias: false,
      isNullable: false,
      isPrimaryKey: true,
      isUniqueKey: false,
      hasDefault: false,
      columnDefault: null,
      isBinary: false,
      isAutoIncrement: true,
    },
    {
      name: 'name',
      dataType: 'VARCHAR',
      isBooleanAlias: false,
      isNullable: true,
      isPrimaryKey: false,
      isUniqueKey: false,
      hasDefault: false,
      columnDefault: null,
      isBinary: false,
      isAutoIncrement: false,
    },
  ],
  primaryKey: {
    keyColumns: ['id'],
    hasAutoIncrement: true,
    isUniqueKeyFallback: false,
  },
  foreignKeys: [],
}

const MOCK_TABLE_INFO_2: QueryTableEditInfo = {
  database: 'other_db',
  table: 'orders',
  columns: [
    {
      name: 'id',
      dataType: 'INT',
      isBooleanAlias: false,
      isNullable: false,
      isPrimaryKey: true,
      isUniqueKey: false,
      hasDefault: false,
      columnDefault: null,
      isBinary: false,
      isAutoIncrement: true,
    },
  ],
  primaryKey: {
    keyColumns: ['id'],
    hasAutoIncrement: true,
    isUniqueKeyFallback: false,
  },
  foreignKeys: [],
}

function setupTabState(tabId: string, overrides: Partial<TabQueryState> = {}) {
  useQueryStore.setState({
    tabs: {
      [tabId]: { ...DEFAULT_TAB_STATE, ...overrides },
    },
  })
}

function setupConnectionStore(connectionId: string, readOnly = false) {
  useConnectionStore.setState({
    activeConnections: {
      [connectionId]: {
        id: connectionId,
        profile: {
          id: 'profile-1',
          name: 'Test Connection',
          host: '127.0.0.1',
          port: 3306,
          username: 'test',
          hasPassword: true,
          defaultDatabase: 'test_db',
          sslEnabled: false,
          sslCaPath: null,
          sslCertPath: null,
          sslKeyPath: null,
          color: '#2563eb',
          groupId: null,
          readOnly,
          sortOrder: 0,
          connectTimeoutSecs: 10,
          keepaliveIntervalSecs: 60,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
        status: 'connected',
        serverVersion: '8.0.33',
      },
    },
  })
}

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  useConnectionStore.setState({ activeConnections: {} })
  mockIPC(() => null)
})

describe('EditModeDropdown', () => {
  const tabId = 'tab-1'
  const connectionId = 'conn-1'

  describe('visibility', () => {
    it('is hidden when status is idle', () => {
      setupTabState(tabId, { status: 'idle' })
      setupConnectionStore(connectionId)
      const { container } = render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      expect(container.innerHTML).toBe('')
    })

    it('is hidden when status is error', () => {
      setupTabState(tabId, {
        status: 'error',
        errorMessage: 'Some error',
        columns: [{ name: 'id', dataType: 'INT' }],
      })
      setupConnectionStore(connectionId)
      const { container } = render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      expect(container.innerHTML).toBe('')
    })

    it('is hidden when no result columns', () => {
      setupTabState(tabId, { status: 'success', columns: [] })
      setupConnectionStore(connectionId)
      const { container } = render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      expect(container.innerHTML).toBe('')
    })

    it('is hidden when connection is read-only', () => {
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
      })
      setupConnectionStore(connectionId, true)
      const { container } = render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      expect(container.innerHTML).toBe('')
    })

    it('is visible when status is success with columns and not read-only', () => {
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        lastExecutedSql: 'SELECT * FROM users',
      })
      setupConnectionStore(connectionId)
      render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      expect(screen.getByTestId('edit-mode-dropdown')).toBeInTheDocument()
    })

    it('is hidden for SHOW statements even with columns', () => {
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'Tables_in_db', dataType: 'VARCHAR' }],
        lastExecutedSql: 'SHOW TABLES',
      })
      setupConnectionStore(connectionId)
      const { container } = render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      expect(container.innerHTML).toBe('')
    })

    it('is hidden for DESCRIBE statements even with columns', () => {
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'Field', dataType: 'VARCHAR' }],
        lastExecutedSql: 'DESCRIBE users',
      })
      setupConnectionStore(connectionId)
      const { container } = render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      expect(container.innerHTML).toBe('')
    })

    it('is hidden for EXPLAIN statements even with columns', () => {
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        lastExecutedSql: 'EXPLAIN SELECT * FROM users',
      })
      setupConnectionStore(connectionId)
      const { container } = render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      expect(container.innerHTML).toBe('')
    })

    it('is hidden when lastExecutedSql is null', () => {
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        lastExecutedSql: null,
      })
      setupConnectionStore(connectionId)
      const { container } = render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      expect(container.innerHTML).toBe('')
    })
  })

  describe('rendering', () => {
    it('renders with data-testid="edit-mode-dropdown"', () => {
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        lastExecutedSql: 'SELECT * FROM users',
      })
      setupConnectionStore(connectionId)
      render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      expect(screen.getByTestId('edit-mode-dropdown')).toBeInTheDocument()
    })

    it('renders with data-testid="edit-mode-group"', () => {
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        lastExecutedSql: 'SELECT * FROM users',
      })
      setupConnectionStore(connectionId)
      render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      expect(screen.getByTestId('edit-mode-group')).toBeInTheDocument()
    })

    it('shows "Read Only" as default option', () => {
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        lastExecutedSql: 'SELECT * FROM users',
      })
      setupConnectionStore(connectionId)
      render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      expect(screen.getByTestId('edit-mode-dropdown')).toHaveTextContent('Read Only')
    })

    it('shows detected table names as options', async () => {
      const user = userEvent.setup()
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        editTableMetadata: { 'test_db.users': MOCK_TABLE_INFO },
        lastExecutedSql: 'SELECT * FROM users',
      })
      setupConnectionStore(connectionId)
      render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      await user.click(screen.getByTestId('edit-mode-dropdown'))
      const opts = screen.getAllByRole('option')
      expect(opts).toHaveLength(2)
      expect(opts[1]).toHaveAccessibleName('users')
    })

    it('shows database prefix when tables come from multiple databases', async () => {
      const user = userEvent.setup()
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        editTableMetadata: {
          'test_db.users': MOCK_TABLE_INFO,
          'other_db.orders': MOCK_TABLE_INFO_2,
        },
        lastExecutedSql: 'SELECT * FROM users',
      })
      setupConnectionStore(connectionId)
      render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      await user.click(screen.getByTestId('edit-mode-dropdown'))
      const opts = screen.getAllByRole('option')
      expect(opts).toHaveLength(3)
      expect(opts[1]).toHaveAccessibleName('test_db.users')
      expect(opts[2]).toHaveAccessibleName('other_db.orders')
    })

    it('does not show database prefix when all tables from same database', async () => {
      const user = userEvent.setup()
      const sameDbTable: QueryTableEditInfo = { ...MOCK_TABLE_INFO_2, database: 'test_db' }
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        editTableMetadata: {
          'test_db.users': MOCK_TABLE_INFO,
          'test_db.orders': sameDbTable,
        },
        lastExecutedSql: 'SELECT * FROM users',
      })
      setupConnectionStore(connectionId)
      render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      await user.click(screen.getByTestId('edit-mode-dropdown'))
      const opts = screen.getAllByRole('option')
      expect(opts[1]).toHaveAccessibleName('users')
      expect(opts[2]).toHaveAccessibleName('orders')
    })

    it('is disabled when isAnalyzingQuery is true', () => {
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        isAnalyzingQuery: true,
        lastExecutedSql: 'SELECT * FROM users',
      })
      setupConnectionStore(connectionId)
      render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      expect(screen.getByTestId('edit-mode-dropdown')).toBeDisabled()
    })

    it('reflects current editMode as selected value', () => {
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        editTableMetadata: { 'test_db.users': MOCK_TABLE_INFO },
        editMode: 'test_db.users',
        lastExecutedSql: 'SELECT * FROM users',
      })
      setupConnectionStore(connectionId)
      render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      expect(screen.getByTestId('edit-mode-dropdown')).toHaveTextContent('users')
    })
  })

  describe('interactions', () => {
    it('calls setEditMode when table is selected', async () => {
      const user = userEvent.setup()
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        editTableMetadata: { 'test_db.users': MOCK_TABLE_INFO },
        lastExecutedSql: 'SELECT * FROM users',
      })
      setupConnectionStore(connectionId)

      const setEditModeSpy = vi.fn()
      useQueryStore.setState({ setEditMode: setEditModeSpy })

      render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      await user.click(screen.getByTestId('edit-mode-dropdown'))
      await user.click(screen.getByRole('option', { name: 'users' }))

      expect(setEditModeSpy).toHaveBeenCalledWith(connectionId, tabId, 'test_db.users')
    })

    it('calls setEditMode with null when "Read Only" is selected', async () => {
      const user = userEvent.setup()
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        editTableMetadata: { 'test_db.users': MOCK_TABLE_INFO },
        editMode: 'test_db.users',
        lastExecutedSql: 'SELECT * FROM users',
      })
      setupConnectionStore(connectionId)

      const setEditModeSpy = vi.fn()
      useQueryStore.setState({ setEditMode: setEditModeSpy })

      render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      await user.click(screen.getByTestId('edit-mode-dropdown'))
      await user.click(screen.getByRole('option', { name: 'Read Only' }))

      expect(setEditModeSpy).toHaveBeenCalledWith(connectionId, tabId, null)
    })

    it('triggers requestNavigationAction when edits are pending', async () => {
      const user = userEvent.setup()
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        editTableMetadata: { 'test_db.users': MOCK_TABLE_INFO },
        editMode: 'test_db.users',
        lastExecutedSql: 'SELECT * FROM users',
        editState: {
          rowKey: { id: 1 },
          originalValues: { name: 'Alice' },
          currentValues: { name: 'Bob' },
          modifiedColumns: new Set(['name']),
          isNewRow: false,
        },
      })
      setupConnectionStore(connectionId)

      const requestNavSpy = vi.fn()
      useQueryStore.setState({ requestNavigationAction: requestNavSpy })

      render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      await user.click(screen.getByTestId('edit-mode-dropdown'))
      await user.click(screen.getByRole('option', { name: 'Read Only' }))

      expect(requestNavSpy).toHaveBeenCalledWith(tabId, expect.any(Function))
    })

    it('does not trigger requestNavigationAction when no modifications exist', async () => {
      const user = userEvent.setup()
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        editTableMetadata: { 'test_db.users': MOCK_TABLE_INFO },
        editMode: 'test_db.users',
        lastExecutedSql: 'SELECT * FROM users',
        editState: {
          rowKey: { id: 1 },
          originalValues: { name: 'Alice' },
          currentValues: { name: 'Alice' },
          modifiedColumns: new Set(),
          isNewRow: false,
        },
      })
      setupConnectionStore(connectionId)

      const setEditModeSpy = vi.fn()
      const requestNavSpy = vi.fn()
      useQueryStore.setState({
        setEditMode: setEditModeSpy,
        requestNavigationAction: requestNavSpy,
      })

      render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      await user.click(screen.getByTestId('edit-mode-dropdown'))
      await user.click(screen.getByRole('option', { name: 'Read Only' }))

      expect(requestNavSpy).not.toHaveBeenCalled()
      expect(setEditModeSpy).toHaveBeenCalledWith(connectionId, tabId, null)
    })

    it('has aria-label="Edit mode"', () => {
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        lastExecutedSql: 'SELECT * FROM users',
      })
      setupConnectionStore(connectionId)
      render(<EditModeDropdown tabId={tabId} connectionId={connectionId} />)
      expect(screen.getByLabelText('Edit mode')).toBeInTheDocument()
    })
  })
})
