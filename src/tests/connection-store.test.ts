import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useConnectionStore, _resetListenersSetup } from '../stores/connection-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { useQueryStore } from '../stores/query-store'
import { useTableDataStore } from '../stores/table-data-store'
import { useToastStore, _resetToastTimeoutsForTests } from '../stores/toast-store'
import type { SavedConnection, ConnectionGroup } from '../types/connection'
import { makeTabState } from './helpers/query-test-utils'
import { ipc, expectToast } from './ipc-mock'

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
    activeConnectionOrder: [],
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
  useToastStore.setState({ toasts: [] })
  _resetToastTimeoutsForTests()
  _resetListenersSetup()
  const tauriInternals = (
    window as unknown as Window & {
      __TAURI_INTERNALS__?: {
        transformCallback?: (cb: unknown, once?: boolean) => string
      }
    }
  ).__TAURI_INTERNALS__
  if (!tauriInternals?.transformCallback) {
    ;(
      window as unknown as Window & {
        __TAURI_INTERNALS__?: {
          transformCallback?: (cb: unknown, once?: boolean) => string
        }
      }
    ).__TAURI_INTERNALS__ = {
      ...tauriInternals,
      transformCallback: () => 'mock-callback-id',
    }
  }
})

// --- Tests ---

describe('useConnectionStore — initial state', () => {
  it('has correct initial state', () => {
    const state = useConnectionStore.getState()
    expect(state.savedConnections).toEqual([])
    expect(state.connectionGroups).toEqual([])
    expect(state.activeConnections).toEqual({})
    expect(state.activeConnectionOrder).toEqual([])
    expect(state.activeTabId).toBeNull()
    expect(state.dialogOpen).toBe(false)
    expect(state.error).toBeNull()
  })
})

describe('useConnectionStore — fetchSavedConnections', () => {
  it('loads connections and groups from backend', async () => {
    ipc.override('list_connections', () => [mockSavedConnection])
    ipc.override('list_connection_groups', () => [mockGroup])

    await useConnectionStore.getState().fetchSavedConnections()

    const state = useConnectionStore.getState()
    expect(state.savedConnections).toEqual([mockSavedConnection])
    expect(state.connectionGroups).toEqual([mockGroup])
    expect(state.error).toBeNull()
  })

  it('sets error on IPC failure', async () => {
    ipc.override('list_connections', () => {
      throw new Error('Database error')
    })

    await useConnectionStore.getState().fetchSavedConnections()

    const state = useConnectionStore.getState()
    expect(state.error).toBe('Database error')
  })

  it('clears previous error on success', async () => {
    useConnectionStore.setState({ error: 'previous error' })
    ipc.override('list_connections', () => [])
    ipc.override('list_connection_groups', () => [])

    await useConnectionStore.getState().fetchSavedConnections()
    expect(useConnectionStore.getState().error).toBeNull()
  })
})

describe('useConnectionStore — openConnection', () => {
  it('adds to activeConnections and sets activeTabId', async () => {
    useConnectionStore.setState({ savedConnections: [mockSavedConnection] })
    ipc.override('open_connection', () => ({ sessionId: 'sess-1', serverVersion: '8.0.35' }))

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
    expect(state.activeConnectionOrder).toEqual(['sess-1'])
    expect(state.error).toBeNull()
  })

  it('opens multiple sessions for the same saved profile', async () => {
    useConnectionStore.setState({ savedConnections: [mockSavedConnection] })
    let n = 0
    ipc.override('open_connection', () => {
      n += 1
      return { sessionId: `sess-${n}`, serverVersion: '8.0.35' }
    })

    await useConnectionStore.getState().openConnection('conn-1')
    await useConnectionStore.getState().openConnection('conn-1')

    const state = useConnectionStore.getState()
    expect(Object.keys(state.activeConnections).sort()).toEqual(['sess-1', 'sess-2'])
    expect(state.activeConnections['sess-1'].profile.id).toBe('conn-1')
    expect(state.activeConnections['sess-2'].profile.id).toBe('conn-1')
    expect(state.activeTabId).toBe('sess-2')
    expect(state.activeConnectionOrder).toEqual(['sess-1', 'sess-2'])
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
    ipc.override('open_connection', () => {
      throw new Error('Connection refused')
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
      activeConnectionOrder: ['sess-1'],
      activeTabId: 'sess-1',
    })
    ipc.override('close_connection', () => null)

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
      activeConnectionOrder: ['sess-1', 'sess-2'],
      activeTabId: 'sess-1',
    })
    ipc.override('close_connection', () => null)

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
      activeConnectionOrder: ['sess-1'],
      activeTabId: 'sess-1',
    })
    ipc.override('close_connection', () => null)

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
      activeConnectionOrder: ['sess-1', 'sess-2'],
      activeTabId: 'sess-1',
    })
    ipc.override('close_connection', () => null)

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
      activeConnectionOrder: ['sess-1'],
      activeTabId: 'sess-1',
    })
    ipc.override('close_connection', () => {
      throw new Error('Close failed')
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

describe('useConnectionStore — active connection order normalization', () => {
  it('normalizes missing order values and renders every active session once', () => {
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
      activeConnectionOrder: [],
    })

    useConnectionStore.getState().normalizeActiveConnectionOrder()

    expect(useConnectionStore.getState().activeConnectionOrder).toEqual(['sess-1', 'sess-2'])
  })

  it('drops stale and duplicate ids during normalization', () => {
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
      activeConnectionOrder: ['stale', 'sess-2', 'sess-2', 'sess-1'],
    })

    useConnectionStore.getState().normalizeActiveConnectionOrder()

    expect(useConnectionStore.getState().activeConnectionOrder).toEqual(['sess-2', 'sess-1'])
  })

  it('reorders without changing active selection', () => {
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
      activeConnectionOrder: ['sess-1', 'sess-2'],
      activeTabId: 'sess-1',
    })

    useConnectionStore.getState().reorderActiveConnection('sess-2', 0)

    expect(useConnectionStore.getState().activeConnectionOrder).toEqual(['sess-2', 'sess-1'])
    expect(useConnectionStore.getState().activeTabId).toBe('sess-1')
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
  it('returns an unlisten function', async () => {
    const unlisten = await useConnectionStore.getState().setupEventListeners()
    expect(unlisten).toEqual(expect.any(Function))
  })

  it('is idempotent — calling twice only registers once', async () => {
    await useConnectionStore.getState().setupEventListeners()

    const firstUnlisten = await useConnectionStore.getState().setupEventListeners()
    expect(firstUnlisten).toBeUndefined()
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

    await useConnectionStore.getState().setupEventListeners()

    await ipc.emit('connection-status-changed', {
      connectionId: 'sess-1',
      status: 'disconnected',
      message: 'Lost connection',
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
    ipc.override('update_connection', () => null)

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
    ipc.override('update_connection', () => null)

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
    ipc.override('update_connection', () => {
      throw new Error('IPC write failed')
    })

    await useConnectionStore.getState().updateDefaultDatabase('sess-1', 'new_db')

    // Should revert to the original default database
    const state = useConnectionStore.getState()
    expect(state.activeConnections['sess-1'].profile.defaultDatabase).toBe(
      mockSavedConnection.defaultDatabase
    )
    expect(state.savedConnections[0].defaultDatabase).toBe(mockSavedConnection.defaultDatabase)
    expect(consoleSpy).not.toHaveBeenCalled()
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
    ipc.override('select_database', () => {
      selectDatabaseSpy()
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

    ipc.override('select_database', () => {
      throw new Error('USE failed')
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
    ipc.override('close_connection', () => {
      closeConnectionSpy()
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
        'qt-1': makeTabState({
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
              foreignKeys: [],
            },
          },
        }),
      },
    })

    await useConnectionStore.getState().closeConnection('sess-1')

    // Connection should NOT have been closed
    expect(closeConnectionSpy).not.toHaveBeenCalled()
    expect(useConnectionStore.getState().activeConnections['sess-1']).toBeDefined()
    await expectToast('error', 'Connection not closed')
  })

  it('does not close connection when table-data saveCurrentRow fails', async () => {
    const closeConnectionSpy = vi.fn()
    ipc.override('close_connection', () => {
      closeConnectionSpy()
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
          currentPage: 1,
          pageSize: 100,
          executionTimeMs: 0,
          primaryKey: null, // No PK → save will fail
          viewMode: 'grid',
          selectedRowKey: null,
          selectedCell: null,
          isExportDialogOpen: false,
          filterModel: [],
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
          scrollRow: 0,
          scrollCol: 0,
        },
      },
    })

    await useConnectionStore.getState().closeConnection('sess-1')

    // Connection should NOT have been closed
    expect(closeConnectionSpy).not.toHaveBeenCalled()
    expect(useConnectionStore.getState().activeConnections['sess-1']).toBeDefined()
    await expectToast('error', 'Connection not closed')
  })

  it('proceeds with close when saveCurrentRow succeeds', async () => {
    ipc.override('close_connection', () => null)
    ipc.override('update_table_row', () => null)
    ipc.override('update_result_cell', () => null)
    ipc.override('evict_results', () => null)

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
        'qt-1': makeTabState({
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
              foreignKeys: [],
            },
          },
        }),
      },
    })

    await useConnectionStore.getState().closeConnection('sess-1')

    // Connection should have been closed
    expect(useConnectionStore.getState().activeConnections['sess-1']).toBeUndefined()
  })
})
