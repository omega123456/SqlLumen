/**
 * Tests for connection-store: close-connection guard with dirty non-active query results.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useConnectionStore, _resetListenersSetup } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { resetWorkspaceStore } from '../helpers/workspace-test-utils'
import { useQueryStore, DEFAULT_RESULT_STATE } from '../../stores/query-store'
import { useTableDataStore } from '../../stores/table-data-store'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { ipc } from '../ipc-mock'
import type { ActiveConnection } from '../../types/connection'

function makeActiveConnection(sessionId: string, profileId: string, name: string): ActiveConnection {
  return {
    id: sessionId,
    profile: {
      id: profileId,
      name,
      host: 'localhost',
      port: 3306,
      username: 'root',
      hasPassword: true,
      defaultDatabase: 'testdb',
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
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    sessionDatabase: 'testdb',
    status: 'connected',
    serverVersion: '8.0.0',
  }
}

function dirtyQueryResult(queryId: string) {
  return {
    ...DEFAULT_RESULT_STATE,
    resultStatus: 'success' as const,
    queryId,
    editState: {
      rowKey: { id: 1 },
      originalValues: { name: 'Alice' },
      currentValues: { name: 'Bob' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    },
    editingRowIndex: 0,
  }
}

beforeEach(() => {
  // Reset all stores
  useConnectionStore.setState({
    savedConnections: [],
    connectionGroups: [],
    activeConnections: {},
    activeConnectionOrder: [],
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
  resetWorkspaceStore()
  useQueryStore.setState({ tabs: {} })
  useTableDataStore.setState({ tabs: {} })
  useObjectEditorStore.setState({ tabs: {} })
  _resetListenersSetup()

  ipc.override('close_connection', () => null)
  ipc.override('evict_results', () => null)
  ipc.override('log_frontend', () => undefined)
  ipc.override('build_schema_index', () => undefined)
  ipc.override('get_index_status', () => ({ status: 'ready' }))
  ipc.override('invalidate_schema_index', () => undefined)
  ipc.override('semantic_search', () => [])
  ipc.override('list_indexed_tables', () => [])
})

describe('useConnectionStore — closeConnection guard for dirty non-active query results', () => {
  function setupActiveConnection() {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': {
          id: 'session-1',
          profile: {
            id: 'profile-1',
            name: 'Test Connection',
            host: 'localhost',
            port: 3306,
            username: 'root',
            hasPassword: true,
            defaultDatabase: 'testdb',
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
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
          sessionDatabase: 'testdb',
          status: 'connected',
          serverVersion: '8.0.0',
        },
      },
      activeTabId: 'session-1',
    })
  }

  it('prompts the user when a query tab has dirty non-active result', async () => {
    setupActiveConnection()

    // Open a query-editor tab
    const tabId = useWorkspaceStore.getState().openQueryTab('session-1')

    // Set up query store with dirty non-active result (index 1 is dirty, active is 0)
    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1; SELECT 2',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'session-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q1',
            },
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q2',
              editState: {
                rowKey: { id: 1 },
                originalValues: { name: 'Alice' },
                currentValues: { name: 'Bob' },
                modifiedColumns: new Set(['name']),
                isNewRow: false,
              },
              editingRowIndex: 0,
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
          activeBottomPanelItem: { type: 'result' },
        },
      },
    })

    // Mock confirm to reject
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(false)

    await useConnectionStore.getState().closeConnection('session-1')

    // Connection should NOT have been closed
    expect(useConnectionStore.getState().activeConnections['session-1']).toBeDefined()
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('unsaved changes in non-active query results')
    )

    confirmSpy.mockRestore()
  })

  it('proceeds with close when user confirms dirty non-active result prompt', async () => {
    setupActiveConnection()

    const tabId = useWorkspaceStore.getState().openQueryTab('session-1')

    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1; SELECT 2',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'session-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q1',
            },
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q2',
              editState: {
                rowKey: { id: 1 },
                originalValues: { name: 'Alice' },
                currentValues: { name: 'Bob' },
                modifiedColumns: new Set(['name']),
                isNewRow: false,
              },
              editingRowIndex: 0,
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
          activeBottomPanelItem: { type: 'result' },
        },
      },
    })

    // Mock confirm to accept
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true)

    await useConnectionStore.getState().closeConnection('session-1')

    // Connection should have been closed
    expect(useConnectionStore.getState().activeConnections['session-1']).toBeUndefined()
    expect(confirmSpy).toHaveBeenCalled()

    confirmSpy.mockRestore()
  })

  it('does not prompt when only the active result is dirty (saves it instead)', async () => {
    setupActiveConnection()

    const tabId = useWorkspaceStore.getState().openQueryTab('session-1')

    // Set up query store with dirty ACTIVE result with no actual modifications
    // (empty modifiedColumns means save is a no-op)
    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'session-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q1',
              editState: {
                rowKey: { id: 1 },
                originalValues: { name: 'Alice' },
                currentValues: { name: 'Alice' },
                modifiedColumns: new Set<string>(),
                isNewRow: false,
              },
              editingRowIndex: 0,
              editConnectionId: 'session-1',
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
          activeBottomPanelItem: { type: 'result' },
        },
      },
    })

    // No confirm needed
    const confirmSpy = vi.spyOn(globalThis, 'confirm')

    await useConnectionStore.getState().closeConnection('session-1')

    // Connection should have been closed (save succeeded — no modifications)
    expect(useConnectionStore.getState().activeConnections['session-1']).toBeUndefined()
    // confirm should NOT have been called
    expect(confirmSpy).not.toHaveBeenCalled()

    confirmSpy.mockRestore()
  })

  it('saves active dirty result even when non-active dirty results also exist', async () => {
    setupActiveConnection()

    const tabId = useWorkspaceStore.getState().openQueryTab('session-1')

    // Both active (index 0) and non-active (index 1) are dirty
    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1; SELECT 2',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'session-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q1',
              editMode: 'users',
              editConnectionId: 'session-1',
              editState: {
                rowKey: { id: 1 },
                originalValues: { name: 'Alice' },
                currentValues: { name: 'Modified' },
                modifiedColumns: new Set(['name']),
                isNewRow: false,
              },
              editingRowIndex: 0,
            },
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q2',
              editState: {
                rowKey: { id: 2 },
                originalValues: { email: 'a@b.com' },
                currentValues: { email: 'x@y.com' },
                modifiedColumns: new Set(['email']),
                isNewRow: false,
              },
              editingRowIndex: 0,
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
          activeBottomPanelItem: { type: 'result' },
        },
      },
    })

    // User confirms losing non-active dirty results
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true)

    // Mock saveCurrentRow to succeed (avoids needing full edit metadata)
    const saveCurrentRowSpy = vi
      .spyOn(useQueryStore.getState(), 'saveCurrentRow')
      .mockResolvedValue(true)

    await useConnectionStore.getState().closeConnection('session-1')

    // confirm should have been called for the non-active dirty result
    expect(confirmSpy).toHaveBeenCalled()
    // saveCurrentRow should ALSO have been called for the active dirty result
    expect(saveCurrentRowSpy).toHaveBeenCalledWith(tabId)
    // Connection should have been closed
    expect(useConnectionStore.getState().activeConnections['session-1']).toBeUndefined()

    confirmSpy.mockRestore()
    saveCurrentRowSpy.mockRestore()
  })
})

describe('useConnectionStore — Process List integration', () => {
  function setupActiveConnection() {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': {
          id: 'session-1',
          profile: {
            id: 'profile-1',
            name: 'Test Connection',
            host: 'localhost',
            port: 3306,
            username: 'root',
            hasPassword: true,
            defaultDatabase: 'testdb',
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
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
          sessionDatabase: 'testdb',
          status: 'connected',
          serverVersion: '8.0.0',
        },
      },
      activeTabId: 'session-1',
    })
  }

  it('closeConnection resets processlist store state', async () => {
    setupActiveConnection()
    // Open processlist tab and set some state
    useWorkspaceStore.getState().openProcessListTab('session-1')

    const { useProcessListStore } = await import('../../stores/processlist-store')
    useProcessListStore.setState({
      rowsByConnection: {
        'session-1': [
          {
            id: 1,
            user: 'root',
            host: 'localhost',
            db: 'test',
            command: 'Query',
            time: 10,
            state: 'executing',
            info: 'SELECT 1',
          },
        ],
      },
      selectedIdsByConnection: { 'session-1': new Set([1]) },
    })

    await useConnectionStore.getState().closeConnection('session-1')

    expect(useProcessListStore.getState().rowsByConnection['session-1']).toBeUndefined()
    expect(useProcessListStore.getState().selectedIdsByConnection['session-1']).toBeUndefined()
  })
})

describe('useConnectionStore — openConnection creates default workspace tabs', () => {
  it('opens History tab at index 0 and Process List tab at index 1', async () => {
    // Set up a saved connection profile
    useConnectionStore.setState({
      savedConnections: [
        {
          id: 'profile-1',
          name: 'Test Connection',
          host: 'localhost',
          port: 3306,
          username: 'root',
          hasPassword: true,
          defaultDatabase: 'testdb',
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
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
    })

    ipc.override('open_connection', () => ({ sessionId: 'session-1', serverVersion: '8.0.0' }))

    await useConnectionStore.getState().openConnection('profile-1')

    const tabs = useWorkspaceStore.getState().tabsByConnection['session-1']
    expect(tabs).toBeDefined()
    expect(tabs!.length).toBeGreaterThanOrEqual(2)
    expect(tabs![0].type).toBe('history')
    expect(tabs![1].type).toBe('processlist')
  })
})

describe('useConnectionStore — explicit active connection order lifecycle', () => {
  it('removes closed sessions from explicit order and activates next by order', async () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': {
          id: 'session-1',
          profile: {
            id: 'profile-1',
            name: 'A',
            host: 'localhost',
            port: 3306,
            username: 'root',
            hasPassword: true,
            defaultDatabase: 'testdb',
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
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
          sessionDatabase: 'testdb',
          status: 'connected',
          serverVersion: '8.0.0',
        },
        'session-2': {
          id: 'session-2',
          profile: {
            id: 'profile-2',
            name: 'B',
            host: 'localhost',
            port: 3306,
            username: 'root',
            hasPassword: true,
            defaultDatabase: 'testdb',
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
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
          sessionDatabase: 'testdb',
          status: 'connected',
          serverVersion: '8.0.0',
        },
      },
      activeConnectionOrder: ['session-2', 'session-1'],
      activeTabId: 'session-2',
    })

    await useConnectionStore.getState().closeConnection('session-2')

    expect(useConnectionStore.getState().activeConnectionOrder).toEqual(['session-1'])
    expect(useConnectionStore.getState().activeTabId).toBe('session-1')
  })

  it('reorders active sessions by insert index', () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': {
          id: 'session-1',
          profile: {
            id: 'profile-1',
            name: 'A',
            host: 'localhost',
            port: 3306,
            username: 'root',
            hasPassword: true,
            defaultDatabase: 'testdb',
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
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
          sessionDatabase: 'testdb',
          status: 'connected',
          serverVersion: '8.0.0',
        },
        'session-2': {
          id: 'session-2',
          profile: {
            id: 'profile-2',
            name: 'B',
            host: 'localhost',
            port: 3306,
            username: 'root',
            hasPassword: true,
            defaultDatabase: 'testdb',
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
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
          sessionDatabase: 'testdb',
          status: 'connected',
          serverVersion: '8.0.0',
        },
      },
      activeConnectionOrder: ['session-1', 'session-2'],
      activeTabId: 'session-1',
    })

    useConnectionStore.getState().reorderActiveConnection('session-2', 0)

    expect(useConnectionStore.getState().activeConnectionOrder).toEqual(['session-2', 'session-1'])
    expect(useConnectionStore.getState().activeTabId).toBe('session-1')
  })
})

describe('useConnectionStore — closeAllConnections', () => {
  it('closes every active connection and leaves no residual workspace tabs', async () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': makeActiveConnection('session-1', 'profile-1', 'A'),
        'session-2': makeActiveConnection('session-2', 'profile-2', 'B'),
      },
      activeConnectionOrder: ['session-1', 'session-2'],
      activeTabId: 'session-1',
    })
    useWorkspaceStore.getState().openQueryTab('session-1')
    useWorkspaceStore.getState().openQueryTab('session-2')

    await useConnectionStore.getState().closeAllConnections()

    const state = useConnectionStore.getState()
    expect(state.activeConnections).toEqual({})
    expect(state.activeConnectionOrder).toEqual([])
    expect(state.activeTabId).toBeNull()
    expect(useWorkspaceStore.getState().tabsByConnection['session-1']).toBeUndefined()
    expect(useWorkspaceStore.getState().tabsByConnection['session-2']).toBeUndefined()
  })

  it('reports failure when not every targeted connection closes', async () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': makeActiveConnection('session-1', 'profile-1', 'A'),
        'session-2': makeActiveConnection('session-2', 'profile-2', 'B'),
      },
      activeConnectionOrder: ['session-1', 'session-2'],
      activeTabId: 'session-1',
    })

    const originalCloseConnection = useConnectionStore.getState().closeConnection
    const closeConnectionSpy = vi
      .fn(originalCloseConnection)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    useConnectionStore.setState({
      closeConnection: closeConnectionSpy,
    })

    const allClosed = await useConnectionStore.getState().closeAllConnections({ force: true })

    expect(allClosed).toBe(false)
    expect(closeConnectionSpy).toHaveBeenNthCalledWith(1, 'session-1', { force: true })
    expect(closeConnectionSpy).toHaveBeenNthCalledWith(2, 'session-2', { force: true })
  })
})

describe('useConnectionStore — force close', () => {
  it('closes without prompting via globalThis.confirm even with dirty edits', async () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': makeActiveConnection('session-1', 'profile-1', 'A'),
      },
      activeConnectionOrder: ['session-1'],
      activeTabId: 'session-1',
    })

    const tabId = useWorkspaceStore.getState().openQueryTab('session-1')
    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1; SELECT 2',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'session-1',
          results: [dirtyQueryResult('q1'), dirtyQueryResult('q2')],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
          activeBottomPanelItem: { type: 'result' },
        },
      },
    })

    const confirmSpy = vi.spyOn(globalThis, 'confirm')
    const saveCurrentRowSpy = vi.spyOn(useQueryStore.getState(), 'saveCurrentRow')

    await useConnectionStore.getState().closeConnection('session-1', { force: true })

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(saveCurrentRowSpy).not.toHaveBeenCalled()
    expect(useConnectionStore.getState().activeConnections['session-1']).toBeUndefined()

    confirmSpy.mockRestore()
    saveCurrentRowSpy.mockRestore()
  })
})

describe('useConnectionStore — connectionsWithUnsavedEdits', () => {
  it('returns nothing when no edits are pending', () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': makeActiveConnection('session-1', 'profile-1', 'A'),
      },
      activeConnectionOrder: ['session-1'],
      activeTabId: 'session-1',
    })
    useWorkspaceStore.getState().openQueryTab('session-1')

    expect(useConnectionStore.getState().connectionsWithUnsavedEdits()).toEqual([])
  })

  it('identifies a connection with a dirty query-result tab', () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': makeActiveConnection('session-1', 'profile-1', 'A'),
      },
      activeConnectionOrder: ['session-1'],
      activeTabId: 'session-1',
    })
    const tabId = useWorkspaceStore.getState().openQueryTab('session-1')
    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'session-1',
          results: [dirtyQueryResult('q1')],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
          activeBottomPanelItem: { type: 'result' },
        },
      },
    })

    expect(useConnectionStore.getState().connectionsWithUnsavedEdits()).toEqual(['session-1'])
  })

  it('identifies a connection with a dirty table-data tab', () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': makeActiveConnection('session-1', 'profile-1', 'A'),
      },
      activeConnectionOrder: ['session-1'],
      activeTabId: 'session-1',
    })
    const tabId = useWorkspaceStore.getState().restoreTableDataTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'session-1',
      databaseName: 'testdb',
      objectName: 'users',
      objectType: 'table',
    })
    useTableDataStore.setState({
      tabs: {
        [tabId]: {
          editState: {
            rowKey: { id: 1 },
            originalValues: { name: 'Alice' },
            currentValues: { name: 'Bob' },
            modifiedColumns: new Set(['name']),
            isNewRow: false,
          },
        },
      } as never,
    })

    expect(useConnectionStore.getState().connectionsWithUnsavedEdits()).toEqual(['session-1'])
  })

  it('identifies a connection with a dirty object-editor tab', () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': makeActiveConnection('session-1', 'profile-1', 'A'),
      },
      activeConnectionOrder: ['session-1'],
      activeTabId: 'session-1',
    })
    useWorkspaceStore.setState((state) => ({
      tabsByConnection: {
        ...state.tabsByConnection,
        'session-1': [
          {
            id: 'oe-tab-1',
            type: 'object-editor',
            label: 'my_view',
            connectionId: 'session-1',
            databaseName: 'testdb',
            objectName: 'my_view',
            objectType: 'view',
            mode: 'alter',
          },
        ],
      },
    }))
    useObjectEditorStore.setState({
      tabs: {
        'oe-tab-1': {
          connectionId: 'session-1',
          database: 'testdb',
          objectName: 'my_view',
          objectType: 'view',
          mode: 'alter',
          content: 'SELECT 2',
          originalContent: 'SELECT 1',
          isLoading: false,
          isSaving: false,
          error: null,
          pendingNavigationAction: null,
          savedObjectName: null,
        },
      },
    })

    expect(useConnectionStore.getState().connectionsWithUnsavedEdits()).toEqual(['session-1'])
  })
})
