import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'

vi.mock('../stores/toast-store', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}))

import { useConnectionStore, _resetListenersSetup } from '../stores/connection-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { useQueryStore } from '../stores/query-store'
import { useTableDataStore } from '../stores/table-data-store'
import { showErrorToast } from '../stores/toast-store'
import type { SavedConnection, ConnectionGroup } from '../types/connection'

// Mock the Tauri event system
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

import { listen } from '@tauri-apps/api/event'
const mockListen = vi.mocked(listen)

// --- Test fixtures ---

const mockSavedConnection: SavedConnection = {
  id: 'conn-1',
  name: 'Test DB',
  host: 'localhost',
  port: 3306,
  username: 'root',
  hasPassword: true,
  defaultDatabase: 'mydb',
  sslEnabled: false,
  sslCaPath: null,
  sslCertPath: null,
  sslKeyPath: null,
  color: null,
  groupId: null,
  readOnly: false,
  sortOrder: 0,
  connectTimeoutSecs: 10,
  keepaliveIntervalSecs: 60,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
}

const mockSavedConnection2: SavedConnection = {
  ...mockSavedConnection,
  id: 'conn-2',
  name: 'Staging DB',
}

const mockGroup: ConnectionGroup = {
  id: 'grp-1',
  name: 'Production',
  parentId: null,
  sortOrder: 0,
  createdAt: '2025-01-01T00:00:00Z',
}

// --- Reset store between tests ---

beforeEach(() => {
  useConnectionStore.setState({
    savedConnections: [],
    connectionGroups: [],
    activeConnections: {},
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
  mockListen.mockClear()
  _resetListenersSetup()
})

// --- Tests ---

describe('useConnectionStore — initial state', () => {
  it('has correct initial state', () => {
    const state = useConnectionStore.getState()
    expect(state.savedConnections).toEqual([])
    expect(state.connectionGroups).toEqual([])
    expect(state.activeConnections).toEqual({})
    expect(state.activeTabId).toBeNull()
    expect(state.dialogOpen).toBe(false)
    expect(state.error).toBeNull()
  })
})

describe('useConnectionStore — fetchSavedConnections', () => {
  it('loads connections and groups from backend', async () => {
    mockIPC((cmd) => {
      if (cmd === 'list_connections') return [mockSavedConnection]
      if (cmd === 'list_connection_groups') return [mockGroup]
      return null
    })

    await useConnectionStore.getState().fetchSavedConnections()

    const state = useConnectionStore.getState()
    expect(state.savedConnections).toEqual([mockSavedConnection])
    expect(state.connectionGroups).toEqual([mockGroup])
    expect(state.error).toBeNull()
  })

  it('sets error on IPC failure', async () => {
    mockIPC((cmd) => {
      if (cmd === 'list_connections') throw new Error('Database error')
      return null
    })

    await useConnectionStore.getState().fetchSavedConnections()

    const state = useConnectionStore.getState()
    expect(state.error).toBe('Database error')
  })

  it('clears previous error on success', async () => {
    useConnectionStore.setState({ error: 'previous error' })
    mockIPC((cmd) => {
      if (cmd === 'list_connections') return []
      if (cmd === 'list_connection_groups') return []
      return null
    })

    await useConnectionStore.getState().fetchSavedConnections()
    expect(useConnectionStore.getState().error).toBeNull()
  })
})

describe('useConnectionStore — openConnection', () => {
  it('adds to activeConnections and sets activeTabId', async () => {
    useConnectionStore.setState({ savedConnections: [mockSavedConnection] })
    mockIPC((cmd) => {
      if (cmd === 'open_connection') {
        return { sessionId: 'sess-1', serverVersion: '8.0.35' }
      }
      return null
    })

    await useConnectionStore.getState().openConnection('conn-1')

    const state = useConnectionStore.getState()
    expect(state.activeConnections['sess-1']).toEqual({
      id: 'sess-1',
      profile: mockSavedConnection,
      sessionDatabase: mockSavedConnection.defaultDatabase,
      status: 'connected',
      serverVersion: '8.0.35',
    })
    expect(state.activeTabId).toBe('sess-1')
    expect(state.error).toBeNull()
  })

  it('opens multiple sessions for the same saved profile', async () => {
    useConnectionStore.setState({ savedConnections: [mockSavedConnection] })
    let n = 0
    mockIPC((cmd) => {
      if (cmd === 'open_connection') {
        n += 1
        return { sessionId: `sess-${n}`, serverVersion: '8.0.35' }
      }
      return null
    })

    await useConnectionStore.getState().openConnection('conn-1')
    await useConnectionStore.getState().openConnection('conn-1')

    const state = useConnectionStore.getState()
    expect(Object.keys(state.activeConnections).sort()).toEqual(['sess-1', 'sess-2'])
    expect(state.activeConnections['sess-1'].profile.id).toBe('conn-1')
    expect(state.activeConnections['sess-2'].profile.id).toBe('conn-1')
    expect(state.activeTabId).toBe('sess-2')
  })

  it('sets error when profile not found in savedConnections', async () => {
    useConnectionStore.setState({ savedConnections: [] })

    await expect(useConnectionStore.getState().openConnection('missing-id')).rejects.toThrow(
      "Connection profile 'missing-id' not found"
    )

    const state = useConnectionStore.getState()
    expect(state.error).toBe("Connection profile 'missing-id' not found")
    expect(state.activeConnections).toEqual({})
  })

  it('sets error on IPC failure', async () => {
    useConnectionStore.setState({ savedConnections: [mockSavedConnection] })
    mockIPC((cmd) => {
      if (cmd === 'open_connection') {
        throw new Error('Connection refused')
      }
      return null
    })

    await expect(useConnectionStore.getState().openConnection('conn-1')).rejects.toThrow(
      'Connection refused'
    )

    const state = useConnectionStore.getState()
    expect(state.error).toBe('Connection refused')
    expect(state.activeConnections).toEqual({})
  })
})

describe('useConnectionStore — closeConnection', () => {
  it('removes from activeConnections', async () => {
    useConnectionStore.setState({
      activeConnections: {
        'sess-1': {
          id: 'sess-1',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
      },
      activeTabId: 'sess-1',
    })
    mockIPC((cmd) => {
      if (cmd === 'close_connection') return null
      return null
    })

    await useConnectionStore.getState().closeConnection('sess-1')

    const state = useConnectionStore.getState()
    expect(state.activeConnections).toEqual({})
  })

  it('switches activeTabId to another connection when closing active tab', async () => {
    useConnectionStore.setState({
      activeConnections: {
        'sess-1': {
          id: 'sess-1',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
        'sess-2': {
          id: 'sess-2',
          profile: mockSavedConnection2,
          status: 'connected',
          serverVersion: '8.0.35',
        },
      },
      activeTabId: 'sess-1',
    })
    mockIPC((cmd) => {
      if (cmd === 'close_connection') return null
      return null
    })

    await useConnectionStore.getState().closeConnection('sess-1')

    const state = useConnectionStore.getState()
    expect(state.activeTabId).toBe('sess-2')
  })

  it('sets activeTabId to null when closing the last connection', async () => {
    useConnectionStore.setState({
      activeConnections: {
        'sess-1': {
          id: 'sess-1',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
      },
      activeTabId: 'sess-1',
    })
    mockIPC((cmd) => {
      if (cmd === 'close_connection') return null
      return null
    })

    await useConnectionStore.getState().closeConnection('sess-1')

    const state = useConnectionStore.getState()
    expect(state.activeTabId).toBeNull()
  })

  it('does not change activeTabId when closing a non-active tab', async () => {
    useConnectionStore.setState({
      activeConnections: {
        'sess-1': {
          id: 'sess-1',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
        'sess-2': {
          id: 'sess-2',
          profile: mockSavedConnection2,
          status: 'connected',
          serverVersion: '8.0.35',
        },
      },
      activeTabId: 'sess-1',
    })
    mockIPC((cmd) => {
      if (cmd === 'close_connection') return null
      return null
    })

    await useConnectionStore.getState().closeConnection('sess-2')

    const state = useConnectionStore.getState()
    expect(state.activeTabId).toBe('sess-1')
  })

  it('sets error on IPC failure', async () => {
    useConnectionStore.setState({
      activeConnections: {
        'sess-1': {
          id: 'sess-1',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
      },
      activeTabId: 'sess-1',
    })
    mockIPC((cmd) => {
      if (cmd === 'close_connection') throw new Error('Close failed')
      return null
    })

    await useConnectionStore.getState().closeConnection('sess-1')

    const state = useConnectionStore.getState()
    expect(state.error).toBe('Close failed')
    // Connection should still be in activeConnections since IPC failed
    expect(state.activeConnections['sess-1']).toBeDefined()
  })
})

describe('useConnectionStore — switchTab', () => {
  it('sets activeTabId', () => {
    useConnectionStore.getState().switchTab('sess-2')
    expect(useConnectionStore.getState().activeTabId).toBe('sess-2')
  })
})

describe('useConnectionStore — updateConnectionStatus', () => {
  it('updates the status of a matching active connection', () => {
    useConnectionStore.setState({
      activeConnections: {
        'sess-1': {
          id: 'sess-1',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
      },
    })

    useConnectionStore.getState().updateConnectionStatus({
      connectionId: 'sess-1',
      status: 'reconnecting',
    })

    expect(useConnectionStore.getState().activeConnections['sess-1'].status).toBe('reconnecting')
  })

  it('does nothing for unknown connection id', () => {
    useConnectionStore.setState({
      activeConnections: {
        'sess-1': {
          id: 'sess-1',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
      },
    })

    useConnectionStore.getState().updateConnectionStatus({
      connectionId: 'unknown-id',
      status: 'disconnected',
    })

    // sess-1 should be unchanged
    expect(useConnectionStore.getState().activeConnections['sess-1'].status).toBe('connected')
  })
})

describe('useConnectionStore — dialog', () => {
  it('openDialog sets dialogOpen to true', () => {
    useConnectionStore.getState().openDialog()
    expect(useConnectionStore.getState().dialogOpen).toBe(true)
  })

  it('closeDialog sets dialogOpen to false', () => {
    useConnectionStore.setState({ dialogOpen: true })
    useConnectionStore.getState().closeDialog()
    expect(useConnectionStore.getState().dialogOpen).toBe(false)
  })
})

describe('useConnectionStore — clearError', () => {
  it('sets error to null', () => {
    useConnectionStore.setState({ error: 'some error' })
    useConnectionStore.getState().clearError()
    expect(useConnectionStore.getState().error).toBeNull()
  })
})

describe('useConnectionStore — setupEventListeners', () => {
  it('calls listen with connection-status-changed event', async () => {
    await useConnectionStore.getState().setupEventListeners()

    expect(mockListen).toHaveBeenCalledWith('connection-status-changed', expect.any(Function))
  })

  it('returns an unlisten function', async () => {
    const mockUnlisten = vi.fn()
    mockListen.mockResolvedValueOnce(mockUnlisten)

    const unlisten = await useConnectionStore.getState().setupEventListeners()
    expect(unlisten).toBe(mockUnlisten)
  })

  it('is idempotent — calling twice only registers once', async () => {
    await useConnectionStore.getState().setupEventListeners()
    await useConnectionStore.getState().setupEventListeners()

    expect(mockListen).toHaveBeenCalledTimes(1)
  })

  it('event handler calls updateConnectionStatus with event payload', async () => {
    // Set up an active connection so updateConnectionStatus has something to update
    useConnectionStore.setState({
      activeConnections: {
        'sess-1': {
          id: 'sess-1',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
      },
    })

    // Capture the handler passed to listen
    let capturedHandler: ((event: { payload: unknown }) => void) | undefined
    mockListen.mockImplementation((_event, handler) => {
      capturedHandler = handler as (event: { payload: unknown }) => void
      return Promise.resolve(() => {})
    })

    await useConnectionStore.getState().setupEventListeners()

    // Simulate an event
    capturedHandler!({
      payload: {
        connectionId: 'sess-1',
        status: 'disconnected',
        message: 'Lost connection',
      },
    })

    expect(useConnectionStore.getState().activeConnections['sess-1'].status).toBe('disconnected')
  })
})

describe('useConnectionStore — updateDefaultDatabase', () => {
  it('updates defaultDatabase in-memory and persists via IPC', async () => {
    useConnectionStore.setState({
      savedConnections: [mockSavedConnection],
      activeConnections: {
        'sess-1': {
          id: 'sess-1',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
      },
    })
    mockIPC((cmd) => {
      if (cmd === 'update_connection') return null
      return null
    })

    await useConnectionStore.getState().updateDefaultDatabase('sess-1', 'new_db')

    const state = useConnectionStore.getState()
    expect(state.activeConnections['sess-1'].profile.defaultDatabase).toBe('new_db')
    expect(state.savedConnections[0].defaultDatabase).toBe('new_db')
  })

  it('updates all active sessions sharing the same profile', async () => {
    useConnectionStore.setState({
      savedConnections: [mockSavedConnection],
      activeConnections: {
        'sess-1': {
          id: 'sess-1',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
        'sess-2': {
          id: 'sess-2',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
      },
    })
    mockIPC((cmd) => {
      if (cmd === 'update_connection') return null
      return null
    })

    await useConnectionStore.getState().updateDefaultDatabase('sess-1', 'new_db')

    const state = useConnectionStore.getState()
    expect(state.activeConnections['sess-1'].profile.defaultDatabase).toBe('new_db')
    expect(state.activeConnections['sess-2'].profile.defaultDatabase).toBe('new_db')
  })

  it('reverts in-memory state when IPC persistence fails', async () => {
    useConnectionStore.setState({
      savedConnections: [mockSavedConnection],
      activeConnections: {
        'sess-1': {
          id: 'sess-1',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
      },
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockIPC((cmd) => {
      if (cmd === 'update_connection') throw new Error('IPC write failed')
      return null
    })

    await useConnectionStore.getState().updateDefaultDatabase('sess-1', 'new_db')

    // Should revert to the original default database
    const state = useConnectionStore.getState()
    expect(state.activeConnections['sess-1'].profile.defaultDatabase).toBe(
      mockSavedConnection.defaultDatabase
    )
    expect(state.savedConnections[0].defaultDatabase).toBe(mockSavedConnection.defaultDatabase)
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to persist defaultDatabase change:',
      expect.any(Error)
    )
    consoleSpy.mockRestore()
  })
})

describe('useConnectionStore — setActiveDatabase', () => {
  it('updates only the targeted active session and calls select_database IPC', async () => {
    useConnectionStore.setState({
      activeConnections: {
        'sess-1': {
          id: 'sess-1',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
        'sess-2': {
          id: 'sess-2',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
      },
    })

    const selectDatabaseSpy = vi.fn()
    mockIPC((cmd) => {
      if (cmd === 'select_database') {
        selectDatabaseSpy()
        return null
      }
      return null
    })

    await useConnectionStore.getState().setActiveDatabase('sess-1', 'analytics_db')

    const state = useConnectionStore.getState()
    expect(state.activeConnections['sess-1'].sessionDatabase).toBe('analytics_db')
    expect(state.activeConnections['sess-1'].profile.defaultDatabase).toBe(
      mockSavedConnection.defaultDatabase
    )
    expect(state.activeConnections['sess-2'].sessionDatabase).toBeUndefined()
    expect(selectDatabaseSpy).toHaveBeenCalledTimes(1)
  })

  it('reverts the session database when select_database IPC fails', async () => {
    useConnectionStore.setState({
      activeConnections: {
        'sess-1': {
          id: 'sess-1',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
      },
    })

    mockIPC((cmd) => {
      if (cmd === 'select_database') throw new Error('USE failed')
      return null
    })

    await useConnectionStore.getState().setActiveDatabase('sess-1', 'analytics_db')

    expect(useConnectionStore.getState().activeConnections['sess-1'].sessionDatabase).toBe(
      mockSavedConnection.defaultDatabase
    )
  })
})

// ---------------------------------------------------------------------------
// closeConnection — aborts when save fails
// ---------------------------------------------------------------------------

describe('useConnectionStore — closeConnection aborts on failed save', () => {
  it('does not close connection when query-editor saveCurrentRow fails', async () => {
    const closeConnectionSpy = vi.fn()
    mockIPC((cmd) => {
      if (cmd === 'close_connection') {
        closeConnectionSpy()
        return null
      }
      return null
    })

    // Set up active connection
    useConnectionStore.setState({
      activeConnections: {
        'sess-1': {
          id: 'sess-1',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
      },
      activeTabId: 'sess-1',
    })

    // Set up workspace tab
    useWorkspaceStore.setState({
      tabsByConnection: {
        'sess-1': [{ id: 'qt-1', type: 'query-editor', label: 'Query 1', connectionId: 'sess-1' }],
      },
    })

    // Set up query store with pending edits that will fail to save
    useQueryStore.setState({
      tabs: {
        'qt-1': {
          ...useQueryStore.getState().getTabState('qt-1'),
          editMode: 'testdb.users',
          editConnectionId: 'sess-1',
          editingRowIndex: 0,
          editState: {
            rowKey: { id: 1 },
            originalValues: { id: 1, name: 'Alice' },
            currentValues: { id: 1, name: 'Changed' },
            modifiedColumns: new Set(['name']),
            isNewRow: false,
          },
          editTableMetadata: {
            'testdb.users': {
              database: 'testdb',
              table: 'users',
              columns: [],
              primaryKey: null, // No PK → save will fail
            },
          },
        },
      },
    })

    await useConnectionStore.getState().closeConnection('sess-1')

    // Connection should NOT have been closed
    expect(closeConnectionSpy).not.toHaveBeenCalled()
    expect(useConnectionStore.getState().activeConnections['sess-1']).toBeDefined()
    expect(showErrorToast).toHaveBeenCalledWith(
      'Connection not closed',
      expect.stringContaining('Could not save pending edits')
    )
  })

  it('does not close connection when table-data saveCurrentRow fails', async () => {
    const closeConnectionSpy = vi.fn()
    mockIPC((cmd) => {
      if (cmd === 'close_connection') {
        closeConnectionSpy()
        return null
      }
      return null
    })

    // Set up active connection
    useConnectionStore.setState({
      activeConnections: {
        'sess-1': {
          id: 'sess-1',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
      },
      activeTabId: 'sess-1',
    })

    // Set up workspace tab (table-data type)
    useWorkspaceStore.setState({
      tabsByConnection: {
        'sess-1': [
          {
            id: 'td-1',
            type: 'table-data' as const,
            label: 'users',
            connectionId: 'sess-1',
            databaseName: 'testdb',
            objectName: 'users',
            objectType: 'table' as const,
          },
        ],
      },
    })

    // Set up table data store with pending edits — no PK so save will fail
    useTableDataStore.setState({
      tabs: {
        'td-1': {
          connectionId: 'sess-1',
          database: 'testdb',
          table: 'users',
          columns: [],
          rows: [],
          totalRows: 0,
          currentPage: 1,
          totalPages: 1,
          pageSize: 100,
          executionTimeMs: 0,
          primaryKey: null, // No PK → save will fail
          viewMode: 'grid',
          selectedRowKey: null,
          isExportDialogOpen: false,
          filterModel: {},
          sort: null,
          isLoading: false,
          error: null,
          pendingNavigationAction: null,
          editState: {
            rowKey: { id: 1 },
            originalValues: { id: 1, name: 'Alice' },
            currentValues: { id: 1, name: 'Changed' },
            modifiedColumns: new Set(['name']),
            isNewRow: false,
          },
          saveError: null,
        },
      },
    })

    await useConnectionStore.getState().closeConnection('sess-1')

    // Connection should NOT have been closed
    expect(closeConnectionSpy).not.toHaveBeenCalled()
    expect(useConnectionStore.getState().activeConnections['sess-1']).toBeDefined()
    expect(showErrorToast).toHaveBeenCalledWith(
      'Connection not closed',
      expect.stringContaining('Could not save pending edits')
    )
  })

  it('proceeds with close when saveCurrentRow succeeds', async () => {
    mockIPC((cmd) => {
      if (cmd === 'close_connection') return null
      if (cmd === 'update_table_row') return null
      if (cmd === 'update_result_cell') return null
      if (cmd === 'evict_results') return null
      return null
    })

    // Set up active connection
    useConnectionStore.setState({
      activeConnections: {
        'sess-1': {
          id: 'sess-1',
          profile: mockSavedConnection,
          status: 'connected',
          serverVersion: '8.0.35',
        },
      },
      activeTabId: 'sess-1',
    })

    // Set up workspace tab
    useWorkspaceStore.setState({
      tabsByConnection: {
        'sess-1': [{ id: 'qt-1', type: 'query-editor', label: 'Query 1', connectionId: 'sess-1' }],
      },
    })

    // Set up query store with pending edits that will succeed
    useQueryStore.setState({
      tabs: {
        'qt-1': {
          ...useQueryStore.getState().getTabState('qt-1'),
          editMode: 'testdb.users',
          editConnectionId: 'sess-1',
          editingRowIndex: 0,
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
          ],
          rows: [[1, 'Alice']],
          currentPage: 1,
          pageSize: 1000,
          editState: {
            rowKey: { id: 1 },
            originalValues: { id: 1, name: 'Alice' },
            currentValues: { id: 1, name: 'Updated' },
            modifiedColumns: new Set(['name']),
            isNewRow: false,
          },
          editTableMetadata: {
            'testdb.users': {
              database: 'testdb',
              table: 'users',
              columns: [],
              primaryKey: {
                keyColumns: ['id'],
                hasAutoIncrement: true,
                isUniqueKeyFallback: false,
              },
            },
          },
        },
      },
    })

    await useConnectionStore.getState().closeConnection('sess-1')

    // Connection should have been closed
    expect(useConnectionStore.getState().activeConnections['sess-1']).toBeUndefined()
  })
})
